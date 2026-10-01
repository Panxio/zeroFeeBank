# S-09 — La boleta de garantía por API

> Unidad del backlog: **S-09**. Es **lo único del alcance que ParaBank no tiene**: el
> diferenciador del producto.
> Perfil `app-financiera` (D1–D6) y `sut-automatizable` (C2 reloj inyectado, C5 errores con
> código tipado).
> Árbitros: `npm run test:boletas` y `npm run test:domain` — **ya escritos y calibrados.
> NO SE TOCAN.**
> Aplica `specs/_CANDADO.md` completo.

---

## Pilar 1 · Qué hace, en prosa

Una boleta de garantía es un **documento formal** que un cliente (el **tomador**) emite a favor
de un tercero (el **beneficiario**) para respaldar una obligación. El banco **inmoviliza** los
fondos del tomador: si el tomador incumple, el beneficiario cobra el documento y el banco paga
sin entrar a discutir el contrato de fondo.

De ahí salen las cinco rutas de esta unidad:

- **`POST /boletas`** — el tomador emite. **Inmoviliza fondos, no los descuenta**: un asiento de
  partida doble mueve el monto de su cuenta a la **cuenta de garantía del sistema**. Sin fondos
  suficientes **no hay boleta**, y no se escribe nada.
- **`GET /boletas`** y **`GET /boletas/{id}`** — el tomador ve sus boletas, con el estado
  **calculado contra el reloj inyectado**.
- **`POST /boletas/{id}/cobrar`** — el beneficiario cobra presentando el documento. Los fondos
  salen de la garantía **hacia fuera del banco** (la caja del sistema, que es la contrapartida
  externa desde S-12).
- **`POST /boletas/{id}/vencer`** — acto explícito que materializa el vencimiento y **libera**
  los fondos de vuelta a la cuenta del tomador.
- **`POST /boletas/{id}/devolver`** — el tomador libera los fondos porque el beneficiario
  devolvió el documento sin cobrarlo.

```
EMITIDA/VIGENTE ──cobrar──────> COBRADA      (garantía → caja: sale del banco)
       │
       ├────────devolver──────> DEVUELTA     (garantía → cuenta del tomador)
       │
       └──(el reloj)─VENCIDA──> vencer ─────> VENCIDA materializada
                                              (garantía → cuenta del tomador)
```

## Los datos de negocio — entregados por el humano el 2026-09-07. No se reinterpretan

| # | Dato | Valor entregado |
|---|---|---|
| B1 | La vigencia | La fija quien emite, en **`plazoDias`, entre 1 y 365**. El servidor calcula `venceEn = ahora + plazoDias`. |
| B2 | Al vencer | **Acto explícito** (`POST /boletas/{id}/vencer`). El estado se deriva del reloj al leer, pero el asiento que libera los fondos lo escribe una llamada, no un GET. |
| B3 | El beneficiario | **Datos del documento, no un usuario**: RUT y nombre, más una **glosa** (la descripción de la obligación). No hay mantenedor de beneficiarios ni cuenta asociada. |
| B4 | Quién retira | RUT y nombre, **declarados al emitir**. El cobro exige que el RUT presentado **coincida**. |
| B5 | El RUT | **Se valida con dígito verificador** (módulo 11, algoritmo chileno estándar). |
| B6 | Tope de monto | **No hay.** El único límite es tener los fondos. |
| B7 | Quién cobra | **Sin token.** Quien cobra presenta el documento (el id de la boleta) y el RUT del retirador. Es lo que hace **irrevocable** el instrumento: el tomador no puede impedir el cobro. |

> **Por qué el cobro no lleva token y el resto sí.** El beneficiario no tiene sesión en
> zeroFeeBank —no hay mantenedor (B3)—, y un cobro autenticado con el token del tomador sería
> el tomador auto-cobrándose la garantía que emitió a favor de otro: contradice el instrumento.
> Emitir, vencer y devolver **sí** son actos del tomador y **sí** exigen su token.

## No-goals (explícitos, para que no crezca solo)

