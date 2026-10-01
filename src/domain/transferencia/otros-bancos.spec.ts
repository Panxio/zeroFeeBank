import { describe, expect, it } from 'vitest';
import {
  BANCOS,
  TOPE_DIARIO_OTROS_BANCOS_CENTAVOS,
  TopeDiarioExcedidoError,
  assertDentroDelTope,
  diaUtcDe,
  esBanco,
  esNumeroCuentaExterna,
  esTipoCuentaExterna,
} from './otros-bancos.js';

/**
 * Arnés de dominio puro para S-22 (transferencia a otros bancos).
 * Ver specs/S-22-otros-bancos.md § 5 y § 8 («Arnés del dominio»).
 *
 * Especifica la lógica pura sin base de datos ni framework:
 * 1. Catálogo exacto de 5 códigos ficticios (R10) y esBanco.
 * 2. esNumeroCuentaExterna en los bordes de B2 y A7 (1 a 20 dígitos numéricos).
 * 3. esTipoCuentaExterna (CORRIENTE y AHORRO).
 * 4. diaUtcDe: ventana del día UTC [desde, hasta) sin Date.now() ni new Date() vacío.
 * 5. assertDentroDelTope con borde inclusivo (J2), código del error (J9) y bigint hasta 2^53 (D1).
 */

describe('catálogo de bancos y esBanco', () => {
  // Enmienda § 8.1: comparar catálogo como conjunto ordenado en el test ya que la spec no fija un orden
  it('contiene exactamente los 5 códigos del catálogo aprobado (R10, juego A), sin ZEROFEEBANK', () => {
    const bancosEsperados = ['ASERCION', 'FIXTURE', 'MOCK', 'SANDBOX', 'STUB'];
    expect([...BANCOS].sort()).toEqual(bancosEsperados);
    expect(BANCOS).toHaveLength(5);
    expect(BANCOS).not.toContain('ZEROFEEBANK');
  });

  it('esBanco acepta cada banco del catálogo de forma exacta', () => {
    for (const banco of BANCOS) {
      expect(esBanco(banco), `${banco} debería ser un banco válido`).toBe(true);
    }
  });

  it('esBanco rechaza bancos fuera del catálogo, cadenas no exactas y tipos no string (B1)', () => {
    const invalidos = [
      'BANCO_REAL',
      'ZEROFEEBANK',
      '',
      'asercion',
      ' ASERCION',
      'ASERCION ',
      1,
      null,
      undefined,
      {},
      [],
    ];
    for (const inv of invalidos) {
      expect(esBanco(inv), `${String(inv)} no debería ser un banco válido`).toBe(false);
    }
  });
});

describe('esNumeroCuentaExterna', () => {
  it('acepta números de cuenta externa en los bordes de 1 a 20 dígitos (A7, J6)', () => {
    // 1 dígito
    expect(esNumeroCuentaExterna('0')).toBe(true);
    expect(esNumeroCuentaExterna('7')).toBe(true);
    // Casos comunes con ceros a la izquierda que deben preservarse
    expect(esNumeroCuentaExterna('000123')).toBe(true);
    expect(esNumeroCuentaExterna('123456')).toBe(true);
    // 20 dígitos exactos
    expect(esNumeroCuentaExterna('12345678901234567890')).toBe(true);
    expect(esNumeroCuentaExterna('00000000000000000001')).toBe(true);
  });

  it('rechaza números de cuenta externa inválidos según los bordes de B2 y J6', () => {
    const invalidos = [
      '',
      'abc',
      '12-34',
      '12 34',
      '123456789012345678901', // 21 dígitos
      ' 123',
      '123\n',
      12345, // número en lugar de string
      null,
      undefined,
      {},
    ];
    for (const inv of invalidos) {
      expect(esNumeroCuentaExterna(inv), `${String(inv)} no debería ser un número de cuenta válido`).toBe(false);
    }
  });
});

