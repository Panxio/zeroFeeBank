import { ErrorDeNegocio } from '../../domain/errores.js';

export class EmailNoModificableError extends ErrorDeNegocio {
  readonly codigo = 'EMAIL_NO_MODIFICABLE';
  constructor() {
    super('el email no puede modificarse');
  }
}

export class ContactoNombreInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'CONTACTO_NOMBRE_INVALIDO';
  constructor() {
    super('el nombre de contacto es inválido');
  }
}

export class ContactoApellidoInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'CONTACTO_APELLIDO_INVALIDO';
  constructor() {
    super('el apellido de contacto es inválido');
  }
}

export class ContactoDireccionInvalidaError extends ErrorDeNegocio {
  readonly codigo = 'CONTACTO_DIRECCION_INVALIDA';
  constructor() {
    super('la dirección de contacto es inválida');
  }
}

export class ContactoCiudadInvalidaError extends ErrorDeNegocio {
  readonly codigo = 'CONTACTO_CIUDAD_INVALIDA';
  constructor() {
    super('la ciudad de contacto es inválida');
  }
}

export class ContactoEstadoInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'CONTACTO_ESTADO_INVALIDO';
  constructor() {
    super('el estado de contacto es inválido');
  }
}

export class ContactoCodigoPostalInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'CONTACTO_CODIGO_POSTAL_INVALIDO';
  constructor() {
    super('el código postal de contacto es inválido');
  }
}

export class ContactoTelefonoInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'CONTACTO_TELEFONO_INVALIDO';
  constructor() {
    super('el teléfono de contacto es inválido');
  }
}
