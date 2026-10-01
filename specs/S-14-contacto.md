# S-14 · Los datos de contacto del cliente

> Paridad ParaBank: **Update Contact Info**. Escrita el **2026-09-09**,
> antes de implementar, junto con su arnés (`test/contacto.int.spec.ts`) y su calibrador.
> Candado: `specs/_CANDADO.md`. **El arnés no se toca.**
>
> Esta unidad **no entrega producto**, entrega un **arnés calibrado**; la implementación se
> escribe después, contra él.

---

## 0 · Qué cambia, y qué NO cambia

**No cambia ningún contrato existente.** `/contacto` es una ruta nueva; el barrido del repo
entero —`grep -rn "contacto" src/ test/ scripts/ specs/`, corrido el 2026-09-09 antes
de escribir una línea— devuelve **cero consumidores**. A diferencia de S-18, acá no hay ningún
arnés que endurecer.

> **Nota de la vitrina:** el barrido original recorría además la carpeta de evidencias del repositorio privado, que no se publica; el comando de arriba corre sobre lo publicado.

**Sí cambia el esquema**, y por eso hay dos piezas que se hicieron ANTES de la implementación y
fuera de ella:

| pieza | quién | por qué |
|---|---|---|
| Migración `20260909001204_s14_contacto_cliente` — 7 columnas en `usuario` | — | las migraciones de BD van antes del arnés, y el arnés necesita las columnas para poder usar Prisma como oráculo independiente |
| Los 8 códigos de error nuevos en `src/infra/errores-http.filter.ts` | — | mismo motivo que en S-13 y S-18: si cada implementación tocara el filtro, dos entregas en paralelo pisarían el mismo archivo |

### Por qué las columnas son NULLABLE si los siete campos son obligatorios

No es una contradicción y se declara para que se pueda discutir. **S-08 registra al cliente con
email y contraseña, y nada más** (`auth.service.ts:158`). Por lo tanto *«el cliente existe y
todavía no completó su contacto»* es un estado real y alcanzable del sistema, y el esquema tiene
que poder representarlo. Un `NOT NULL DEFAULT ''` lo confundiría con *«los completó en blanco»*
y además rompería los **cuatro** sitios que hoy crean usuarios (`auth.service.ts:178`,
`costuras.service.ts:220` y `:362`, `test/idempotencia.int.spec.ts:68`).

La obligatoriedad vive **en el borde**, donde puede devolver un código tipado (C5). Una columna
corta o `NOT NULL` convertiría un `400 CONTACTO_TELEFONO_INVALIDO` en un 500 de Postgres.

**Verificado el 2026-09-09, no supuesto:** el rol `zerofeebank_app` tiene `UPDATE` sobre las
siete columnas nuevas (`information_schema.column_privileges`). El append-only de D3 es sólo
sobre `movimiento` y no las alcanza.

---

## 1 · Qué hace, y qué queda fuera

**Hace:** el cliente identificado **consulta** sus datos de contacto (`GET /contacto`) y los
**reemplaza por completo** (`PUT /contacto`). Los siete campos son obligatorios en el PUT.

**Fuera (no-goals):**

- **No cambia el email.** Decisión del humano, 2026-09-09: el email es la credencial de acceso y
  queda **fuera del alcance de S-14**. El `GET` lo devuelve como campo de sólo lectura y el `PUT`
  lo rechaza con `400 EMAIL_NO_MODIFICABLE` si viene distinto del actual. Cambiar la credencial
  es una historia de usuario propia: arrastra unicidad, invalidación de la sesión abierta y una
  lista de revocación de tokens que **hoy no existe** (los tokens de S-08 son sin estado).
- **No pide `Idempotency-Key`.** D5 exige idempotencia en *todo POST que mueva plata*. Este
  endpoint no mueve plata y además es un `PUT` de reemplazo total, que es idempotente por
  construcción: dos veces el mismo cuerpo dejan el mismo estado. Añadir la clave sería
  ceremonia (Pilar 0). El brazo **F3** lo fija como contrato.
- **No toca contabilidad.** Ni un movimiento, ni una transacción, ni una fila de
  `clave_idempotencia`. I1–I5 no se ven afectados y el brazo **F1** lo comprueba.
