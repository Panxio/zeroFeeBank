# S-07 — Las costuras de prueba: `reset`, `seed` y el reloj fijable

> Unidad del backlog: **S-07**. Perfil `sut-automatizable`, costuras **C1** y **C2**.
> Árbitro: `npm run test:costuras` — ya escrito y calibrado. **No se toca.**
> Aplica `specs/_CANDADO.md` completo.

---

## Pilar 1 · Qué hace, en prosa

La aplicación expone tres rutas bajo `/__test__/` que **sólo existen cuando un flag de entorno
lo dice**. Sirven para que cualquier suite de pruebas —de cualquier framework, desde fuera del
proceso— deje el sistema en un estado conocido, cree un escenario nombrado y reciba de vuelta
**los identificadores que se crearon**, y controle el reloj de la aplicación.

Sin esto no hay determinismo, y sin determinismo cualquier suite es un generador de
intermitencias. Con esto, la prohibición de `waitForTimeout` del perfil `qa-automation` se
vuelve cumplible: la app coopera en vez de obligar a la suite a adivinar.

**La costura expone un estado que el sistema puede alcanzar de verdad.** Ninguna de estas rutas
crea nada que un usuario no pudiera crear operando el banco. Si una costura sólo existe para que
pase un test y no representa nada real, la app está mintiendo.

## No-goals (explícitos, para que no crezca solo)

- **No hay autenticación acá.** Los escenarios crean filas de `usuario` **sin credenciales
  utilizables** (ver § Decisión 4). El registro y el login son S-08 y viajan en otra unidad, en
  paralelo con ésta. **No importes nada de `src/modules/auth/`: en tu copia de trabajo no existe.**
- **No se toca `src/app.module.ts`.** Ya está escrito y registra tu módulo. Si lo modificas,
  rompes el aislamiento entre unidades (dos entregas en paralelo tienen que tocar archivos disjuntos).
- **No se toca el esquema ni se crean migraciones.** Esta unidad no necesita ninguna tabla nueva.
- **No hay ruta de "adelantar el reloj de la base"**. El reloj que se fija es el de la
  aplicación, no el `now()` de Postgres.
- **No hay borrado selectivo.** `reset` deja el sistema en el estado base, entero. Media limpieza
  es peor que ninguna: deja un estado que nadie declaró.

---

## Pilar 2 · Invariantes (qué tiene que ser siempre verdad)

| # | Invariante |
|---|---|
| V1 | Sin `ZFB_COSTURAS_PRUEBA=1`, las tres rutas devuelven **404**. No 403, no 401: **la ruta no existe**. |
| V2 | Después de un `reset`, el trigger de append-only del ledger **sigue puesto y sigue rechazando** un `UPDATE` con `ZFB01`. La garantía D3 no se debilita ni por un instante observable. |
| V3 | `seed` **devuelve todos los identificadores que creó**. Una suite nunca tiene que adivinar un id ni raspar el DOM para encontrarlo. |
| V4 | Un escenario desconocido **falla ruidosamente** (error tipado, 400) y **no escribe absolutamente nada**. Nunca un `200` con el cuerpo vacío. |
| V5 | Los escenarios son **estables entre corridas**: mismo nombre, mismos montos, misma forma. Sólo los uuid cambian. |
| V6 | Todo lo que `seed` escribe en el ledger respeta **D2**: cada transacción suma exactamente 0. Sembrar no es una excusa para descuadrar. |
| V7 | Con el reloj fijado, **todo el proceso** ve ese instante: dos llamadas seguidas a `RelojService.ahora()` devuelven exactamente el mismo `Date`. |

---

## Pilar 3 · El contrato, literal

### El flag

```
ZFB_COSTURAS_PRUEBA
```

**Vale sólo si es exactamente la cadena `"1"`.** Cualquier otra cosa —ausente, `"0"`, `""`,
`"true"`, `"si"`— significa apagado.

> **Por qué comparación exacta y no "es verdadero".** `Boolean("0")` es `true` en JavaScript, y
> «lo que parezca verdadero» es una regla que nadie puede volver a leer con seguridad seis meses
> después. Un solo valor, escrito en la spec, y se acabó la discusión.

