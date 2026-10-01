import { Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { parseMoney } from '../../domain/money/money.js';
import { LARGO_MAXIMO_IDEMPOTENCY_KEY, UUID_REGEX } from '../cuentas/cuentas.constants.js';
import {
  CuentaOrigenNoEncontradaError,
  IdempotencyKeyAusenteError,
  IdempotencyKeyInvalidaError,
  PrestamoMontoInvalidoError,
  PrestamoPieInvalidoError,
} from './prestamos.errors.js';
import { PrestamosService } from './prestamos.service.js';

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

@Controller('prestamos')
export class PrestamosController {
  constructor(
    private readonly authService: AuthService,
    private readonly prestamosService: PrestamosService,
  ) {}

  @Post()
  async solicitar(@Req() req: Request, @Res() res: Response): Promise<void> {
    // 1. Token (401)
    const titular = await this.authService.yo(req.headers['authorization']);

    // 2. Idempotency-Key (400)
    const headerClave = req.headers['idempotency-key'];
    const claveCruda = Array.isArray(headerClave) ? headerClave[0] : headerClave;

    if (typeof claveCruda !== 'string' || claveCruda.trim().length === 0) {
      throw new IdempotencyKeyAusenteError();
    }

    if (
      claveCruda.length > LARGO_MAXIMO_IDEMPOTENCY_KEY ||
      claveCruda.trim().length > LARGO_MAXIMO_IDEMPOTENCY_KEY
    ) {
      throw new IdempotencyKeyInvalidaError();
    }

    const clave = claveCruda.trim();

    // 3. JSON ya validado por express/filtro global.
    const cuerpo = esObjeto(req.body) ? req.body : {};

    // 4. Validación de forma con precedencia fijada: monto -> pie -> forma de cuentaOrigenId
    // 4a. monto (400)
    const montoRaw = cuerpo['monto'];
    if (typeof montoRaw !== 'string') {
      throw new PrestamoMontoInvalidoError(0n);
    }
    let montoCentavos: bigint;
    try {
      montoCentavos = parseMoney(montoRaw);
    } catch {
      throw new PrestamoMontoInvalidoError(0n);
    }
    if (montoCentavos <= 0n) {
      throw new PrestamoMontoInvalidoError(montoCentavos);
    }

    // 4b. pie (400)
    const pieRaw = cuerpo['pie'];
    if (typeof pieRaw !== 'string') {
      throw new PrestamoPieInvalidoError(0n, montoCentavos);
    }
    let pieCentavos: bigint;
    try {
      pieCentavos = parseMoney(pieRaw);
    } catch {
      throw new PrestamoPieInvalidoError(0n, montoCentavos);
    }
    if (pieCentavos < 0n || pieCentavos >= montoCentavos) {
      throw new PrestamoPieInvalidoError(pieCentavos, montoCentavos);
    }

    // 4c. forma de cuentaOrigenId (404)
    const cuentaOrigenId = cuerpo['cuentaOrigenId'];
    if (typeof cuentaOrigenId !== 'string' || !UUID_REGEX.test(cuentaOrigenId)) {
      throw new CuentaOrigenNoEncontradaError();
    }

    // 5. Servicio idempotente
    const resultado = await this.prestamosService.solicitar({
      titularId: titular.id,
      clave,
      cuentaOrigenId,
      montoOriginal: montoRaw,
      pieOriginal: pieRaw,
      montoCentavos,
      pieCentavos,
    });

    if (resultado.esReplay) {
      res.setHeader('Idempotency-Replayed', 'true');
      res.status(resultado.estadoHttp).json(resultado.respuesta);
      return;
    }

    res.status(201).json(resultado.respuesta);
  }
}
