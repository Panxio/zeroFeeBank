import { ErrorDeNegocio } from '../../domain/errores.js';

export {
  CuentaNoEncontradaError,
  IdempotencyKeyAusenteError,
  IdempotencyKeyInvalidaError,
  IdempotencyKeyReusadaError,
} from '../../infra/errores-de-dinero.js';
export { MontoInvalidoError } from '../transferencias/transferencias.errors.js';
export { FondosInsuficientesError } from '../../domain/transferencia/fondos.js';
export { TokenAusenteError, TokenInvalidoError, TokenExpiradoError } from '../auth/auth.errors.js';
export { RutInvalidoError } from '../../domain/rut/rut.js';

/**
 * 404 BOLETA_NO_ENCONTRADA.
 * Ajena e inexistente responden IDÉNTICO: el mensaje es fijo para no filtrar existencia.
 */
export class BoletaNoEncontradaError extends ErrorDeNegocio {
  readonly codigo = 'BOLETA_NO_ENCONTRADA';
  constructor(mensaje = 'la boleta no existe') {
    super(mensaje);
  }
}

/**
 * 400 PLAZO_INVALIDO.
 */
export class PlazoInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'PLAZO_INVALIDO';
  constructor(mensaje = 'el plazo en días debe ser un entero entre 1 y 365') {
    super(mensaje);
  }
}

/**
 * 400 NOMBRE_INVALIDO.
 */
export class NombreInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'NOMBRE_INVALIDO';
  constructor(mensaje = 'el nombre es obligatorio y debe tener entre 1 y 120 caracteres') {
    super(mensaje);
  }
}

/**
 * 400 GLOSA_INVALIDA.
 */
export class GlosaInvalidaError extends ErrorDeNegocio {
  readonly codigo = 'GLOSA_INVALIDA';
  constructor(mensaje = 'la glosa es obligatoria y debe tener entre 1 y 200 caracteres') {
    super(mensaje);
  }
}

/**
 * 403 RETIRADOR_NO_AUTORIZADO.
 */
export class RetiradorNoAutorizadoError extends ErrorDeNegocio {
  readonly codigo = 'RETIRADOR_NO_AUTORIZADO';
  constructor(mensaje = 'el RUT presentado no coincide con el retirador autorizado') {
    super(mensaje);
  }
}

/**
 * 409 TRANSICION_INVALIDA.
 */
export class TransicionInvalidaError extends ErrorDeNegocio {
  readonly codigo = 'TRANSICION_INVALIDA';
  constructor(mensaje = 'la transición solicitada no es válida para el estado actual de la boleta') {
    super(mensaje);
  }
}

/**
 * 409 BOLETA_NO_VENCIDA.
 */
export class BoletaNoVencidaError extends ErrorDeNegocio {
  readonly codigo = 'BOLETA_NO_VENCIDA';
  constructor(mensaje = 'la boleta aún no ha vencido') {
    super(mensaje);
  }
}
