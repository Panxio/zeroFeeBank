import { ErrorDeNegocio } from '../domain/errores.js';

/**
 * Los errores de negocio que NO son de un módulo, porque los comparte todo POST que mueve
 * plata (D5). Nacieron en S-06 (transferencias) y desde S-12 los usa también la apertura de
 * cuenta. `src/modules/transferencias/transferencias.errors.ts` los re-exporta para no romper
 * los imports que ya existían.
 *
 * La razón de que vivan en UN archivo y no repetidos por módulo es la misma que la de
 * SaldosRepository: dos clases con el mismo `codigo` son dos contratos que se pueden
 * desincronizar sin que nadie lo note, porque el filtro HTTP sólo mira la cadena.
 */
export class CuentaNoEncontradaError extends ErrorDeNegocio {
  readonly codigo = 'CUENTA_NO_ENCONTRADA';
  constructor(readonly cuentaId: string) {
    super(`la cuenta ${cuentaId} no existe`);
  }
}

export class IdempotencyKeyAusenteError extends ErrorDeNegocio {
  readonly codigo = 'IDEMPOTENCY_KEY_AUSENTE';
  constructor() {
    super('la cabecera Idempotency-Key es obligatoria');
  }
}

export class IdempotencyKeyInvalidaError extends ErrorDeNegocio {
  readonly codigo = 'IDEMPOTENCY_KEY_INVALIDA';
  constructor() {
    super('la cabecera Idempotency-Key supera los 200 caracteres permitidos');
  }
}

export class IdempotencyKeyReusadaError extends ErrorDeNegocio {
  readonly codigo = 'IDEMPOTENCY_KEY_REUSADA';
  constructor() {
    super('la clave de idempotencia ya fue utilizada con otro cuerpo de petición');
  }
}
