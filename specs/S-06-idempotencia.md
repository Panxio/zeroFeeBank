# S-06 — Idempotencia y el primer `POST` que mueve plata

> Unidad de trabajo del backlog. La spec y el arnés se escriben, y se calibran rompiendo la app
> a propósito, **antes** de la implementación, que se escribe contra un contrato literal.
> Aplica el candado común de `specs/_CANDADO.md`.
> Escrita: 2026-09-08. Meta que cierra: **M3**.

---

## Pilar 1 · Qué hace, en prosa

Le pone **la puerta** al caso de uso de transferencia que S-05 dejó listo y sin publicar:
un `POST /transferencias` que exige el header `Idempotency-Key` y garantiza que **dos
peticiones con la misma clave ejecutan la transferencia una sola vez** y devuelven **la misma
respuesta**, aunque lleguen **a la vez**.

Lo simultáneo no es un adorno del enunciado: es el caso real. Un doble clic y un reintento de
red producen dos peticiones que se solapan, no dos peticiones en fila. Una idempotencia
implementada como «consulto si la clave existe, y si no existe ejecuto e inserto» pasa todas
las pruebas secuenciales del mundo y **duplica el cobro** en cuanto las dos peticiones se
cruzan en la ventana entre la consulta y la inserción. Esa ventana es el defecto que esta
unidad tiene que cerrar, y el arnés está escrito para verla.

Trae además **el borde de serialización de `bigint`**, que no es un detalle: `JSON.stringify`
de un `bigint` **lanza** `TypeError`. El borde hay que escribirlo a propósito, y los montos
salen como **string decimal**, nunca como `number` (D1). Un `Number(centavos)` en la salida
compila, corre, se ve bien, y pierde plata a partir de 2^53 centavos sin que nada avise.

## No-goals (explícitos, para que no crezca solo)

- **Ninguna autenticación.** No se comprueba que el titular sea quien dice ser: eso es S-08.
  Queda anotado como límite conocido, no como algo resuelto.
- **Ningún endpoint más.** Ni listar movimientos, ni consultar saldo, ni depositar. Sólo el
  `POST` de transferencia. Un endpoint de lectura no necesita idempotencia y ensucia la unidad.
- **Ninguna comisión, tasa ni límite de giro.** Los no-goals del proyecto los excluyen y el
  producto se llama `zeroFeeBank`. No se inventa ninguno.
- **No se persisten las respuestas de error bajo la clave.** Ver § Decisión 3; es una decisión
  declarada con su porqué, no un olvido.
- **Ninguna expiración ni purga de claves.** Una política de retención necesita un plazo, y un
  plazo es un dato de negocio que la spec no trae. Se escala cuando haga falta; hoy no hace.
- **Ningún reintento automático.** Igual que en S-05: escondería un mecanismo mal implementado.

---

## Pilar 2 · Invariantes (qué tiene que ser siempre verdad)

| # | Invariante |
|---|---|
| J1 | Dos peticiones con la **misma clave y el mismo cuerpo** producen **exactamente una** ejecución: 1 transacción y 2 movimientos en el ledger, nunca 4. Da igual si llegan en serie o a la vez. |
| J2 | La respuesta del reintento es **idéntica byte a byte** en cuerpo y en código HTTP a la de la primera. |
| J3 | Dos peticiones con **claves distintas** y el mismo cuerpo son **dos transferencias reales**. La idempotencia no puede volverse un candado que deja de mover plata. |
| J4 | La **misma clave con un cuerpo distinto** se rechaza con `409 IDEMPOTENCY_KEY_REUSADA` y **no escribe nada** en el ledger. Es un error del cliente, no una repetición. |
| J5 | Ningún monto sale del borde como `number` de JSON. En el **texto crudo** de toda respuesta, el monto va **entre comillas**. |
| J6 | Un rechazo de negocio (fondos, cuenta inexistente, monto inválido) **no escribe nada** en el ledger, ni un movimiento ni una transacción huérfana. |
| J7 | Los invariantes de S-05 siguen en pie: el bloqueo ordenado por id ascendente y el saldo derivado después del bloqueo. `npm run test:concurrencia` sigue en verde, sin tocarlo. |

---

## Pilar 3 · El contrato, literal

