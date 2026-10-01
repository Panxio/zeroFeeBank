/**
 * ARNÉS S-16 — Préstamo (regla de aprobación + asiento). NO SE TOCA.
 *
 * Contrato bajo prueba: src/domain/prestamo/prestamo.ts. Ver specs/S-16-prestamo.md § 2 y § 3.
 * La regla es la de ParaBank (AbstractLoanProcessor + AvailableFundsLoanProcessor, umbral 20),
 * con la comparación ENTERA exacta de R2 y los límites del pie de N5.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluarPrestamo,
  crearAsientoPrestamo,
  UMBRAL_PRESTAMO_PORCENTAJE,
  PrestamoMontoInvalidoError,
  PrestamoPieInvalidoError,
  PrestamoPieSuperaFondosError,
  PrestamoFondosInsuficientesError,
} from './prestamo.js';
import { assertBalanceada } from '../ledger/ledger.js';

const ok = (monto: bigint, pie: bigint, fondos: bigint) =>
  evaluarPrestamo({ montoCentavos: monto, pieCentavos: pie, fondosDisponiblesCentavos: fondos });

describe('S-16 · umbral', () => {
  it('es 20, el loanProcessorThreshold de ParaBank (insert.sql)', () => {
    expect(UMBRAL_PRESTAMO_PORCENTAJE).toBe(20n);
  });
});

describe('S-16 · evaluarPrestamo — forma (N5, D6)', () => {
  it('monto 0 → PrestamoMontoInvalidoError', () => {
    expect(() => ok(0n, 0n, 100000n)).toThrow(PrestamoMontoInvalidoError);
  });
  it('monto negativo → PrestamoMontoInvalidoError', () => {
    expect(() => ok(-1n, 0n, 100000n)).toThrow(PrestamoMontoInvalidoError);
  });
  it('pie negativo → PrestamoPieInvalidoError', () => {
    expect(() => ok(1000n, -1n, 100000n)).toThrow(PrestamoPieInvalidoError);
  });
  it('pie igual al monto → PrestamoPieInvalidoError (N5: pie < monto)', () => {
    expect(() => ok(1000n, 1000n, 100000n)).toThrow(PrestamoPieInvalidoError);
  });
  it('pie mayor que el monto → PrestamoPieInvalidoError', () => {
    expect(() => ok(1000n, 1001n, 100000n)).toThrow(PrestamoPieInvalidoError);
  });
  it('pie = monto − 1 centavo → aprobado', () => {
    expect(() => ok(1000n, 999n, 100000n)).not.toThrow();
  });
  it('pie 0 → aprobado', () => {
    expect(() => ok(1000n, 0n, 100000n)).not.toThrow();
  });
  it('los errores de forma llevan código tipado', () => {
    expect(new PrestamoMontoInvalidoError(0n).codigo).toBe('MONTO_INVALIDO');
    expect(new PrestamoPieInvalidoError(0n, 0n).codigo).toBe('PRESTAMO_PIE_INVALIDO');
  });
});

describe('S-16 · evaluarPrestamo — regla de ParaBank (N1, R2)', () => {
  it('fondos exactamente al 20 % → aprobado (el borde aprueba)', () => {
    expect(() => ok(500000n, 0n, 100000n)).not.toThrow();
  });
  it('un centavo más de monto sobre el 20 % → PrestamoFondosInsuficientesError', () => {
    expect(() => ok(500001n, 0n, 100000n)).toThrow(PrestamoFondosInsuficientesError);
  });
  it('cociente 0,1999... → rechazado (R2: sin el redondeo a 3 decimales de ParaBank)', () => {
    // ParaBank: 99980/500000 = 0.19996 → HALF_UP a 3 decimales = 0.200 → aprobaba.
    expect(() => ok(500000n, 0n, 99980n)).toThrow(PrestamoFondosInsuficientesError);
  });
  it('pie mayor que los fondos → PrestamoPieSuperaFondosError', () => {
    expect(() => ok(1000000n, 100001n, 100000n)).toThrow(PrestamoPieSuperaFondosError);
  });
  it('pie igual a los fondos → no es PieSuperaFondos (ParaBank compara con >)', () => {
    expect(() => ok(500000n, 100000n, 100000n)).not.toThrow();
  });
  it('pie > fondos Y cociente malo → gana PieSuperaFondos (J5, orden de ParaBank)', () => {
    // fondos 1000, monto 1.000.000: cociente 0,001 — también fallaría la segunda regla.
    expect(() => ok(100000000n, 100001n, 100000n)).toThrow(PrestamoPieSuperaFondosError);
  });
  it('fondos cero → PrestamoFondosInsuficientesError', () => {
    expect(() => ok(1000n, 0n, 0n)).toThrow(PrestamoFondosInsuficientesError);
  });
  it('fondos negativos (sobregiro) → PieSuperaFondos: 0 > negativo, y esa regla va primero (J5)', () => {
    // La versión inicial esperaba
    // FondosInsuficientes, lo que contradecía el orden de ParaBank aprobado en N1/J5.
    expect(() => ok(1000n, 0n, -5000n)).toThrow(PrestamoPieSuperaFondosError);
  });
  it('montos sobre 2^53 no se redondean (D1)', () => {
    const grande = 2n ** 60n;
    expect(() => ok(grande * 5n, 0n, grande)).not.toThrow();
    expect(() => ok(grande * 5n + 1n, 0n, grande)).toThrow(PrestamoFondosInsuficientesError);
  });
  it('los rechazos llevan código tipado', () => {
    expect(new PrestamoPieSuperaFondosError(1n, 0n).codigo).toBe('PRESTAMO_PIE_SUPERA_FONDOS');
    expect(new PrestamoFondosInsuficientesError(1n, 0n).codigo).toBe(
      'PRESTAMO_FONDOS_INSUFICIENTES',
    );
  });
});

describe('S-16 · crearAsientoPrestamo (N3, J3)', () => {
  const base = {
    id: 'tx-1',
    cuentaPrestamoId: 'prestamo',
    contrapartidaId: 'sistema',
    cuentaOrigenId: 'origen',
  };

  it('pie > 0 → 4 entradas literales, balanceadas', () => {
    const t = crearAsientoPrestamo({ ...base, montoCentavos: 500000n, pieCentavos: 50000n });
    expect(t.id).toBe('tx-1');
    expect(t.entradas).toEqual([
      { cuentaId: 'prestamo', monto: 500000n },
      { cuentaId: 'sistema', monto: -500000n },
      { cuentaId: 'origen', monto: -50000n },
      { cuentaId: 'sistema', monto: 50000n },
    ]);
    expect(() => assertBalanceada(t)).not.toThrow();
  });

  it('pie = 0 → 2 entradas, sin entradas de monto cero', () => {
    const t = crearAsientoPrestamo({ ...base, montoCentavos: 500000n, pieCentavos: 0n });
    expect(t.entradas).toEqual([
      { cuentaId: 'prestamo', monto: 500000n },
      { cuentaId: 'sistema', monto: -500000n },
    ]);
    expect(() => assertBalanceada(t)).not.toThrow();
  });

  it('rechaza pie inválido también acá (el asiento no confía en quien lo llama)', () => {
    expect(() =>
      crearAsientoPrestamo({ ...base, montoCentavos: 1000n, pieCentavos: 1000n }),
    ).toThrow(PrestamoPieInvalidoError);
    expect(() =>
      crearAsientoPrestamo({ ...base, montoCentavos: 0n, pieCentavos: 0n }),
    ).toThrow(PrestamoMontoInvalidoError);
  });
});
