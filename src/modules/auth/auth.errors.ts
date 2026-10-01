import { ErrorDeNegocio } from '../../domain/errores.js';

export class EmailInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'EMAIL_INVALIDO';
  constructor(mensaje = 'el email es inválido o no tiene el formato esperado') {
    super(mensaje);
  }
}

export class PasswordDebilError extends ErrorDeNegocio {
  readonly codigo = 'PASSWORD_DEBIL';
  constructor(mensaje = 'la contraseña debe tener al menos 8 caracteres') {
    super(mensaje);
  }
}

export class EmailYaRegistradoError extends ErrorDeNegocio {
  readonly codigo = 'EMAIL_YA_REGISTRADO';
  constructor(mensaje = 'el email ya está registrado') {
    super(mensaje);
  }
}

export class CredencialesInvalidasError extends ErrorDeNegocio {
  readonly codigo = 'CREDENCIALES_INVALIDAS';
  constructor(mensaje = 'credenciales inválidas') {
    super(mensaje);
  }
}

export class TokenAusenteError extends ErrorDeNegocio {
  readonly codigo = 'TOKEN_AUSENTE';
  constructor(mensaje = 'cabecera de autorización ausente o inválida') {
    super(mensaje);
  }
}

export class TokenInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'TOKEN_INVALIDO';
  constructor(mensaje = 'token inválido') {
    super(mensaje);
  }
}

export class TokenExpiradoError extends ErrorDeNegocio {
  readonly codigo = 'TOKEN_EXPIRADO';
  constructor(mensaje = 'token expirado') {
    super(mensaje);
  }
}
