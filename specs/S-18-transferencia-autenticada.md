# S-18 · La transferencia exige identificarse

> Cierra **R4** del plan de negocio. Escrita el **2026-09-08**, antes
> de implementar, junto con el endurecimiento de su arnés (`test/idempotencia.int.spec.ts`).
> Candado: `specs/_CANDADO.md`. **El arnés no se toca.**

---

## 0 · Por qué esta unidad cambia un contrato que ya estaba verde

`POST /transferencias` es hoy **el único endpoint que mueve dinero sin pedir identificación**.
Cualquiera que conozca dos UUID de cuenta puede ordenar una transferencia entre ellas. S-08
(auth) llegó después de S-06 (idempotencia) y la puerta nunca se volvió a cerrar.

Eso significa que **S-18 cambia el contrato de S-06**, y se declara acá en vez de descubrirse
al ver un arnés en rojo:

> **A partir de S-18, `POST /transferencias` responde `401 TOKEN_AUSENTE` a toda petición sin
> `Authorization: Bearer <token>` válido.** Los 9 casos de `test/idempotencia.int.spec.ts`
> llamaban sin token porque cuando se escribieron no existía el token. **Se endurecen
> antes de implementar**: cada caso pasa a mandar un token válido y se añaden los casos nuevos.
> Autoriza: el humano, 2026-09-08. Nadie más toca ese archivo.

**Se endurece, nunca se ablanda:** ninguna aserción existente se borra ni se relaja. Lo único
que cambia en los 9 casos vigentes es que la petición ahora lleva token y las cuentas sembradas
tienen dueño. Todo lo que medían —el candado, la huella, el borde de `bigint`, el 409, el
ledger intacto— sigue midiéndose igual.

### Corrección de alcance (medida, no supuesta) — 2026-09-08

Un plan previo declaraba que S-18 tocaba **dos** arneses y **13** casos. Se verificó
leyendo los archivos y **es falso para uno de los dos**:

| arnés | capa | ¿lo toca S-18? |
|---|---|---|
| `test/idempotencia.int.spec.ts` | **HTTP** (`fetch` contra `/transferencias`), 9 casos | **Sí** — los 9 pasan a 401 sin token |
| `test/concurrencia.int.spec.ts` | **servicio**, instancia `TransferenciasService` a mano, 4 casos | **No** — nunca cruza el controller ni auth |

**M2 no se ve afectada por esta unidad**, porque su arnés no pasa por la puerta HTTP. Se
vuelve a correr igual al cierre (una meta cumplida que está cerca de lo que se toca se
re-mide), pero **no se modifica ni un caso suyo**.

### Segunda corrección: esta tabla estaba incompleta, y lo encontró la implementación

**Bloqueo de la implementación, 2026-09-08, y tenía razón.** La tabla de arriba se escribió mirando
los dos arneses que el plan previo nombraba, **sin barrer `test/` entero**. Falta uno:

| arnés | capa | ¿lo toca S-18? |
|---|---|---|
| `test/cuentas.int.spec.ts` · caso **F7**, línea 623 | **HTTP** — `pedir('POST', '/transferencias', …)` sin `autorizacion` | **Sí** |

F7 comprueba que el resumen de cuentas y el motor de transferencias comparten *la* definición
de saldo, y para eso mueve plata «por la otra puerta». Esa puerta ahora pide identificarse.

**Se endurece igual que los otros**: la petición pasa a mandar `autorizacion: t.auth`
—`t` ya es el dueño de las dos cuentas—, sin tocar una sola aserción de lo que F7 mide.
Autoriza el humano.

**El número real de casos a endurecer es 10, no 9 ni 13.** Y la lección, que es más cara que
el número: *una corrección de alcance también se verifica barriendo, no leyendo los dos
archivos que alguien nombró*. Van **tres BLOCKERs de tres con razón** en este proyecto.

---

## 1 · Qué hace, y qué queda fuera

**Hace:** `POST /transferencias` saca el titular del token, y sólo lo deja mover dinero **desde
una cuenta suya**. La cuenta origen que no existe y la que es de otro responden **idéntico**.

**Fuera (no-goals):**
- No cambia el motor de dinero: ni el bloqueo ordenado (D4), ni la partida doble (D2), ni el
  candado consultivo. `TransferenciasService` **no se toca**.
- No añade un `Guard` de Nest ni un decorador de sesión. El patrón del repo es sacar el titular
  en el controlador con `AuthService.yo(...)`, y hay dos precedentes literales.
