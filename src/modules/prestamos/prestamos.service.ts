import { Injectable } from '@nestjs/common';
import { RelojService } from '../../infra/reloj.js';
import {
  IdempotenciaEjecutor,
  type ResultadoIdempotente,
} from '../../infra/idempotencia.ejecutor.js';
import { formatMoney } from '../../domain/money/money.js';
import { ENDPOINT_POST_PRESTAMOS } from './prestamos.constants.js';
import { CuentaNoEncontradaError, CuentaOrigenNoEncontradaError } from './prestamos.errors.js';
import { PrestamosMotor } from './prestamos.motor.js';
import type { PrestamoRespuestaDto } from './prestamos.dto.js';

export type ResultadoPrestamo = ResultadoIdempotente<PrestamoRespuestaDto>;

function esRespuestaValida(valor: unknown): valor is PrestamoRespuestaDto {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    'cuentaPrestamoId' in valor &&
    typeof valor.cuentaPrestamoId === 'string' &&
    'transaccionId' in valor &&
    typeof valor.transaccionId === 'string' &&
    'cuentaOrigenId' in valor &&
    typeof valor.cuentaOrigenId === 'string' &&
    'monto' in valor &&
    typeof valor.monto === 'string' &&
    'pie' in valor &&
    typeof valor.pie === 'string' &&
    'otorgadoEn' in valor &&
    typeof valor.otorgadoEn === 'string'
  );
}

@Injectable()
export class PrestamosService {
  constructor(
    private readonly idempotenciaEjecutor: IdempotenciaEjecutor,
    private readonly motor: PrestamosMotor,
    private readonly reloj: RelojService,
  ) {}

  async solicitar(params: {
    titularId: string;
    clave: string;
    cuentaOrigenId: string;
    montoOriginal: string;
    pieOriginal: string;
    montoCentavos: bigint;
    pieCentavos: bigint;
  }): Promise<ResultadoPrestamo> {
    const {
      titularId,
      clave,
      cuentaOrigenId,
      montoOriginal,
      pieOriginal,
      montoCentavos,
      pieCentavos,
    } = params;

    return this.idempotenciaEjecutor.ejecutar<PrestamoRespuestaDto>({
      clave,
      endpoint: ENDPOINT_POST_PRESTAMOS,
      huellaDe: {
        titularId,
        cuentaOrigenId,
        monto: montoOriginal,
        pie: pieOriginal,
      },
      estadoHttp: 201,
      esRespuestaValida,
      reconstruir: (r) => ({
        cuentaPrestamoId: r.cuentaPrestamoId,
        transaccionId: r.transaccionId,
        cuentaOrigenId: r.cuentaOrigenId,
        monto: r.monto,
        pie: r.pie,
        otorgadoEn: r.otorgadoEn,
      }),
      operacion: async (tx) => {
        const ahora = this.reloj.ahora();
        try {
          const resultado = await this.motor.otorgarEn(tx, {
            titularId,
            cuentaOrigenId,
            montoCentavos,
            pieCentavos,
            en: ahora,
          });

          return {
            cuentaPrestamoId: resultado.cuentaPrestamoId,
            transaccionId: resultado.transaccionId,
            cuentaOrigenId,
            monto: formatMoney(montoCentavos),
            pie: formatMoney(pieCentavos),
            otorgadoEn: ahora.toISOString(),
          };
        } catch (error) {
          if (error instanceof CuentaNoEncontradaError) {
            throw new CuentaOrigenNoEncontradaError();
          }
          throw error;
        }
      },
    });
  }
}
