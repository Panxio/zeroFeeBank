# HU-02 · Pantalla de boletas de garantía, con ventanilla pública de cobro

> Historia de pantalla (humano: **una HU por pantalla**, HU-02 … HU-06). El backend de las
> boletas existe desde S-09 (API) y S-19 (PDF); esta HU pide la **pantalla** y lo poco que le falta
> a la API para que la pantalla diga la verdad. Escrita el **2026-09-15**
> con las decisiones del humano. De ella salen S-23 y S-17-boletas (§ 8).

---

## 1 · La historia

> **Como** titular de ZeroFeeBank,
> **quiero** emitir boletas de garantía desde una de mis cuentas, verlas con su estado, liberar los
> fondos de una vencida, devolver una vigente y descargar sus comprobantes,
> **para** garantizar una obligación sin salir de la banca en línea;
> **y como** retirador autorizado de una boleta, **quiero** cobrarla en una ventanilla pública, sin
> cuenta ni sesión en el banco.

## 2 · Variantes del flujo (qué existe hoy y qué falta)

| # | Variante | API hoy | Qué falta |
|---|---|---|---|
| V1 | Emitir (monto, plazo, beneficiario, glosa, retirador) | ✅ `POST /boletas` (S-09) | pantalla |
| V2 | Listar mis boletas y ver una | ✅ `GET /boletas`, `GET /boletas/:id` | pantalla |
| V3 | Cobro por el retirador, sin login | ✅ `POST /boletas/:id/cobrar` sin token | **ventanilla pública** (R7) |
| V4 | Liberar los fondos de una vencida | ✅ `POST /boletas/:id/vencer` | pantalla + **saber si ya se liberaron** (R9, § 6) → **S-23** |
| V5 | Devolver una vigente | ✅ `POST /boletas/:id/devolver` | pantalla |
| V6 | Descargar comprobante (siempre) y resumen (cerrada) | ✅ S-19 | pantalla |
| V7 | Una boleta en cada estado, lista para probar | ❌ ningún escenario de `seed` crea boletas | escenario de `seed` → **S-23** |

## 3 · Reglas de negocio (de las specs del backend o del humano — no inventadas)

| # | Regla | Fuente |
|---|---|---|
| R1 | Plazo entero de **1 a 365 días**. | S-09 B1 |
| R2 | Sin tope de monto: el único límite es el saldo (`409 FONDOS_INSUFICIENTES`). | S-09 B6 |
| R3 | Sin comisión de emisión ni de cobro. | S-09 § No-goals |
| R4 | Beneficiario y retirador: RUT con dígito verificador válido y nombre de 1 a 120 caracteres; glosa de 1 a 200. | S-09 B3, `boletas.constants.ts` |
| R5 | Un titular **sólo ve y sólo opera** boletas de sus cuentas; una ajena responde como inexistente. | S-09 V5 |
| R6 | El cobro no lleva token: lo autoriza el **RUT del retirador**. Otro RUT → `403 RETIRADOR_NO_AUTORIZADO`. | S-09 § cobrar |
| R7 | El cobro se hace en una **ventanilla pública**, sin login, con enlace desde la portada y URL directa. Pide id de la boleta y RUT del retirador. **Enmienda el no-goal «no hay portal del beneficiario» de S-09:** hay ventanilla, no cuenta ni sesión del beneficiario. | — |
| R8 | **Sin proceso batch de vencimiento.** La boleta figura VENCIDA sola al leer (reloj); los fondos se devuelven con «Liberar fondos» (`vencer`). S-09 B2 sin cambio; el batch va al backlog. | — |
| R9 | La pantalla distingue una VENCIDA **con fondos por liberar** de una **ya liberada**: la API suma un campo aditivo al `BoletaDto`. | — |
| R10 | Fechas y horas en **UTC, rotuladas «UTC»**, igual que la API y los PDF (S-19). | — |
| R11 | El resumen PDF sólo existe para una boleta cerrada; si no, `409 BOLETA_NO_CERRADA`. | S-19 |

## 4 · Decisiones de diseño (declaradas para que el humano las discuta)

- **J1 · La cuenta de origen se muestra por su tipo y su id**, cruzando `cuentaOrigenId` con
  `GET /cuentas`. Es la misma forma en que el Resumen muestra las cuentas (S-10: id visible con botón
  de copiar), así que no hace falta un número de cuenta nuevo. Esto corrige lo que se
  contó como hueco real de P2.
- **J2 · Qué acción ofrece cada estado:** VIGENTE → «Devolver» · VENCIDA sin liberar → «Liberar
  fondos» · VENCIDA liberada, COBRADA, DEVUELTA → ninguna. El comprobante se ofrece siempre; el
  resumen, sólo cuando la boleta está cerrada (R11).
- **J3 · El estado EMITIDA del catálogo S-10 § 3 (desafío 16) no existe en el dominio**
  (`src/domain/boleta/boleta.ts:22`): una boleta nace VIGENTE. La pantalla muestra los 4 estados del
  dominio y el catálogo se corrige en S-17-boletas.
- **J4 · Nombre del campo nuevo (R9):** `fondosLiberados: boolean`, que es `true` cuando la boleta
  tiene asiento de cierre. El nombre final se fija en S-23.
