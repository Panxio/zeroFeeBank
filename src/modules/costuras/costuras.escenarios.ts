/**
 * EL catálogo de escenarios de `POST /__test__/seed`, en un archivo propio y no dentro del
 * servicio, por una razón medida y no estética: la lista estaba escrita DOS veces —acá y en
 * la prosa de `EscenarioDesconocidoError`— y al añadir 'movimientos-buscables' la
 * segunda copia se quedó atrás sin que ningún test se enterara, porque la suite afirma sobre
 * el código tipado (C5) y nunca sobre el mensaje. Es un arnés ciego:
 * una lista duplicada que dejó de mirar y siguió en verde.
 *
 * Con una sola fuente, añadir un escenario actualiza el mensaje solo.
 */
export const ESCENARIOS_VALIDOS = [
  'cuenta-unica',
  'dos-cuentas',
  'cuenta-con-historial',
  'movimientos-buscables',
  'boletas-en-cada-estado',
] as const;

export type EscenarioValido = (typeof ESCENARIOS_VALIDOS)[number];
