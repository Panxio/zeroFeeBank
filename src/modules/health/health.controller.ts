import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health.service.js';

/**
 * Costura C6 del perfil sut-automatizable: un /health que dice la verdad,
 * incluida la base, para que la suite espere al arranque en vez de dormir.
 *
 * Contrato (C5: la suite afirma sobre el campo, no sobre un texto en prosa):
 *   200 { status: 'ok',       db: 'up'   }
 *   503 { status: 'degraded', db: 'down' }
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  async get(@Res() res: Response): Promise<void> {
    const db = await this.health.estadoBd();
    const ok = db === 'up';
    res
      .status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
      .json({ status: ok ? 'ok' : 'degraded', db });
  }
}