- No cambia el esquema ni añade migración.
- No toca `test/concurrencia.int.spec.ts` (ver § 0).
- **No cubre los tipos de transferencia que la banca real distingue.** Declarado por el humano
  el 2026-09-08 y dejado **fuera de esta unidad a propósito**, no olvidado:
  *entre cuentas propias de distinto tipo* (corriente ↔ vista), y *a terceros de otro banco*
  —que no requieren validar al destinatario porque el destino vive fuera del sistema—.
  Hoy el esquema sólo conoce `CORRIENTE` y `SISTEMA` (`prisma/schema.prisma:43`) y S-12 sólo
  abre cuentas `CORRIENTE`, así que **la distinción todavía no tiene dónde apoyarse**. Se
  planifica como historia de usuario propia, con sus specs colgando de ella, y **no se inventa
  acá**: qué tipos existen, qué valida cada uno y qué pasa con un destino externo son reglas de
  negocio (Regla de Oro). Anotado como deuda de alcance.

**Hecho es:** `npm run test:idempotencia` en verde con el número nuevo de casos, `npm run
typecheck` exit 0, y `npm run calibrar:s18` con todos sus brazos declarados puestos en rojo por
el defecto que les toca.

---

## 2 · Los datos de negocio (preguntados al humano el 2026-09-08, no inventados)

| # | Pregunta | Respuesta del humano |
|---|---|---|
| N1 | ¿Quién puede ordenar una transferencia: el titular de la cuenta ORIGEN, el de la destino, o cualquiera de los dos? | **Sólo el titular de la cuenta ORIGEN.** |

De N1 se derivan, y se declaran para que se puedan discutir:

- **La cuenta destino NO se comprueba por titularidad.** Transferir a la cuenta de otra persona
  es el caso normal de una transferencia, no la excepción. Del destino sólo se exige que
  **exista**.
- **Transferir entre dos cuentas propias sigue siendo válido** (con origen ≠ destino, que ya lo
  cubre `MISMA_CUENTA`).

### Decisiones de diseño, no del humano (declaradas para que se puedan discutir)

- **J1 · El token se comprueba PRIMERO, antes que la `Idempotency-Key`.** Es el orden de
  `cuentas.controller.ts` y `movimientos.controller.ts`. Consecuencia observable y fijada en el
  contrato: una petición **sin token y sin `Idempotency-Key` responde `401`, no `400`**. Un
  cliente no identificado no merece un diagnóstico sobre la forma de su petición.
- **J2 · `titularId` entra en la huella de idempotencia.** Es exactamente lo que hace S-12
  (`cuentas.service.ts:69-74`). Consecuencia: si dos titulares distintos usan la misma clave,
  el segundo recibe **`409 IDEMPOTENCY_KEY_REUSADA`**, porque la clave es global (`clave` es
  `@id` en `ClaveIdempotencia`) y la huella no coincide. No es un caso nuevo: es el
  comportamiento que S-12 ya estrenó, aplicado a este endpoint.
- **J3 · La titularidad del origen se comprueba DENTRO de la operación idempotente**, junto a
  la validación de UUID que ya vive ahí. Razón: un **replay** de una petición vieja tiene que
  devolver lo guardado sin volver a ejecutar nada, y eso sólo se cumple si la comprobación está
  después de la resolución de la clave. Es el mismo argumento que ya está escrito en
  `idempotencia.service.ts` para el UUID.
- **J4 · La cuenta origen ajena responde `404 CUENTA_NO_ENCONTRADA`, idéntica a la
  inexistente.** Misma línea roja de S-12, S-09 y S-13: un `403` confirmaría qué cuentas
  existen y dejaría barrer el espacio de ids.
  **Corrección de un dato erróneo (2026-09-08, antes de implementar):** la primera
  redacción de esta spec exigía cuerpos «byte a byte iguales». Es **imposible de cumplir**, y
  no por un defecto: `CuentaNoEncontradaError` compone el mensaje como `la cuenta <id> no
  existe` (`src/infra/errores-de-dinero.ts:16`), así que dos ids distintos dan dos cuerpos
  distintos. Lo que se exige de verdad, y es lo que cierra el agujero, es que sean
  **indistinguibles salvo por el id que el propio cliente envió**: mismo estado, mismo
  `codigo`, y mismo mensaje una vez normalizado el UUID. Ni una palabra puede diferir.

---

## 3 · Contrato literal

### `POST /transferencias`

**Cabeceras**

| cabecera | obligatoria | nota |
|---|---|---|
| `Authorization: Bearer <token>` | **sí — nuevo en S-18** | el titular sale de acá, **nunca del cuerpo** |
| `Idempotency-Key` | sí (ya estaba) | ≤ 200 caracteres |

**Cuerpo** — sin cambios respecto de S-06:

```json
{ "origenId": "<uuid>", "destinoId": "<uuid>", "monto": "1234.56" }
```

**Respuesta 201** — sin cambios. El cuerpo NO gana campos: no lleva `titularId`.

### Errores — código estable y estado (C5)

