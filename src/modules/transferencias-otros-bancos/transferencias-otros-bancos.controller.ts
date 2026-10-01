import { Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { parseMoney } from '../../domain/money/money.js';
import {
  esBanco,
  esNumeroCuentaExterna,
  esTipoCuentaExterna,
} from '../../domain/transferencia/otros-bancos.js';
import { LARGO_MAXIMO_IDEMPOTENCY_KEY, UUID_REGEX } from '../cuentas/cuentas.constants.js';
import {
  BancoNoPermitidoError,
  CuentaOrigenNoEncontradaError,
  IdempotencyKeyAusenteError,
  IdempotencyKeyInvalidaError,
  MontoInvalidoError,
  NumeroCuentaExternaInvalidoError,
  TipoCuentaExternaInvalidoError,
} from './transferencias-otros-bancos.errors.js';
import { TransferenciasOtrosBancosService } from './transferencias-otros-bancos.service.js';

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/**
 * S-22 · POST /transferencias/otros-bancos y GET /transferencias/otros-bancos/:id.
 * Ver specs/S-22-otros-bancos.md § 3.
 */
@Controller('transferencias/otros-bancos')
export class TransferenciasOtrosBancosController {
  constructor(
    private readonly authService: AuthService,
    private readonly service: TransferenciasOtrosBancosService,
  ) {}

  @Post()
  async transferir(@Req() req: Request, @Res() res: Response): Promise<void> {
    // 1. Token -> titular (401, S-08, antes que la clave)
    const titular = await this.authService.yo(req.headers['authorization']);

    // 2. Idempotency-Key ausente/vacía -> 400; > 200 -> 400
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

    const cuerpo = esObjeto(req.body) ? req.body : {};

    // 4. Forma del monto (400): string decimal y > 0 (D6, CA20). Rechaza números JSON y > 2 decimales
    const montoRaw = cuerpo['monto'];
    if (typeof montoRaw !== 'string') {
      throw new MontoInvalidoError();
    }
    let montoCentavos: bigint;
    try {
      montoCentavos = parseMoney(montoRaw);
    } catch {
      throw new MontoInvalidoError();
    }
    if (montoCentavos <= 0n) {
      throw new MontoInvalidoError();
    }

    // 5. Forma de cuentaOrigenId (404, S-15 J4): ausente o no-uuid responde EXACTAMENTE lo mismo que inexistente
    const cuentaOrigenId = cuerpo['cuentaOrigenId'];
    if (typeof cuentaOrigenId !== 'string' || !UUID_REGEX.test(cuentaOrigenId)) {
      throw new CuentaOrigenNoEncontradaError();
    }

    // 6. banco (400 BANCO_NO_PERMITIDO, exacto sin trim ni normalizar mayúsculas)
    const banco = cuerpo['banco'];
    if (!esBanco(banco)) {
      throw new BancoNoPermitidoError();
    }

    // 7. numeroCuenta (400 NUMERO_CUENTA_EXTERNA_INVALIDO, exacto sin trim)
    const numeroCuenta = cuerpo['numeroCuenta'];
    if (!esNumeroCuentaExterna(numeroCuenta)) {
      throw new NumeroCuentaExternaInvalidoError();
    }

    // 8. tipoCuenta (400 TIPO_CUENTA_EXTERNA_INVALIDO, exacto sin trim)
    const tipoCuenta = cuerpo['tipoCuenta'];
    if (!esTipoCuentaExterna(tipoCuenta)) {
      throw new TipoCuentaExternaInvalidoError();
    }

    // 9–12. Idempotencia, titularidad del origen, tope y fondos
    const resultado = await this.service.transferir({
      titularId: titular.id,
      clave,
      cuentaOrigenId,
      montoOriginal: montoRaw,
      montoCentavos,
      banco,
      numeroCuenta,
      tipoCuenta,
    });

    if (resultado.esReplay) {
      res.setHeader('Idempotency-Replayed', 'true');
      res.status(resultado.estadoHttp).json(resultado.respuesta);
      return;
    }

    res.status(201).json(resultado.respuesta);
  }

  @Get(':id')
  async consultar(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') id: string,
  ): Promise<void> {
    const titular = await this.authService.yo(req.headers['authorization']);
    const respuesta = await this.service.consultar(titular.id, id);
    res.status(200).json(respuesta);
  }
}
