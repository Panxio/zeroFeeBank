import { describe, it, expect } from 'vitest';
import { FondosInsuficientesError, assertFondosSuficientes } from './fondos.js';

// Arnés de S-05, capa 1: la regla de fondos, sin base de datos.
// La capa 2 (concurrencia contra Postgres) es npm run test:concurrencia: mide otra cosa.
describe('assertFondosSuficientes', () => {
  it('deja pasar cuando sobra saldo', () => {
    expect(() => assertFondosSuficientes(10_000n, 1_000n, 0n)).not.toThrow();
  });

  it('deja pasar cuando el saldo es EXACTAMENTE el monto', () => {
    // El borde de un carácter: con `>` en vez de `>=` queda plata muerta en la cuenta.
    expect(() => assertFondosSuficientes(1_000n, 1_000n, 0n)).not.toThrow();
  });

  it('rechaza cuando falta un solo centavo', () => {
    expect(() => assertFondosSuficientes(999n, 1_000n, 0n)).toThrow(FondosInsuficientesError);
  });

  it('deja pasar si el descubierto cabe en el límite pactado', () => {
    // saldo 0, monto 500, límite 500 -> queda en -500, que es su límite exacto.
    expect(() => assertFondosSuficientes(0n, 500n, 500n)).not.toThrow();
  });

  it('rechaza si el descubierto pasa el límite pactado por un centavo', () => {
    expect(() => assertFondosSuficientes(0n, 501n, 500n)).toThrow(FondosInsuficientesError);
  });

  it('rechaza a una cuenta sin sobregiro que ya está en cero', () => {
    expect(() => assertFondosSuficientes(0n, 1n, 0n)).toThrow(FondosInsuficientesError);
  });

  it('trata un límite negativo como un error de programación, no como más crédito', () => {
    // Un límite negativo significaría "esta cuenta debe mantener un mínimo", que no es una
    // regla que exista en este producto. Se rechaza en vez de interpretarla.
    expect(() => assertFondosSuficientes(10_000n, 1n, -1n)).toThrow(RangeError);
  });

  it('el error lleva un código estable y los números del rechazo', () => {
    // C5: la suite afirma sobre el código; el texto puede cambiar sin romper nada.
    try {
      assertFondosSuficientes(999n, 1_000n, 0n);
      expect.unreachable('debía lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(FondosInsuficientesError);
      const err = e as FondosInsuficientesError;
      expect(err.codigo).toBe('FONDOS_INSUFICIENTES');
      expect(err.saldoCentavos).toBe(999n);
      expect(err.montoCentavos).toBe(1_000n);
    }
  });

  it('no usa coma flotante ni siquiera con montos enormes', () => {
    // 2^53 + 1 centavos: un `number` lo redondearía y el rechazo se convertiría en un permiso.
    const enorme = 9_007_199_254_740_993n;
    expect(() => assertFondosSuficientes(enorme - 1n, enorme, 0n)).toThrow(FondosInsuficientesError);
  });
});
