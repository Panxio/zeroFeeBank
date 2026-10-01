import { ErrorDeNegocio } from '../errores.js';

/**
 * Catálogo exacto de bancos ficticios aprobados (R10, juego A).
 * specs/S-22-otros-bancos.md § 2.
 */
export const BANCOS = ['ASERCION', 'FIXTURE', 'MOCK', 'SANDBOX', 'STUB'] as const;
export type Banco = (typeof BANCOS)[number];

/**
 * Tope diario de 200,00 USD expresado en centavos (R9).
 * specs/S-22-otros-bancos.md § 2.
 */
export const TOPE_DIARIO_OTROS_BANCOS_CENTAVOS = 20000n;

/**
 * Tipos de cuenta externa permitidos (J4).
 */
export const TIPOS_CUENTA_EXTERNA = ['CORRIENTE', 'AHORRO'] as const;
export type TipoCuentaExterna = (typeof TIPOS_CUENTA_EXTERNA)[number];

/**
 * Error de negocio cuando la transferencia supera el tope diario (J9, C5).
 */
export class TopeDiarioExcedidoError extends ErrorDeNegocio {
  readonly codigo = 'TOPE_DIARIO_EXCEDIDO';
  constructor(
    readonly acumuladoCentavos?: bigint,
    readonly montoCentavos?: bigint,
    readonly topeCentavos?: bigint,
  ) {
    super(
      acumuladoCentavos !== undefined && montoCentavos !== undefined && topeCentavos !== undefined
        ? `acumulado ${acumuladoCentavos} y monto ${montoCentavos} superan el tope diario ${topeCentavos}`
        : 'el monto solicitado supera el tope diario para transferencias a otros bancos',
    );
  }
}

/**
 * Comprueba que el acumulado del día más el nuevo monto no superen el tope diario (J2).
 * Borde inclusivo: si acumulado + monto == tope, pasa.
 */
export function assertDentroDelTope(
  acumuladoCentavos: bigint,
  montoCentavos: bigint,
  topeCentavos: bigint = TOPE_DIARIO_OTROS_BANCOS_CENTAVOS,
): void {
  if (acumuladoCentavos + montoCentavos > topeCentavos) {
    throw new TopeDiarioExcedidoError(acumuladoCentavos, montoCentavos, topeCentavos);
  }
}

/**
 * Calcula la ventana [desde, hasta) del día UTC del instante inyectado (J1).
 */
export function diaUtcDe(instante: Date): { desde: Date; hasta: Date } {
  const anio = instante.getUTCFullYear();
  const mes = instante.getUTCMonth();
  const dia = instante.getUTCDate();
  const desde = new Date(Date.UTC(anio, mes, dia));
  const hasta = new Date(Date.UTC(anio, mes, dia + 1));
  return { desde, hasta };
}

/**
 * Validador exacto del banco (B1, R10).
 */
export function esBanco(banco: unknown): banco is Banco {
  return typeof banco === 'string' && (BANCOS as readonly string[]).includes(banco);
}

/**
 * Validador exacto del número de cuenta externa (B2, A7, J6).
 * Cadena numérica de 1 a 20 dígitos.
 */
export function esNumeroCuentaExterna(numero: unknown): numero is string {
  return typeof numero === 'string' && /^[0-9]{1,20}$/.test(numero);
}

/**
 * Validador exacto del tipo de cuenta externa (B3, A6, J4).
 */
export function esTipoCuentaExterna(tipo: unknown): tipo is TipoCuentaExterna {
  return typeof tipo === 'string' && (tipo === 'CORRIENTE' || tipo === 'AHORRO');
}