- **J5 · Escenario de `seed` (V7):** una boleta en cada estado visible (VIGENTE, VENCIDA sin
  liberar, VENCIDA liberada, COBRADA, DEVUELTA) sobre una cuenta con saldo. `seed` devuelve los ids
  (C1). El nombre y las fechas sembradas se fijan en S-23.
- **J6 · La ventanilla genera su propia `Idempotency-Key`** para cada intento de cobro, y la reusa
  si el mismo intento se reenvía (doble clic). Es la misma regla que Transferir (S-10 T3 § 4.3).

## 5 · Criterios de aceptación (verificables sobre el artefacto renderizado, C3)

**Backend (S-23)**
- CA1 · `GET /boletas` y `GET /boletas/:id` traen el campo de R9: `false` en una VIGENTE y en una
  VENCIDA sin liberar, `true` después de `vencer`, `cobrar` o `devolver`.
- CA2 · Los arneses de S-09 y S-19 siguen verdes; ninguna aserción se relaja.
- CA3 · `seed` con el escenario de J5 devuelve los 5 ids, y cada boleta figura en su estado.

**Pantalla del titular (S-17-boletas)**
- CA4 · Emitir con datos válidos → la boleta aparece VIGENTE, su id está en un `data-testid` y el
  saldo de la cuenta baja exactamente el monto.
- CA5 · Cada rechazo de la API se ve con su código tipado (C5), sin escribir en el ledger:
  `PLAZO_INVALIDO`, `RUT_INVALIDO`, `NOMBRE_INVALIDO`, `GLOSA_INVALIDA`, `MONTO_INVALIDO`,
  `FONDOS_INSUFICIENTES`.
- CA6 · Con el reloj de prueba adelantado más allá de `venceEn`, la boleta figura VENCIDA y ofrece
  «Liberar fondos» sin esperar tiempo real. Al liberar, el saldo vuelve a ser el de antes de emitir
  y la acción desaparece.
- CA7 · «Devolver» una VIGENTE → DEVUELTA, y el saldo vuelve.
- CA8 · Las acciones de cada estado son exactamente las de J2, medidas sobre las 5 boletas del
  escenario de J5.
- CA9 · El comprobante se descarga como PDF. El resumen de una cerrada también; en una abierta, el
  botón del resumen no aparece.
- CA10 · Fechas rotuladas UTC (R10).

**Ventanilla pública (S-17-boletas)**
- CA11 · Se llega sin sesión, desde la portada y por URL directa.
- CA12 · Id y RUT del retirador correctos → COBRADA; el titular la ve COBRADA al volver a entrar.
- CA13 · RUT del beneficiario u otro → `RETIRADOR_NO_AUTORIZADO`. Boleta ya cerrada →
  `TRANSICION_INVALIDA`. Id inexistente → `BOLETA_NO_ENCONTRADA`. En los tres casos el ledger queda
  intacto.
- CA14 · Doble clic en «Cobrar» → un solo cobro (J6, D5).

## 6 · Hueco medido antes de escribir esta HU (R9)

`armarBoletaDto` (`src/modules/boletas/boletas.dto.ts:74-114`) devuelve `estado: estadoEn(…)` y
ningún dato del cierre. `estadoEn` (`src/domain/boleta/boleta.ts:38-41`) responde `VENCIDA` tanto
para una VIGENTE pasada de fecha como para una ya liberada (estado persistido `VENCIDA`). Por eso la
pantalla no puede decidir si mostrar «Liberar fondos». No hay riesgo de dinero: un segundo `vencer`
responde `409 TRANSICION_INVALIDA` y deja el ledger intacto (`boletas.service.ts:352`, test F4 en
`test/boletas.int.spec.ts:845`).

## 7 · Invariantes que esta HU no puede romper

- I1–I5 e I7 en verde tras cada spec.
- I6 (pendiente): saldo(GARANTIA) == suma de las boletas no cerradas. El escenario de
  J5 es el primer lugar donde se puede medir con boletas en todos los estados.

## 8 · Specs que salen de esta HU

| Spec | Qué | Árbitro | Reparto (DUPLA.md §2) |
|---|---|---|---|
| **S-23** | Campo de R9 en `BoletaDto` + escenario de `seed` de J5 | CA1–CA3, con un brazo nuevo en `test:boletas` y en el test de costuras | contrato del DTO, no delegable; el escenario de `seed` es delegable con el arnés hecho |
| **S-17-boletas** | Pantalla del titular + ventanilla pública (R7) | CA4–CA14 y la lista de `data-testid` versionada, sobre el artefacto renderizado | se planifica aparte, como S-10 (arnés y ataque a ciegas) |

**Orden (Pilar 3):** S-23 antes que S-17-boletas, porque la pantalla necesita el campo de R9 y el
escenario de J5 para su propio arnés.

## 9 · No-goals

- Proceso batch de vencimiento (R8; está en el backlog).
- Cobro parcial, renovación o prórroga, comisiones (S-09).
- Cuenta o sesión del beneficiario: la ventanilla no identifica a nadie más allá del RUT (R7).
- Filtros o paginación en la lista de boletas (S-09).
- Número de cuenta legible distinto del id (J1).
- Hora local chilena (R10).
