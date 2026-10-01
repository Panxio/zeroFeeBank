import { Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { parseMoney } from '../../domain/money/money.js';
import { IdempotenciaService } from './idempotencia.service.js';
import {
  IdempotencyKeyAusenteError,
  IdempotencyKeyInvalidaError,
  MismaCuentaError,
  MontoInvalidoError,
} from './transferencias.errors.js';

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null;
}

@Controller('transferencias')
export class TransferenciasController {
  constructor(
    private readonly authService: AuthService,
    private readonly idempotenciaService: IdempotenciaService,
  ) {}

  @Post()
  async transferir(@Req() req: Request, @Res() res: Response): Promise<void> {
    // 1. Token -> titular
    const titular = await this.authService.yo(req.headers['authorization']);

    // 2. Idempotency-Key ausente/vacía -> 400 IDEMPOTENCY_KEY_AUSENTE
    const headerClave = req.headers['idempotency-key'];
    const claveCruda = Array.isArray(headerClave) ? headerClave[0] : headerClave;

    if (typeof claveCruda !== 'string' || claveCruda.trim().length === 0) {
      throw new IdempotencyKeyAusenteError();
    }

    // 2. Idempotency-Key > 200 chars -> 400 IDEMPOTENCY_KEY_INVALIDA
    if (claveCruda.length > 200 || claveCruda.trim().length > 200) {
      throw new IdempotencyKeyInvalidaError();
    }

    const clave = claveCruda.trim();

    // 3. monto mal formado o <= 0 -> 400 MONTO_INVALIDO
    const body: unknown = req.body;
    if (!esObjeto(body) || typeof body['monto'] !== 'string') {
      throw new MontoInvalidoError();
    }

    const montoOriginal = body['monto'];
    let montoCentavos: bigint;
    try {
      montoCentavos = parseMoney(montoOriginal);
    } catch {
      throw new MontoInvalidoError();
    }

    if (montoCentavos <= 0n) {
      throw new MontoInvalidoError();
    }

    // 4. origenId == destinoId -> 400 MISMA_CUENTA
    const origenId = body['origenId'];
    const destinoId = body['destinoId'];
    if (
      typeof origenId === 'string' &&
      typeof destinoId === 'string' &&
      origenId === destinoId
    ) {
      throw new MismaCuentaError(origenId);
    }

    // 5 en adelante: dentro de IdempotenciaService con transacción y candado
    const resultado = await this.idempotenciaService.ejecutar({
      clave,
      titularId: titular.id,
      origenId: typeof origenId === 'string' ? origenId : '',
      destinoId: typeof destinoId === 'string' ? destinoId : '',
      montoOriginal,
      montoCentavos,
    });

    if (resultado.esReplay) {
      res.setHeader('Idempotency-Replayed', 'true');
      res.status(resultado.estadoHttp).json(resultado.respuesta);
      return;
    }

    res.status(201).json(resultado.respuesta);
  }
}
