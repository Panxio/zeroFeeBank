/**
 * Constantes de S-15 · pago a terceros (Bill Pay).
 * Ver specs/S-15-billpay.md § 2 y § 3.
 */

/**
 * Etiqueta del asiento en el ledger (J2). NO es cosmética: la lista de conceptos está
 * VERSIONADA en scripts/invariantes.sh, en las DOS listas, porque el pago es un POST que
 * mueve plata y D5 exige que nazca con clave de idempotencia. Un concepto que no esté en
 * ellas pone roja la compuerta de población de I5.
 */
export const CONCEPTO_ASIENTO_PAGO = 'PAGO_SERVICIO';

/** Endpoint guardado en clave_idempotencia, para que la misma clave no colisione entre POSTs. */
export const ENDPOINT_POST_PAGOS = 'POST /pagos';

/**
 * Los siete campos del beneficiario con su máximo (§ 3, J8). EL ORDEN ES LA PRECEDENCIA
 * del paso 5: con dos campos malos gana el primero de esta lista (brazo C16).
 */
export const CAMPOS_BENEFICIARIO = [
  { nombre: 'beneficiarioNombre', max: 100 },
  { nombre: 'beneficiarioDireccion', max: 100 },
  { nombre: 'beneficiarioCiudad', max: 50 },
  { nombre: 'beneficiarioEstado', max: 50 },
  { nombre: 'beneficiarioCodigoPostal', max: 20 },
  { nombre: 'beneficiarioTelefono', max: 20 },
  { nombre: 'cuentaBeneficiario', max: 50 },
] as const;

export type CampoBeneficiario = (typeof CAMPOS_BENEFICIARIO)[number];

export type NombreCampoBeneficiario = CampoBeneficiario['nombre'];
