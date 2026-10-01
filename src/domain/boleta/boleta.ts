export class TransicionInvalidaError extends Error {
  constructor(id: string, desde: Estado, hacia: string) {
    super(`transición inválida en boleta ${id}: ${desde} → ${hacia}`);
    this.name = 'TransicionInvalidaError';
  }
}

export class MontoInvalidoError extends Error {
  constructor(monto: bigint) {
    super(`monto inválido: ${monto}`);
    this.name = 'MontoInvalidoError';
  }
}

export class VigenciaInvalidaError extends Error {
  constructor(venceEn: Date, ahora: Date) {
    super(`vigencia inválida: vence ${venceEn.toISOString()} ≤ ${ahora.toISOString()}`);
    this.name = 'VigenciaInvalidaError';
  }
}

export type Estado = 'VIGENTE' | 'COBRADA' | 'VENCIDA' | 'DEVUELTA';

export interface Boleta {
  id: string;
  monto: bigint;
  emitidaEn: Date;
  venceEn: Date;
  estado: Estado;
}

export function emitir(a: { id: string; monto: bigint; venceEn: Date }, ahora: Date): Boleta {
  if (a.monto <= 0n) throw new MontoInvalidoError(a.monto);
  if (a.venceEn.getTime() <= ahora.getTime()) throw new VigenciaInvalidaError(a.venceEn, ahora);
  return { id: a.id, monto: a.monto, emitidaEn: ahora, venceEn: a.venceEn, estado: 'VIGENTE' };
}

export function estadoEn(b: Boleta, ahora: Date): Estado {
  if (b.estado === 'VIGENTE' && ahora.getTime() >= b.venceEn.getTime()) return 'VENCIDA';
  return b.estado;
}

export function cobrar(b: Boleta, ahora: Date): Boleta {
  const actual = estadoEn(b, ahora);
  if (actual !== 'VIGENTE') throw new TransicionInvalidaError(b.id, actual, 'COBRADA');
  return { ...b, estado: 'COBRADA' };
}

export function devolver(b: Boleta, ahora: Date): Boleta {
  const actual = estadoEn(b, ahora);
  if (actual !== 'VIGENTE') throw new TransicionInvalidaError(b.id, actual, 'DEVUELTA');
  return { ...b, estado: 'DEVUELTA' };
}