- **No añade pantalla.** El frontend de esta capacidad es S-17.
- **No valida el formato del teléfono ni del código postal.** Decisión del humano al elegir la
  paridad ParaBank literal: los siete son texto libre no vacío con un máximo. Inventar un
  formato chileno acá sería inventar una regla de negocio.
- **No normaliza mayúsculas ni acentos.** Lo único que se aplica es `trim()`, y se declara en
  § 3 porque cambia lo que se guarda.

**Hecho es:** `npm run test:contacto` en verde con sus **32 casos**, `npm run typecheck` exit 0,
`npm run build` exit 0, `npm run guante` 6/6, y `npm run calibrar:s14` con los **8 defectos**
poniendo rojos exactamente los brazos que declara § 8 — y **ninguno más**.

---

## 2 · Los datos de negocio (preguntados al humano el 2026-09-09, no inventados)

| # | Pregunta | Respuesta del humano |
|---|---|---|
| N1 | ¿Qué campos de contacto existen y qué valida cada uno? | **Paridad ParaBank literal: siete campos** —nombre, apellido, dirección, ciudad, estado, código postal, teléfono—, **todos obligatorios**, todos texto no vacío con un máximo, **sin formato exigido** en teléfono ni código postal. |
| N2 | ¿El cliente puede cambiar su email, que es su credencial? | **No. Fuera del alcance de S-14.** El GET lo muestra; el PUT con un email distinto responde `400 EMAIL_NO_MODIFICABLE`. |

> **`estado` es la región administrativa** (el *state* de ParaBank), no un estado de máquina.
> Se conserva el nombre del referente aunque en Chile la división sea *región/comuna*: la misma
> incoherencia declarada del RUT chileno con moneda dólar. No rompe
> nada y se ve en una entrevista; queda escrita, no disimulada.

### Decisiones del JUEZ, no del humano (declaradas para que se puedan discutir)

- **J1 · Los datos viven en `usuario`, no en una tabla `contacto` aparte.** La relación es 1:1
  estricta, no tiene historial y el email —que se devuelve en la misma respuesta— ya vive ahí.
  Una tabla aparte añadiría un JOIN y un caso «existe el usuario pero no su fila de contacto»
  que no aporta nada. Si algún día se pide historial de cambios, **eso** justifica la tabla.
- **J2 · El `PUT` es reemplazo total, no un merge.** Es lo que significa `PUT`, y es lo que hace
  falso el caso «mandé sólo el teléfono y me borró la dirección sin avisar»: mandar seis campos
  de siete **no** actualiza seis, **falla** con el código del que falta. Un `PATCH` parcial es
  otra unidad, y no está pedida. El brazo **B3** lo fija.
- **J3 · El titular sale SIEMPRE del token, nunca del cuerpo ni de la ruta.** No hay
  `PUT /contacto/:id`. Es la misma línea roja de S-12, S-13 y S-18: sin id en la puerta no hay
  espacio de ids que barrer. El brazo **E5** lo fija.
- **J4 · `EMAIL_NO_MODIFICABLE` se comprueba ANTES que los siete campos.** Un intento de cambiar
  la credencial es una acción prohibida, categóricamente distinta de una petición mal formada, y
  merece su propio diagnóstico aunque el resto del cuerpo también esté mal. Consecuencia
  observable y fijada: un cuerpo con email ajeno **y** nombre vacío responde
  `EMAIL_NO_MODIFICABLE`, no `CONTACTO_NOMBRE_INVALIDO`. El brazo **D3** lo fija.
- **J5 · El email igual al actual se acepta y se ignora.** Un cliente que hace `GET` y devuelve
  el mismo objeto en el `PUT` está haciendo lo correcto; rechazarlo por incluir un campo que no
  cambió sería hostil. El brazo **D2** lo fija.
- **J6 · Un `GET` de un cliente que nunca completó su contacto responde `200` con los siete
  campos en `null`, no `404`.** El recurso «mi contacto» existe desde que existe el cliente; lo
  que no existe es su valor. Es el mismo criterio que el resumen de cuentas vacío de S-12 (F1).
- **J7 · El `PUT` es todo o nada.** Si un campo es inválido, **ninguno** se escribe. Un
  reemplazo a medias dejaría al cliente con una dirección nueva y una ciudad vieja, que es un
  descuadre de datos sin traza. El brazo **C8** lo fija.