### La petición

```
POST /transferencias
Idempotency-Key: <texto, 1..200 caracteres, no vacío tras recortar espacios>
Content-Type: application/json

{ "origenId": "<uuid>", "destinoId": "<uuid>", "monto": "1234.56" }
```

- `monto` es **string decimal**, se parsea con `parseMoney` de `src/domain/money/money.js`,
  que acepta exactamente `/^-?(\d+)(?:\.(\d{1,2}))?$/`. Cualquier otra cosa —un `number` de
  JSON, `"1,5"`, `"1.234"`, `""`— es `MONTO_INVALIDO`.
- El monto **tiene que ser positivo** (D6: el signo lo pone el tipo de movimiento, no el
  input). `"0"`, `"-1"` y `"-0.01"` son `MONTO_INVALIDO`.
- `origenId` y `destinoId` son UUID; si no lo son, `MONTO_INVALIDO` no aplica: son
  `CUENTA_NO_ENCONTRADA` (404). No se inventa un código nuevo para un uuid malformado.

### La respuesta de éxito — `201 Created`

```json
{
  "transaccionId": "<uuid v4 generado por el servidor>",
  "origenId": "<uuid>",
  "destinoId": "<uuid>",
  "monto": "1234.56"
}
```

- `monto` es **`formatMoney(centavos)`**: siempre con dos decimales, siempre string. Se
  normaliza: entra `"1234.5"`, sale `"1234.50"`.
- `transaccionId` lo genera el **servidor** con `randomUUID()`. El cliente no lo manda.
- **Sin campos de más.** El cuerpo tiene exactamente esas cuatro claves, en ese orden.

### La respuesta al reintento

**Idéntica**: mismo código HTTP (`201`) y mismo cuerpo, byte a byte, incluido el mismo
`transaccionId`. Se recupera de `clave_idempotencia`, **no se vuelve a ejecutar**.

> ⚠️ **Trampa verificada el 2026-09-07, durante la calibración.** La columna
> `respuesta` es `Json`, y en Postgres eso es **`jsonb`, que NO conserva el orden de las
> claves**: las reordena por longitud y alfabéticamente. Si devuelves el objeto tal como te lo
> entrega Prisma, el contenido es correcto pero el **texto** de la respuesta no coincide con el
> de la primera, y el arnés lo caza en A1. El cuerpo del reintento se **reconstruye en el orden
> del contrato** (`transaccionId`, `origenId`, `destinoId`, `monto`), no se vuelca. Esto no es
> una manía de estilo: un cliente que compara respuestas por hash —el uso normal de una clave
> de idempotencia— vería dos respuestas distintas para la misma operación.

Y lleva un header que la distingue:

```
Idempotency-Replayed: true
```

En la primera ejecución ese header **no se envía** (ni con valor `false`: no se envía).

> **Por qué el header, y por qué es del contrato.** El arnés necesita **dos testigos
> independientes** de que no hubo segunda ejecución: contar los movimientos del ledger y ver
> el header. Un solo síntoma es la primera de las tres formas en que un arnés nace ciego:
> si el único testigo es el conteo, una implementación que
> ejecute dos veces y borre una queda indistinguible de una que ejecutó una sola vez.

### Las respuestas de error

Cuerpo, siempre y para todos:

```json
{ "codigo": "FONDOS_INSUFICIENTES", "mensaje": "<prosa para la persona>" }
```

La suite afirma sobre `codigo`; la persona lee `mensaje` (C5 del perfil SUT). El texto de
`mensaje` puede cambiar sin romper una prueba; **el `codigo` es contrato versionado.**

| Situación | HTTP | `codigo` |
|---|---|---|
| Falta el header, o viene vacío tras recortar | 400 | `IDEMPOTENCY_KEY_AUSENTE` |
| El header trae más de 200 caracteres **una vez recortado** | 400 | `IDEMPOTENCY_KEY_INVALIDA` |
| Misma clave, cuerpo distinto | 409 | `IDEMPOTENCY_KEY_REUSADA` |
| `monto` ausente, no string, mal formado, cero o negativo | 400 | `MONTO_INVALIDO` |
| `origenId` == `destinoId` | 400 | `MISMA_CUENTA` |
| `origenId` o `destinoId` no existe (o no es uuid) | 404 | `CUENTA_NO_ENCONTRADA` |
| El saldo no alcanza para el monto | 409 | `FONDOS_INSUFICIENTES` |

