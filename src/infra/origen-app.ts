/**
 * Origen de la aplicación cliente (web).
 * Lee `ZFB_ORIGEN_APP` (por defecto `http://localhost:4200`).
 * Lanza si el valor no es un origen exacto (`new URL(v).origin !== v`).
 */
export function obtenerOrigenApp(): string {
  const v = process.env['ZFB_ORIGEN_APP'] ?? 'http://localhost:4200';
  let esOrigenExacto = false;
  try {
    const url = new URL(v);
    esOrigenExacto = url.origin === v;
  } catch {
    esOrigenExacto = false;
  }

  if (!esOrigenExacto) {
    throw new Error(
      `ZFB_ORIGEN_APP inválido: "${v}". Debe ser un origen exacto (ej: http://localhost:4200)`,
    );
  }

  return v;
}