**Dónde se decide, y esto es la mitad de la unidad:** la comprobación va **dentro de
`CosturasModule.paraEntorno()`**, el módulo dinámico que ya está escrito en el esqueleto, no en
un guard ni en un middleware ni en un `if` dentro del controlador. Con el flag apagado,
`paraEntorno()` devuelve un módulo **sin controladores** y el 404 lo da el router de Nest por sí
solo, sin código que se pueda olvidar de correr.

**La firma de `paraEntorno()` no se cambia.** La llaman `src/app.module.ts` y el arnés, y
ninguno de los dos está en tu alcance de archivos. Lee el comentario del esqueleto: explica por
qué es un módulo dinámico y no un `@Module` con un ternario adentro.

> Un guard que devuelve 404 «como si» la ruta no existiera es exactamente lo que V1 prohíbe: la
> ruta existe, y hay una línea de código entre el atacante y el `reset`. Aquí no hay línea.

### La segunda llave: el DSN de dueño

`reset` necesita permisos de dueño de la base (ver § Decisión 1). Los toma de:

```
DATABASE_URL_MIGRACION      # ya existe en .env desde S-04
```

**Si `ZFB_COSTURAS_PRUEBA=1` y `DATABASE_URL_MIGRACION` no está, la aplicación falla al
arrancar**, con un mensaje que nombre la variable que falta. No al recibir la petición.

> Una costura que existe a medias es peor que ninguna: la suite la encuentra, la llama, y
> descubre el problema a mitad de un escenario. Fallar al arrancar cuesta dos segundos y se lee
> en el log de CI.

---

### `POST /__test__/reset`

Sin cuerpo. Deja el sistema en el **estado base**: todas las tablas de datos vacías, el reloj
devuelto a la hora real.

**Respuesta `200 OK`:**

```json
{ "ok": true, "tablasVaciadas": ["movimiento","transaccion","boleta","clave_idempotencia","cuenta","usuario"] }
```

El arreglo va **en ese orden**, que es el orden en que se vacían, y es el orden que respeta las
claves foráneas.

---

### `POST /__test__/seed`

```json
{ "escenario": "dos-cuentas" }
```

**Respuesta `201 Created`** — la forma depende del escenario, y está fijada abajo. Siempre lleva
el nombre del escenario de vuelta, para que un log de CI diga qué se sembró:

```json
{
  "escenario": "dos-cuentas",
  "usuarioId": "<uuid>",
  "cuentas": [
    { "id": "<uuid>", "tipo": "CORRIENTE", "saldoCentavos": "100000" },
    { "id": "<uuid>", "tipo": "CORRIENTE", "saldoCentavos": "0" }
  ],
  "cuentaSistemaId": "<uuid>"
}
```

> **`saldoCentavos` viaja como string.** D1: en el borde JSON el dinero es una cadena decimal,
> nunca un `number`. Ya hay precedente resuelto en `src/modules/transferencias/`; **mira cómo se
> hizo ahí y hazlo igual**, no inventes un segundo estilo.

#### El catálogo de escenarios — los tres, completos

Los montos son **constantes de la costura**, fijadas acá. No son reglas de negocio: son la forma
del escenario, y por eso pueden estar escritas en una spec.

| escenario | qué crea | para qué existe |
|---|---|---|
| `cuenta-unica` | 1 usuario · 1 cuenta `CORRIENTE` con **100000** centavos · 1 cuenta `SISTEMA` de contrapartida | el caso más simple: mirar un saldo |
| `dos-cuentas` | 1 usuario · 2 cuentas `CORRIENTE`, la primera con **100000** y la segunda con **0** · 1 `SISTEMA` | transferir de una a otra |
| `cuenta-con-historial` | 1 usuario · 1 cuenta `CORRIENTE` con **100000** repartidos en **20** movimientos de abono · 1 `SISTEMA` | buscar movimientos, y **ensanchar la ventana** de las carreras (lección de S-05) |

- El saldo se construye **siempre por partida doble** contra la cuenta `SISTEMA` del propio
  escenario: por cada abono a la cuenta de cliente, el cargo espejo a la de sistema (V6, D2).
