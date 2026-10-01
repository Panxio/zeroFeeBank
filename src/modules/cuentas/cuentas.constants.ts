/**
 * Constantes de S-12 · apertura de cuenta y resumen con saldo derivado.
 * Ver specs/S-12-cuentas.md § Constantes.
 */

/**
 * Los tipos que abre la puerta pública. S-20 (HU-01 R2): AHORRO con las mismas reglas que
 * CORRIENTE. SISTEMA y PRESTAMO los crea el sistema, nunca el cliente. Sin normalizar.
 */
export const TIPOS_APERTURA = ['CORRIENTE', 'AHORRO'] as const;
export type TipoApertura = (typeof TIPOS_APERTURA)[number];

export function esTipoApertura(valor: unknown): valor is TipoApertura {
  return TIPOS_APERTURA.some((t) => t === valor);
}

/** 1000 dólares. Dato de negocio entregado por el humano el 2026-09-07. */
export const MONTO_APERTURA_MINIMO_CENTAVOS = 100000n;

/** Etiqueta estable de la contrapartida externa. */
export const CODIGO_CUENTA_CAJA = 'CAJA';

/** El mismo límite de S-06: 200 caracteres. */
export const LARGO_MAXIMO_IDEMPOTENCY_KEY = 200;

/** Concepto del asiento en el ledger, versionado en scripts/invariantes.sh. */
export const CONCEPTO_ASIENTO_APERTURA = 'APERTURA_CUENTA';

/** Endpoint guardado en clave_idempotencia. */
export const ENDPOINT_POST_CUENTAS = 'POST /cuentas';

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
