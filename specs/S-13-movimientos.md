# S-13 · Búsqueda de movimientos

> Paridad ParaBank: *Find Transactions*. Escrita el **2026-09-08**,
> ANTES de implementar, junto con su arnés (`test/movimientos.int.spec.ts`).
> Candado: `specs/_CANDADO.md`. **El arnés no se toca.**

---

## 1 · Qué hace, y qué queda fuera

**Hace.** Un endpoint de **lectura** que devuelve los movimientos de UNA cuenta del titular
autenticado, filtrados por transacción, por rango de fechas y por importe, con un tope duro de
resultados y un orden declarado.

**No hace (no-goals, explícitos):**
- **No mueve plata.** No escribe en el ledger, no abre transacciones de escritura, no lleva
  `Idempotency-Key`. Es el primer módulo del repo que no toca D2/D5, y eso es a propósito.
- **No pagina.** El tope es duro y la respuesta declara si quedó algo fuera. Cursor y páginas
  son otra unidad, si alguna vez se pide.
- **No busca sobre transacciones**, sino sobre **movimientos** (dato del humano, 2026-09-08):
  una transferencia es UNA transacción y DOS movimientos, y el cliente sólo ve el suyo.
- **No devuelve la contraparte.** Ni su cuenta, ni su titular, ni su monto.
- **No expone el saldo.** Eso es `GET /cuentas` (S-12) y no se duplica acá.

**Criterio de «hecho»:** `npm run test:movimientos` en verde con los 57 casos del arnés, y
`npm run test:integracion`, `npm run guante`, `npm run typecheck` y `npm run invariantes` sin
moverse de su número.

---

## 2 · Los datos de negocio (preguntados al humano el 2026-09-08, no inventados)

La Regla de Oro prohíbe rellenar estos con un ejemplo. Se preguntaron **antes** de escribir
este archivo y se citan con su respuesta literal:

| # | Dato | Respuesta del humano |
|---|---|---|
| M1 | ¿movimientos o transacciones? | **Movimientos de la cuenta.** El cliente ve sólo la pata que toca su cuenta |
| M2 | ¿tope o paginación? | **Tope duro, sin paginación** |
| M3 | ¿cuál es el tope? | **50** |
| M4 | ¿el filtro por fecha usa el día completo? | **Día completo, inclusivo en ambos extremos** |
| M5 | ¿en qué zona horaria corta el día? | **UTC** |
| M6 | ¿los filtros se acumulan o son excluyentes? | **AND: se acumulan todos** |

### Decisiones de diseño, no datos de negocio (declaradas para que se puedan discutir)

Son forma del contrato, dominio autónomo (§ Límite de la Regla de Oro). Se listan aparte para
que nadie las lea como si fueran datos de negocio entregados:

- **J1 · El filtro por monto compara el importe ABSOLUTO.** Buscar `25.00` devuelve tanto el
  débito de −$25,00 como el crédito de $25,00. Una persona que busca un importe en un buscador
  escribe la cifra, no el signo; y el signo sigue visible en cada fila del resultado.
- **J2 · «Buscar por un día» no lleva parámetro propio:** se expresa con `desde=hasta`. Un
  tercer parámetro para lo que dos ya cubren es código que no necesita existir (Pilar 0).
- **J3 · `total` NO se devuelve.** Devolver el total real exigiría un `COUNT` aparte sobre una
  tabla que ya tiene ~80.000 filas por corrida, para un dato que la pantalla no usa. Se
  devuelven `devueltos` y `hayMas`, que es lo que el tope obliga a comunicar.

---

## 3 · Contrato literal

### `GET /movimientos`

**Cabecera obligatoria:** `Authorization: Bearer <token>` (S-08).

**Parámetros de consulta:**

| parámetro | obligatorio | forma | significado |
|---|---|---|---|
| `cuentaId` | **sí** | UUID | la cuenta cuyos movimientos se buscan. **Debe ser del titular del token** |
| `transaccionId` | no | UUID | sólo los movimientos de esa transacción **que sean de `cuentaId`** |
| `desde` | no | `YYYY-MM-DD` | día **completo** UTC, **inclusivo**: desde `T00:00:00.000Z` |
| `hasta` | no | `YYYY-MM-DD` | día **completo** UTC, **inclusivo**: hasta `T23:59:59.999Z` |
| `monto` | no | string decimal ≥ 0, dos decimales (`"25.00"`) | importe **absoluto** (J1) |

**Los filtros presentes se combinan con AND** (M6). Un parámetro ausente no filtra.
Un parámetro presente y vacío (`?monto=`) **es un 400**, no un ausente: aceptar la cadena vacía
como «sin filtro» hace que un bug del cliente se vea como una búsqueda exitosa.

**Respuesta `200`:**