- **J8 · Cada campo tiene su propio código de error.** Un único `CONTACTO_INVALIDO` obligaría a
  la suite —y a la pantalla de S-17— a leer el mensaje en prosa para saber qué campo marcar en
  rojo, que es exactamente lo que C5 prohíbe.

---

## 3 · Contrato literal

### `GET /contacto`

**Cabeceras:** `Authorization: Bearer <token>` — obligatoria.

**Respuesta 200** — las ocho claves, **siempre las ocho, ni una más**:

```json
{
  "email": "ana@ejemplo.cl",
  "nombre": "Ana",
  "apellido": "Pérez",
  "direccion": "Av. Siempre Viva 742",
  "ciudad": "Santiago",
  "estado": "Región Metropolitana",
  "codigoPostal": "8320000",
  "telefono": "+56 9 1234 5678"
}
```

Cliente que nunca completó su contacto: los **siete** campos valen `null` y `email` trae su
valor (J6).

### `PUT /contacto`

**Cabeceras:** `Authorization: Bearer <token>` — obligatoria. **No** lleva `Idempotency-Key`.

**Cuerpo** — los siete, todos obligatorios. `email` es **opcional y sólo se tolera si es igual
al actual** (J5):

```json
{
  "nombre": "Ana",
  "apellido": "Pérez",
  "direccion": "Av. Siempre Viva 742",
  "ciudad": "Santiago",
  "estado": "Región Metropolitana",
  "codigoPostal": "8320000",
  "telefono": "+56 9 1234 5678"
}
```

**Respuesta 200:** el mismo cuerpo que devuelve el `GET`, ya con los valores nuevos.
Toda clave que no esté en la lista se **ignora** en silencio (brazo C9): rechazarlas rompería a
un cliente que reenvía el objeto del `GET` con un campo futuro.

### Las siete reglas de validación — las constantes, con su porqué

| campo | máximo | por qué ese máximo |
|---|---|---|
| `nombre` | **50** | nombre de pila; el mismo orden de magnitud que `beneficiarioNombre` de S-09 |
| `apellido` | **50** | ídem |
| `direccion` | **100** | calle + número + depto en una línea |
| `ciudad` | **50** | topónimo |
| `estado` | **50** | región administrativa |
| `codigoPostal` | **20** | holgado a propósito: los formatos varían por país y no se valida el formato (N1) |
| `telefono` | **20** | cabe `+56 9 1234 5678` con separadores |

Un campo es **válido** si y sólo si: está presente, es de tipo `string`, y **tras `trim()`** su
largo está entre **1** y su máximo, **ambos inclusive**. Se guarda el valor **ya recortado**.

> Los máximos son una **decisión de diseño**: lo que fija el negocio es *qué* campos hay y que son
> obligatorios (N1); un tope de longitud es una defensa de borde, no una regla de negocio.
> Están acá con su valor y su razón porque el Pilar 1 lo exige, y porque el arnés los mide en
> el límite exacto (brazo C4).

### Errores — código estable y estado (C5)

**Ocho códigos nuevos**, todos `400`. Ya registrados en
`src/infra/errores-http.filter.ts`; la implementación **no toca ese archivo**.

| situación | código | estado |
|---|---|---|
| falta `Authorization`, o no empieza con `Bearer ` | `TOKEN_AUSENTE` | 401 |
| token mal formado o de firma ajena | `TOKEN_INVALIDO` | 401 |
| token vencido | `TOKEN_EXPIRADO` | 401 |
| `email` presente y distinto del actual | `EMAIL_NO_MODIFICABLE` | **400** |
| `nombre` ausente, no-string, vacío tras trim, o > 50 | `CONTACTO_NOMBRE_INVALIDO` | **400** |
| `apellido` ídem | `CONTACTO_APELLIDO_INVALIDO` | **400** |
| `direccion` ídem (> 100) | `CONTACTO_DIRECCION_INVALIDA` | **400** |
| `ciudad` ídem | `CONTACTO_CIUDAD_INVALIDA` | **400** |
| `estado` ídem | `CONTACTO_ESTADO_INVALIDO` | **400** |
| `codigoPostal` ídem (> 20) | `CONTACTO_CODIGO_POSTAL_INVALIDO` | **400** |
| `telefono` ídem (> 20) | `CONTACTO_TELEFONO_INVALIDO` | **400** |
| JSON que no parsea | `CUERPO_INVALIDO` | 400 |

