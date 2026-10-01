/**
 * Constantes de S-16 · préstamo. Ver specs/S-16-prestamo.md § 2.
 * Las pone el autor de la spec; la implementación puede AGREGAR constantes, no cambiar éstas.
 */

/**
 * Etiqueta del asiento (J2). Está en las DOS listas versionadas de scripts/invariantes.sh:
 * el préstamo es un POST que mueve plata y D5 exige que nazca con clave de idempotencia.
 */
export const CONCEPTO_ASIENTO_PRESTAMO = 'OTORGAMIENTO_PRESTAMO';

/** La cuenta de sistema contrapartida de todos los préstamos (J1). No es CAJA a propósito. */
export const CODIGO_CUENTA_PRESTAMOS = 'PRESTAMOS';

/** Endpoint guardado en clave_idempotencia, para que la misma clave no colisione entre POSTs. */
export const ENDPOINT_POST_PRESTAMOS = 'POST /prestamos';
