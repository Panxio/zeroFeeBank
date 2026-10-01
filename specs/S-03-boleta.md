# S-03 · Boleta de garantía — la máquina de estados

> Aplica `specs/_CANDADO.md` completo. Léelo antes que esto.
> **Un entregable, una corrida.** Esta spec no depende de S-01 ni de S-02.

## Qué hace

Modela el ciclo de vida de una boleta de garantía, con el instante actual **inyectado como
parámetro** en toda función.

```
VIGENTE ──cobrar──> COBRADA
   │
   ├───devolver───> DEVUELTA
   │
   └──(el reloj)──> VENCIDA
```

## Por qué existe

Es el diferenciador del proyecto frente a un clon de ParaBank, y es el módulo cuyo estado
**depende del tiempo** — que es justo lo que casi ninguna suite de pruebas sabe controlar.

Por eso el reloj se inyecta: sin eso, probar un vencimiento exigiría esperar meses o mentirle
a la base de datos. Es la costura C2 del perfil `sut-automatizable`.

## Archivo a crear

```
src/domain/boleta/boleta.ts     ← ÚNICO archivo que puedes crear o modificar
```

## Contrato exacto

```ts
export class TransicionInvalidaError extends Error {}
export class MontoInvalidoError extends Error {}
export class VigenciaInvalidaError extends Error {}

export type Estado = 'VIGENTE' | 'COBRADA' | 'VENCIDA' | 'DEVUELTA';

export interface Boleta {
  id: string; monto: bigint; emitidaEn: Date; venceEn: Date; estado: Estado;
}

export function emitir(a: { id: string; monto: bigint; venceEn: Date }, ahora: Date): Boleta;
export function estadoEn(b: Boleta, ahora: Date): Estado;
export function cobrar(b: Boleta, ahora: Date): Boleta;
export function devolver(b: Boleta, ahora: Date): Boleta;
```

## Reglas

### `emitir`
- Nace con `estado: 'VIGENTE'`, `emitidaEn` = el `ahora` recibido.
- `monto <= 0n` → `MontoInvalidoError`.
- `venceEn <= ahora` → `VigenciaInvalidaError`. **El mismo instante también se rechaza.**

### `estadoEn` — el vencimiento lo decide el reloj, no un proceso nocturno
- Si el estado guardado es `'VIGENTE'` y `ahora >= venceEn` → devuelve `'VENCIDA'`.
- En cualquier otro caso devuelve el estado guardado. Una boleta ya cobrada sigue `'COBRADA'`
  después del vencimiento; una devuelta sigue `'DEVUELTA'`.

> **El borde está fijado y no se mueve:** `venceEn` es **exclusivo**. Justo en el instante del
> vencimiento la boleta ya está `VENCIDA`, no vigente.

### `cobrar` y `devolver`
- Solo operan si `estadoEn(b, ahora) === 'VIGENTE'`. En cualquier otro caso →
  `TransicionInvalidaError`. Esto cubre: cobrar una vencida, cobrar dos veces, cobrar una
  devuelta, devolver una cobrada, devolver dos veces, devolver una vencida.
- **Devuelven una boleta nueva y no mutan la recibida.** El objeto original queda intacto.
- Una transición inválida **lanza y no produce ningún efecto**.

## Criterio de "hecho"

`npm run test:domain` y `npm run typecheck` en exit 0, con los **22 casos** de
`src/domain/boleta/boleta.spec.ts` pasando. Reporta el número real.

## Fuera de alcance (no-goals)

Los movimientos en el libro mayor que acompañan cada transición (llegan al integrar con S-02),
la inmovilización de fondos, el beneficiario, renovación o prórroga, comisiones, notificaciones,
persistencia y endpoints.