describe('esTipoCuentaExterna', () => {
  it('acepta únicamente CORRIENTE y AHORRO (J4)', () => {
    expect(esTipoCuentaExterna('CORRIENTE')).toBe(true);
    expect(esTipoCuentaExterna('AHORRO')).toBe(true);
  });

  it('rechaza tipos fuera de J4, minúsculas y no strings (B3)', () => {
    const invalidos = [
      'SISTEMA',
      'PRESTAMO',
      'ahorro',
      'corriente',
      '',
      'VISTA',
      null,
      undefined,
      1,
    ];
    for (const inv of invalidos) {
      expect(esTipoCuentaExterna(inv), `${String(inv)} no debería ser un tipo de cuenta externa válido`).toBe(false);
    }
  });
});

describe('diaUtcDe', () => {
  it('calcula la ventana [desde, hasta) a mediodía (12:00Z)', () => {
    const { desde, hasta } = diaUtcDe(new Date('2026-10-01T12:00:00.000Z'));
    expect(desde.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(hasta.toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });

  it('calcula la ventana en el borde inicial del día (00:00:00.000Z)', () => {
    const { desde, hasta } = diaUtcDe(new Date('2026-10-01T00:00:00.000Z'));
    expect(desde.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(hasta.toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });

  it('calcula la ventana en el último milisegundo del día (23:59:59.999Z)', () => {
    const { desde, hasta } = diaUtcDe(new Date('2026-10-01T23:59:59.999Z'));
    expect(desde.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(hasta.toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });

  it('calcula correctamente el cambio de mes y de año (2026-12-31T23:59:59.999Z → 2026-12-31 a 2027-01-01)', () => {
    const { desde, hasta } = diaUtcDe(new Date('2026-12-31T23:59:59.999Z'));
    expect(desde.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    expect(hasta.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('assertDentroDelTope', () => {
  it('define la constante TOPE_DIARIO_OTROS_BANCOS_CENTAVOS en 20000n (200,00 USD)', () => {
    expect(TOPE_DIARIO_OTROS_BANCOS_CENTAVOS).toBe(20000n);
  });

  it('deja pasar cuando acumulado + monto = 19999n (199,99 USD)', () => {
    expect(() => assertDentroDelTope(10000n, 9999n, 20000n)).not.toThrow();
  });

  it('deja pasar cuando acumulado + monto es exactamente el tope: 20000n (borde inclusivo J2)', () => {
    expect(() => assertDentroDelTope(10000n, 10000n, 20000n)).not.toThrow();
    expect(() => assertDentroDelTope(0n, 20000n, 20000n)).not.toThrow();
    expect(() => assertDentroDelTope(20000n, 0n, 20000n)).not.toThrow();
  });

  it('rechaza cuando acumulado + monto supera el tope por un centavo: 20001n (lanza TopeDiarioExcedidoError)', () => {
    expect(() => assertDentroDelTope(20000n, 1n, 20000n)).toThrow(TopeDiarioExcedidoError);
    expect(() => assertDentroDelTope(10000n, 10001n, 20000n)).toThrow(TopeDiarioExcedidoError);
    expect(() => assertDentroDelTope(0n, 20001n, 20000n)).toThrow(TopeDiarioExcedidoError);
  });

  it('usa TOPE_DIARIO_OTROS_BANCOS_CENTAVOS si se omite el argumento de tope', () => {
    expect(() => assertDentroDelTope(0n, 20000n)).not.toThrow();
    expect(() => assertDentroDelTope(0n, 20001n)).toThrow(TopeDiarioExcedidoError);
  });

  it('el error TopeDiarioExcedidoError lleva el código estable TOPE_DIARIO_EXCEDIDO (J9, C5)', () => {
    try {
      assertDentroDelTope(20000n, 1n, 20000n);
      expect.unreachable('debía lanzar TopeDiarioExcedidoError');
    } catch (e) {
      expect(e).toBeInstanceOf(TopeDiarioExcedidoError);
      const err = e as TopeDiarioExcedidoError;
      expect(err.codigo).toBe('TOPE_DIARIO_EXCEDIDO');
    }
  });

  it('soporta montos bigint cerca de 2^53 sin pérdida de precisión ni desborde de coma flotante (D1)', () => {
    const casiLimite = 9_007_199_254_740_992n; // 2^53
    expect(() => assertDentroDelTope(casiLimite - 1n, 1n, casiLimite)).not.toThrow();
    expect(() => assertDentroDelTope(casiLimite - 1n, 2n, casiLimite)).toThrow(TopeDiarioExcedidoError);
  });
});
