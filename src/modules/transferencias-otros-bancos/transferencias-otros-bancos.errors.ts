import { ErrorDeNegocio } from '../../domain/errores.js';

export {
  IdempotencyKeyAusenteError,
  IdempotencyKeyInvalidaError,
  IdempotencyKeyReusadaError,
} from '../../infra/errores-de-dinero.js';

export { MontoInvalidoError } from '../transferencias/transferencias.errors.js';
export { TopeDiarioExcedidoError } from '../../domain/transferencia/otros-bancos.js';

/**
 * 404 CUENTA_NO_ENCONTRADA (J4, S-15 J4, S-18 J4).
 * Origen inexistente, ajeno o cuenta SISTEMA responden IDÉNTICO para no filtrar existencia.
 */
export class CuentaOrigenNoEncontradaError extends ErrorDeNegocio {
  readonly codigo = 'CUENTA_NO_ENCONTRADA';
  constructor() {
    super('la cuenta de origen no existe');
  }
}

/**
 * 400 BANCO_NO_PERMITIDO (J11).
 */
export class BancoNoPermitidoError extends ErrorDeNegocio {
  readonly codigo = 'BANCO_NO_PERMITIDO';
  constructor() {
    super('el banco especificado no pertenece al catálogo permitido');
  }
}

/**
 * 400 NUMERO_CUENTA_EXTERNA_INVALIDO (J6, J11).
 */
export class NumeroCuentaExternaInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'NUMERO_CUENTA_EXTERNA_INVALIDO';
  constructor() {
    super('el número de cuenta externa no cumple el formato requerido');
  }
}

/**
 * 400 TIPO_CUENTA_EXTERNA_INVALIDO (J4, J11).
 */
export class TipoCuentaExternaInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'TIPO_CUENTA_EXTERNA_INVALIDO';
  constructor() {
    super('el tipo de cuenta externa no cumple el formato requerido');
  }
}

/**
 * 404 TRANSFERENCIA_NO_ENCONTRADA (J8, J11, J16).
 * Inexistente, ajena, o no UUID responden IDÉNTICO para no filtrar existencia.
 */
export class TransferenciaNoEncontradaError extends ErrorDeNegocio {
  readonly codigo = 'TRANSFERENCIA_NO_ENCONTRADA';
  constructor() {
    super('la transferencia a otro banco no existe');
  }
}
