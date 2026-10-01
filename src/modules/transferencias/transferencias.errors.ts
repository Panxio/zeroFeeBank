import { ErrorDeNegocio } from '../../domain/errores.js';

// D5 es transversal: las claves de idempotencia dejaron de ser propiedad de este módulo
// cuando S-12 estrenó el segundo POST que mueve plata. Se re-exportan para que los imports
// que ya existían sigan funcionando y para que haya UNA sola definición de cada código.
export {
  CuentaNoEncontradaError,
  IdempotencyKeyAusenteError,
  IdempotencyKeyInvalidaError,
  IdempotencyKeyReusadaError,
} from '../../infra/errores-de-dinero.js';


export class MontoInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'MONTO_INVALIDO';
  constructor(mensaje = 'el monto es inválido o no es positivo') {
    super(mensaje);
  }
}

export class MismaCuentaError extends ErrorDeNegocio {
  readonly codigo = 'MISMA_CUENTA';
  constructor(cuentaId?: string) {
    super(
      cuentaId
        ? `origen y destino son la misma cuenta: ${cuentaId}`
        : 'origen y destino son la misma cuenta',
    );
  }
}

