import { ErrorDeNegocio } from '../../domain/errores.js';
import { ESCENARIOS_VALIDOS } from './costuras.escenarios.js';

export class EscenarioDesconocidoError extends ErrorDeNegocio {
  readonly codigo = 'ESCENARIO_DESCONOCIDO';

  constructor(escenario?: unknown) {
    const detalle = escenario !== undefined ? `: "${String(escenario)}"` : '';
    super(
      `Escenario desconocido${detalle}. Los escenarios válidos son: ${ESCENARIOS_VALIDOS.map(
        (e) => `'${e}'`,
      ).join(', ')}.`,
    );
  }
}

export class RelojPeticionInvalidaError extends ErrorDeNegocio {
  readonly codigo = 'RELOJ_PETICION_INVALIDA';

  constructor(
    mensaje = 'Petición inválida para el reloj: debe incluir exactamente una de las claves: instante o avanzarMs.',
  ) {
    super(mensaje);
  }
}

export class RelojInstanteInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'RELOJ_INSTANTE_INVALIDO';

  constructor(mensaje = 'El campo instante no es una fecha ISO válida.') {
    super(mensaje);
  }
}

export class RelojAvanceInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'RELOJ_AVANCE_INVALIDO';

  constructor(mensaje = 'El campo avanzarMs debe ser un entero no negativo.') {
    super(mensaje);
  }
}

export class RelojNoFijadoError extends ErrorDeNegocio {
  readonly codigo = 'RELOJ_NO_FIJADO';

  constructor(
    mensaje = 'No se puede avanzar el reloj: no está fijado actualmente.',
  ) {
    super(mensaje);
  }
}
