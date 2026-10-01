const FORMATO = /^-?(\d+)(?:\.(\d{1,2}))?$/;

export class MoneyParseError extends Error {
  constructor(texto: string) {
    super(`monto inválido: "${texto}"`);
    this.name = 'MoneyParseError';
  }
}

export function parseMoney(texto: string): bigint {
  const m = FORMATO.exec(texto);
  if (m === null) throw new MoneyParseError(texto);
  const negativo = texto.startsWith('-');
  const enteros = m[1] ?? '';
  const decimales = (m[2] ?? '').padEnd(2, '0');
  const digitos = `${enteros}${decimales}`;
  const centavos = BigInt(digitos);
  return negativo ? -centavos : centavos;
}

export function formatMoney(centavos: bigint): string {
  const negativo = centavos < 0n;
  const abs = negativo ? -centavos : centavos;
  const enteros = abs / 100n;
  const decimales = (abs % 100n).toString().padStart(2, '0');
  return `${negativo ? '-' : ''}${enteros.toString()}.${decimales}`;
}
