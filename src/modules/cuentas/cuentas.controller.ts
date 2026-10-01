import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { parseMoney } from '../../domain/money/money.js';
import {
  LARGO_MAXIMO_IDEMPOTENCY_KEY,
  MONTO_APERTURA_MINIMO_CENTAVOS,
  esTipoApertura,
} from './cuentas.constants.js';
import {
  IdempotencyKeyAusenteError,
  IdempotencyKeyInvalidaError,
  MontoAperturaInsuficienteError,
  MontoInvalidoError,
  TipoCuentaNoPermitidoError,
} from './cuentas.errors.js';
import { CuentasService } from './cuentas.service.js';

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null;
}

@Controller('cuentas')
export class CuentasController {
  constructor(
    private readonly authService: AuthService,
    private readonly cuentasService: CuentasService,
  ) {}

  @Post()
  async abrir(@Req() req: Request, @Res() res: Response): Promise<void> {
    // 1. Token -> titular
    const titular = await this.authService.yo(req.headers['authorization']);

    // 2. Idempotency-Key presente y válida
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

    // 3. Forma del cuerpo: tipo primero, después monto
    const body: unknown = req.body;
    const tipo: unknown = esObjeto(body) ? body['tipo'] : undefined;
    if (!esObjeto(body) || !esTipoApertura(tipo)) {
      throw new TipoCuentaNoPermitidoError(tipo);
    }

    let montoCentavos: bigint;
    let montoOriginal: string | null = null;
    if (body['monto'] !== undefined) {
      if (typeof body['monto'] !== 'string') {
        throw new MontoInvalidoError();
      }
      montoOriginal = body['monto'];
      try {
        montoCentavos = parseMoney(montoOriginal);
      } catch {
        throw new MontoInvalidoError();
      }

      if (montoCentavos <= 0n) {
        throw new MontoInvalidoError();
      }

      if (montoCentavos < MONTO_APERTURA_MINIMO_CENTAVOS) {
        throw new MontoAperturaInsuficienteError(montoCentavos);
      }
    } else {
      montoCentavos = MONTO_APERTURA_MINIMO_CENTAVOS;
    }

    // 4 y 5. Idempotencia y ejecución dentro de la transacción
    const resultado = await this.cuentasService.abrirCuenta({
      titularId: titular.id,
      clave,
      tipo,
      body,
      montoCentavos,
      montoOriginal,
    });

    if (resultado.esReplay) {
      res.setHeader('Idempotency-Replayed', 'true');
      res.status(resultado.estadoHttp).json(resultado.respuesta);
      return;
    }

    res.status(201).json(resultado.respuesta);
  }

  @Get()
  async listar(@Req() req: Request, @Res() res: Response): Promise<void> {
    // 1. Token -> titular
    const titular = await this.authService.yo(req.headers['authorization']);

    // 2. Resumen con saldo derivado del ledger
    const resumen = await this.cuentasService.listarCuentas(titular.id);

    res.status(200).json(resumen);
  }
}
