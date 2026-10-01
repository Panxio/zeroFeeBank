import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { parseMoney } from '../../domain/money/money.js';
import { LARGO_MAXIMO_IDEMPOTENCY_KEY, UUID_REGEX } from '../cuentas/cuentas.constants.js';
import { CAMPOS_BENEFICIARIO, type NombreCampoBeneficiario } from './pagos.constants.js';
import {
  CuentaOrigenNoEncontradaError,
  ERROR_DE_CAMPO,
  IdempotencyKeyAusenteError,
  IdempotencyKeyInvalidaError,
  MontoInvalidoError,
} from './pagos.errors.js';
import { PagosService } from './pagos.service.js';
import type { Beneficiario } from './pagos.dto.js';

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/**
 * El paso 5 de la precedencia: los siete campos del beneficiario, EN EL ORDEN de
 * specs/S-15 § 3. Con dos campos malos gana el primero de la lista (brazo C16).
 *
 * Cada campo: obligatorio, STRING (comprobar `typeof` ANTES de llamar a `.trim()`, o un
 * número revienta con TypeError y sale 500 en vez del código tipado — brazo C17), no
 * vacío TRAS trim (una cadena de sólo espacios es inválida — brazo C2), y de largo ≤ max
 * medido sobre el valor recortado, que es lo que se guarda (brazos C3/C4/C6/C7 y A4).
 */
function validarBeneficiario(cuerpo: Record<string, unknown>): Beneficiario {
  const valores = {} as Record<NombreCampoBeneficiario, string>;
  for (const { nombre, max } of CAMPOS_BENEFICIARIO) {
    const valor = cuerpo[nombre];
    const ErrorDelCampo = ERROR_DE_CAMPO[nombre];
    if (typeof valor !== 'string') {
      throw new ErrorDelCampo();
    }
    const recortado = valor.trim();
    if (recortado.length < 1 || recortado.length > max) {
      throw new ErrorDelCampo();
    }
    valores[nombre] = recortado;
  }
  return valores;
}

/**
 * S-15 · POST /pagos y GET /pagos. Ver specs/S-15-billpay.md § 3.
 *
 * La precedencia de validación está FIJADA (§ 3) y no se deja a criterio:
 *   1. token (401, J5: antes que la Idempotency-Key)
 *   2. Idempotency-Key ausente/vacía (400) y > 200 (400)
 *   3. el cuerpo que no parsea lo rechaza el filtro global (400 CUERPO_INVALIDO)
 *   4. forma del monto (400) y forma de cuentaOrigenId (404, J4)
 *   5. los siete campos del beneficiario (400, en orden)
 *   6. existencia y titularidad del origen (404, J7: dentro de la operación idempotente)
 *   7. fondos (409): lo lanza el motor de S-05, no código nuevo
 */
@Controller('pagos')
export class PagosController {
  constructor(
    private readonly authService: AuthService,
    private readonly pagosService: PagosService,
  ) {}

  @Post()
  async pagar(@Req() req: Request, @Res() res: Response): Promise<void> {
    // 1. Token -> titular (J3: el titular sale SIEMPRE del token, nunca del cuerpo)
    const titular = await this.authService.yo(req.headers['authorization']);

    // 2. Idempotency-Key ausente/vacía -> 400 AUSENTE; > 200 -> 400 INVALIDA
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

    // 4a. Forma del monto (400): string decimal y > 0 (D6, J10). Un número JSON es 400.
    if (typeof cuerpo['monto'] !== 'string') {
      throw new MontoInvalidoError();
    }
    const montoOriginal = cuerpo['monto'];
    let montoCentavos: bigint;
    try {
      montoCentavos = parseMoney(montoOriginal);
    } catch {
      throw new MontoInvalidoError();
    }
    if (montoCentavos <= 0n) {
      throw new MontoInvalidoError();
    }

    // 4b. Forma de cuentaOrigenId (404, J4): ausente o no-uuid responde EXACTAMENTE lo
    // mismo que una inexistente, sin tocar la base. La existencia y la titularidad (J7)
    // van después, dentro de la operación idempotente.
    const cuentaOrigenId = cuerpo['cuentaOrigenId'];
    if (typeof cuentaOrigenId !== 'string' || !UUID_REGEX.test(cuentaOrigenId)) {
      throw new CuentaOrigenNoEncontradaError();
    }

    // 5. Los siete campos del beneficiario, en orden
    const beneficiario = validarBeneficiario(cuerpo);

    // 6 y 7. Idempotencia (D5), titularidad del origen (J7) y fondos, dentro de la
    // MISMA transacción de BD (J11).
    const resultado = await this.pagosService.pagar({
      titularId: titular.id,
      clave,
      cuentaOrigenId,
      montoOriginal,
      montoCentavos,
      beneficiario,
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
    // 1. Token -> titular (V5: un titular no ve los pagos de otro)
    const titular = await this.authService.yo(req.headers['authorization']);

    // 2. El listado con el monto derivado del ledger
    const lista = await this.pagosService.listar(titular.id);

    res.status(200).json(lista);
  }
}
