import { ErrorDeNegocio } from '../../domain/errores.js';

export {
  IdempotencyKeyAusenteError,
  IdempotencyKeyInvalidaError,
  IdempotencyKeyReusadaError,
  CuentaNoEncontradaError,
} from '../../infra/errores-de-dinero.js';

export {
  PrestamoMontoInvalidoError,
  PrestamoPieInvalidoError,
  PrestamoPieSuperaFondosError,
  PrestamoFondosInsuficientesError,
} from '../../domain/prestamo/prestamo.js';

export class CuentaOrigenNoEncontradaError extends ErrorDeNegocio {
  readonly codigo = 'CUENTA_NO_ENCONTRADA';
  constructor() {
    super('la cuenta de origen no existe');
  }
}