- En `cuenta-con-historial` los 20 movimientos suman exactamente 100000. **20 × 5000.** Sin
  restos, sin redondeo: si el reparto no fuera exacto, la spec traería el reparto, no una
  división.
- La cuenta `SISTEMA` de cada escenario lleva `codigo` **nulo**. El `codigo` es único en el
  esquema, y dos escenarios sembrados seguidos colisionarían.

#### El escenario desconocido — V4, y es lo que se calibra

```json
{ "codigo": "ESCENARIO_DESCONOCIDO", "mensaje": "..." }
```

`400 Bad Request`. El mensaje **enumera los escenarios válidos** (una persona leyendo un log de
CI a las 3 de la mañana lo agradece). **No se escribe una sola fila** antes de validar el nombre:
la validación va **primero**, antes de abrir cualquier transacción.

Un cuerpo sin `escenario`, o con `escenario` que no sea string, da el mismo código.

---

### `POST /__test__/reloj`

Dos formas, **excluyentes**:

```json
{ "instante": "2027-01-15T10:00:00.000Z" }   → fija el reloj en ese instante
{ "avanzarMs": 86400000 }                    → adelanta el reloj fijado en ese tanto
{ "instante": null }                         → devuelve el reloj a la hora real
```

**Respuesta `200 OK`:** `{ "ahora": "<ISO-8601>", "fijado": true|false }`.

Errores tipados, `400`:

| situación | código |
|---|---|
| las dos claves a la vez, o ninguna | `RELOJ_PETICION_INVALIDA` |
| `instante` no es una fecha ISO válida | `RELOJ_INSTANTE_INVALIDO` |
| `avanzarMs` no es un entero, o es negativo | `RELOJ_AVANCE_INVALIDO` |
| `avanzarMs` con el reloj **no** fijado | `RELOJ_NO_FIJADO` |

> **`avanzarMs` negativo se rechaza a propósito.** Un reloj que retrocede convierte una boleta
> vencida en vigente, y eso es un estado que el sistema **no puede alcanzar de verdad**. La
> costura expone estados reales o no es una costura.

---

## Pilar 3b · El mecanismo, decidido de antemano (no es dominio de quien implementa)

Cuatro decisiones tomadas. **No las sustituyas por otra cosa que "también funcione".**

### Decisión 1 · `reset` quita el trigger, vacía, y lo vuelve a poner — en UNA transacción

S-04 dejó en `movimiento` un trigger `BEFORE TRUNCATE` que aborta con `ZFB01` **incluso para el
dueño de la base**, más un `REVOKE UPDATE, DELETE, TRUNCATE` al rol de la app. Es decir: **la
conexión normal de la aplicación no puede vaciar el ledger, y eso está bien.**

El `reset` corre entonces sobre una **segunda conexión, con el DSN de dueño**, y hace, todo
dentro de un único `BEGIN … COMMIT`:

```sql
BEGIN;
  DROP TRIGGER movimiento_sin_truncate ON "movimiento";
  TRUNCATE TABLE "movimiento","transaccion","boleta","clave_idempotencia","cuenta","usuario"
    RESTART IDENTITY CASCADE;
  CREATE TRIGGER movimiento_sin_truncate
    BEFORE TRUNCATE ON "movimiento"
    EXECUTE FUNCTION <la misma función que creó S-04>;
COMMIT;
```

**Por qué esto no abre un hueco en D3.** En PostgreSQL el DDL es transaccional: mientras esa
transacción no confirme, **ninguna otra conexión ve el trigger ausente**. La garantía nunca está
observablemente apagada. Si la transacción se cae por lo que sea, el `ROLLBACK` deja el trigger
donde estaba. Es la única forma de vaciar el ledger sin debilitar la regla que lo protege, y por
eso V2 es un invariante y no una buena intención.

- El nombre exacto del trigger y de su función están en
  `prisma/migrations/20260907020724_s04_ledger_append_only/migration.sql`. **Léelo y copia los
  nombres de ahí**; no los deduzcas.
- **No se tocan los triggers de `UPDATE` ni de `DELETE`.** Sólo estorba el de `TRUNCATE`.
- La segunda conexión se abre **al arrancar** y se cierra al apagar, no una por petición.

