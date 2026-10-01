export class TransaccionDesbalanceadaError extends Error {
  constructor(id: string, detalle: string) {
    super(`transacción ${id} desbalanceada: ${detalle}`);
    this.name = 'TransaccionDesbalanceadaError';
  }
}

export class MontoInvalidoError extends Error {
  constructor(monto: bigint) {
    super(`monto inválido: ${monto}`);
    this.name = 'MontoInvalidoError';
  }
}

export class MismaCuentaError extends Error {
  constructor(cuentaId: string) {
    super(`origen y destino son la misma cuenta: ${cuentaId}`);
    this.name = 'MismaCuentaError';
  }
}

export interface Entrada {
  cuentaId: string;
  monto: bigint;
}

export interface Transaccion {
  id: string;
  entradas: Entrada[];
}

export function crearTransferencia(a: {
  id: string;
  origen: string;
  destino: string;
  monto: bigint;
}): Transaccion {
  if (a.monto <= 0n) throw new MontoInvalidoError(a.monto);
  if (a.origen === a.destino) throw new MismaCuentaError(a.origen);
  return {
    id: a.id,
    entradas: [
      { cuentaId: a.origen, monto: -a.monto },
      { cuentaId: a.destino, monto: a.monto },
    ],
  };
}

export function assertBalanceada(t: Transaccion): void {
  if (t.entradas.length < 2)
    throw new TransaccionDesbalanceadaError(t.id, 'menos de dos entradas');
  for (const e of t.entradas)
    if (e.monto === 0n)
      throw new TransaccionDesbalanceadaError(t.id, `entrada de monto cero en ${e.cuentaId}`);
  const suma = t.entradas.reduce((acc, e) => acc + e.monto, 0n);
  if (suma !== 0n) throw new TransaccionDesbalanceadaError(t.id, `suma ${suma}`);
}

export function saldoDe(cuentaId: string, movimientos: Entrada[]): bigint {
  return movimientos.reduce((acc, e) => (e.cuentaId === cuentaId ? acc + e.monto : acc), 0n);
}