> **El tope se mide sobre la clave YA RECORTADA**, que es la que se persiste. La primera
> versión de esta spec no lo decía y la entrega comprobó las dos longitudes para
> cubrirse: el hueco era de la spec, no de la entrega. Queda cerrado acá.
>
> **El tope de 200 caracteres no es un número de negocio inventado.** Es un límite técnico: la
> clave es la llave primaria de `clave_idempotencia`, y un índice btree de Postgres revienta
> pasados ~2700 bytes con un error de infraestructura ilegible. 200 convierte ese fallo en un
> error tipado del contrato. Si el humano quiere otro valor, se cambia acá y en el arnés.

### El orden de validación

Fijo, porque decide qué código sale cuando hay dos cosas mal a la vez:

```
1. Idempotency-Key ausente/vacía   → 400 IDEMPOTENCY_KEY_AUSENTE
2. Idempotency-Key > 200 chars     → 400 IDEMPOTENCY_KEY_INVALIDA
3. monto mal formado o <= 0        → 400 MONTO_INVALIDO
4. origenId == destinoId           → 400 MISMA_CUENTA
5. --- desde aquí, ya con la clave tomada y dentro de la transacción de BD ---
6. clave conocida, huella distinta → 409 IDEMPOTENCY_KEY_REUSADA
7. clave conocida, huella igual    → 201 con la respuesta guardada + header de replay
8. cuenta inexistente              → 404 CUENTA_NO_ENCONTRADA
9. fondos insuficientes            → 409 FONDOS_INSUFICIENTES
```

Los pasos 1–4 son **validación de borde y ocurren antes de tocar la base**: una petición
malformada no debe consumir una clave ni abrir una transacción.

---

## Pilar 3b · El mecanismo, decidido de antemano (no es dominio de quien implementa)

Estas cuatro decisiones **no se rediscuten ni se sustituyen por otra cosa que «también
funcione»**. Son la razón por la que esta unidad existe.

### Decisión 1 · Un solo `$transaction`, con un candado consultivo tomado primero

La clave, la transferencia y el registro del resultado ocurren **dentro de la misma
transacción de base de datos**. Lo primero que se hace dentro de ella es tomar un candado
consultivo sobre la clave:

```sql
SELECT pg_advisory_xact_lock(hashtext(<clave>))
```

Y **recién después** se consulta `clave_idempotencia`.

Con eso, la segunda petición simultánea **se queda esperando** en el candado hasta que la
primera confirme; cuando entra, ya ve la fila y devuelve la respuesta guardada. La ventana
entre consultar y escribir —que es todo el defecto— deja de existir, porque no hay ventana:
hay un candado.

- `pg_advisory_xact_lock` (no `pg_advisory_lock`) porque el sufijo `_xact` lo suelta la propia
  transacción al confirmar o revertir. Con la variante manual, un `throw` en medio deja el
  candado tomado hasta que muera la conexión, y la segunda petición espera para siempre.
- `hashtext` devuelve 32 bits, así que **dos claves distintas pueden colisionar**. Una colisión
  hace que dos peticiones no relacionadas se serialicen: cuesta latencia, **no corrección**.
  Es un costo aceptado a propósito y anotado acá para que nadie lo descubra como sorpresa.
- **El candado de la clave se toma SIEMPRE ANTES que los `FOR UPDATE` de las cuentas.** Ese
  orden es global y no cambia, así que no introduce deadlocks con D4. Invertirlo sí los
  introduciría.

### Decisión 2 · La huella del cuerpo

```
huellaPeticion = sha256_hex( JSON.stringify({ origenId, destinoId, monto }) )
```

Con las claves **exactamente en ese orden** y los valores **tal como llegaron** (el `monto`
sin normalizar: la huella de `"1234.5"` es distinta de la de `"1234.50"`, y está bien —
son dos cuerpos distintos). `sha256` sale de `node:crypto` (Pilar 0, peldaño 3: no se agrega
una dependencia para esto).