### Decisión 2 · El reloj es un servicio inyectable en `src/infra/`, y la app entera lo usa

`RelojService` con `ahora(): Date`. Estado interno: un `Date | null`. Nulo = hora real.

- Lo publica el módulo de costuras, pero **vive en `src/infra/reloj.ts`** porque no es una
  costura: es infraestructura que la costura sabe empujar. En producción existe igual, siempre
  con el reloj real, y `fijar()` nunca se llama porque el módulo que lo llama no está montado.
- **El dominio sigue sin conocerlo.** `src/domain/` recibe el instante como parámetro y esa regla
  no cambia: el grep del guante sigue en 0.
- `avanzarMs` sobre un reloj no fijado es un error (`RELOJ_NO_FIJADO`), no un "fijo la hora
  actual y sumo". Adelantar desde un instante que nadie eligió es no-determinismo con otro
  nombre.

### Decisión 3 · `seed` valida el nombre ANTES de abrir la transacción

El orden es: *validar el cuerpo* → *resolver el escenario en el catálogo* → *si no está, 400 y se
acabó* → *recién entonces `$transaction`*. V4 no se cumple con un `try/catch` que deshaga: se
cumple no empezando.

### Decisión 4 · Los usuarios sembrados no tienen credenciales utilizables

`Usuario.passwordHash` es `NOT NULL` en el esquema, así que hay que escribir algo. Se escribe la
cadena literal:

```
!NO-UTILIZABLE-S07!
```

**No es un hash de nada y no puede serlo**: no tiene la forma de ningún hash, así que ninguna
verificación futura la va a aceptar por accidente. No inventes una contraseña ni un hash "de
ejemplo": eso es exactamente lo que la Regla de Oro prohíbe.

> Los escenarios **con credenciales que sirven para entrar** llegan cuando S-07 y S-08 estén las
> dos en `main`, y se agregan en una unidad propia. Anotado a propósito: es una costura
> que falta, no una que se resolvió a medias.

---

## Pilar 4 · Casos borde que ya están anticipados

1. **`reset` sobre una base ya vacía** → `200`, mismo cuerpo. Vaciar lo vacío no es un error.
2. **Dos `seed` seguidos del mismo escenario** → dos escenarios completos e independientes, con
   uuid distintos. Nada colisiona (por eso el `codigo` de la cuenta `SISTEMA` va nulo).
3. **`reset` con el reloj fijado** → el reloj vuelve a la hora real. El estado base incluye el
   tiempo; si no, un escenario heredaría la hora del anterior.
4. **`seed` con el reloj fijado** → las fechas de lo sembrado salen del `RelojService`, no de
   `new Date()`. Un escenario que se siembra "ahora" y luego se mira desde un futuro fijado tiene
   que ser coherente.
5. **Cuerpo que no es JSON, o vacío** → `400` con código tipado, nunca un 500.
6. **`avanzarMs` = 0** → válido. Adelantar cero es una operación legítima y el reloj no cambia.

---

## Pilar 5 · El arnés (ya escrito y calibrado — NO SE TOCA)

```bash
npm run test:costuras
```

`test/costuras.int.spec.ts`. Habla **por HTTP**, contra Postgres de verdad, con la app levantada
de verdad — porque V1 (el 404) y el borde de serialización sólo existen ahí.

El brazo del **404 sin flag levanta una segunda aplicación con el flag apagado**. Es la única
forma honesta de comprobarlo: mirar el código fuente y no encontrar la ruta es precisamente el
check ciego que este repo ya cazó cinco veces.

---


## Pilar 7 · La meta numérica, fijada antes de codear

| # | Meta | Cómo se mide |
|---|---|---|
| — | `npm run test:costuras` en verde, **todos** los casos | salida del runner |
| — | `npm run test:domain` sigue en **87/87** | no tocaste el dominio; si baja, algo se rompió |
| — | `npm run typecheck` **exit 0** | `tsc --noEmit` |
| — | `npm run guante` sigue en **5/5** | las compuertas duras por ausencia |
| — | `npm run verify:s04` sigue en **6/6** | **el append-only sobrevivió a la Decisión 1** |

Reporta el número real de cada uno, incluidos los fallos. "Funciona" no es una métrica.
