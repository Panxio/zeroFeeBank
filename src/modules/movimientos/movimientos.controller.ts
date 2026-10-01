import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { parseMoney } from '../../domain/money/money.js';
import { AuthService } from '../auth/auth.service.js';
import { FECHA_REGEX, UUID_REGEX } from './movimientos.constants.js';
import {
  CuentaIdInvalidoError,
  CuentaIdRequeridoError,
  FechaInvalidaError,
  MontoInvalidoError,
  RangoInvalidoError,
  TransaccionIdInvalidoError,
} from './movimientos.errors.js';
import { MovimientosService } from './movimientos.service.js';

function validarFecha(str: string): void {
  if (!FECHA_REGEX.test(str)) {
    throw new FechaInvalidaError();
  }
  const [yStr, mStr, dStr] = str.split('-');
  if (!yStr || !mStr || !dStr) {
    throw new FechaInvalidaError();
  }
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  const d = parseInt(dStr, 10);
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) {
    throw new FechaInvalidaError();
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    throw new FechaInvalidaError();
  }
}

@Controller('movimientos')
export class MovimientosController {
  constructor(
    private readonly authService: AuthService,
    private readonly movimientosService: MovimientosService,
  ) {}

  @Get()
  async buscar(@Req() req: Request, @Res() res: Response): Promise<void> {
    // 1. Token -> titular (401 si falta o es inválido)
    const titular = await this.authService.yo(req.headers['authorization']);

    // 2. Forma de los parámetros (400)
    // Precedencia fija: cuentaId -> transaccionId -> desde -> hasta -> rango -> monto
    const query = req.query;

    // 2.1 cuentaId
    const cuentaIdRaw = query['cuentaId'];
    if (cuentaIdRaw === undefined) {
      throw new CuentaIdRequeridoError();
    }
    if (Array.isArray(cuentaIdRaw)) {
      throw new CuentaIdInvalidoError();
    }
    if (typeof cuentaIdRaw !== 'string') {
      throw new CuentaIdInvalidoError();
    }
    if (cuentaIdRaw.length === 0) {
      throw new CuentaIdRequeridoError();
    }
    if (!UUID_REGEX.test(cuentaIdRaw)) {
      throw new CuentaIdInvalidoError();
    }
    const cuentaId = cuentaIdRaw;

    // 2.2 transaccionId
    let transaccionId: string | undefined;
    const transaccionIdRaw = query['transaccionId'];
    if (transaccionIdRaw !== undefined) {
      if (
        typeof transaccionIdRaw !== 'string' ||
        !UUID_REGEX.test(transaccionIdRaw)
      ) {
        throw new TransaccionIdInvalidoError();
      }
      transaccionId = transaccionIdRaw;
    }

    // 2.3 desde
    let desde: string | undefined;
    const desdeRaw = query['desde'];
    if (desdeRaw !== undefined) {
      if (typeof desdeRaw !== 'string') {
        throw new FechaInvalidaError();
      }
      validarFecha(desdeRaw);
      desde = desdeRaw;
    }

    // 2.4 hasta
    let hasta: string | undefined;
    const hastaRaw = query['hasta'];
    if (hastaRaw !== undefined) {
      if (typeof hastaRaw !== 'string') {
        throw new FechaInvalidaError();
      }
      validarFecha(hastaRaw);
      hasta = hastaRaw;
    }

    // 2.5 rango (desde <= hasta)
    if (desde !== undefined && hasta !== undefined) {
      if (desde > hasta) {
        throw new RangoInvalidoError();
      }
    }

    // 2.6 monto
    let montoCentavos: bigint | undefined;
    const montoRaw = query['monto'];
    if (montoRaw !== undefined) {
      if (typeof montoRaw !== 'string' || montoRaw.length === 0) {
        throw new MontoInvalidoError();
      }
      if (montoRaw.includes('-') || montoRaw.includes('+')) {
        throw new MontoInvalidoError();
      }
      try {
        montoCentavos = parseMoney(montoRaw);
      } catch {
        throw new MontoInvalidoError();
      }
      if (montoCentavos < 0n) {
        throw new MontoInvalidoError();
      }
    }

    // 3 y 4. Existencia, titularidad y búsqueda (en MovimientosService)
    const resultado = await this.movimientosService.buscarMovimientos({
      titularId: titular.id,
      cuentaId,
      transaccionId,
      desde,
      hasta,
      montoCentavos,
    });

    res.status(200).json(resultado);
  }
}