- **No hay portal del beneficiario.** No se crea usuario, ni sesión, ni notificación. El
  beneficiario es texto en el documento. Capacidad futura declarada, no un olvido.
- **No hay cobro parcial.** Se cobra el monto completo o nada.
- **No hay renovación ni prórroga** de una boleta vigente. Emitir otra es la vía.
- **No hay comisión de emisión.** El banco se llama zeroFeeBank; una comisión sería una tasa
  inventada, que es justo lo que la Regla de Oro prohíbe.
- **No se toca `prisma/`.** La migración `20260908002805_s09_boleta_documento` **ya está
  aplicada** y la tabla `boleta` ya tiene todas las columnas que necesitas.
- **No se toca `src/infra/`, `src/modules/auth/`, `src/modules/transferencias/`,
  `src/modules/costuras/`, `src/modules/cuentas/`, `test/`, `scripts/` ni `package.json`.**
- **No se instala ninguna dependencia.** Todo lo que necesitas está en el repo.
- **No hay paginación ni filtros** en `GET /boletas`. Buscar es S-13.
- **No hay proceso nocturno** que venza boletas solo. B2 lo dice: el vencimiento es un acto.

---

## Pilar 2 · Invariantes (qué tiene que ser siempre verdad)

| # | Invariante |
|---|---|
| V1 | Toda operación de boleta escribe **exactamente 2 movimientos que suman 0** (D2), o **no escribe nada**. |
| V2 | **Una transición inválida no deja rastro**: ni movimiento, ni transacción, ni cambio de estado, ni clave de idempotencia consumida por una ejecución que no ocurrió. La transacción de BD revierte entera. |
| V3 | `saldo(GARANTIA) == SUMA de los montos de las boletas cuyo estado guardado es VIGENTE`. Es el cuadre propio de esta unidad: si una boleta se cierra sin liberar, o libera sin cerrarse, este número deja de dar. |
| V4 | El estado que se **expone** sale de `estadoEn(boleta, reloj.ahora())`, nunca de la columna a secas: una boleta VIGENTE cuyo `venceEn` ya pasó se lee **VENCIDA** aunque la columna diga otra cosa. |
| V5 | Un titular **sólo ve y sólo opera** boletas de sus propias cuentas. Una boleta ajena responde igual que una inexistente en los GET, en `vencer` y en `devolver`. |
| V6 | **Ningún `new Date()` ni `Date.now()`** en el código de esta unidad. El instante sale de `RelojService`, siempre. |
| V7 | La misma `Idempotency-Key` nunca ejecuta dos veces (D5), y **dos transiciones simultáneas sobre la misma boleta dejan pasar exactamente una** (D4). |
| V8 | Ningún monto negativo ni cero entra al dominio (D6). |

---

## Pilar 3 · El contrato, literal

### `POST /boletas` — emitir

Cabeceras: `Authorization: Bearer <token>` y `Idempotency-Key: <clave>`.

```json
{
  "cuentaOrigenId": "<uuid>",
  "monto": "500.00",
  "plazoDias": 30,
  "beneficiarioRut": "12345678-2",
  "beneficiarioNombre": "Constructora Andes SpA",
  "glosa": "Fiel cumplimiento contrato 123",
  "retiradorRut": "9876543-5",
  "retiradorNombre": "Ana Soto"
}
```

**Todos los campos son obligatorios.** El cuerpo es **plano**, no anidado.

- `monto` — string decimal (**nunca `number`**, D1), mayor que 0.
- `plazoDias` — **entero JSON**, entre `PLAZO_DIAS_MINIMO` y `PLAZO_DIAS_MAXIMO` inclusive.
  Un `"30"` string es un error: `PLAZO_INVALIDO`.
- `beneficiarioRut` y `retiradorRut` — RUT chileno **válido**; se guardan **normalizados**.
- `beneficiarioNombre`, `retiradorNombre` — texto, 1 a `LARGO_MAXIMO_NOMBRE` tras recortar.
- `glosa` — texto, 1 a `LARGO_MAXIMO_GLOSA` tras recortar.

