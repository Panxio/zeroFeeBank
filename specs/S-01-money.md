# S-01 · Money — el dinero en centavos

> Aplica `specs/_CANDADO.md` completo. Léelo antes que esto.
> **Un entregable, una corrida.** Esta spec no depende de S-02 ni de S-03.

## Qué hace

Convierte entre **texto decimal** (lo que ve una persona: `"1234.56"`) y **centavos en
`bigint`** (lo que guarda el sistema: `123456n`). Nada más.

## Por qué existe (regla D1)

`0.1 + 0.2` no da `0.3` en coma flotante, y en banca eso es un descuadre. Los montos viven en
enteros de principio a fin. El único lugar donde aparece un punto decimal es el borde: la
entrada del usuario y la salida JSON.

## Archivo a crear

```
src/domain/money/money.ts     ← ÚNICO archivo que puedes crear o modificar
```

## Contrato exacto

```ts
export class MoneyParseError extends Error {}

/** Texto decimal → centavos. Lanza MoneyParseError si el texto no cumple el formato. */
export function parseMoney(texto: string): bigint;

/** Centavos → texto decimal con SIEMPRE dos decimales. */
export function formatMoney(centavos: bigint): string;
```

### Formato aceptado por `parseMoney`

Exactamente: un signo `-` opcional, una parte entera de uno o más dígitos, y opcionalmente un
punto seguido de **uno o dos** dígitos. Nada más.

| Entrada | Resultado |
|---|---|
| `"0"` · `"0.00"` · `"-0.00"` | `0n` |
| `"0.1"` | `10n` |
| `"0.01"` | `1n` |
| `"1234"` | `123400n` |
| `"1234.5"` | `123450n` |
| `"1234.56"` | `123456n` |
| `"-1234.56"` | `-123456n` |

**Rechaza** (con `MoneyParseError`): cadena vacía, solo espacios, espacios alrededor
(`" 1.00 "`), tres o más decimales, separador de miles (`"1,234.56"`), coma decimal (`"1,23"`),
punto sin decimales (`"1."`), sin parte entera (`".5"`), notación científica (`"1e3"`), texto,
`"Infinity"`, `"NaN"`, signo más explícito (`"+1.00"`), doble signo, doble punto.

### Formato emitido por `formatMoney`

Siempre `/^-?\d+\.\d{2}$/`. `0n → "0.00"`, `1n → "0.01"`, `-1n → "-0.01"`,
`123456n → "1234.56"`, `-123400n → "-1234.00"`.

**Nunca emite `"-0.00"`.**

### Invariante de ida y vuelta

`parseMoney(formatMoney(c)) === c` para todo `c: bigint`.

### El caso que define el diseño

`parseMoney("92233720368547758.07")` debe dar exactamente `9223372036854775807n`, y
`formatMoney` debe devolver ese mismo texto. Ese monto supera `Number.MAX_SAFE_INTEGER`: con
coma flotante se redondea en silencio. **Si este caso pasa, la implementación es de verdad
entera.**

## Decisión de diseño ya tomada — no la "mejores"

**No agregues `add`, `sub`, `neg` ni comparadores.** `bigint` ya tiene `+`, `-` y `<`
nativos; envolverlos sería una capa sin comportamiento propio (Pilar 0, peldaño 3). Si crees
que hace falta una operación, escríbelo como bloqueo, no la agregues.

## Criterio de "hecho"

`npm run test:domain` y `npm run typecheck` en exit 0, con los **36 casos** de
`src/domain/money/money.spec.ts` pasando. Reporta el número real.

## Fuera de alcance (no-goals)

Conversión de divisas, redondeo bancario, formato con separador de miles o símbolo de moneda,
localización.

> ⚠️ **Corregido el 2026-09-07.** Esta línea decía «Monedas distintas del **peso**»,
> y era la única mención de una moneda en todo el repositorio: no había campo, ni constante, ni
> símbolo que la respaldara. Al declararse la moneda —**el dólar**— esa palabra pasó a contradecir la decisión, así que se quita en vez de dejarla
> envejecer. Lo que esta unidad sí fija, y no cambia, es la **representación**: entero en la
> unidad mínima, dos decimales en el borde. El sistema es **mono-moneda y no la representa**;
> el día que haya dos, la moneda entra al ledger, no al formato.
