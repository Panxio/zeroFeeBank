/**
 * ARNÉS S-03 — Boleta de garantía. NO SE TOCA.
 *
 * Si un caso falla, el problema está en la implementación, no en este archivo.
 * Si crees que un caso está mal, DETENTE y descríbelo en la spec en vez de editarlo.
 *
 * Contrato bajo prueba: src/domain/boleta/boleta.ts
 * El "ahora" se INYECTA como parámetro en toda función. El dominio nunca
 * llama a Date.now() ni a new Date(): sin eso, probar un vencimiento exigiría
 * esperar meses o mentirle a la base de datos (costura C2).
 */
import { describe, it, expect } from 'vitest';
import {
  emitir,
  estadoEn,
  cobrar,
  devolver,
  TransicionInvalidaError,
  MontoInvalidoError,
  VigenciaInvalidaError,
  type Boleta,
} from './boleta.js';

const T0 = new Date('2026-01-01T00:00:00.000Z');
const VENCE = new Date('2026-04-01T00:00:00.000Z');
const ANTES = new Date('2026-03-31T23:59:59.999Z');
const JUSTO = new Date('2026-04-01T00:00:00.000Z');
const DESPUES = new Date('2026-04-01T00:00:00.001Z');

const nueva = (): Boleta =>
  emitir({ id: 'b1', monto: 500000n, venceEn: VENCE }, T0);

describe('emitir', () => {
  it('nace VIGENTE, con su monto y sus fechas', () => {
    const b = nueva();
    expect(b.estado).toBe('VIGENTE');
    expect(b.monto).toBe(500000n);
    expect(b.emitidaEn).toEqual(T0);
    expect(b.venceEn).toEqual(VENCE);
  });

  it.each([[0n], [-1n], [-500000n]])('rechaza el monto %s', (monto) => {
    expect(() =>
      emitir({ id: 'b1', monto: monto as bigint, venceEn: VENCE }, T0),
    ).toThrow(MontoInvalidoError);
  });

  it('rechaza una vigencia que vence antes de emitirse', () => {
    expect(() =>
      emitir({ id: 'b1', monto: 100n, venceEn: new Date('2025-12-31T00:00:00.000Z') }, T0),
    ).toThrow(VigenciaInvalidaError);
  });

  it('rechaza una vigencia que vence en el mismo instante de la emisión', () => {
    expect(() => emitir({ id: 'b1', monto: 100n, venceEn: T0 }, T0)).toThrow(
      VigenciaInvalidaError,
    );
  });
});

describe('estadoEn — el vencimiento lo decide el reloj, no un proceso', () => {
  it('sigue VIGENTE un milisegundo antes de vencer', () => {
    expect(estadoEn(nueva(), ANTES)).toBe('VIGENTE');
  });

  it('⭐ BORDE — está VENCIDA justo en el instante del vencimiento', () => {
    // El borde se fija acá y no se mueve: venceEn es exclusivo.
    expect(estadoEn(nueva(), JUSTO)).toBe('VENCIDA');
  });

  it('está VENCIDA un milisegundo después', () => {
    expect(estadoEn(nueva(), DESPUES)).toBe('VENCIDA');
  });

  it('una boleta cobrada sigue COBRADA después del vencimiento', () => {
    const cobrada = cobrar(nueva(), ANTES);
    expect(estadoEn(cobrada, DESPUES)).toBe('COBRADA');
  });

  it('una boleta devuelta sigue DEVUELTA después del vencimiento', () => {
    const devuelta = devolver(nueva(), ANTES);
    expect(estadoEn(devuelta, DESPUES)).toBe('DEVUELTA');
  });
});

describe('cobrar', () => {
  it('una boleta vigente pasa a COBRADA', () => {
    const c = cobrar(nueva(), ANTES);
    expect(c.estado).toBe('COBRADA');
    expect(c.monto).toBe(500000n);
  });

  it('no muta la boleta original', () => {
    const b = nueva();
    cobrar(b, ANTES);
    expect(b.estado).toBe('VIGENTE');
  });

  it('rechaza cobrar en el instante del vencimiento', () => {
    expect(() => cobrar(nueva(), JUSTO)).toThrow(TransicionInvalidaError);
  });

  it('rechaza cobrar una boleta ya vencida', () => {
    expect(() => cobrar(nueva(), DESPUES)).toThrow(TransicionInvalidaError);
  });

  it('rechaza cobrar dos veces', () => {
    const c = cobrar(nueva(), ANTES);
    expect(() => cobrar(c, ANTES)).toThrow(TransicionInvalidaError);
  });

  it('rechaza cobrar una boleta devuelta', () => {
    const d = devolver(nueva(), ANTES);
    expect(() => cobrar(d, ANTES)).toThrow(TransicionInvalidaError);
  });
});

describe('devolver', () => {
  it('una boleta vigente pasa a DEVUELTA', () => {
    expect(devolver(nueva(), ANTES).estado).toBe('DEVUELTA');
  });

  it('no muta la boleta original', () => {
    const b = nueva();
    devolver(b, ANTES);
    expect(b.estado).toBe('VIGENTE');
  });

  it('rechaza devolver una boleta vencida', () => {
    expect(() => devolver(nueva(), DESPUES)).toThrow(TransicionInvalidaError);
  });

  it('rechaza devolver una boleta cobrada', () => {
    const c = cobrar(nueva(), ANTES);
    expect(() => devolver(c, ANTES)).toThrow(TransicionInvalidaError);
  });

  it('rechaza devolver dos veces', () => {
    const d = devolver(nueva(), ANTES);
    expect(() => devolver(d, ANTES)).toThrow(TransicionInvalidaError);
  });
});
