import { ErrorDeNegocio } from '../errores.js';

export class RutInvalidoError extends ErrorDeNegocio {
  readonly codigo = 'RUT_INVALIDO';
  constructor(mensaje = 'RUT inválido') {
    super(mensaje);
    this.name = 'RutInvalidoError';
  }
}

function parsearRut(entrada: unknown): { cuerpoNormalizado: string; dvEsperado: string } | null {
  if (typeof entrada !== 'string') {
    return null;
  }
  const limpio = entrada.trim();
  if (limpio.length === 0) {
    return null;
  }

  const partes = limpio.split('-');
  if (partes.length !== 2) {
    return null;
  }

  const [cuerpoCrudo, dvCrudo] = partes;
  if (cuerpoCrudo === undefined || dvCrudo === undefined) {
    return null;
  }

  if (dvCrudo.length !== 1) {
    return null;
  }
  const dvChar = dvCrudo.toUpperCase();
  if (!/^[\dK]$/.test(dvChar)) {
    return null;
  }

  if (cuerpoCrudo.length === 0 || !/^[\d.]+$/.test(cuerpoCrudo)) {
    return null;
  }

  const cuerpoSinPuntos = cuerpoCrudo.replace(/\./g, '');
  if (cuerpoSinPuntos.length === 0) {
    return null;
  }

  const cuerpoNormalizado = cuerpoSinPuntos.replace(/^0+/, '');
  if (cuerpoNormalizado.length < 1 || cuerpoNormalizado.length > 8) {
    return null;
  }

  let suma = 0;
  let mult = 2;
  for (let i = cuerpoNormalizado.length - 1; i >= 0; i--) {
    const digito = cuerpoNormalizado.charCodeAt(i) - 48;
    suma += digito * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }

  const resto = suma % 11;
  const dvCalculado = 11 - resto;
  let dvEsperado = '';
  if (dvCalculado === 11) {
    dvEsperado = '0';
  } else if (dvCalculado === 10) {
    dvEsperado = 'K';
  } else {
    dvEsperado = String(dvCalculado);
  }

  if (dvChar !== dvEsperado) {
    return null;
  }

  return { cuerpoNormalizado, dvEsperado };
}

export function esRutValido(entrada: unknown): boolean {
  return parsearRut(entrada) !== null;
}

export function normalizarRut(entrada: unknown): string {
  const resultado = parsearRut(entrada);
  if (resultado === null) {
    throw new RutInvalidoError();
  }
  return `${resultado.cuerpoNormalizado}-${resultado.dvEsperado}`;
}
