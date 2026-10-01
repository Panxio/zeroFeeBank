/**
 * Base de los errores de negocio (C5 del perfil SUT).
 *
 * Todo error de negocio lleva un CÓDIGO estable y tipado. La suite afirma sobre el código;
 * la persona lee el mensaje. Así el texto se puede traducir o mejorar sin romper una sola
 * prueba, y sin que nadie tenga que hacer coincidir cadenas de prosa.
 */
export abstract class ErrorDeNegocio extends Error {
  abstract readonly codigo: string;
}
