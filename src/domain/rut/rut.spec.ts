import { describe, expect, it } from 'vitest';
import { RutInvalidoError, esRutValido, normalizarRut } from './rut.js';

/**
 * Arnés del RUT · S-09, Decisión 7. ESTE ARCHIVO NO SE TOCA (specs/_CANDADO.md).
 *
 * ─── Por qué el RUT se valida de verdad y no sólo por forma ─────────────────────────────
 * La boleta de garantía es un DOCUMENTO formal a favor de un tercero que no tiene sesión en
 * el sistema (B3): el RUT es el único identificador del beneficiario y de quien retira, y el
 * cobro se autoriza comparándolo (B4). Un campo de texto libre ahí deja entrar "asdf" en el
 * lugar donde después se decide quién se lleva el dinero.
 *
 * ─── De dónde salen los dígitos verificadores de estos casos ────────────────────────────
 * NO están inventados: se calcularon con el módulo 11 estándar antes de escribir el arnés,
 * y el algoritmo está escrito en la spec para que el resultado sea reproducible por
 * cualquiera. 12345678-5 · 9876543-3 · 1000070-K · 7654321-6 · 5126663-3 · 22222222-2 ·
 * 18765432-7 · 1000609-0 · 1-9 · 6-K · 999999-K.
 *
 * ─── Los dos K importan ────────────────────────────────────────────────────────────────
 * El resto 10 es el único caso que no es un dígito, y es donde muere una implementación que
 * hace `String(11 - resto)`: devolvería "10" y ningún RUT con K validaría jamás.
 */

const VALIDOS = [
  '12345678-5',
  '9876543-3',
  '1000070-K',
  '7654321-6',
  '5126663-3',
  '22222222-2',
  '18765432-7',
  '1000609-0',
];

describe('esRutValido', () => {
  it('R1 · acepta los RUT cuyo dígito verificador cuadra', () => {
    for (const rut of VALIDOS) {
      expect(esRutValido(rut), `${rut} debería ser válido`).toBe(true);
    }
  });

  it('R2 · rechaza el mismo RUT con el dígito verificador cambiado', () => {
    // Mismo cuerpo, DV distinto del correcto: si la implementación sólo mirara el formato,
    // los siete pasarían. Es el caso que separa validar de parecer que valida.
    expect(esRutValido('12345678-3')).toBe(false);
    expect(esRutValido('9876543-4')).toBe(false);
    expect(esRutValido('1000070-1')).toBe(false);
    expect(esRutValido('7654321-0')).toBe(false);
    expect(esRutValido('1000609-K')).toBe(false);
  });

  it('R3 · acepta el resto 10 escrito como K y como k', () => {
    expect(esRutValido('1000070-K')).toBe(true);
    expect(esRutValido('1000070-k')).toBe(true);
  });

  it('R4 · acepta puntos y espacios alrededor', () => {
    expect(esRutValido('12.345.678-5')).toBe(true);
    expect(esRutValido('  12345678-5  ')).toBe(true);
    expect(esRutValido('12.345.678-5 ')).toBe(true);
  });

  it('R5 · exige el guion: sin separador no se sabe dónde termina el cuerpo', () => {
    expect(esRutValido('123456785')).toBe(false);
    expect(esRutValido('12345678')).toBe(false);
  });

  it('R6 · rechaza lo que no es un RUT', () => {
    expect(esRutValido('')).toBe(false);
    expect(esRutValido('   ')).toBe(false);
    expect(esRutValido('-5')).toBe(false);
    expect(esRutValido('abcd-5')).toBe(false);
    expect(esRutValido('1234a678-5')).toBe(false);
    expect(esRutValido('12345678-')).toBe(false);
    expect(esRutValido('12345678-55')).toBe(false);
    expect(esRutValido('12345678-A')).toBe(false);
    expect(esRutValido('123456789-2')).toBe(false); // cuerpo de 9 dígitos
  });

  it('R7 · rechaza lo que ni siquiera es un string', () => {
    expect(esRutValido(undefined)).toBe(false);
    expect(esRutValido(null)).toBe(false);
    expect(esRutValido(12345678)).toBe(false);
    expect(esRutValido({ rut: '12345678-5' })).toBe(false);
    expect(esRutValido(['12345678-5'])).toBe(false);
  });

  it('R8 · acepta cuerpos cortos, que existen de verdad', () => {
    expect(esRutValido('1-9')).toBe(true);
    expect(esRutValido('6-K')).toBe(true);
    expect(esRutValido('999999-K')).toBe(true);
  });
});

