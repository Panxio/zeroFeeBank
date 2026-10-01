/**
 * Regex para validar UUID v4 antes de consultar a Prisma (columna @db.Uuid de Postgres).
 * Evita el error 500 que Postgres lanza cuando un id no tiene formato UUID.
 */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Concepto exigido para comprobantes de transferencia (J3).
 */
export const CONCEPTO_TRANSFERENCIA = 'TRANSFERENCIA';
