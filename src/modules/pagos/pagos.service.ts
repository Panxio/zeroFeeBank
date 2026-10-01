import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infra/prisma.service.js';
import { RelojService } from '../../infra/reloj.js';
import { CuentasSistemaRepository } from '../../infra/cuentas-sistema.repository.js';
import {
  IdempotenciaEjecutor,
  type ResultadoIdempotente,
} from '../../infra/idempotencia.ejecutor.js';
import { TransferenciasService } from '../transferencias/transferencias.service.js';
import { formatMoney } from '../../domain/money/money.js';
import { CODIGO_CUENTA_CAJA } from '../cuentas/cuentas.constants.js';
import { CONCEPTO_ASIENTO_PAGO, ENDPOINT_POST_PAGOS } from './pagos.constants.js';
import { CuentaOrigenNoEncontradaError } from './pagos.errors.js';
import type { Beneficiario, ListaPagosRespuestaDto, PagoRespuestaDto } from './pagos.dto.js';

export type ResultadoPago = ResultadoIdempotente<PagoRespuestaDto>;

function esRespuestaValida(valor: unknown): valor is PagoRespuestaDto {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    'id' in valor &&
    typeof valor.id === 'string' &&
    'transaccionId' in valor &&
    typeof valor.transaccionId === 'string' &&
    'cuentaOrigenId' in valor &&
    typeof valor.cuentaOrigenId === 'string' &&
    'monto' in valor &&
    typeof valor.monto === 'string' &&
    'beneficiarioNombre' in valor &&
    typeof valor.beneficiarioNombre === 'string' &&
    'cuentaBeneficiario' in valor &&
    typeof valor.cuentaBeneficiario === 'string' &&
    'pagadoEn' in valor &&
    typeof valor.pagadoEn === 'string'
  );
}

/**
 * S-15 · el pago a un beneficiario EXTERNO (Bill Pay). Ver specs/S-15-billpay.md.
 *
 * La escritura de la fila `pago` y la del asiento van en la MISMA transacción de BD (J11):
 * toda la operación corre dentro de `IdempotenciaEjecutor.ejecutar`, así que todo rechazo
 * revierte la transacción y no hay código de limpieza que alguien pueda olvidar.
 *
 * El asiento NO se escribe acá: `TransferenciasService.transferirEn` es el motor de dinero
 * auditado (D2, D4, saldo derivado y FONDOS_INSUFICIENTES). Escribir los dos movimientos
 * por cuenta propia sería un defecto, no una alternativa.
 */