/**
 * R14–R17: los tres bordes que la spec dejaba abiertos (S-09). Fijan lo que
 * `rut.ts` ya hacía, medido el 2026-10-02; no cambian el código.
 */
describe('esRutValido · bordes de la enmienda', () => {
  it('R14 · un cuerpo que queda vacío tras descartar los ceros no es un RUT, aunque el DV (0) cuadre', () => {
    expect(esRutValido('0-0')).toBe(false);
    expect(esRutValido('00-0')).toBe(false);
  });

  it('R15 · el DV es exactamente un carácter: ni un punto antes ni uno después', () => {
    expect(esRutValido('12345678-.5')).toBe(false);
    expect(esRutValido('12345678-5.')).toBe(false);
  });

  it('R16 · los puntos del cuerpo no se validan por posición: se descartan donde estén', () => {
    expect(esRutValido('12345.678-5')).toBe(true);
    expect(normalizarRut('12345.678-5')).toBe('12345678-5');
  });

  it('R17 · el largo del cuerpo se mide tras quitar los ceros a la izquierda, no antes', () => {
    expect(esRutValido('000000001-9')).toBe(true);
    expect(normalizarRut('000000001-9')).toBe('1-9');
  });
});

describe('normalizarRut', () => {
  it('R9 · devuelve la forma canónica: sin puntos, con guion, DV en mayúscula', () => {
    expect(normalizarRut('12.345.678-5')).toBe('12345678-5');
    expect(normalizarRut('  12345678-5 ')).toBe('12345678-5');
    expect(normalizarRut('1000070-k')).toBe('1000070-K');
    expect(normalizarRut('999999-k')).toBe('999999-K');
  });

  it('R10 · descarta los ceros a la izquierda del cuerpo', () => {
    // El mismo RUT escrito de dos maneras tiene que quedar guardado UNA sola, o el cobro
    // compararía "012345678-5" con "12345678-5" y negaría a quien sí puede retirar.
    expect(normalizarRut('012345678-5')).toBe('12345678-5');
    expect(normalizarRut('0000001-9')).toBe('1-9');
  });

  it('R11 · lo ya normalizado no cambia (idempotencia)', () => {
    for (const rut of VALIDOS) {
      expect(normalizarRut(normalizarRut(rut))).toBe(normalizarRut(rut));
      expect(normalizarRut(rut)).toBe(rut);
    }
  });

  it('R12 · lanza RutInvalidoError con lo inválido, no devuelve algo parecido', () => {
    for (const malo of ['12345678-3', '123456785', '', 'abcd-5', '12345678-A']) {
      expect(() => normalizarRut(malo), `${malo} debería lanzar`).toThrow(RutInvalidoError);
    }
    expect(() => normalizarRut(undefined)).toThrow(RutInvalidoError);
    expect(() => normalizarRut(null)).toThrow(RutInvalidoError);
    expect(() => normalizarRut(12345678)).toThrow(RutInvalidoError);
  });

  it('R13 · el error lleva su nombre, para que se distinga en un catch', () => {
    try {
      normalizarRut('12345678-3');
      expect.unreachable('normalizarRut debería haber lanzado');
    } catch (error) {
      expect(error).toBeInstanceOf(RutInvalidoError);
      expect((error as Error).name).toBe('RutInvalidoError');
    }
  });
});
