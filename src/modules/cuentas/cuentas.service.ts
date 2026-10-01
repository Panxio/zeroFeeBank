import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infra/prisma.service.js';
import { RelojService } from '../../infra/reloj.js';
import { SaldosRepository } from '../../infra/saldos.repository.js';
import { CuentasSistemaRepository } from '../../infra/cuentas-sistema.repository.js';
import {
  IdempotenciaEjecutor,
  type ResultadoIdempotente,
} from '../../infra/idempotencia.ejecutor.js';
import { TransferenciasService } from '../transferencias/transferencias.service.js';
import { formatMoney } from '../../domain/money/money.js';
import { assertBalanceada, crearTransferencia } from '../../domain/ledger/ledger.js';
import {
  CODIGO_CUENTA_CAJA,
  CONCEPTO_ASIENTO_APERTURA,
  ENDPOINT_POST_CUENTAS,
  UUID_REGEX,
  esTipoApertura,
  type TipoApertura,
} from './cuentas.constants.js';
import {
  CuentaNoEncontradaError,
  CuentaOrigenRequeridaError,
} from './cuentas.errors.js';
import type {
  CuentaCreadaRespuestaDto,
  ResumenCuentasRespuestaDto,
} from './cuentas.dto.js';

export type ResultadoApertura = ResultadoIdempotente<CuentaCreadaRespuestaDto>;

function esRespuestaValida(valor: unknown): valor is CuentaCreadaRespuestaDto {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    'id' in valor &&
    typeof valor.id === 'string' &&
    'tipo' in valor &&
    esTipoApertura(valor.tipo) &&
    'saldo' in valor &&
    typeof valor.saldo === 'string' &&
    'abiertaEn' in valor &&
    typeof valor.abiertaEn === 'string' &&
    'transaccionId' in valor &&
    typeof valor.transaccionId === 'string'
  );
}

@Injectable()
export class CuentasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly saldosRepository: SaldosRepository,
    private readonly idempotenciaEjecutor: IdempotenciaEjecutor,
    private readonly transferenciasService: TransferenciasService,
    private readonly cuentasSistema: CuentasSistemaRepository,
    private readonly reloj: RelojService,
  ) {}

  async abrirCuenta(params: {
    titularId: string;
    clave: string;
    tipo: TipoApertura;
    body: Record<string, unknown>;
    montoCentavos: bigint;
    montoOriginal: string | null;
  }): Promise<ResultadoApertura> {
    const { titularId, clave, tipo, body, montoCentavos, montoOriginal } = params;

    return this.idempotenciaEjecutor.ejecutar<CuentaCreadaRespuestaDto>({
      clave,
      endpoint: ENDPOINT_POST_CUENTAS,
      huellaDe: {
        titularId,
        tipo,
        cuentaOrigenId: body['cuentaOrigenId'] ?? null,
        monto: montoOriginal,
      },
      estadoHttp: 201,
      esRespuestaValida,
      reconstruir: (r) => ({
        id: r.id,
        tipo: r.tipo,
        saldo: r.saldo,
        abiertaEn: r.abiertaEn,
        transaccionId: r.transaccionId,
      }),
      operacion: async (tx) => {
        const cuentaOrigenIdRaw = body['cuentaOrigenId'];

        if (cuentaOrigenIdRaw !== undefined) {
          const cuentaOrigenId = String(cuentaOrigenIdRaw);
          if (!UUID_REGEX.test(cuentaOrigenId)) {
            throw new CuentaNoEncontradaError(cuentaOrigenId);
          }

          const origen = await tx.cuenta.findFirst({
            where: {
              id: cuentaOrigenId,
              titularId,
            },
          });

          if (!origen) {
            throw new CuentaNoEncontradaError(cuentaOrigenId);
          }

          // DEUDA-reloj · un solo instante para la cuenta, su asiento y sus movimientos.
          const ahora = this.reloj.ahora();
          const nuevaCuenta = await tx.cuenta.create({
            data: {
              tipo,
              titularId,
              creadaEn: ahora,
            },
          });

          const transaccionId = randomUUID();
          await this.transferenciasService.transferirEn(tx, {
            transaccionId,
            origenId: cuentaOrigenId,
            destinoId: nuevaCuenta.id,
            montoCentavos,
            concepto: CONCEPTO_ASIENTO_APERTURA,
            en: ahora,
          });

          return {
            id: nuevaCuenta.id,
            tipo,
            saldo: formatMoney(montoCentavos),
            abiertaEn: nuevaCuenta.creadaEn.toISOString(),
            transaccionId,
          };
        } else {
          // No se especificó cuentaOrigenId: verificar si ya tenía cuentas
          const cuentasDelTitular = await tx.cuenta.count({
            where: { titularId },
          });

          if (cuentasDelTitular > 0) {
            throw new CuentaOrigenRequeridaError();
          }

          // Primera cuenta del titular: fondeo desde la caja del sistema.
          //
          // El INSERT ... ON CONFLICT DO NOTHING y el porqué de que no sea un `create` con
          // catch del P2002 viven ahora en CuentasSistemaRepository, que es el único lugar
          // donde este sistema obtiene una cuenta de sistema. Se extrajo en S-09, que estrena
          // la segunda (la de garantía): dos copias del mecanismo que ya produjo un 500
          // se desincronizan la primera vez que una se arregla.
          // El árbitro de que la extracción no cambió nada: `npm run sonda:caja` (15/15) y
          // `npm run test:cuentas` (38/38), ninguno de los dos tocado.
          // DEUDA-reloj · un solo instante para la cuenta de sistema, la nueva cuenta, el
          // asiento y sus movimientos.
          const ahora = this.reloj.ahora();
          const caja = await this.cuentasSistema.obtenerOCrear(tx, CODIGO_CUENTA_CAJA, ahora);

          const nuevaCuenta = await tx.cuenta.create({
            data: {
              tipo,
              titularId,
              creadaEn: ahora,
            },
          });

          const transaccionId = randomUUID();
          const asiento = crearTransferencia({
            id: transaccionId,
            origen: caja.id,
            destino: nuevaCuenta.id,
            monto: montoCentavos,
          });
          assertBalanceada(asiento);

          await tx.transaccion.create({
            data: {
              id: asiento.id,
              concepto: CONCEPTO_ASIENTO_APERTURA,
              creadaEn: ahora,
            },
          });

          await tx.movimiento.createMany({
            data: asiento.entradas.map((e) => ({
              transaccionId: asiento.id,
              cuentaId: e.cuentaId,
              montoCentavos: e.monto,
              creadoEn: ahora,
            })),
          });

          return {
            id: nuevaCuenta.id,
            tipo,
            saldo: formatMoney(montoCentavos),
            abiertaEn: nuevaCuenta.creadaEn.toISOString(),
            transaccionId,
          };
        }
      },
    });
  }

  async listarCuentas(titularId: string): Promise<ResumenCuentasRespuestaDto> {
    const cuentas = await this.prisma.cuenta.findMany({
      where: { titularId },
      orderBy: [{ creadaEn: 'asc' }, { id: 'asc' }],
    });

    const saldosMap = await this.saldosRepository.saldosDeTitular(
      this.saldosRepository.sinTransaccion,
      titularId,
    );

    return {
      cuentas: cuentas.map((c) => ({
        id: c.id,
        tipo: c.tipo,
        saldo: formatMoney(saldosMap.get(c.id) ?? 0n),
        abiertaEn: c.creadaEn.toISOString(),
      })),
    };
  }
}