@Injectable()
export class PagosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotenciaEjecutor: IdempotenciaEjecutor,
    private readonly transferenciasService: TransferenciasService,
    private readonly cuentasSistema: CuentasSistemaRepository,
    private readonly reloj: RelojService,
  ) {}

  async pagar(params: {
    titularId: string;
    clave: string;
    cuentaOrigenId: string;
    montoOriginal: string;
    montoCentavos: bigint;
    beneficiario: Beneficiario;
  }): Promise<ResultadoPago> {
    const { titularId, clave, cuentaOrigenId, montoOriginal, montoCentavos, beneficiario } =
      params;

    return this.idempotenciaEjecutor.ejecutar<PagoRespuestaDto>({
      clave,
      endpoint: ENDPOINT_POST_PAGOS,
      // J6 + J12: la huella cubre el pago ENTERO — titularId MÁS los nueve campos del
      // cuerpo. Sin titularId, otro titular con la misma clave recibiría la respuesta
      // guardada del dueño (filtración, brazo D4). Sin los campos del beneficiario, un
      // reintento con otro destinatario devolvería el pago ANTERIOR (brazo D6).
      huellaDe: {
        titularId,
        cuentaOrigenId,
        monto: montoOriginal,
        ...beneficiario,
      },
      estadoHttp: 201,
      esRespuestaValida,
      reconstruir: (r) => ({
        id: r.id,
        transaccionId: r.transaccionId,
        cuentaOrigenId: r.cuentaOrigenId,
        monto: r.monto,
        beneficiarioNombre: r.beneficiarioNombre,
        cuentaBeneficiario: r.cuentaBeneficiario,
        pagadoEn: r.pagadoEn,
      }),
      operacion: async (tx) => {
        // J7: la titularidad del origen se comprueba DENTRO de la operación idempotente,
        // para que un replay devuelva lo guardado sin volver a ejecutar.
        const origen = await tx.cuenta.findFirst({
          where: { id: cuentaOrigenId, titularId },
          select: { id: true },
        });
        if (!origen) {
          throw new CuentaOrigenNoEncontradaError();
        }

        // DEUDA-reloj · un solo instante para la cuenta de sistema, el asiento y el pago.
        const ahora = this.reloj.ahora();

        // J1: la contrapartida es la CAJA que ya existe, resuelta por el ÚNICO mecanismo
        // con que este sistema obtiene una cuenta de sistema (duplicarlo produjo un 500).
        const caja = await this.cuentasSistema.obtenerOCrear(tx, CODIGO_CUENTA_CAJA, ahora);

        const transaccionId = randomUUID();
        await this.transferenciasService.transferirEn(tx, {
          transaccionId,
          origenId: cuentaOrigenId,
          destinoId: caja.id,
          montoCentavos,
          concepto: CONCEPTO_ASIENTO_PAGO,
          en: ahora,
        });

        // J9: cuentaBeneficiario se guarda como TEXTO OPACO. Aunque traiga la forma de una
        // cuenta real del banco, no se acredita esa cuenta ni aparece en el asiento.
        // J11: misma transacción que el asiento — un pago sin asiento sería un descuadre.
        const pago = await tx.pago.create({
          data: {
            id: randomUUID(),
            transaccionId,
            cuentaOrigenId,
            titularId,
            ...beneficiario,
            pagadoEn: ahora,
          },
        });

        return {
          id: pago.id,
          transaccionId,
          cuentaOrigenId,
          monto: montoOriginal,
          beneficiarioNombre: beneficiario.beneficiarioNombre,
          cuentaBeneficiario: beneficiario.cuentaBeneficiario,
          pagadoEn: pago.pagadoEn.toISOString(),
        };
      },
    });
  }

  /**
   * Los pagos del titular, orden `pagadoEn` desc y `id` asc (parte del contrato).
   *
   * El monto NO está en la tabla `pago` a propósito (D2: el dinero vive en el ledger):
   * se DERIVA de los movimientos de la transacción de cada pago — el débito a la cuenta
   * origen es negativo y su valor absoluto es el monto pagado.
   */
  async listar(titularId: string): Promise<ListaPagosRespuestaDto> {
    const filas = await this.prisma.pago.findMany({
      where: { titularId },
      orderBy: [{ pagadoEn: 'desc' }, { id: 'asc' }],
    });

    const origenPorTransaccion = new Map(
      filas.map((f) => [f.transaccionId, f.cuentaOrigenId] as const),
    );

    const movimientos =
      filas.length === 0
        ? []
        : await this.prisma.movimiento.findMany({
            where: { transaccionId: { in: [...origenPorTransaccion.keys()] } },
            select: { transaccionId: true, cuentaId: true, montoCentavos: true },
          });

    const debitoPorTransaccion = new Map<string, bigint>();
    for (const m of movimientos) {
      if (origenPorTransaccion.get(m.transaccionId) === m.cuentaId) {
        debitoPorTransaccion.set(m.transaccionId, m.montoCentavos);
      }
    }

    return {
      pagos: filas.map((f) => {
        const debito = debitoPorTransaccion.get(f.transaccionId);
        if (debito === undefined) {
          // J11 hace imposible un pago sin asiento; si llegara a existir, es corrupción
          // y se reporta como lo que es, no como un monto falseado.
          throw new Error(`el pago ${f.id} no tiene asiento: el monto no se puede derivar`);
        }
        return {
          id: f.id,
          transaccionId: f.transaccionId,
          cuentaOrigenId: f.cuentaOrigenId,
          monto: formatMoney(-debito),
          beneficiarioNombre: f.beneficiarioNombre,
          cuentaBeneficiario: f.cuentaBeneficiario,
          pagadoEn: f.pagadoEn.toISOString(),
        };
      }),
    };
  }
}