`endpoint` se guarda como el literal `"POST /transferencias"`, para que la misma clave usada
en dos endpoints distintos no colisione el día que haya un segundo.

### Decisión 3 · Sólo se persiste bajo la clave lo que **movió plata**

Si la operación falla —fondos, cuenta inexistente, monto inválido— la transacción **revierte
entera** y la clave **no queda registrada**: se puede reintentar con la misma clave.

Esto **no relaja D5**. D5 existe para cerrar «cobros duplicados por reintento de red o doble
clic», y una operación que falló no movió un centavo: repetirla no duplica nada. Persistir los
errores exigiría una segunda transacción que sobreviva al `rollback` de la primera, y eso es
maquinaria que el riesgo no justifica hoy (Pilar 0). **Queda declarado como límite conocido**,
no como algo resuelto, y se revisa si aparece un caso que lo pida.

### Decisión 4 · La extracción mínima en `TransferenciasService`

El servicio de S-05 abre su propio `$transaction`, y esta unidad necesita meter la
transferencia **dentro** de la transacción de la idempotencia. Se extrae el cuerpo:

```ts
async transferirEn(tx: Prisma.TransactionClient, p: Peticion): Promise<{ transaccionId: string }>
async transferir(p: Peticion): Promise<{ transaccionId: string }>   // = $transaction(tx => transferirEn(tx, p))
```

`transferir` **conserva su firma y su comportamiento**, sin excepción: el arnés de
concurrencia de S-05 lo llama y no se toca (J7). La lógica de dentro —bloqueo ordenado, saldo
derivado después del bloqueo, orden de las escrituras— **se mueve tal cual, sin cambiar ni una
línea de su contenido**. Si al mover algo te parece que se puede mejorar: no es esta unidad.

---

## Pilar 4 · Casos borde que ya están anticipados

- **Dos peticiones idénticas a la vez** — el caso central. Cubierto por J1 y por el arnés A2.
- **Veinte peticiones idénticas a la vez** — el mismo caso, con la ventana abierta de par en
  par. Si el mecanismo es el ingenuo, con veinte se ve; con dos, a veces no.
- **Misma clave, cuerpo distinto** — J4. No es una repetición: es un cliente con un bug.
- **Claves distintas, cuerpo idéntico** — J3, el **control negativo**. Sin este caso, una
  implementación que no ejecute nunca nada pasaría el resto del arnés en verde.
- **Monto sobre 2^53 centavos** — `"99999999999999999.99"` tiene que sobrevivir el viaje de
  ida y de vuelta **exacto**. Es el caso que caza un `Number()` colado en el borde.
- **Monto como `number` de JSON** (`{"monto": 1234.56}`) → `MONTO_INVALIDO`, no un parseo
  amable. Aceptarlo sería abrir la puerta de la coma flotante justo donde D1 la cierra.
- **Fondos insuficientes con clave nueva** — J6: cero movimientos, y la clave sigue libre.

---

## Pilar 5 · El arnés (ya escrito y calibrado — NO SE TOCA)

```bash
npm run test:idempotencia      # test/idempotencia.int.spec.ts, contra Postgres real
```

Levanta la app de verdad en un puerto efímero y le habla por **HTTP con `fetch`**, no por
inyección de servicios. Es a propósito: el borde de `bigint` sólo existe cuando la respuesta
se serializa de verdad, y un test que llama al servicio directamente **no lo cruza**.

Los demás comandos del árbitro siguen valiendo y tienen que quedar en verde:

```bash
npm run test:domain        # 87 casos
npm run typecheck          # exit 0
npm run guante             # 5/5
npm run test:concurrencia  # 4/4 — J7: S-05 no se rompe
```

---


## Pilar 7 · La meta numérica, fijada antes de codear

**M3 cumplida** significa exactamente esto, y se reporta con el número real:

- `npm run test:idempotencia` → **9 casos en 8 grupos (A1–A8), 9 en verde, 0 en rojo**.
- **20 peticiones simultáneas con la misma clave → 1 transacción y 2 movimientos** en el
  ledger. No «pocos». Dos.
- `npm run test:concurrencia` → 4/4 (J7, S-05 intacto).
- `npm run test:domain` → 87/87 · `npm run typecheck` → exit 0 · `npm run guante` → 5/5.
