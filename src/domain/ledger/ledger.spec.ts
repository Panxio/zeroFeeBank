/**
 * ARNÉS S-02 — Ledger (libro mayor de partida doble). NO SE TOCA.
 *
 * Si un caso falla, el problema está en la implementación, no en este archivo.
 * Si crees que un caso está mal, DETENTE y descríbelo en la spec en vez de editarlo.
 *
 * Contrato bajo prueba: src/domain/ledger/ledger.ts
 * Éste es el arnés que sostiene el invariante I1. El caso
 * "rechaza una transacción que solo debita" es EL caso de calibración:
 * es el defecto que se inyecta a propósito para comprobar que I1 puede fallar.
 */
import { describe, it, expect } from 'vitest';
import {
  crearTransferencia,
  assertBalanceada,
  saldoDe,
  TransaccionDesbalanceadaError,
  MontoInvalidoError,
  MismaCuentaError,
  type Transaccion,
} from './ledger.js';

const tx = (id: string, entradas: Array<[string, bigint]>): Transaccion => ({
  id,
  entradas: entradas.map(([cuentaId, monto]) => ({ cuentaId, monto })),
});

describe('crearTransferencia', () => {
  it('produce exactamente dos entradas que suman cero', () => {
    const t = crearTransferencia({ id: 't1', origen: 'A', destino: 'B', monto: 5000n });
    expect(t.entradas).toHaveLength(2);
    expect(t.entradas.reduce((acc, e) => acc + e.monto, 0n)).toBe(0n);
  });

  it('debita el origen y acredita el destino por el mismo monto', () => {
    const t = crearTransferencia({ id: 't1', origen: 'A', destino: 'B', monto: 5000n });
    expect(t.entradas.find((e) => e.cuentaId === 'A')?.monto).toBe(-5000n);
    expect(t.entradas.find((e) => e.cuentaId === 'B')?.monto).toBe(5000n);
  });

  it.each([[0n], [-1n], [-5000n]])('rechaza el monto %s', (monto) => {
    expect(() =>
      crearTransferencia({ id: 't1', origen: 'A', destino: 'B', monto: monto as bigint }),
    ).toThrow(MontoInvalidoError);
  });

  it('rechaza transferir a la misma cuenta', () => {
    expect(() =>
      crearTransferencia({ id: 't1', origen: 'A', destino: 'A', monto: 100n }),
    ).toThrow(MismaCuentaError);
  });

  it('la transacción que produce siempre pasa assertBalanceada', () => {
    const t = crearTransferencia({ id: 't1', origen: 'A', destino: 'B', monto: 1n });
    expect(() => assertBalanceada(t)).not.toThrow();
  });
});

describe('assertBalanceada — el invariante I1', () => {
  it('acepta una transacción balanceada de dos entradas', () => {
    expect(() => assertBalanceada(tx('t1', [['A', -100n], ['B', 100n]]))).not.toThrow();
  });

  it('acepta una transacción balanceada de tres entradas', () => {
    expect(() =>
      assertBalanceada(tx('t1', [['A', -100n], ['B', 70n], ['C', 30n]])),
    ).not.toThrow();
  });

  it('⭐ CALIBRACIÓN — rechaza una transacción que solo debita', () => {
    // Éste es el defecto que se inyecta a propósito en la app para comprobar
    // que el invariante I1 puede ponerse rojo. Si este caso pasa en verde,
    // I1 no está verificando nada.
    expect(() => assertBalanceada(tx('t1', [['A', -100n]]))).toThrow(
      TransaccionDesbalanceadaError,
    );
  });

  it('rechaza una transacción que solo acredita', () => {
    expect(() => assertBalanceada(tx('t1', [['B', 100n]]))).toThrow(
      TransaccionDesbalanceadaError,
    );
  });

  it('rechaza dos entradas que no suman cero', () => {
    expect(() => assertBalanceada(tx('t1', [['A', -100n], ['B', 99n]]))).toThrow(
      TransaccionDesbalanceadaError,
    );
  });

  it('rechaza una transacción sin entradas', () => {
    expect(() => assertBalanceada(tx('t1', []))).toThrow(TransaccionDesbalanceadaError);
  });

  it('rechaza una entrada de monto cero, aunque el total sume cero', () => {
    // Un movimiento de cero no representa nada y ensucia el libro mayor.
    expect(() =>
      assertBalanceada(tx('t1', [['A', -100n], ['B', 100n], ['C', 0n]])),
    ).toThrow(TransaccionDesbalanceadaError);
  });

  it('detecta el desbalance en montos que desbordan Number.MAX_SAFE_INTEGER', () => {
    // Con coma flotante estos dos montos se considerarían iguales.
    expect(() =>
      assertBalanceada(tx('t1', [['A', -9007199254740993n], ['B', 9007199254740992n]])),
    ).toThrow(TransaccionDesbalanceadaError);
  });
});

describe('saldoDe — el saldo es una consulta derivada, no una columna', () => {
  const movimientos = [
    ...tx('t1', [['A', -1000n], ['B', 1000n]]).entradas,
    ...tx('t2', [['B', -250n], ['C', 250n]]).entradas,
    ...tx('t3', [['A', -50n], ['C', 50n]]).entradas,
  ];

  it.each([
    ['A', -1050n],
    ['B', 750n],
    ['C', 300n],
  ])('el saldo de %s es %s', (cuentaId, esperado) => {
    expect(saldoDe(cuentaId as string, movimientos)).toBe(esperado);
  });

  it('una cuenta sin movimientos tiene saldo cero', () => {
    expect(saldoDe('Z', movimientos)).toBe(0n);
  });

  it('el saldo de todas las cuentas suma cero — el invariante I2', () => {
    const total = movimientos.reduce((acc, e) => acc + e.monto, 0n);
    expect(total).toBe(0n);
  });
});
