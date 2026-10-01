import { ErrorDeNegocio } from '../../domain/errores.js';

export { CuentaNoEncontradaError } from '../../infra/errores-de-dinero.js';
export { MontoInvalidoError } from '../transferencias/transferencias.errors.js';

export class CuentaIdRequeridoError extends ErrorDeNegocio {
  readonly codigo = 'CUENTA_ID_REQUERIDO';
  constructor() {
    super('el parámetro cuentaId es obligatorio');
  }
}

export class CuentaIdInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'CUENTA_ID_INVALIDO';
  constructor() {
    super('el parámetro cuentaId debe ser un UUID válido');
  }
}

export class TransaccionIdInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'TRANSACCION_ID_INVALIDO';
  constructor() {
    super('el parámetro transaccionId debe ser un UUID válido');
  }
}

export class FechaInvalidaError extends ErrorDeNegocio {
  readonly codigo = 'FECHA_INVALIDA';
  constructor() {
    super('la fecha debe tener formato YYYY-MM-DD y ser una fecha válida');
  }
}

export class RangoInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'RANGO_INVALIDO';
  constructor() {
    super('la fecha desde no puede ser posterior a la fecha hasta');
  }
}