### Precedencia de validación — FIJADA, no se deja a criterio

Se comprueba **en este orden exacto**, y el primero que falla es el que responde:

```
1. Authorization -> titular        401 TOKEN_AUSENTE / TOKEN_INVALIDO / TOKEN_EXPIRADO
2. email presente y != el actual   400 EMAIL_NO_MODIFICABLE                      <-- J4
3. nombre                          400 CONTACTO_NOMBRE_INVALIDO
4. apellido                        400 CONTACTO_APELLIDO_INVALIDO
5. direccion                       400 CONTACTO_DIRECCION_INVALIDA
6. ciudad                          400 CONTACTO_CIUDAD_INVALIDA
7. estado                          400 CONTACTO_ESTADO_INVALIDO
8. codigoPostal                    400 CONTACTO_CODIGO_POSTAL_INVALIDO
9. telefono                        400 CONTACTO_TELEFONO_INVALIDO
   -- recién acá se escribe, en UNA sola operación --
```

**Un cuerpo que no es un objeto** (un array, una cadena, `null`) tiene cero campos válidos, así
que cae en el paso 3: `CONTACTO_NOMBRE_INVALIDO`. Nunca un 500. El brazo **C7** lo fija.

---

## 4 · Invariantes de esta unidad

| # | Invariante |
|---|---|
| V1 | Ninguna petición sin token válido modifica **una sola columna** de `usuario`. |
| V2 | Un `PUT` que responde 4xx deja las siete columnas **exactamente** como estaban (J7). |
| V3 | `PUT /contacto` **nunca** modifica `email`, `password_hash` ni `creado_en`. |
| V4 | Un titular no puede leer ni escribir el contacto de otro: el id sale del token (J3). |
| V5 | S-14 no escribe **ni una fila** en `movimiento`, `transaccion` ni `clave_idempotencia`. I1–I5 quedan intactos. |

---

## 5 · Casos borde anticipados (Pilar 4)

- Cliente recién registrado que nunca completó nada → `GET` 200 con siete `null` (J6).
- Cuerpo con los siete campos **más** claves de sobra → 200, las de sobra se ignoran (C9).
- Campo con sólo espacios `"   "` → inválido: el largo se mide **después** del trim.
- Campo de exactamente el máximo → **válido** (el límite es *mayor que*, no *mayor o igual*).
- Campo que es un número, un `null` o un objeto → 400 con su código, nunca un 500.
- Dos campos malos a la vez → responde el **primero** de la lista fijada (C6).
- Email ajeno **y** nombre vacío → `EMAIL_NO_MODIFICABLE` (J4, brazo D3).
- Email **igual** al actual → 200, se ignora (J5).
- Segundo `PUT` con seis de siete campos → **falla**, no hace merge (J2, brazo B3).
- `PUT` repetido idéntico → mismo estado y misma respuesta (B5).
- `PUT` sin token → 401 **y** ni una columna escrita (E2, V1).

---


## 7 · Piezas que YA existen y se reusan (no se reimplementan)

| pieza | dónde | para qué |
|---|---|---|
| `AuthService.yo(authorization)` | `src/modules/auth/auth.service.js` | token → `{ id, email }`. Lanza `TokenAusenteError` / `TokenInvalidoError` / `TokenExpiradoError`, ya mapeados a 401 |
| `ErrorDeNegocio` | `src/domain/errores.js` | la base de todo error tipado: `codigo` + mensaje |
| `ErroresHttpFilter` | `src/infra/errores-http.filter.js` | ya traduce **los ocho** códigos de esta spec. **No se toca** |
| `PrismaService` | `src/infra/prisma.service.js` | el acceso a `usuario`, con las siete columnas ya migradas |
| `AuthModule` | `src/modules/auth/auth.module.js` | **exporta `AuthService` y no importa ningún otro módulo**: `ContactoModule` puede importarlo sin crear un ciclo. Verificado el 2026-09-09; es lo mismo que hace `CuentasModule` |