Ningún código nuevo. Todos existen ya en `src/infra/errores-http.filter.ts`:

| situación | código | estado |
|---|---|---|
| falta `Authorization`, o no empieza con `Bearer ` | `TOKEN_AUSENTE` | **401** |
| token mal formado, firma que no cuadra | `TOKEN_INVALIDO` | **401** |
| token vencido | `TOKEN_EXPIRADO` | **401** |
| `origenId` no existe **o es de otro titular** | `CUENTA_NO_ENCONTRADA` | **404** |
| `destinoId` no existe | `CUENTA_NO_ENCONTRADA` | **404** |
| el resto (monto, misma cuenta, clave, fondos) | como en S-06 | sin cambios |

### Precedencia de validación — FIJADA, no se deja a criterio

Se comprueba **en este orden exacto**, y el primero que falla es el que responde:

```
1. Authorization -> titular            401 TOKEN_AUSENTE / TOKEN_INVALIDO / TOKEN_EXPIRADO
2. Idempotency-Key presente y <= 200   400 IDEMPOTENCY_KEY_AUSENTE / _INVALIDA
3. monto bien formado y > 0            400 MONTO_INVALIDO
4. origenId != destinoId               400 MISMA_CUENTA
   ── a partir de acá, dentro de la transacción idempotente ──
5. origenId y destinoId son UUID       404 CUENTA_NO_ENCONTRADA
6. origen existe Y es del titular      404 CUENTA_NO_ENCONTRADA   <-- nuevo en S-18
7. destino existe                      404 CUENTA_NO_ENCONTRADA
8. fondos                              409 FONDOS_INSUFICIENTES
```

Los pasos 2 a 8 son los de S-06 sin alterar. **S-18 añade el paso 1 arriba y el 6 en medio.**

---

## 4 · Invariantes de esta unidad

| # | Invariante |
|---|---|
| V1 | Ninguna petición sin token válido escribe **una sola fila** en `movimiento`, `transaccion` ni `clave_idempotencia`. |
| V2 | La respuesta a un `origenId` inexistente y la respuesta a un `origenId` ajeno son **indistinguibles**: mismo estado, mismo `codigo`, y mismo mensaje tras normalizar el UUID que el cliente mandó (ver J4). |
| V3 | El `titularId` **nunca** se lee del cuerpo de la petición. Sale de `AuthService.yo(...)` y de ningún otro sitio. |
| V4 | Los invariantes contables I1–I5 siguen en verde: esta unidad no mueve dinero de forma nueva. |

---

## 5 · Casos borde anticipados (Pilar 4)

- Token válido, `origenId` de **otro** titular → 404, y el ledger no se toca (V1 + V2).
- Token válido, `destinoId` de otro titular → **201**. Es el caso normal (N1).
- Sin token y sin `Idempotency-Key` → **401**, no 400 (J1).
- `Authorization: Bearer ` (vacío tras el prefijo) → 401 `TOKEN_AUSENTE`.
- `Authorization` sin el prefijo `Bearer ` → 401 `TOKEN_AUSENTE`.
- Dos titulares distintos, **misma** `Idempotency-Key` → el segundo recibe 409
  `IDEMPOTENCY_KEY_REUSADA` (J2).
- Mismo titular, misma clave, mismo cuerpo → **replay**, con `Idempotency-Replayed: true` y sin
  ejecutar de nuevo. Sin cambios respecto de S-06.
- Token que caduca **entre** la petición original y el replay → 401. El replay no es un pase
  libre: la identificación se exige siempre, antes de resolver la clave (J1 + J3).

---


## 7 · Piezas que YA existen y se reusan (no se reimplementan)

| pieza | dónde | para qué |
|---|---|---|
| `AuthService.yo(authorization)` | `src/modules/auth/auth.service.js` | token → `{ id, email }`. Lanza `TokenAusenteError` / `TokenInvalidoError` / `TokenExpiradoError` con su 401 ya mapeado |
| `CuentaNoEncontradaError` | `src/infra/errores-de-dinero.js` | el 404 de origen y destino, ya re-exportado por `transferencias.errors.js` |
| `IdempotenciaEjecutor` | `src/infra/idempotencia.ejecutor.js` | el mecanismo de la clave. `huellaDe` es el sitio donde entra `titularId` (J2) |
| `ErroresHttpFilter` | `src/infra/errores-http.filter.js` | ya traduce **todos** los códigos de esta spec |

**Verificado antes de implementar (2026-09-08):** `AuthModule` ya exporta `AuthService`, y no
importa ningún otro módulo, así que `TransferenciasModule` puede importarlo **sin crear un
ciclo**. Es exactamente lo que hace `CuentasModule`. No hay que tocar `src/modules/auth/**`.

