import {
  CODIGO_CUENTA_CAJA,
  LARGO_MAXIMO_IDEMPOTENCY_KEY,
  UUID_REGEX,
} from '../cuentas/cuentas.constants.js';

export { CODIGO_CUENTA_CAJA, LARGO_MAXIMO_IDEMPOTENCY_KEY, UUID_REGEX };

/** 1 día. Dato de negocio entregado por el humano (B1). */
export const PLAZO_DIAS_MINIMO = 1;

/** 365 días. Dato de negocio entregado por el humano (B1). */
export const PLAZO_DIAS_MAXIMO = 365;

/** 24 × 60 × 60 × 1000. Aritmética de instantes UTC. */
export const MS_POR_DIA = 86_400_000;

/** Etiqueta estable de la cuenta de garantía del sistema. */
export const CODIGO_CUENTA_GARANTIA = 'GARANTIA';

/** Límite de frontera de confianza para la glosa. */
export const LARGO_MAXIMO_GLOSA = 200;

/** Límite de frontera de confianza para los nombres. */
export const LARGO_MAXIMO_NOMBRE = 120;

/** Conceptos del ledger, versionados en scripts/invariantes.sh. */
export const CONCEPTO_EMISION_BOLETA = 'EMISION_BOLETA';
export const CONCEPTO_COBRO_BOLETA = 'COBRO_BOLETA';
export const CONCEPTO_VENCIMIENTO_BOLETA = 'VENCIMIENTO_BOLETA';
export const CONCEPTO_DEVOLUCION_BOLETA = 'DEVOLUCION_BOLETA';

/** Endpoints guardados en clave_idempotencia (con :id literal). */
export const ENDPOINT_POST_BOLETAS = 'POST /boletas';
export const ENDPOINT_POST_BOLETAS_COBRAR = 'POST /boletas/:id/cobrar';
export const ENDPOINT_POST_BOLETAS_VENCER = 'POST /boletas/:id/vencer';
export const ENDPOINT_POST_BOLETAS_DEVOLVER = 'POST /boletas/:id/devolver';
