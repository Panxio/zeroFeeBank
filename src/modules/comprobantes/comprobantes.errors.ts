import { ErrorDeNegocio } from '../../domain/errores.js';

export { BoletaNoEncontradaError } from '../boletas/boletas.errors.js';

/**
 * 404 TRANSFERENCIA_NO_ENCONTRADA.
 * Id malformado, inexistente, de otro concepto, ajeno o recibido responden
 * IDÉNTICO: el mensaje es fijo para no filtrar existencia (P-b, J3).
 */
export class TransferenciaNoEncontradaError extends ErrorDeNegocio {
  readonly codigo = 'TRANSFERENCIA_NO_ENCONTRADA';
  constructor(mensaje = 'la transferencia no existe') {
    super(mensaje);
  }
}

/**
 * 409 BOLETA_NO_CERRADA.
 * Sin asiento de cierre no hay fecha de cierre que imprimir (J4).
 */
export class BoletaNoCerradaError extends ErrorDeNegocio {
  readonly codigo = 'BOLETA_NO_CERRADA';
  constructor(mensaje = 'la boleta no tiene asiento de cierre') {
    super(mensaje);
  }
}
