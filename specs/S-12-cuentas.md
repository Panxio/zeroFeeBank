# S-12 — Abrir una cuenta y ver el resumen con el saldo derivado

> Unidad del backlog: **S-12**. Paridad ParaBank: *Open New Account* · *Accounts Overview*.
> Perfil `app-financiera` (D1–D6) y `sut-automatizable` (C5, errores con código tipado).
> Árbitro: `npm run test:cuentas` — **ya escrito y calibrado. NO SE TOCA.**
> Aplica `specs/_CANDADO.md` completo.

---

## Pilar 1 · Qué hace, en prosa

Dos rutas bajo `/cuentas`, las dos autenticadas con el token de S-08:

- **`POST /cuentas`** abre una cuenta corriente nueva **a nombre de quien trae el token**, y la
  deja **fondeada**. El dinero no aparece de la nada: la apertura escribe un asiento de partida
  doble en el ledger (D2), y **de dónde sale la contrapartida depende de si el titular ya tenía
  cuentas o no** (§ Decisión 1).
- **`GET /cuentas`** devuelve el resumen de las cuentas de ese titular con **el saldo derivado
  del ledger** — nunca una columna guardada (D2).

El titular **siempre** sale del token, jamás del cuerpo. Un endpoint que aceptara un
`titularId` en el JSON dejaría abrir cuentas a nombre de cualquiera.

## No-goals (explícitos, para que no crezca solo)

- **No se abren cuentas de ahorro.** P3, respondido por el humano el 2026-09-07: sólo
  `CORRIENTE`. `AHORRO` sigue en el enum del esquema **como capacidad futura**, y pedirla por
  esta puerta es un error del cliente, no un caso a implementar.
- **No hay moneda.** El sistema es mono-moneda (dólar) y **no la representa**: no hay campo, ni
  símbolo, ni conversión. Es un no-goal declarado, no un olvido.
- **No se cierra ni se edita una cuenta.** Ni `DELETE`, ni `PATCH`. El ledger es append-only y
  cerrar una cuenta con saldo es una regla de negocio que nadie ha entregado.
- **No se toca `src/domain/`, ni `prisma/`, ni las migraciones.** La tabla `cuenta` ya existe
  desde S-04 y te sobra.
- **No se toca `POST /transferencias` ni su arnés.** Sigue sin token, a propósito: atarlo es una
  unidad aparte (cierra R4) y meterlo acá rompería el arnés de S-06.
- **No se instala ninguna dependencia.** `package.json` está fuera de tu alcance.
- **No hay paginación ni filtros en el resumen.** Buscar movimientos es S-13.

---

## Pilar 2 · Invariantes (qué tiene que ser siempre verdad)

| # | Invariante |
|---|---|
| V1 | Toda apertura escribe **exactamente 2 movimientos que suman 0** (D2), o no escribe nada. |
| V2 | El saldo que expone `GET /cuentas` es **siempre** `SUM(monto_centavos)` del ledger. No existe ni se crea ninguna columna de saldo (D2/I3). |
| V3 | Una petición rechazada **no deja rastro**: ni cuenta, ni transacción, ni movimiento, ni clave de idempotencia. La transacción de BD revierte entera. |
| V4 | Un titular **sólo ve y sólo usa cuentas suyas**. Una cuenta ajena responde igual que una inexistente. |
| V5 | La misma `Idempotency-Key` **nunca** devuelve la cuenta de otro usuario ni ejecuta dos veces (D5). |
| V6 | Ningún monto negativo entra al dominio (D6): lo rechaza el borde. |
| V7 | Las cuentas de tipo `SISTEMA` **jamás** aparecen en el resumen de nadie ni se pueden abrir por esta puerta. |

---

## Pilar 3 · El contrato, literal

### `POST /cuentas`

Cabeceras obligatorias: `Authorization: Bearer <token>` y `Idempotency-Key: <clave>`.

```json
{ "tipo": "CORRIENTE", "cuentaOrigenId": "<uuid>", "monto": "1000.00" }
```

- **`tipo`** — obligatorio, y el **único valor aceptado es la cadena exacta `"CORRIENTE"`**.
  No se normaliza: `"corriente"` es un error. Un endpoint que arregla en silencio lo que le
  mandan esconde el bug del cliente.
- **`cuentaOrigenId`** — obligatorio **si el titular ya tiene al menos una cuenta**; ausente
  cuando abre la primera. Ver Decisión 1.
