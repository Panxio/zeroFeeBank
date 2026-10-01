import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { formatMoney } from '../../domain/money/money.js';
import {
  IdempotenciaEjecutor,
  type ResultadoIdempotente,
} from '../../infra/idempotencia.ejecutor.js';
import { TransferenciasService } from './transferencias.service.js';
import { CuentaNoEncontradaError } from './transferencias.errors.js';
import type { TransferenciaRespuestaDto } from './transferencias.dto.js';

export interface ParametrosTransferencia {
  clave: string;
  titularId: string;
  origenId: string;
  destinoId: string;
  montoOriginal: string;
  montoCentavos: bigint;
}

export type ResultadoTransferencia = ResultadoIdempotente<TransferenciaRespuestaDto>;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function esRespuestaValida(valor: unknown): valor is TransferenciaRespuestaDto {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    'transaccionId' in valor &&
    typeof valor.transaccionId === 'string' &&
    'origenId' in valor &&
    typeof valor.origenId === 'string' &&
    'destinoId' in valor &&
    typeof valor.destinoId === 'string' &&
    'monto' in valor &&
    typeof valor.monto === 'string'
  );
}

/**
 * S-06 · la transferencia, hecha idempotente. El MECANISMO vive en IdempotenciaEjecutor
 * (src/infra) desde S-12; acá queda lo que es propio de la transferencia: qué entra en la
 * huella, qué se ejecuta, y qué forma tiene la respuesta.
 */
@Injectable()
export class IdempotenciaService {
  constructor(
    private readonly ejecutor: IdempotenciaEjecutor,
    private readonly transferenciasService: TransferenciasService,
  ) {}

  async ejecutar(params: ParametrosTransferencia): Promise<ResultadoTransferencia> {
    return this.ejecutor.ejecutar<TransferenciaRespuestaDto>({
      clave: params.clave,
      endpoint: 'POST /transferencias',
      huellaDe: {
        titularId: params.titularId,
        origenId: params.origenId,
        destinoId: params.destinoId,
        monto: params.montoOriginal,
      },
      estadoHttp: 201,
      esRespuestaValida,
      reconstruir: (r) => ({
        transaccionId: r.transaccionId,
        origenId: r.origenId,
        destinoId: r.destinoId,
        monto: r.monto,
      }),
      operacion: async (tx) => {
        // Un id que no es UUID nunca va a existir, y la base lanzaría un error de tipo en vez
        // del 404 del contrato. Se comprueba DENTRO de la transacción y después de la clave,
        // para que un replay de una petición vieja siga respondiendo lo guardado.
        if (!UUID_REGEX.test(params.origenId)) {
          throw new CuentaNoEncontradaError(params.origenId);
        }
        if (!UUID_REGEX.test(params.destinoId)) {
          throw new CuentaNoEncontradaError(params.destinoId);
        }

        const cuenta = await tx.cuenta.findUnique({
          where: { id: params.origenId },
          select: { titularId: true },
        });

        if (!cuenta || cuenta.titularId !== params.titularId) {
          throw new CuentaNoEncontradaError(params.origenId);
        }

        // S-21 · un cliente no le transfiere a una cuenta de sistema: el mismo 404 que un destino
        // inexistente (J1) y antes del motor, así no compite con FONDOS_INSUFICIENTES (J2). Va
        // acá y no en el motor porque apertura, boletas, pagos y préstamo sí mueven plata hacia
        // y desde cuentas SISTEMA por el motor. Sólo SISTEMA: PRESTAMO sigue siendo destino (J3).
        const destino = await tx.cuenta.findUnique({
          where: { id: params.destinoId },
          select: { tipo: true },
        });
        if (destino?.tipo === 'SISTEMA') {
          throw new CuentaNoEncontradaError(params.destinoId);
        }

        const transaccionId = randomUUID();
        await this.transferenciasService.transferirEn(tx, {
          transaccionId,
          origenId: params.origenId,
          destinoId: params.destinoId,
          montoCentavos: params.montoCentavos,
        });

        return {
          transaccionId,
          origenId: params.origenId,
          destinoId: params.destinoId,
          monto: formatMoney(params.montoCentavos),
        };
      },
    });
  }
}