**`201 Created`**, con las claves **en este orden**:

```json
{
  "id": "<uuid>",
  "estado": "VIGENTE",
  "monto": "500.00",
  "cuentaOrigenId": "<uuid>",
  "beneficiarioRut": "12345678-2",
  "beneficiarioNombre": "Constructora Andes SpA",
  "glosa": "Fiel cumplimiento contrato 123",
  "retiradorRut": "9876543-5",
  "retiradorNombre": "Ana Soto",
  "emitidaEn": "<ISO-8601>",
  "venceEn": "<ISO-8601>",
  "transaccionId": "<uuid>"
}
```

`emitidaEn` es **el instante del `RelojService`**, y `venceEn` es ese instante más `plazoDias`
días exactos. En un replay la respuesta es la misma, con `201` y `Idempotency-Replayed: true`.

### `GET /boletas` y `GET /boletas/{id}` — leer

Cabecera: `Authorization: Bearer <token>`.

`GET /boletas` → **`200`** con `{ "boletas": [ <BoletaDto>, ... ] }`, **sólo** las de las cuentas
del titular, ordenadas por `emitidaEn` ascendente y, a igualdad, por `id` ascendente. Sin
boletas devuelve `{"boletas": []}`, **no un 404**.

`GET /boletas/{id}` → **`200`** con el `<BoletaDto>` a secas.

`<BoletaDto>` son **las once claves de la respuesta de emisión menos `transaccionId`**, en el
mismo orden, con `estado` calculado contra el reloj (V4).

### `POST /boletas/{id}/cobrar` — cobrar (SIN token, B7)

Cabecera: `Idempotency-Key: <clave>`. **`Authorization` se ignora si viene.**

```json
{ "rutRetirador": "9876543-5" }
```

**`200 OK`** con el `<BoletaDto>` (ya en `COBRADA`) más `"transaccionId"` al final: el asiento
del cobro.

### `POST /boletas/{id}/vencer` y `POST /boletas/{id}/devolver` — liberar (token del tomador)

Cabeceras: `Authorization: Bearer <token>` y `Idempotency-Key: <clave>`. **Sin cuerpo**
(un cuerpo `{}` o ausente da igual; no se lee nada de él).

**`200 OK`** con el `<BoletaDto>` (en `VENCIDA` o `DEVUELTA`) más `"transaccionId"`.

- `vencer` sólo procede si el estado **derivado** es `VENCIDA` y el guardado es `VIGENTE`. Si la
  boleta sigue vigente → `409 BOLETA_NO_VENCIDA`. Si ya estaba cerrada → `409 TRANSICION_INVALIDA`.
- `devolver` sólo procede si el estado derivado es `VIGENTE`.

### Las respuestas de error — todas, con su código y su estado

| situación | código | HTTP |
|---|---|---|
| falta `Authorization` en las rutas que lo exigen | `TOKEN_AUSENTE` | 401 |
| token malformado o mal firmado | `TOKEN_INVALIDO` | 401 |
| token vencido | `TOKEN_EXPIRADO` | 401 |
| falta `Idempotency-Key`, o está vacía | `IDEMPOTENCY_KEY_AUSENTE` | 400 |
| `Idempotency-Key` de más de 200 caracteres | `IDEMPOTENCY_KEY_INVALIDA` | 400 |
| misma clave con otro cuerpo | `IDEMPOTENCY_KEY_REUSADA` | 409 |
| el cuerpo no es JSON válido | `CUERPO_INVALIDO` | 400 |
| `monto` ausente, no parseable, cero o negativo | `MONTO_INVALIDO` | 400 |
| `plazoDias` ausente, no entero, o fuera de 1..365 | `PLAZO_INVALIDO` | 400 |
| un RUT ausente, mal formado o con dígito verificador que no cuadra | `RUT_INVALIDO` | 400 |
| un nombre ausente, vacío tras recortar, o más largo que el máximo | `NOMBRE_INVALIDO` | 400 |
| glosa ausente, vacía tras recortar, o más larga que el máximo | `GLOSA_INVALIDA` | 400 |
| `cuentaOrigenId` que no existe, **o que no es del titular** | `CUENTA_NO_ENCONTRADA` | 404 |
| la cuenta no tiene fondos para el monto | `FONDOS_INSUFICIENTES` | 409 |
| boleta que no existe, **o que no es del titular** (GET, vencer, devolver) | `BOLETA_NO_ENCONTRADA` | 404 |
| el `rutRetirador` presentado no es el declarado al emitir | `RETIRADOR_NO_AUTORIZADO` | 403 |
| la boleta no está `VIGENTE` para la transición pedida | `TRANSICION_INVALIDA` | 409 |
| se pide vencer una boleta que todavía está vigente | `BOLETA_NO_VENCIDA` | 409 |

