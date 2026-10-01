import { ErrorDeNegocio } from '../errores.js';
import type { Transaccion } from '../ledger/ledger.js';

/**
 * S-16 · la regla de aprobación de préstamos. Ver specs/S-16-prestamo.md § 2.
 *
 * Es la de ParaBank (AbstractLoanProcessor + AvailableFundsLoanProcessor), leída de su código,
 * no inventada: `loanProcessor = 'funds'` y `loanProcessorThreshold = '20'` en su insert.sql.
 */

/** El `loanProcessorThreshold` por defecto de ParaBank. Fijo: no hay costura para cambiarlo (N1). */
export const UMBRAL_PRESTAMO_PORCENTAJE = 20n;

export class PrestamoMontoInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'MONTO_INVALIDO';
  constructor(readonly montoCentavos: bigint) {
    super(`monto de préstamo inválido: ${montoCentavos}`);
  }
}

/** N5 (humano): `0 ≤ pie < monto`. ParaBank sólo exigía el campo no vacío. */
export class PrestamoPieInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'PRESTAMO_PIE_INVALIDO';
  constructor(
    readonly pieCentavos: bigint,
    readonly montoCentavos: bigint,
  ) {
    super(`el pie ${pieCentavos} debe ser ≥ 0 y menor que el monto ${montoCentavos}`);
  }
}

/** ParaBank: `error.insufficient.funds.for.down.payment`. */
export class PrestamoPieSuperaFondosError extends ErrorDeNegocio {
  readonly codigo = 'PRESTAMO_PIE_SUPERA_FONDOS';
  constructor(
    readonly pieCentavos: bigint,
    readonly fondosDisponiblesCentavos: bigint,
  ) {
    super(`el pie ${pieCentavos} supera los fondos disponibles ${fondosDisponiblesCentavos}`);
  }
}

/** ParaBank: `error.insufficient.funds`. */
export class PrestamoFondosInsuficientesError extends ErrorDeNegocio {
  readonly codigo = 'PRESTAMO_FONDOS_INSUFICIENTES';
  constructor(
    readonly montoCentavos: bigint,
    readonly fondosDisponiblesCentavos: bigint,
  ) {
    super(
      `fondos disponibles ${fondosDisponiblesCentavos} bajo el ${UMBRAL_PRESTAMO_PORCENTAJE} % de ${montoCentavos}`,
    );
  }
}

function assertForma(montoCentavos: bigint, pieCentavos: bigint): void {
  if (montoCentavos <= 0n) throw new PrestamoMontoInvalidoError(montoCentavos);
  if (pieCentavos < 0n || pieCentavos >= montoCentavos) {
    throw new PrestamoPieInvalidoError(pieCentavos, montoCentavos);
  }
}

/**
 * Lanza si el préstamo no se aprueba; no devuelve nada si se aprueba.
 *
 * El orden es el de ParaBank (J5): primero el pie contra los fondos, después el cociente.
 * `fondosDisponibles` = suma de los saldos de las cuentas del titular que NO son PRESTAMO: esa
 * suma la calcula quien llama, bajo bloqueo (J6). Acá sólo vive la regla.
 */
export function evaluarPrestamo(p: {
  montoCentavos: bigint;
  pieCentavos: bigint;
  fondosDisponiblesCentavos: bigint;
}): void {
  assertForma(p.montoCentavos, p.pieCentavos);
  if (p.pieCentavos > p.fondosDisponiblesCentavos) {
    throw new PrestamoPieSuperaFondosError(p.pieCentavos, p.fondosDisponiblesCentavos);
  }
  // R2 · fondos/monto ≥ 20/100, multiplicado en cruz para quedarse en enteros. ParaBank divide
  // y redondea a 3 decimales (HALF_UP), y así aprobaba cocientes en [0,1995 ; 0,2000).
  if (p.fondosDisponiblesCentavos * 100n < p.montoCentavos * UMBRAL_PRESTAMO_PORCENTAJE) {
    throw new PrestamoFondosInsuficientesError(p.montoCentavos, p.fondosDisponiblesCentavos);
  }
}

/**
 * J3 · la traducción LITERAL de N3 a partida doble, sin neteo: la cuenta PRESTAMO recibe el
 * monto contra la contrapartida de sistema, y el pie va de la cuenta de origen a esa misma
 * contrapartida. Con pie 0 el segundo par no existe (el ledger rechaza entradas de cero).
 */
export function crearAsientoPrestamo(a: {
  id: string;
  cuentaPrestamoId: string;
  contrapartidaId: string;
  cuentaOrigenId: string;
  montoCentavos: bigint;
  pieCentavos: bigint;
}): Transaccion {
  assertForma(a.montoCentavos, a.pieCentavos);
  const entradas = [
    { cuentaId: a.cuentaPrestamoId, monto: a.montoCentavos },
    { cuentaId: a.contrapartidaId, monto: -a.montoCentavos },
  ];
  if (a.pieCentavos > 0n) {
    entradas.push(
      { cuentaId: a.cuentaOrigenId, monto: -a.pieCentavos },
      { cuentaId: a.contrapartidaId, monto: a.pieCentavos },
    );
  }
  return { id: a.id, entradas };
}