```json
{
  "cuentaId": "5496d68d-16e9-4e94-99ce-1cfdf804c623",
  "movimientos": [
    {
      "id": "…uuid…",
      "transaccionId": "…uuid…",
      "concepto": "TRANSFERENCIA",
      "monto": "-25.00",
      "fecha": "2026-03-01T12:00:00.000Z"
    }
  ],
  "devueltos": 1,
  "hayMas": false
}
```

- `monto` es **string decimal con signo** (D1). El `bigint` no cruza el borde JSON. El borde ya
  está escrito tres veces en este repo (`formatMoney` en `src/domain/money/money.js`):
  **se reusa, no se reinventa.**
- `fecha` es ISO-8601 en UTC con milisegundos, tal como `Date#toISOString`.
- `concepto` sale de `transaccion.concepto`.
- `devueltos` es la longitud de `movimientos` (≤ 50).
- `hayMas` es `true` **si y sólo si** existían más resultados de los que caben en el tope.

### Orden — es parte del contrato (C2)

**`fecha` DESCENDENTE (lo más reciente primero); a igualdad exacta de `fecha`, `id`
ASCENDENTE.**

El desempate no es decorativo: la población de prueba tiene 51 movimientos con **el mismo
instante exacto**, y sin un desempate estable una aserción sobre `movimientos[0]` es un
intermitente esperando a ocurrir. El tope se aplica **después** de ordenar.

### Errores — código estable y estado (C5)

| código | HTTP | cuándo |
|---|---|---|
| `TOKEN_AUSENTE` · `TOKEN_INVALIDO` · `TOKEN_EXPIRADO` | 401 | los de S-08, reusados tal cual |
| `CUENTA_ID_REQUERIDO` | 400 | falta `cuentaId`, o llega vacío |
| `CUENTA_ID_INVALIDO` | 400 | `cuentaId` no es un UUID |
| `TRANSACCION_ID_INVALIDO` | 400 | `transaccionId` presente y no es un UUID |
| `FECHA_INVALIDA` | 400 | `desde` o `hasta` no es `YYYY-MM-DD` válido |
| `RANGO_INVALIDO` | 400 | `desde` posterior a `hasta` |
| `MONTO_INVALIDO` | 400 | `monto` no parseable, negativo, o con signo |
| `CUENTA_NO_ENCONTRADA` | 404 | la cuenta no existe **o no es del titular** |

> **`CUENTA_NO_ENCONTRADA` para lo ajeno y lo inexistente, idéntico.** Misma línea roja que
> S-12 y S-09: un 403 confirmaría que la cuenta existe y dejaría barrer el espacio de ids.

### Precedencia de validación — FIJADA, no se deja a criterio

Hay una observación abierta sobre S-09: la spec no fijó si el 403 va antes que el
409 y la entrega lo eligió sola. No se repite. El orden es **exactamente** éste:

1. **Token** → 401.
2. **Forma de los parámetros** → 400, evaluados en este orden:
   `cuentaId` → `transaccionId` → `desde` → `hasta` → rango (`desde` ≤ `hasta`) → `monto`.
3. **Existencia y titularidad de `cuentaId`** → 404.
4. La búsqueda.

**400 antes que 404**, a propósito: un parámetro malformado no puede servir de sonda sobre qué
cuentas existen, y validar la forma es más barato que ir a la base.

---

## 4 · Invariantes de esta unidad

- **V1 · No escribe.** Después de cualquier petición a `GET /movimientos`, el número de filas
  de `movimiento`, `transaccion` y `clave_idempotencia` es idéntico al de antes.
- **V2 · Sólo lo del titular.** Ningún `id` devuelto pertenece a una cuenta cuyo `titularId`
  sea distinto del `sub` del token.
- **V3 · Nunca más de 50.** `movimientos.length ≤ 50` para cualquier combinación de filtros.
- **V4 · `hayMas` no miente.** `hayMas === true` ⟺ el conjunto que cumple los filtros tiene más
  de 50 elementos.
- **V5 · El orden se cumple entero**, incluido el desempate por `id` ascendente.

---

## 5 · Casos borde anticipados (Pilar 4)

1. Sin ningún filtro salvo `cuentaId`: devuelve los movimientos de la cuenta, ordenados y
   topados.
2. Una cuenta **sin movimientos**: `200` con lista vacía, `devueltos: 0`, `hayMas: false`.
   **No es un 404.** La cuenta existe.
3. `desde` y `hasta` iguales: devuelve **el día entero**, incluidos `00:00:00.000Z` y
   `23:59:59.999Z`. Es el caso que M4 vino a cerrar.
4. `desde` sin `hasta` (y viceversa): válido, filtra por un solo extremo.
5. Rango que no contiene nada: `200` con lista vacía.
6. `transaccionId` de una transacción real **cuya otra pata es de otra cuenta**: devuelve
   **una** fila, no dos.