- **`monto`** — **opcional**, string decimal (nunca `number`, D1). Si no viene, se usa
  `"1000.00"`. Si viene, tiene que ser **mayor o igual** al mínimo de apertura.

**`201 Created`**, con las claves **en este orden**:

```json
{
  "id": "<uuid>",
  "tipo": "CORRIENTE",
  "saldo": "1000.00",
  "abiertaEn": "<ISO-8601>",
  "transaccionId": "<uuid>"
}
```

`saldo` es el monto con que quedó la cuenta, como **string decimal de dos decimales**
(`formatMoney`), que es la convención del borde ya fijada por `POST /transferencias`.

En un **replay** la respuesta es byte a byte la misma, con `201` y la cabecera
`Idempotency-Replayed: true`.

### `GET /cuentas`

Cabecera obligatoria: `Authorization: Bearer <token>`.

**`200 OK`:**

```json
{ "cuentas": [ { "id": "<uuid>", "tipo": "CORRIENTE", "saldo": "1000.00", "abiertaEn": "<ISO-8601>" } ] }
```

- Sólo las cuentas **cuyo titular es el del token**. Nunca las de otro, nunca las de `SISTEMA`.
- Un titular sin cuentas devuelve `200` con `{"cuentas": []}`, **no un 404**. La lista vacía es
  una respuesta correcta, no un error.
- **Orden estable** (C2, determinismo): por `abiertaEn` ascendente y, a igualdad, por `id`
  ascendente. Dos llamadas seguidas devuelven el mismo orden. Sin un orden declarado, una suite
  E2E que afirme sobre `cuentas[0]` es un intermitente esperando a ocurrir.

### Las respuestas de error — todas, con su código y su estado

| situación | código | HTTP |
|---|---|---|
| falta `Authorization`, o no empieza con `Bearer ` | `TOKEN_AUSENTE` | 401 |
| token malformado o con firma que no cuadra | `TOKEN_INVALIDO` | 401 |
| token bien firmado pero vencido | `TOKEN_EXPIRADO` | 401 |
| falta la cabecera `Idempotency-Key`, o está vacía | `IDEMPOTENCY_KEY_AUSENTE` | 400 |
| `Idempotency-Key` de más de 200 caracteres | `IDEMPOTENCY_KEY_INVALIDA` | 400 |
| la misma clave con otro cuerpo (u otro titular) | `IDEMPOTENCY_KEY_REUSADA` | 409 |
| `tipo` ausente, o distinto de la cadena exacta `"CORRIENTE"` | `TIPO_CUENTA_NO_PERMITIDO` | 400 |
| `monto` presente pero no parseable, o **negativo** | `MONTO_INVALIDO` | 400 |
| `monto` bien formado pero **menor** al mínimo de apertura | `MONTO_APERTURA_INSUFICIENTE` | 400 |
| el titular ya tiene cuentas y no mandó `cuentaOrigenId` | `CUENTA_ORIGEN_REQUERIDA` | 400 |
| `cuentaOrigenId` que no existe, **o que no es del titular** | `CUENTA_NO_ENCONTRADA` | 404 |
| el origen no tiene fondos para el monto | `FONDOS_INSUFICIENTES` | 409 |
| el cuerpo no es JSON válido | `CUERPO_INVALIDO` | 400 |

> **Por qué una cuenta ajena da 404 y no 403.** Un `403` confirma que esa cuenta existe, y con
> eso se puede barrer el espacio de ids para saber qué cuentas tiene el banco. Es la línea roja
> de seguridad del núcleo: no se recorta. **Ajena e inexistente responden idénticamente**, y el
> arnés lo afirma.
>
> **Por qué `MONTO_INVALIDO` y `MONTO_APERTURA_INSUFICIENTE` son códigos distintos.** Son dos
> mecanismos —parseo y regla de negocio— y juntarlos es la
> primera forma en que un arnés nace ciego: *dos mecanismos, un solo síntoma*. Con un solo
> código, la comprobación del mínimo podría no haberse escrito nunca y nadie lo vería.

### El orden de validación — fijo, y el arnés lo comprueba

1. **Token** → titular. (Sin titular no hay nada que decidir.)
2. **`Idempotency-Key`** presente y de largo válido.
3. **Forma del cuerpo**: `tipo` primero, después `monto`.
4. Recién entonces se abre la transacción de BD: candado de la clave → replay o ejecución.
5. Dentro de la transacción: resolver el fondeo, y escribir.