**Los dos precedentes literales, que se miran y se copian:**
- `src/modules/cuentas/cuentas.controller.ts` — cómo se saca el titular del token en el
  controlador, sin `Guard` ni decorador (es el patrón del repo, con tres precedentes).
- `src/modules/movimientos/movimientos.service.ts` — cómo se valida un parámetro y se lanza el
  error tipado en vez de una `BadRequestException` de Nest.

---

## 8 · La calibración: qué defecto pone rojo a qué brazo

**Fijada ANTES de implementar.** Regla: *un defecto inyectado declara qué brazos
DEBE poner rojos* —y cuáles deben seguir verdes—. Contar rojos deja pasar brazos que mienten.

> ⚠️ **El arnés pasó a 39 casos y DOS brazos suyos eran imposibles de pasar.**
> Lo destapó la primera implementación, no la calibración por ausencia. Ver § 8.2.

El arnés tenía **32 casos** cuando se escribió, en siete grupos: **A** (GET, 5) · **B** (PUT feliz, 5) · **C**
(validación, 9) · **D** (el email, 4) · **E** (auth y aislamiento, 5) · **F** (lo que no toca, 2)
· **G** (controles que **no** dependen de S-14, 2). Los brazos van prefijados `A1 · `, `C6 · `,
etc.: el calibrador los identifica por ese prefijo y **sin él no puede declarar nada**.

### La mitad barata: la calibración por ausencia (corrida esta sesión)

Se corre el arnés entero contra `main` **sin** S-14. El resultado exacto está en § 8.1.

> **Y se dice su límite en voz alta, en vez de contarla como una victoria.** S-14 es un módulo
> **entero nuevo**: sin él, `/contacto` no existe y las 26 peticiones que lo tocan reciben el
> 404 de Nest. Que se pongan rojas prueba que **cada brazo puede fallar** —que no es poco: es
> la prueba de que ninguno pasa con el módulo sin escribir— pero **no prueba que cada brazo mida
> lo suyo**. Eso lo da `calibrar:s14`, sobre la entrega. Es el mismo principio aplicado a la
> propia calibración: *una corrida toda roja se lee caso por caso*.
>
> Por eso el arnés lleva el grupo **G**: dos brazos que usan **sólo** puertas de S-08 y que
> **deben quedar verdes sin S-14**. Son controles con dientes: cualquier defecto de la entrega
> que los enrojezca significa que la implementación rompió algo que no era suyo.
>
> Y sirvió para algo más que confirmar lo esperado: **cazó dos brazos nacidos ciegos** en la
> primera corrida. Ver § 8.1.

### La mitad cara: `npm run calibrar:s14`, sobre la entrega

Copia del calibrador de S-18 —el que comprueba **las dos mitades**— y no del de S-13.
La mecánica común (respaldar, parchar, correr, leer las dos mitades, restaurar) se **extrajo**
a `scripts/lib/calibrador.sh`: era la tercera copia del mismo bucle. El calibrador de S-18 ya está migrado y
**re-medido**: 5/5 antes y 5/5 después, el mismo resultado exacto.
**Los brazos de cada defecto se fijan AHORA; sólo los textos ancla del parche se completan
después de la entrega**, porque inyectar un defecto exige saber qué escribió la implementación. El
ancla es *dónde* se inyecta; el brazo que debe cazarlo es *qué* se mide, y ese no se toca.