> **Por qué una boleta ajena da 404 y no 403 en los GET, pero el cobro da 403.** Son dos
> situaciones distintas. En los GET, un `403` confirmaría que esa boleta existe y permitiría
> barrer ids ajenos: misma línea roja de seguridad que en S-12, **ajena e inexistente responden
> idénticamente**. En el cobro no hay nada que ocultar —quien llama ya tiene el documento en la
> mano, que es el id— y lo que se le está diciendo es otra cosa: *existe, pero tú no eres quien
> puede retirarla*. Un 404 ahí mandaría al beneficiario legítimo a buscar un id equivocado.
>
> **Por qué `BOLETA_NO_VENCIDA` es distinto de `TRANSICION_INVALIDA`.** Dos mecanismos, dos
> síntomas: uno es "todavía no", el otro es "ya no". Con un solo código, la comprobación de que
> `vencer` **no** funciona sobre una boleta vigente podría no haberse escrito nunca y nadie lo
> vería (*dos mecanismos, un solo síntoma*).

### El orden de validación — fijo, y el arnés lo comprueba

1. **Token** → titular (en las rutas que lo exigen; el cobro se salta este paso).
2. **`Idempotency-Key`** presente y de largo válido.
3. **Forma del cuerpo**, en este orden: `cuentaOrigenId` → `monto` → `plazoDias` →
   `beneficiarioRut` → `retiradorRut` → nombres → `glosa`.
4. Recién entonces se abre la transacción: candado de la clave → replay o ejecución.
5. Dentro de la transacción: bloquear la boleta / resolver la cuenta → comprobar estado →
   mover el dinero → escribir.

Los pasos 1–3 fallan **sin tocar la base**: una petición mal formada no deja ni una clave de
idempotencia guardada, porque entonces el cliente que la corrige recibiría un `409`.

---

## Pilar 3b · El mecanismo, decidido de antemano (no es dominio de quien implementa)

### Decisión 1 · La cuenta de garantía es UNA, de sistema, y se obtiene con el repositorio que ya existe

`codigo = 'GARANTIA'`, `tipo = SISTEMA`, `titularId = null`. **Se obtiene con
`CuentasSistemaRepository.obtenerOCrear(tx, CODIGO_CUENTA_GARANTIA)`**, que se extrajo de
S-12 para esta unidad y que ya está probado por `npm run sonda:caja`.

> ⚠️ **No escribas tu propio `create` con `catch (P2002)`.** Ese fue exactamente el defecto de
> la entrega de S-12: en PostgreSQL un error dentro de una transacción la **aborta entera**, y
> la relectura muere con 25P02. Dos aperturas simultáneas dieron 201 y **500**. El repositorio
> usa `INSERT ... ON CONFLICT DO NOTHING`, que no lanza. Si escribes tu propia versión, tu
> entrega se rechaza.

Una sola cuenta de garantía para todo el sistema, no una por cliente ni una por boleta: así V3
es una resta de dos números y I2 (cuadre global) sigue dando 0.

### Decisión 2 · Los cuatro asientos los escribe `TransferenciasService.transferirEn`. Ninguno se escribe a mano

