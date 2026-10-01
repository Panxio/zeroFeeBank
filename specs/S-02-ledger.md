# S-02 · Ledger — el libro mayor de partida doble

> Aplica `specs/_CANDADO.md` completo. Léelo antes que esto.
> **Un entregable, una corrida.** Esta spec no depende de S-01 ni de S-03.

## Qué hace

Registra movimientos de dinero de forma que **nunca puedan descuadrar**, y deriva el saldo de
una cuenta sumando sus movimientos.

## Por qué existe (reglas D2 y D3)

El saldo **no es una columna que se edita**: es una consulta sobre el libro mayor. Una columna
de saldo mutable se puede corromper sin dejar rastro de cómo. Un libro mayor de partida doble
no: si algo no cuadra, la suma lo delata.

Este módulo es el que sostiene el invariante **I1** del proyecto.

## Archivo a crear

```
src/domain/ledger/ledger.ts     ← ÚNICO archivo que puedes crear o modificar
```

## Contrato exacto

```ts
export class TransaccionDesbalanceadaError extends Error {}
export class MontoInvalidoError extends Error {}
export class MismaCuentaError extends Error {}

export interface Entrada { cuentaId: string; monto: bigint }   // monto CON signo
export interface Transaccion { id: string; entradas: Entrada[] }

/** Construye una transferencia balanceada de dos entradas. */
export function crearTransferencia(a: {
  id: string; origen: string; destino: string; monto: bigint;
}): Transaccion;

/** El invariante I1. No devuelve nada: lanza si la transacción no cuadra. */
export function assertBalanceada(t: Transaccion): void;

/** Saldo derivado: la suma de los movimientos de esa cuenta. */
export function saldoDe(cuentaId: string, movimientos: Entrada[]): bigint;
```

## Reglas

### `crearTransferencia`
- Produce **exactamente dos** entradas: `origen` con `-monto`, `destino` con `+monto`.
- `monto <= 0n` → `MontoInvalidoError`. El signo lo pone el tipo de movimiento, **nunca la
  entrada del usuario** (regla D6).
- `origen === destino` → `MismaCuentaError`.
- Lo que produce **siempre** pasa `assertBalanceada`.

### `assertBalanceada` — lanza `TransaccionDesbalanceadaError` si:
- hay **menos de dos** entradas (incluye la lista vacía);
- **alguna** entrada tiene `monto === 0n`, aunque el total sume cero — un movimiento de cero
  no representa nada y ensucia el libro mayor;
- la suma de los montos **no es exactamente `0n`**.

Acepta transacciones de tres o más entradas, mientras cumplan lo anterior.

### `saldoDe`
- Suma los montos de las entradas cuyo `cuentaId` coincide.
- Una cuenta sin movimientos da `0n`. No lanza.

## El caso de calibración

`assertBalanceada({ id: 't1', entradas: [{ cuentaId: 'A', monto: -100n }] })` **debe lanzar**.

Ése es el defecto que se inyecta a propósito en la aplicación —una transferencia que solo
debita— para comprobar que el invariante I1 puede ponerse rojo. Si ese caso pasara en verde,
I1 no estaría verificando nada.

## Criterio de "hecho"

`npm run test:domain` y `npm run typecheck` en exit 0, con los **20 casos** de
`src/domain/ledger/ledger.spec.ts` pasando. Reporta el número real.

## Fuera de alcance (no-goals)

Persistencia, base de datos, Prisma, fechas de los movimientos, tipos de cuenta, límites de
sobregiro, movimientos compensatorios, conciliación. Todo eso llega en S-04 y S-05.