| # | defecto inyectado | brazos que DEBEN ponerse rojos | y que DEBEN seguir verdes |
|---|---|---|---|
| K1 | el token deja de rechazar: `AuthService.yo(...)` envuelto en un `try/catch` que devuelve un titular vacío | **E1, E2, E3, E4** | **G1, G2**, A1–A5, B1–B5, D1–D4 |
| K2 | el titular sale del cuerpo si viene: `cuerpo.id ?? titular.id` | **E5** | todos los demás, **A4 incluido** |
| K3 | se quita la validación de `nombre` (se acepta lo que llegue) | **C1, C2, C3, C4, C5, C6, C7** | C8, C9, D1–D5, G1–G3. **C3 y C5 se añadieron después**: al endurecerlos para cubrir los siete campos pasaron a medir también `nombre` |
| K4 | el email se deja cambiar (se borra la comprobación de J4) | **D1, D3, D4, D5** | **D2**, y todo el resto. **D5 es nuevo** (hallazgo H5) |
| K5 | la precedencia se invierte: los campos se validan ANTES del email (rompe J4) | **D3** | **D1, D2, D4** — el email sigue rechazándose, sólo cambia quién gana |
| K6 | la escritura deja de ser atómica: se guarda campo por campo y se valida sobre la marcha (rompe J7) | **C4, C8** | C1–C3, C5–C7, C9 — los códigos no cambian, sólo lo que queda escrito. **C4 se añadió después** (hallazgo H4): ahora censa la base tras el rechazo por largo |
| K7 | el `PUT` hace merge en vez de reemplazo: los campos ausentes conservan su valor (rompe J2) | **B3**, y sólo B3 | todos los demás, **C1, C2, C6 y C7 incluidos** |
| K8 | el `GET` devuelve el registro entero de Prisma, con `passwordHash` y `creadoEn` | **A5** | todos los demás — el contrato de valores no cambia, sólo sobran claves |

**Por qué K7 sólo puede caer en B3, y se dice en vez de repartirlo:** B3 es el único brazo que
le quita un campo a un contacto **ya completo**. Los demás casos de campo ausente (C1, C2, C6,
C7) parten de un titular **sin** contacto previo, donde el merge deja el campo en `null` y la
validación lo rechaza igual: siguen verdes. Es una consecuencia del diseño de los datos del
arnés, no un descuido — *los datos de un arnés también se calibran*.

**K3, K5, K6 y K7 son los que separan un brazo honesto de uno decorativo.** Si K6 pone rojo algo
más que C8, es que ese otro brazo no medía el código de error que decía medir sino el estado de
la base. Y si C8 sigue verde con K6 puesto, **C8 no mide J7**.

> ### La corrida del 2026-09-09, y las cuatro correcciones que obligó
>
> Las anclas se completaron sobre la entrega. **La primera corrida dio 4/8**, y los
> cuatro fallos se diagnosticaron en vez de ajustar el número. **El script es la versión
> vigente**; la tabla de arriba es de cuando se escribió, antes de tener nada que romper.
>
> | qué falló | diagnóstico | qué se hizo |
> |---|---|---|
> | **K2** puso rojo `C9`, no declarado | C9 manda `id: randomUUID()` entre las claves de sobra, justo para comprobar que se ignoran. Con K2, **ese** id pasa a ser el titular. **Depende legítimamente de lo roto** | se **añade** a la lista: la predicción era incompleta, no equivocada |
> | **K3** puso rojo `F1`, no declarado | el segundo `PUT` de F1 es `nombre: ''` y lo espera en **400** (endurecimiento posterior). Sin validación de nombre devuelve 200. **Depende legítimamente** | se **añade** |
> | **K4** dejó `D4` verde | ⚠️ la predicción estaba **equivocada, no incompleta**. K4 quita el **rechazo** de un email ajeno; D4 mide que el `PUT` no **escribe** la columna. Son dos mecanismos, y la entrega nunca escribe el email | se **quita** D4 de K4 → y nace **K9**, porque un brazo sin un defecto que lo pruebe no es un brazo |
> | **K6** dejó `C4` y `C11` verdes | `C11` manda `{}`: el nombre falla **antes** de la primera escritura, así que no queda nada a medias — depende de K3, no de J7. `C4` compara la base tras el rechazo por largo, pero su `PUT` rechazado lleva los otros seis campos **idénticos** al aceptado justo antes: la escritura campo por campo reescribe los mismos valores | se **quitan** los dos → K6 queda en `C8`, que es exactamente el brazo de J7 |
>
> **`K9` nace de este ejercicio, y con él salió el hallazgo de la sesión:** el `PUT` refresca
> `creadoEn`, y `D4` **seguía verde**. La causa no era el defecto sino el brazo: comparaba los
> timestamps con `String(fecha)`, que en JavaScript **formatea a segundos**, así que dos
> instantes del mismo segundo daban cadenas idénticas. Es la familia «dos relojes en unidades
> que no son la misma». Endurecido a `toISOString()`.
>
> **Resultado tras las correcciones: `calibrar:s14` → 9/9 defectos con el resultado exacto.**