Los pasos 1–3 fallan **sin tocar la base**: una petición mal formada no debe dejar ni una clave
de idempotencia guardada, porque entonces el cliente que la corrige recibiría un `409`.

---

## Pilar 3b · El mecanismo, fijado (no es decisión de implementación)

### Decisión 1 · De dónde sale el dinero de la apertura

**Dato de negocio, entregado por el humano el 2026-09-07.** No se reinterpreta.

- **La primera cuenta de un titular** (no tiene ninguna) se fondea **desde la caja del
  sistema**: es un depósito externo. Movimientos: `+monto` a la cuenta nueva, `−monto` a la
  caja.
- **De la segunda en adelante**, `cuentaOrigenId` es **obligatorio** y la apertura es una
  **transferencia interna** desde esa cuenta, que tiene que ser del mismo titular y tener
  fondos. Es la paridad con ParaBank.

**La caja** es una cuenta `tipo: SISTEMA`, `titularId: null`, `codigo: 'CAJA'`. Se busca por
`codigo`; **si no existe, se crea dentro de la misma transacción**. El `@unique` de `codigo`
resuelve la carrera de dos aperturas simultáneas: si el `create` choca con `P2002`, se relee la
fila y se sigue. **No se crea una caja por apertura**, ni una por usuario: hay una sola en todo
el sistema, y por eso I2 (cuadre global) puede dar 0.

> **Por qué el depósito desde la caja NO pasa por el chequeo de fondos.** La caja es la
> contrapartida del mundo exterior: su saldo negativo *es* el dinero que el sistema entregó, y
> es exactamente la razón por la que I4 excluye las cuentas `SISTEMA`. Exigirle fondos sería
> pedirle a la ventanilla que tenga saldo antes de que exista el banco. La transferencia interna
> **sí** los exige, y para eso reutiliza el motor de S-05 entero.

### Decisión 2 · La apertura reutiliza lo que ya existe. No se reimplementa nada

Tres piezas ya escritas, probadas y calibradas. **Usarlas es obligatorio**; escribir una versión
propia de cualquiera de las tres es un defecto, no una alternativa de estilo.

| pieza | dónde | para qué |
|---|---|---|
| `TransferenciasService.transferirEn(tx, {..., concepto})` | `src/modules/transferencias/` | la transferencia interna: bloqueo ordenado (D4), fondos, partida doble |
| `IdempotenciaEjecutor.ejecutar(...)` | `src/infra/idempotencia.ejecutor.js` | D5: candado consultivo, huella, replay, persistencia en la misma transacción |
| `SaldosRepository` | `src/infra/saldos.repository.js` | **LA** definición de saldo del sistema |
| `AuthService.yo(cabecera)` | `src/modules/auth/` | del token al titular, con los tres errores ya tipados |

> **`SaldosRepository` no es una comodidad: es el punto 1 de esta unidad.** Hasta hoy el saldo
> se calculaba con un `SUM(monto_centavos)` suelto dentro de `transferencias.service.ts`. Un
> segundo `SUM` escrito para el resumen dejaría **dos definiciones de «saldo» en producción**, y
> así es exactamente como nacen los descuadres que I3 existe para cazar. La extracción ya está
> hecha; **si escribes un `SUM(monto_centavos)` propio, tu entrega se rechaza.**

El asiento del depósito desde la caja se arma con `crearTransferencia` + `assertBalanceada` del
dominio (`src/domain/ledger/ledger.js`), igual que hace S-05. La partida doble no se escribe a
mano con dos `create`.

### Decisión 3 · Qué entra en la huella de idempotencia

```
{ titularId, tipo, cuentaOrigenId, monto }   // monto: el string TAL COMO LLEGÓ, o null
```

**El `titularId` va en la huella, y no es un detalle.** Sin él, dos usuarios distintos que
mandaran la misma clave con el mismo cuerpo obtendrían un **replay**, y el segundo recibiría
**el id de la cuenta del primero**. Con él, la huella difiere y responde `409`, que es lo
correcto: la clave ya se usó. Hay un brazo del arnés dedicado a esto.

El `endpoint` que se guarda con la clave es la cadena literal **`POST /cuentas`**.

### Decisión 4 · El concepto del asiento es `APERTURA_CUENTA`

Literal, en mayúsculas, para los dos caminos de fondeo.