| operación | origen → destino | concepto |
|---|---|---|
| emitir | cuenta del tomador → `GARANTIA` | `EMISION_BOLETA` |
| cobrar | `GARANTIA` → `CAJA` | `COBRO_BOLETA` |
| vencer | `GARANTIA` → cuenta del tomador | `VENCIMIENTO_BOLETA` |
| devolver | `GARANTIA` → cuenta del tomador | `DEVOLUCION_BOLETA` |

`transferirEn` ya trae el bloqueo ordenado por id (D4), el chequeo de fondos contra el saldo
derivado **después** del bloqueo, la partida doble y `assertBalanceada`. **Escribir
`tx.movimiento.createMany` en esta unidad es un defecto, no una alternativa de estilo.**

> **El cobro pasa por el chequeo de fondos igual que todo lo demás, y eso es deliberado:** si la
> cuenta de garantía no tuviera el monto, habría un descuadre, y lo correcto es fallar ruidoso.
> **La caja no tiene chequeo** porque es la contrapartida del mundo exterior (S-12, Decisión 1).

### Decisión 3 · La boleta se bloquea con `SELECT ... FOR UPDATE` antes de leer su estado

En `cobrar`, `vencer` y `devolver`, **lo primero que se hace dentro de la transacción** es:

```sql
SELECT ... FROM boleta WHERE id = $1 FOR UPDATE
```

Sin ese bloqueo, dos cobros simultáneos con claves distintas leen `VIGENTE` los dos, pasan los
dos, y la garantía se paga dos veces. Es el bug de doble gasto de D4 aplicado a esta unidad, y
**ninguna prueba secuencial lo ve**: el arnés tiene un brazo de concurrencia dedicado.

El bloqueo va sobre la boleta y el de `transferirEn` sobre las cuentas, **siempre en ese orden**
(boleta primero, cuentas después) en las cuatro operaciones. Dos órdenes distintos son la receta
del deadlock que D4 existe para evitar.

### Decisión 4 · El estado se guarda materializado, y además se deriva al leer

- La columna `estado` guarda lo que **pasó** (`VIGENTE`, `COBRADA`, `VENCIDA`, `DEVUELTA`).
- Lo que se **expone** y lo que se comprueba antes de una transición sale siempre de
  `estadoEn(boleta, reloj.ahora())` del dominio (S-03), que convierte `VIGENTE` + reloj pasado
  en `VENCIDA` sin escribir nada.
- `vencer` es lo que **materializa** esa derivación y mueve el dinero (B2).

`venceEn` es **exclusivo** y ese borde ya está fijado en S-03: justo en el instante del
vencimiento la boleta ya está `VENCIDA`. No se mueve.

### Decisión 5 · Qué entra en la huella de idempotencia

```
POST /boletas                  → { titularId, cuentaOrigenId, monto, plazoDias,
                                   beneficiarioRut, beneficiarioNombre, glosa,
                                   retiradorRut, retiradorNombre }   ← los valores TAL COMO LLEGARON
POST /boletas/:id/cobrar       → { boletaId, rutRetirador }
POST /boletas/:id/vencer       → { titularId, boletaId }
POST /boletas/:id/devolver     → { titularId, boletaId }
```

El `endpoint` que se guarda con la clave es literal: `POST /boletas`,
`POST /boletas/:id/cobrar`, `POST /boletas/:id/vencer`, `POST /boletas/:id/devolver` — **con el
`:id` literal, no el uuid**: el discriminante entre dos peticiones es la huella, y el id ya va
dentro de ella. El `titularId` va en la huella de las rutas con token por la misma razón que en
S-12: sin él, dos usuarios con la misma clave se roban la respuesta.

**El estado HTTP guardado es `201` para la emisión y `200` para las tres transiciones.**

### Decisión 6 · Los conceptos están versionados

Los cuatro (`EMISION_BOLETA`, `COBRO_BOLETA`, `VENCIMIENTO_BOLETA`, `DEVOLUCION_BOLETA`) ya
están anotados en `scripts/invariantes.sh`, en `CONCEPTOS_CONOCIDOS` **y** en
`CONCEPTOS_CON_CLAVE` (los cuatro nacen de un POST con `Idempotency-Key`, D5). Si escribes otro
concepto, la compuerta de población de `npm run invariantes` se pone roja y lo nombra.