**Meta de esta unidad (Pilar 7):** `calibrar:s14` → **8/8 defectos con el resultado exacto**.
Un defecto que no se pueda inyectar sobre la entrega **se declara y no se cuenta como aprobado**
—como se hizo con E5 en S-18—, nunca se sustituye por otro que sí calce.

### 8.1 · Resultado de la calibración por ausencia

**Arnés de 32 brazos: 30 rojos / 2 verdes.** Los dos verdes de más fueron el
hallazgo que dio la regla del repo *«todo brazo que compare un antes con un después tiene que
exigir que el acto del medio haya tenido éxito»*:

| brazo | qué decía medir | por qué pasaba con el módulo sin escribir |
|---|---|---|
| **D4** | que ningún `PUT` toca `email`, `password_hash` ni `creado_en` | comparaba las columnas antes y después de dos `PUT` **sin exigir que los `PUT` funcionaran**. Con la ruta inexistente los dos daban 404, nada cambiaba, y el brazo se aprobaba solo |
| **F1** | que S-14 no escribe ni una fila en `movimiento`, `transaccion` ni `clave_idempotencia` | idéntico: contaba filas antes y después de dos `PUT` que nunca ocurrieron |

Los dos se **endurecieron** —nunca se ablandó nada— y quedó en **30 rojos / 2 verdes**.

**Arnés de 38 brazos: 35 rojos / 3 verdes, y los verdes son exactamente
G1, G2 y G3.** El arnés creció y se endureció por dos vías distintas:

**(a) DOS ataques independientes sobre el MISMO arnés de 32 brazos** —
uno con **5 de 5 hallazgos ciertos** y otro con **8 de 8 ciertos**. **Sólo dos familias en común y
once huecos distintos entre los dos**: no hay superconjunto, y por eso conviene correr los dos.
Los seis exclusivos del segundo: precedencia entre campos **intermedios** (C6 sólo enfrentaba el
primero contra el último), cuerpo `{}` que nadie enviaba, `B4` comprobando el `trim` de un solo
campo en la respuesta, `E4` probando el token vencido sólo en el `GET` —la ruta que no muta—,
`email: ''`/`null`, y `Authorization` presente sin el prefijo `Bearer `. Todos aplicados:
**C3, B4 y E4 endurecidos, y C10, C11, D6 y E6 nuevos.**

**Los cinco del primero** (5 hallazgos de ~15
candidatos, **5 de 5 verificados**). Los cinco eran ciertos:

| # | el hueco | qué se hizo |
|---|---|---|
| H1 | `CUERPO_INVALIDO` estaba en la spec y en el filtro, y **ningún brazo lo ejercitaba**: `pedir()` tenía el parámetro `cuerpoCrudo` sin un solo consumidor | brazo nuevo — y ver (b) |
| H2 | **C5** inyectaba no-strings sólo en `telefono`, el ÚLTIMO de la precedencia. Un servicio con `typeof` sólo ahí reventaba con un `TypeError` → 500 en `nombre: 42` | C5 **endurecido** a los siete campos |
| H3 | **C3** probaba sólo-espacios sólo en `ciudad`. Un servicio que midiera `.length` sin trim en los otros seis guardaba `'     '` como nombre válido | C3 **endurecido** a los siete campos |
| H4 | **C4** medía el rechazo por `max+1` pero **no miraba la base**: un `substring()` que truncara y después respondiera 400 dejaba el valor escrito | C4 **endurecido**: censa la base tras el rechazo |
| H5 | **D1** medía que el rechazo por email ajeno no escribe, pero partía de un titular **sin contacto**: sus columnas ya eran `null` y `toBeNull()` se cumplía solo. No distinguía «no tocó nada» de «borró lo que había» | **D5 nuevo**, con estado previo con contenido |

> H5 es **exactamente la familia del hallazgo de la calibración por ausencia** (los dos verdes de
> más), encontrada en un arnés ya calibrado. Y H2/H3 son la misma forma en otra clave: *un
> caso probado en UN campo no es un caso probado en los siete.*