⚠️ **La lista de conceptos está VERSIONADA** en `scripts/invariantes.sh`
(`CONCEPTOS_CONOCIDOS`) y `APERTURA_CUENTA` ya está anotada ahí, junto con la marca de que
**nace obligatoriamente de un POST con `Idempotency-Key`** (`CONCEPTOS_CON_CLAVE`). Si escribes
otro concepto, la compuerta de población de `npm run invariantes` se pone roja y lo nombra. Eso
no es burocracia: I5 no sabría si ese asiento debía nacer con clave o no.

---

## Constantes, con su valor y la frase que las justifica (Pilar 1)

| constante | valor | por qué ese valor |
|---|---|---|
| `MONTO_APERTURA_MINIMO_CENTAVOS` | `100000n` | 1000 dólares. **Dato de negocio entregado por el humano el 2026-09-07** (P2). No se cambia, no se redondea, no se hace configurable. |
| monto por defecto | `MONTO_APERTURA_MINIMO_CENTAVOS` | Si el cliente no dice cuánto, deposita el mínimo. Es lo que hace ParaBank y evita un campo obligatorio más. |
| `CODIGO_CUENTA_CAJA` | `'CAJA'` | La etiqueta estable de la contrapartida externa. La columna `codigo` existe en el esquema desde S-04 justamente para esto. |
| largo máximo de `Idempotency-Key` | `200` | El mismo de S-06. Dos límites distintos para la misma cabecera serían dos contratos. |

---

## Pilar 4 · Casos borde que ya están anticipados

1. **`monto` exactamente `"1000.00"`** → `201`. El límite es *menor que* el mínimo, no *menor o
   igual*.
2. **`monto: "999.99"`** → `400 MONTO_APERTURA_INSUFICIENTE`, y **cero filas escritas**.
3. **`monto: "-1000.00"`** → `400 MONTO_INVALIDO` (D6), **no** `MONTO_APERTURA_INSUFICIENTE`.
   El signo lo pone el tipo de asiento, nunca el input.
4. **`tipo: "AHORRO"` y `tipo: "SISTEMA"`** → los dos `400 TIPO_CUENTA_NO_PERMITIDO`. Que
   `SISTEMA` esté en el enum del esquema no lo hace abrible por la puerta pública.
5. **`cuentaOrigenId` que no es un UUID** (`"x"`) → `404 CUENTA_NO_ENCONTRADA`, **nunca un 500**
   por un error de tipo de la base. Compruébalo antes de consultar.
6. **`cuentaOrigenId` de otro usuario** → `404`, y el saldo del otro **no cambia**.
7. **Primera cuenta mandando un `cuentaOrigenId` cualquiera** → `404`: ninguna cuenta le
   pertenece todavía, así que ninguna existe para él.
8. **Dos aperturas simultáneas con la misma clave** → una sola cuenta creada, las dos respuestas
   `201` e idénticas. Lo garantiza el candado consultivo del ejecutor; no lo reimplementes.
9. **Titular sin cuentas pidiendo el resumen** → `200 {"cuentas": []}`.
10. **Cuerpo que no es JSON** → `400 CUERPO_INVALIDO`. Ya lo traduce el filtro global; no
    escribas nada para esto.
11. **Una cuenta recién abierta con `monto` mayor al mínimo** aparece en el resumen con **ese**
    saldo, no con el mínimo.

---

## Pilar 5 · El arnés (ya escrito y calibrado — NO SE TOCA)

```bash
npm run test:cuentas
```

`test/cuentas.int.spec.ts`. Habla **por HTTP**, contra Postgres de verdad, con la app levantada
de verdad, y con el token que emite el `AuthModule` real. Varios brazos leen la base
directamente con Prisma **como oráculo independiente**: comparan lo que el endpoint dice con lo
que el ledger tiene. Un arnés que le preguntara a la misma consulta que audita no tendría
dientes.

---


## Pilar 7 · La meta numérica, fijada antes de codear

| # | Meta | Cómo se mide |
|---|---|---|
| — | `npm run test:cuentas` en verde, **todos** los casos | salida del runner |
| — | `npm run test:integracion` sin regresiones | los 39 de antes + los de esta unidad |
| — | `npm run test:domain` sigue en **87/87** | no tocaste el dominio |
| — | `npm run typecheck` **exit 0** | `tsc --noEmit` |
| — | `npm run build` **exit 0** | el typecheck NO lo cubre |
| — | `npm run guante` sigue en **5/5** | las compuertas duras por ausencia |
| — | `npm run invariantes` sigue en **5/5** | I1–I5, con la apertura de cuenta ya en la base |

Reporta el número real de cada uno, incluidos los fallos. "Funciona" no es una métrica.