### Decisión 7 · El RUT se valida en el dominio, y es tuyo escribirlo

`src/domain/rut/rut.ts`, **puro**: sin Nest, sin Prisma, sin `Date`. Contrato exacto:

```ts
export class RutInvalidoError extends Error {}
export function esRutValido(entrada: unknown): boolean;
export function normalizarRut(entrada: unknown): string;   // lanza RutInvalidoError
```

- Acepta con puntos o sin ellos, con espacios alrededor, y el dígito verificador en minúscula:
  `"12.345.678-2"`, `" 12345678-2 "` y `"12345678-k"` son entradas válidas cuando el DV cuadra.
- **El guion es obligatorio.** `"123456782"` es inválido: sin separador no se sabe dónde termina
  el número.
- El cuerpo tiene entre 1 y 8 dígitos. Los ceros a la izquierda se descartan al normalizar.
- **Normaliza a `<cuerpo sin ceros a la izquierda>-<DV en mayúscula>`**: `"12345678-2"`.
- El dígito verificador se calcula con el **módulo 11** estándar: multiplicadores 2,3,4,5,6,7
  cíclicos de derecha a izquierda; `resto = suma mod 11`; `dv = 11 - resto`; `11 → '0'`,
  `10 → 'K'`.
- Cualquier otra entrada (no string, vacía, con letras en el cuerpo, DV que no cuadra) es
  inválida.

Su árbitro es `npm run test:domain`, con los casos de `src/domain/rut/rut.spec.ts`, **ya
escritos**.

### Decisión 8 · El instante sale de `RelojService` (V6)

`RelojService` (`src/infra/reloj.js`) es **global**: lo exporta `CosturasModule`, que `AppModule`
importa siempre. Inyéctalo y ya. **Ni un `new Date()` ni un `Date.now()` en tu código**: sin eso
no hay forma de probar un vencimiento sin esperar treinta días, y el arnés fija el reloj y lo
adelanta.

`venceEn = new Date(ahora.getTime() + plazoDias * MS_POR_DIA)`. Ese `new Date(...)` a partir de
un instante **recibido** no es leer el reloj: lo que está prohibido es preguntarle la hora al
sistema.

---

## Constantes, con su valor y la frase que las justifica (Pilar 1)

| constante | valor | por qué ese valor |
|---|---|---|
| `PLAZO_DIAS_MINIMO` | `1` | **Dato del humano (B1).** Un plazo de 0 días vencería en el acto: `emitir` del dominio lo rechazaría con `VigenciaInvalidaError`, que no es un error tipado y saldría como 500. |
| `PLAZO_DIAS_MAXIMO` | `365` | **Dato del humano (B1).** |
| `MS_POR_DIA` | `86_400_000` | 24 × 60 × 60 × 1000. Aritmética de instantes, no de calendario: el proyecto trabaja en UTC y no representa husos. |
| `CODIGO_CUENTA_GARANTIA` | `'GARANTIA'` | La etiqueta estable de la cuenta donde vive el dinero inmovilizado. La columna `codigo` existe desde S-04 para esto. |
| `CODIGO_CUENTA_CAJA` | `'CAJA'` | La contrapartida del mundo exterior, ya fijada en S-12. **Importa la constante de `src/modules/cuentas/cuentas.constants.js`; no la reescribas**: dos literales `'CAJA'` en producción son dos cuentas el día que uno se escriba mal. |
| `LARGO_MAXIMO_GLOSA` | `200` | Límite de frontera de confianza puesto por diseño, **no una regla bancaria**: acota lo que entra a la base. Un texto sin techo es una vía de abuso, y la validación en fronteras es línea roja del núcleo. |
| `LARGO_MAXIMO_NOMBRE` | `120` | Lo mismo, para los dos nombres. |
| largo máximo de `Idempotency-Key` | `200` | El mismo de S-06 y S-12. **Impórtalo**, no lo redeclares: dos límites para la misma cabecera son dos contratos. |