**(b) La calibración por ausencia, corrida otra vez sobre el arnés ya endurecido.** El brazo
nuevo de H1 (`C10`) salió **VERDE sin el módulo**: el parser de cuerpo y el filtro global
responden **antes de enrutar**, así que no mide a S-14 sino a la infraestructura. Se movió a
**G3** y se quedó como control —una entrega que registrara su propio parseo y se tragara el
`SyntaxError` lo pondría rojo—, porque **un brazo que no puede fallar por culpa de la unidad no
es un brazo de la unidad**. El arnés de S-15 tuvo el mismo caso el mismo día (su C11 → G5).

## 9 · Cómo se corre el árbitro

```bash
npm run build              # tsc -p tsconfig.build.json — el typecheck NO lo cubre
npm run typecheck          # exit 0
npm run guante             # 6 compuertas duras por ausencia — 6/6
npm run test:contacto      # el arnés de esta unidad — 32 casos
npm run test:auth          # S-08 no se toca: tiene que seguir en 11/11
npm run invariantes        # I1-I5: esta unidad no mueve dinero, y hay que verlo (V5)
npm run calibrar:s14       # DESPUÉS de la entrega (ver § 8)
npm run test:integracion   # la batería ENTERA antes de cerrar, no sólo lo que se tocó
```

Reporta **el número real** de casos pasados y fallados (Pilar 7). "Funciona" no es una métrica.

## 8.2 · Los dos brazos imposibles, y por qué no los cazó ninguna de las dos calibraciones

La primera entrega llegó con **35/38** y un informe de bloqueo de tres puntos. Los tres
eran ciertos, y dos de ellos eran
brazos que **ninguna entrega correcta podía poner en verde**:

| brazo | qué pasaba | por qué |
|---|---|---|
| **D5** y **E5** | su PUT de **preparación** se rechazaba con 400 | `contactoValido('-antes-del-email')` produce un `codigoPostal` de **22** caracteres, y `contactoValido('-victima')` un `telefono` de **22**, contra el máximo de **20** que este mismo arnés exige en C4. Los datos de preparación violaban la regla que el arnés defiende |
| **C7** | esperaba `CONTACTO_NOMBRE_INVALIDO` para `'texto'`, `42` y `null` | el parser de cuerpo de Express corre con `strict: true` y **rechaza los primitivos JSON en la raíz antes de enrutar**, devolviendo `CUERPO_INVALIDO`. Sólo el **array** llega al controlador |

**Ninguna de las dos mitades de la calibración podía cazar esto, y ése es el hallazgo de
método.** La calibración por ausencia los ponía **rojos**, que era exactamente lo que se
esperaba de ellos: un brazo imposible y un brazo correcto sin la unidad se ven **idénticos**.
Y el calibrador sobre la entrega todavía no podía correr. La forma nueva es ésta:

> **Un arnés no sólo puede estar ciego: también puede ser IMPOSIBLE.** Y esa forma no la ve
> ninguna calibración, porque las dos leen el rojo como confirmación. La ve quien corre el
> arnés contra una entrega correcta — o quien lo lee contra el resto del repo, que es lo que
> ocurrió acá y en S-15 el mismo día.

**Qué se hizo, y no fue ablandar nada:**
- **D5 y E5**: sufijos cortos (`'-ant'`, `'-vic'`, `'-sec'`), y sobre todo una **compuerta
  nueva**, `contactoValidoSeguro`, que afirma que **cada valor de preparación respeta el máximo
  de `CAMPOS`** antes de usarlo. El arnés se niega a construir datos que él mismo rechazaría, y
  el fallo dice qué campo y qué sufijo. *Los datos de un arnés también se calibran*.
- **C7 se parte en dos**: `C7` se queda con el **array**, que es el único caso que S-14 decide
  de verdad; los tres primitivos pasan a **`G4`**, control declarado, esperando `CUERPO_INVALIDO`.
  Es el caso inverso: en vez de aprobar al brazo por la unidad, la
  infraestructura lo **reprobaba** por ella. El contrato de C5 se cumple igual —400 con código
  tipado—, así que lo que cambia es de quién es el mérito, no la calidad de la respuesta.
- El arnés queda en **39 casos** (A 5 · B 5 · C 11 · D 6 · E 6 · F 2 · **G 4**), y la entrega
  da **39/39** con las tres correcciones y **sin tocar una línea del código entregado**.
