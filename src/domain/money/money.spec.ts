/**
 * ARNÉS S-01 — Money.  NO SE TOCA.
 *
 * Si un caso falla, el problema está en la implementación, no en este archivo.
 * Si crees que un caso está mal, DETENTE y descríbelo en la spec en vez de editarlo.
 *
 * Contrato bajo prueba: src/domain/money/money.ts
 */
import { describe, it, expect } from 'vitest';
import { parseMoney, formatMoney, MoneyParseError } from './money.js';

describe('parseMoney — texto decimal → centavos en bigint', () => {
  it.each([
    ['0', 0n],
    ['0.00', 0n],
    ['0.01', 1n],
    ['0.1', 10n],
    ['1234', 123400n],
    ['1234.5', 123450n],
    ['1234.56', 123456n],
    ['-1234.56', -123456n],
    ['-0.01', -1n],
    ['-0.00', 0n],
  ])('parsea %s → %s centavos', (input, esperado) => {
    expect(parseMoney(input as string)).toBe(esperado);
  });

  it('no pierde precisión sobre montos que desbordan Number.MAX_SAFE_INTEGER', () => {
    // 92.233.720.368.547.758,07 en centavos supera 2^53. Con coma flotante
    // este caso se redondea en silencio; con bigint no. Es el corazón de D1.
    const grande = '92233720368547758.07';
    expect(parseMoney(grande)).toBe(9223372036854775807n);
    expect(formatMoney(parseMoney(grande))).toBe(grande);
  });

  it.each([
    ['cadena vacía', ''],
    ['solo espacios', '   '],
    ['espacios alrededor', ' 1.00 '],
    ['tres decimales', '1.234'],
    ['separador de miles', '1,234.56'],
    ['coma como decimal', '1,23'],
    ['punto sin decimales', '1.'],
    ['sin parte entera', '.5'],
    ['notación científica', '1e3'],
    ['texto', 'abc'],
    ['Infinity', 'Infinity'],
    ['NaN', 'NaN'],
    ['signo más explícito', '+1.00'],
    ['doble signo', '--1.00'],
    ['doble punto', '1.2.3'],
  ])('rechaza %s', (_caso, input) => {
    expect(() => parseMoney(input as string)).toThrow(MoneyParseError);
  });
});

describe('formatMoney — centavos en bigint → texto decimal', () => {
  it.each([
    [0n, '0.00'],
    [1n, '0.01'],
    [10n, '0.10'],
    [-1n, '-0.01'],
    [123456n, '1234.56'],
    [-123400n, '-1234.00'],
    [100n, '1.00'],
  ])('formatea %s centavos → %s', (input, esperado) => {
    expect(formatMoney(input as bigint)).toBe(esperado);
  });

  it('siempre emite exactamente dos decimales', () => {
    for (const centavos of [0n, 5n, 50n, 500n, 5000n, -5n, -50n]) {
      expect(formatMoney(centavos)).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  it('nunca emite "-0.00"', () => {
    expect(formatMoney(0n)).toBe('0.00');
    expect(formatMoney(-0n)).toBe('0.00');
  });
});

describe('ida y vuelta', () => {
  it('formatear y volver a parsear devuelve el mismo valor', () => {
    for (const centavos of [0n, 1n, -1n, 99n, 100n, 123456789n, -987654321n]) {
      expect(parseMoney(formatMoney(centavos))).toBe(centavos);
    }
  });
});
