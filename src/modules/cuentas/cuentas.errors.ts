import { ErrorDeNegocio } from '../../domain/errores.js';

export {
  CuentaNoEncontradaError,
  IdempotencyKeyAusenteError,
  IdempotencyKeyInvalidaError,
  IdempotencyKeyReusadaError,
} from '../../infra/errores-de-dinero.js';

export { MontoInvalidoError } from '../transferencias/transferencias.errors.js';

export class TipoCuentaNoPermitidoError extends ErrorDeNegocio {
  readonly codigo = 'TIPO_CUENTA_NO_PERMITIDO';
  constructor(tipo?: unknown) {
    super(`el tipo de cuenta "${String(tipo)}" no está permitido`);
  }
}

export class MontoAperturaInsuficienteError extends ErrorDeNegocio {
  readonly codigo = 'MONTO_APERTURA_INSUFICIENTE';
  constructor(montoCentavos?: bigint) {
    super(
      montoCentavos !== undefined
        ? `el monto de apertura ${montoCentavos} centavos es menor al mínimo requerido`
        : 'el monto de apertura es menor al mínimo requerido',
    );
  }
}

export class CuentaOrigenRequeridaError extends ErrorDeNegocio {
  readonly codigo = 'CUENTA_ORIGEN_REQUERIDA';
  constructor() {
    super('la cuenta de origen es requerida para aperturas posteriores a la primera');
  }
}