**Los dos precedentes literales, que se miran y se copian:**
- `src/modules/cuentas/cuentas.controller.ts` — token primero, después `Idempotency-Key`
  (J1), y `titularId` dentro de `huellaDe` (J2).
- `src/modules/movimientos/movimientos.service.ts:26` — la comprobación exacta de la línea
  roja: `if (!cuenta || cuenta.titularId !== params.titularId) throw new CuentaNoEncontradaError(...)`.

---

## 8 · La calibración: qué defecto pone rojo a qué brazo

**Fijada ANTES de implementar.** La regla: *un defecto inyectado declara qué brazos
DEBE poner rojos* — contar rojos deja pasar brazos que mienten sobre lo que miden.

El arnés endurecido tiene **20 casos**: los 9 de S-06 y **11 nuevos, B1–B11**. Contra la app
**sin** S-18, medido el 2026-09-08 antes de implementar:

```
9 rojos  · B1 B2 B3 B4 B5 B6 B9 B10 B11
2 verdes · B7 (el dueño SÍ puede) y B8 (el destino puede ser de otro)
```

Los dos verdes son los **controles**: si se pusieran rojos también, el arnés estaría midiendo
«todo da 404» en vez de la titularidad. Los nueve rojos son la prueba de que cada brazo nuevo
**puede** fallar. Lo que falta —que falle por **su** defecto y no por cualquiera— lo da
`npm run calibrar:s18`, que se escribe **sobre la entrega** (como `calibrar-s13.sh`, que
parchea texto concreto del código entregado) y exige exactamente esto:

| # | defecto inyectado | brazos que DEBEN ponerse rojos | y que DEBEN seguir verdes |
|---|---|---|---|
| E1 | quitar la comprobación de titularidad del origen (dejar sólo `!cuenta`) | **B6, B9** | B7, B8, y los 9 de S-06 |
| E2 | no exigir el token: quitar la llamada a `AuthService.yo(...)` | **B1, B2, B3, B4, B5, B11** | B7, B8 |
| E3 | comprobar el token DESPUÉS de la `Idempotency-Key` (rompe J1) | **B4, B5** | **B1, B2, B3** — siguen rojos sólo si el token se ignora del todo; acá no |
| E4 | sacar `titularId` de `huellaDe` (rompe J2) | **B10** | todos los demás, B6 y B9 incluidos |
| E5 | resolver la clave de idempotencia ANTES de validar el token (rompe J3) | **B11** | B1, B2, B3 |
| E6 | responder `403` en vez de `404` a la cuenta ajena (rompe J4) | **B6, B9** | B7, B8 |

### Lo que la calibración corrigió de esta tabla (2026-09-08, sobre la entrega)

Se corrige la **predicción**, nunca el brazo. Los dos ajustes, con su razón:

- **E6 enrojece B6 *y* B9**, no sólo B6. La tabla original dejaba B9 en la columna de los
  verdes, y era un descuido: B9 también ordena la transferencia desde una **cuenta ajena**
  —lo suyo es que el `titularId` del cuerpo se ignore—, así que cualquier defecto que cambie
  la respuesta a lo ajeno lo mueve. Ya está corregido arriba.
- **E5 no se inyecta, y se dice en vez de contarlo como aprobado.** La entrega valida el token
  en el **controlador**, antes de tocar la idempotencia, así que «resolver la clave antes del
  token» no es un parche de una línea sino otra arquitectura. Forzarlo sería fabricar un
  defecto que la implementación no puede tener. **B11, el brazo que lo vigila, sí queda
  calibrado**: se pone rojo con E2.

**Resultado medido: `npm run calibrar:s18` → 5/5 defectos con el resultado exacto**, y el
calibrador comprueba **las dos mitades** —que los brazos declarados se pongan rojos y que
**ninguno más** lo haga—, que es lo que el de S-13 no hacía.

**E3 y E4 son los que separan un brazo honesto de uno decorativo.** Si al inyectar E4 se pone
rojo algo más que B10, es que ese otro brazo no medía lo que decía. Y si B10 sigue verde con
E4 puesto, B10 **no mide J2** — que es exactamente el defecto que tuvo en su primera
redacción, corregido antes de implementar (ver el comentario de B10 en el arnés).

---

## 9 · Cómo se corre el árbitro

```bash
npm run build                 # tsc -p tsconfig.build.json — el typecheck NO lo cubre
npm run typecheck             # exit 0
npm run test:idempotencia     # el arnés endurecido de esta unidad
npm run test:concurrencia     # M2, NO se modifica: tiene que seguir en 1 exito / 19 rechazos
npm run invariantes           # I1-I5, porque se tocó un endpoint de dinero
npm run calibrar:s18          # DESPUÉS de la entrega (ver § 8)
```

Reporta **el número real** de casos pasados y fallados (Pilar 7). "Funciona" no es una métrica.