7. `transaccionId` que no existe: `200` con lista vacía. **No es un 404**: es un filtro que no
   casó, y un 404 acá diría qué transacciones existen.
8. `monto=0.00`: válido; devuelve los movimientos de importe cero si los hay.
9. `monto` con signo (`-25.00`): **400 `MONTO_INVALIDO`**. El signo lo pone el tipo de asiento,
   nunca el input (D6), y J1 ya dice que el filtro es absoluto.
10. Exactamente 50 resultados: `hayMas: false`. El error clásico de un `> tope` mal escrito.
11. 51 resultados: 50 filas y `hayMas: true`.
12. Parámetro desconocido (`?foo=bar`): se **ignora**. No inventa un 400 que la spec no declara.
13. `cuentaId` repetido (`?cuentaId=a&cuentaId=b`): Express lo entrega como arreglo; **400
    `CUENTA_ID_INVALIDO`**. No se toma el primero en silencio.

---


## 7 · Piezas que YA existen y se reusan (no se reimplementan)

| pieza | dónde | para qué |
|---|---|---|
| `formatMoney` / `parseMoney` | `src/domain/money/money.js` | el borde de `bigint` ↔ string decimal |
| `AuthService.yo(authorization)` | `src/modules/auth/auth.service.js` | token → titular. **El titular sale del token, nunca de la query** |
| `ErrorDeNegocio` | `src/domain/errores.js` | base de los errores tipados (C5) |
| `ErroresHttpFilter` | `src/infra/errores-http.filter.js` | ya traduce los códigos de esta spec |
| `PrismaService` | `src/infra/prisma.service.js` | acceso a la base |

`src/modules/cuentas/cuentas.controller.ts` es el precedente literal de cómo se saca el titular
del token en un controlador. Se mira y se copia el patrón.

---

## 8 · La población de prueba, y por qué es así

El arnés siembra con `POST /__test__/seed {"escenario":"movimientos-buscables"}`, una costura
que **se añadió para esta unidad** porque ninguno de los tres escenarios anteriores
servía: los tres siembran con **una sola fecha** y montos iguales, y contra una población así
un buscador que filtra bien y uno que **ignora los filtros y devuelve todo** son
indistinguibles. El arnés habría dado 100 % verde sobre un endpoint que no filtra nada.

El seed **devuelve** los ids y los diez movimientos que sembró (C1), y esa lista es el oráculo.

Cuenta del titular · 10 movimientos, fechas y montos elegidos para que cada filtro devuelva un
subconjunto **propio y no vacío**:

| # | fecha (UTC) | centavos |
|---|---|---|
| 1 | `2026-03-01T00:00:00.000Z` | `+100000` |
| 2 | `2026-03-01T12:00:00.000Z` | `-2500` |
| 3 | `2026-03-01T23:59:59.999Z` | `+7500` |
| 4 | `2026-03-02T00:00:00.000Z` | `-2500` |
| 5 | `2026-03-02T09:30:00.000Z` | `+50000` |
| 6 | `2026-03-02T18:45:00.000Z` | `-12345` |
| 7 | `2026-03-03T00:00:00.000Z` | `+7500` |
| 8 | `2026-03-03T06:15:00.000Z` | `-99999` |
| 9 | `2026-03-03T23:59:59.999Z` | `+2500` |
| 10 | `2026-03-04T00:00:00.000Z` | `-1` |

Conjuntos esperados, y por qué esos:

```
día 2026-03-01                -> 3 de 10   (con los DOS bordes del día dentro)
rango 2026-03-01..2026-03-02  -> 6 de 10
monto 25.00 (absoluto)        -> 3 de 10   (#2, #4 débitos y #9 crédito: el signo no confunde)
día 03-01 AND monto 25.00     -> 1 de 10   <- el brazo que caza «ignora uno de los filtros»
```

**Cuenta ajena**, de otro titular, con 3 movimientos que **colisionan a propósito** en fecha y
monto con los de arriba. Si el filtro de titularidad desapareciera entero, «día 2026-03-01»
pasaría de 3 a 5 y «monto 25.00» de 3 a 4, y el brazo se pondría rojo. Sin esa colisión, una
cuenta ajena vacía y una inexistente responden ambas 404 y son indistinguibles.

**Cuenta del tope**, del mismo titular: **51** movimientos con el **mismo instante exacto**,
uno más que el tope. El instante repetido obliga a que el desempate por `id` exista de verdad.

---

## 9 · Cómo se corre el árbitro

```bash
npm run test:movimientos     # los 57 casos de test/movimientos.int.spec.ts
```

Necesita Postgres arriba (`npm run db:up`). El arnés levanta la app en proceso con
`ZFB_COSTURAS_PRUEBA=1` y con su propio `ZFB_AUTH_SECRET`.
