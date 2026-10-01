import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma.service.js';
import { RelojService } from '../../infra/reloj.js';
import { CuentasSistemaRepository } from '../../infra/cuentas-sistema.repository.js';
import {
  IdempotenciaEjecutor,
  type ResultadoIdempotente,
} from '../../infra/idempotencia.ejecutor.js';
import { TransferenciasService } from '../transferencias/transferencias.service.js';
import { formatMoney } from '../../domain/money/money.js';
import {
  assertDentroDelTope,
  diaUtcDe,
} from '../../domain/transferencia/otros-bancos.js';
import { UUID_REGEX } from '../cuentas/cuentas.constants.js';
import {
  CODIGO_CUENTA_OTROS_BANCOS,
  CONCEPTO_ASIENTO_OTRO_BANCO,
  ENDPOINT_POST_OTROS_BANCOS,
} from './transferencias-otros-bancos.constants.js';
import {
  CuentaOrigenNoEncontradaError,
  TransferenciaNoEncontradaError,
} from './transferencias-otros-bancos.errors.js';
import {
  esRespuestaValida,
  type TransferenciaOtroBancoRespuestaDto,
} from './transferencias-otros-bancos.dto.js';

export type ResultadoTransferenciaOtroBanco =
  ResultadoIdempotente<TransferenciaOtroBancoRespuestaDto>;

/**
 * S-22 · transferencia a otro banco.
 * Ver specs/S-22-otros-bancos.md § 3, § 4 y § 5.
 */
@Injectable()
export class TransferenciasOtrosBancosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotenciaEjecutor: IdempotenciaEjecutor,
    private readonly transferenciasService: TransferenciasService,
    private readonly cuentasSistema: CuentasSistemaRepository,
    private readonly reloj: RelojService,
  ) {}

  async transferir(params: {
    titularId: string;
    clave: string;
    cuentaOrigenId: string;
    montoOriginal: string;
    montoCentavos: bigint;
    banco: string;
    numeroCuenta: string;
    tipoCuenta: string;
  }): Promise<ResultadoTransferenciaOtroBanco> {
    const {
      titularId,
      clave,
      cuentaOrigenId,
      montoOriginal,
      montoCentavos,
      banco,
      numeroCuenta,
      tipoCuenta,
    } = params;

    return this.idempotenciaEjecutor.ejecutar<TransferenciaOtroBancoRespuestaDto>({
      clave,
      endpoint: ENDPOINT_POST_OTROS_BANCOS,
      huellaDe: {
        titularId,
        cuentaOrigenId,
        monto: montoOriginal,
        banco,
        numeroCuenta,
        tipoCuenta,
      },
      estadoHttp: 201,
      esRespuestaValida,
      reconstruir: (r) => ({
        id: r.id,
        transaccionId: r.transaccionId,
        cuentaOrigenId: r.cuentaOrigenId,
        monto: r.monto,
        banco: r.banco,
        numeroCuenta: r.numeroCuenta,
        tipoCuenta: r.tipoCuenta,
        realizadaEn: r.realizadaEn,
      }),
      operacion: async (tx) => {
        // Paso 10: titularidad y tipo de cuenta de origen (S-18 J4, specs/S-22 § 3.1)
        const origen = await tx.cuenta.findUnique({
          where: { id: cuentaOrigenId },
          select: { id: true, titularId: true, tipo: true },
        });
        if (!origen || origen.titularId !== titularId || origen.tipo === 'SISTEMA') {
          throw new CuentaOrigenNoEncontradaError();
        }

        const ahora = this.reloj.ahora();
        const { desde, hasta } = diaUtcDe(ahora);

        const otrosBancos = await this.cuentasSistema.obtenerOCrear(
          tx,
          CODIGO_CUENTA_OTROS_BANCOS,
          ahora,
        );

        const transaccionId = randomUUID();
        await this.transferenciasService.transferirEn(tx, {
          transaccionId,
          origenId: cuentaOrigenId,
          destinoId: otrosBancos.id,
          montoCentavos,
          concepto: CONCEPTO_ASIENTO_OTRO_BANCO,
          en: ahora,
          trasBloquear: async (txMotor) => {
            // Paso 11: acumulado del día del ledger, BAJO el bloqueo de cuentaOrigenId (D4)
            const filas = await txMotor.$queryRaw<Array<{ acumulado: bigint }>>(
              Prisma.sql`SELECT COALESCE(SUM(-m.monto_centavos), 0)::bigint AS acumulado
                         FROM movimiento m
                         JOIN transaccion t ON t.id = m.transaccion_id
                         WHERE m.cuenta_id = ${cuentaOrigenId}::uuid
                           AND t.concepto = ${CONCEPTO_ASIENTO_OTRO_BANCO}
                           AND t.creada_en >= ${desde}
                           AND t.creada_en < ${hasta}`,
            );
            const acumulado = filas[0]?.acumulado ?? 0n;
            assertDentroDelTope(acumulado, montoCentavos);
          },
        });

        const id = randomUUID();
        await tx.transferenciaOtroBanco.create({
          data: {
            id,
            transaccionId,
            cuentaOrigenId,
            titularId,
            banco,
            numeroCuenta,
            tipoCuenta,
            realizadaEn: ahora,
          },
        });

        return {
          id,
          transaccionId,
          cuentaOrigenId,
          monto: formatMoney(montoCentavos),
          banco,
          numeroCuenta,
          tipoCuenta,
          realizadaEn: ahora.toISOString(),
        };
      },
    });
  }

  async consultar(
    titularId: string,
    id: string,
  ): Promise<TransferenciaOtroBancoRespuestaDto> {
    if (!UUID_REGEX.test(id)) {
      throw new TransferenciaNoEncontradaError();
    }

    const doc = await this.prisma.transferenciaOtroBanco.findUnique({
      where: { id },
      include: {
        transaccion: {
          include: {
            movimientos: true,
          },
        },
      },
    });

    if (!doc || doc.titularId !== titularId) {
      throw new TransferenciaNoEncontradaError();
    }

    const movOrigen = doc.transaccion.movimientos.find(
      (m) => m.cuentaId === doc.cuentaOrigenId,
    );
    if (!movOrigen) {
      throw new Error(`la transferencia ${doc.id} no tiene movimiento de origen en el ledger`);
    }

    const montoCentavos = -movOrigen.montoCentavos;

    return {
      id: doc.id,
      transaccionId: doc.transaccionId,
      cuentaOrigenId: doc.cuentaOrigenId,
      monto: formatMoney(montoCentavos),
      banco: doc.banco,
      numeroCuenta: doc.numeroCuenta,
      tipoCuenta: doc.tipoCuenta,
      realizadaEn: doc.realizadaEn.toISOString(),
    };
  }
}