---

## Pilar 4 · Casos borde que ya están anticipados

1. **`plazoDias: 1`** → `201`, y la boleta vence exactamente 24 h después. **`plazoDias: 365`** →
   `201`. Los dos extremos son válidos: el rango es **inclusivo**.
2. **`plazoDias: 0`, `366`, `-5`, `1.5`, `"30"`** → los cinco `400 PLAZO_INVALIDO`.
3. **`monto: "0.00"` y `monto: "-100.00"`** → `400 MONTO_INVALIDO` (D6). El signo lo pone el
   tipo de asiento, nunca el input.
4. **Emitir por más de lo que hay** → `409 FONDOS_INSUFICIENTES`, **cero filas escritas** y la
   boleta no existe.
5. **RUT con DV equivocado** (`"12345678-3"`) → `400 RUT_INVALIDO`. Es el caso que separa
   *validar* de *mirar el formato*.
6. **Cobrar con el RUT del beneficiario en vez del retirador** → `403 RETIRADOR_NO_AUTORIZADO`,
   y **el saldo de la garantía no cambia**.
7. **Cobrar una boleta ya cobrada, devolver una cobrada, cobrar una devuelta, devolver una
   vencida** → `409 TRANSICION_INVALIDA`, y **el ledger tiene exactamente las mismas filas
   antes y después**. El arnés las cuenta.
8. **Cobrar una boleta cuyo `venceEn` ya pasó pero que nadie venció** → `409
   TRANSICION_INVALIDA`: el estado derivado manda (V4), aunque la columna diga `VIGENTE`.
9. **Vencer una boleta que sigue vigente** → `409 BOLETA_NO_VENCIDA`.
10. **Boleta de otro titular en `GET /boletas/{id}`, `vencer` y `devolver`** → `404
    BOLETA_NO_ENCONTRADA`, idéntico a un id inexistente.
11. **`{id}` que no es un UUID** → `404 BOLETA_NO_ENCONTRADA`, **nunca un 500** por el tipo de la
    base. Compruébalo antes de consultar.
12. **Dos cobros simultáneos con claves distintas** → exactamente uno `200`, el otro `409`, y
    **un solo par de movimientos** en el ledger.
13. **Titular sin boletas** → `200 {"boletas": []}`.
14. **Emitir dos boletas desde la misma cuenta hasta agotar el saldo**: la segunda ve el saldo ya
    inmovilizado por la primera. Los fondos inmovilizados **no están disponibles**.

---

## Pilar 5 · Los arneses (ya escritos y calibrados — NO SE TOCAN)

```bash
npm run test:domain     # incluye src/domain/rut/rut.spec.ts
npm run test:boletas    # test/boletas.int.spec.ts, por HTTP contra Postgres real
```

El de integración habla **por HTTP**, con la app levantada de verdad y el token que emite el
`AuthModule` real; adelanta el tiempo por la **costura del reloj de S-07** (`POST /__test__/reloj`),
y lee la base con Prisma **como oráculo independiente**: compara lo que el endpoint dice con lo
que el ledger tiene. Un arnés que le preguntara a la misma consulta que audita no tendría
dientes.

---


## Pilar 7 · La meta numérica, fijada antes de codear

| # | Meta | Cómo se mide |
|---|---|---|
| — | `npm run test:boletas` en verde, **todos** los casos | salida del runner |
| — | `npm run test:domain` en verde, **con los casos del RUT ya incluidos** | salida del runner |
| — | `npm run test:integracion` sin regresiones | los 77 de antes + los de esta unidad |
| — | `npm run typecheck` **exit 0** | `tsc --noEmit` |
| — | `npm run build` **exit 0** | el typecheck NO lo cubre |
| — | `npm run guante` sigue en **5/5** | las compuertas duras por ausencia |
| — | `npm run invariantes` sigue en **5/5** | I1–I5, con las boletas ya en la base |

Reporta el número real de cada uno, incluidos los fallos. "Funciona" no es una métrica.
