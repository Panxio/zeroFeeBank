import { ErrorDeNegocio } from '../../domain/errores.js';
import type { NombreCampoBeneficiario } from './pagos.constants.js';

/**
 * Errores de S-15 · pago a terceros. Los códigos YA están registrados en
 * src/infra/errores-http.filter.ts (S-15), que está fuera del alcance de esta entrega.
 *
 * TOKEN_*, IDEMPOTENCY_KEY_*, FONDOS_INSUFICIENTES y CUERPO_INVALIDO se REUSAN tal cual:
 * un segundo nombre para la misma situación sería un código abundante, no estable (C5).
 */
export {
  IdempotencyKeyAusenteError,
  IdempotencyKeyInvalidaError,
  IdempotencyKeyReusadaError,
} from '../../infra/errores-de-dinero.js';

export { MontoInvalidoError } from '../transferencias/transferencias.errors.js';

/**
 * 404 CUENTA_NO_ENCONTRADA (J4). Ajena e inexistente responden IDÉNTICO: el mensaje es
 * fijo para no filtrar existencia, porque el brazo E7 compara las dos respuestas ENTERAS,
 * sin normalizar los ids. Es el patrón de BoletaNoEncontradaError (S-09).
 *
 * No se reusa el CuentaNoEncontradaError compartido: su mensaje embarca el id que mandó
 * el cliente, y dos peticiones con ids distintos producirían mensajes distintos — justo
 * el oráculo de existencia que J4 prohíbe.
 */
export class CuentaOrigenNoEncontradaError extends ErrorDeNegocio {
  readonly codigo = 'CUENTA_NO_ENCONTRADA';
  constructor() {
    super('la cuenta de origen no existe');
  }
}

/**
 * Un código por campo y no un PAGO_BENEFICIARIO_INVALIDO genérico (§ J8): con uno solo,
 * la pantalla tendría que leer el mensaje en prosa para saber qué campo marcar en rojo.
 */
export class PagoBeneficiarioNombreInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'PAGO_BENEFICIARIO_NOMBRE_INVALIDO';
  constructor() {
    super('el nombre del beneficiario es obligatorio, texto no vacío de hasta 100 caracteres');
  }
}

export class PagoBeneficiarioDireccionInvalidaError extends ErrorDeNegocio {
  readonly codigo = 'PAGO_BENEFICIARIO_DIRECCION_INVALIDA';
  constructor() {
    super('la dirección del beneficiario es obligatoria, texto no vacío de hasta 100 caracteres');
  }
}

export class PagoBeneficiarioCiudadInvalidaError extends ErrorDeNegocio {
  readonly codigo = 'PAGO_BENEFICIARIO_CIUDAD_INVALIDA';
  constructor() {
    super('la ciudad del beneficiario es obligatoria, texto no vacío de hasta 50 caracteres');
  }
}

export class PagoBeneficiarioEstadoInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'PAGO_BENEFICIARIO_ESTADO_INVALIDO';
  constructor() {
    super('el estado del beneficiario es obligatorio, texto no vacío de hasta 50 caracteres');
  }
}

export class PagoBeneficiarioCodigoPostalInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'PAGO_BENEFICIARIO_CODIGO_POSTAL_INVALIDO';
  constructor() {
    super(
      'el código postal del beneficiario es obligatorio, texto no vacío de hasta 20 caracteres',
    );
  }
}

export class PagoBeneficiarioTelefonoInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'PAGO_BENEFICIARIO_TELEFONO_INVALIDO';
  constructor() {
    super('el teléfono del beneficiario es obligatorio, texto no vacío de hasta 20 caracteres');
  }
}

export class PagoCuentaBeneficiarioInvalidaError extends ErrorDeNegocio {
  readonly codigo = 'PAGO_CUENTA_BENEFICIARIO_INVALIDA';
  constructor() {
    super(
      'la cuenta del beneficiario es obligatoria, texto opaco no vacío de hasta 50 caracteres',
    );
  }
}

/** El error que le toca a cada campo del beneficiario, para la validación en orden. */
export const ERROR_DE_CAMPO: Record<NombreCampoBeneficiario, new () => ErrorDeNegocio> = {
  beneficiarioNombre: PagoBeneficiarioNombreInvalidoError,
  beneficiarioDireccion: PagoBeneficiarioDireccionInvalidaError,
  beneficiarioCiudad: PagoBeneficiarioCiudadInvalidaError,
  beneficiarioEstado: PagoBeneficiarioEstadoInvalidoError,
  beneficiarioCodigoPostal: PagoBeneficiarioCodigoPostalInvalidoError,
  beneficiarioTelefono: PagoBeneficiarioTelefonoInvalidoError,
  cuentaBeneficiario: PagoCuentaBeneficiarioInvalidaError,
};
