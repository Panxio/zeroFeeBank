# HU-01 · Transferir según el destino: cuentas propias, terceros del banco y otros bancos

> Primera historia de usuario del repo (las specs cuelgan de
> una HU, no se escriben sueltas por endpoint). Cierra la **DEUDA DE NEGOCIO** declarada como
> no-goal de `specs/S-18-transferencia-autenticada.md` § 1.
> Escrita el **2026-09-14** con las reglas que entregó el humano ese día.
> De esta HU salen las specs S-20, S-21 y S-22 (§ 8).

---

## 1 · La historia

> **Como** titular de ZeroFeeBank,
> **quiero** mover dinero a mis otras cuentas —corriente o ahorro—, a la cuenta de otro cliente
> del banco, o a una cuenta de otro banco,
> **para** pagar y ordenar mi dinero sin salir de la banca en línea,
> **y** poder consultar después, en modo solo lectura, qué transferí a otro banco y a qué cuenta.

Propósito de la demo (humano): **no hay restricciones de negocio más allá de las que se
listan acá**. El sistema existe para que Selenium, Playwright o un cliente de API lo automaticen;
cada regla de § 3 es a la vez un caso a probar.

## 2 · Variantes del flujo (qué existe hoy y qué falta)

| # | Variante | Hoy | Qué falta |
|---|---|---|---|
| V1 | Entre cuentas propias del mismo tipo (corriente → corriente) | ✅ S-05 + S-18 | nada |
| V2 | Entre cuentas propias de distinto tipo (corriente ↔ ahorro) | ❌ no se puede abrir una ahorro (S-12 P3) | habilitar `AHORRO` en `POST /cuentas` → **S-20** |
| V3 | A un tercero del mismo banco | ✅ S-18: el destino debe existir, no se valida titularidad (N1) | nada |
| V4 | A una cuenta de sistema (CAJA, GARANTIA, PRESTAMOS…) | ⚠️ **responde 201** (medido, § 6) | cerrarla → **S-21** |
| V5 | A otro banco, sin validar destinatario | ❌ no existe | endpoint nuevo + tope diario → **S-22** |
| V6 | Consultar una transferencia a otro banco, solo lectura | ❌ no existe (S-13 no devuelve contraparte) | `GET` de solo lectura → **S-22** |

V1–V3 no cambian de ruta: siguen siendo `POST /transferencias` con `origenId` y `destinoId`
internos. V5 va por una ruta propia porque su destino **no es una cuenta del banco** y su
cuerpo es otro (banco, número, tipo).

## 3 · Reglas de negocio (entregadas por el humano el 2026-09-14 — no inventadas)

| # | Regla | Palabras del humano / respuesta |
|---|---|---|
| R1 | Tipos de cuenta de cliente: **corriente y ahorro**, como ParaBank (checking / savings), usando lo ya planificado en el backend (`AHORRO` está en el enum desde S-04). | «las que manejamos actualmente no más que eso» |
| R2 | `AHORRO` se abre por `POST /cuentas` **con las mismas reglas que `CORRIENTE`**: sin intereses, sin restricciones propias. | respuesta «Sí, igual a CORRIENTE»; autoriza cambiar el caso **B2** de `test/cuentas.int.spec.ts` (hoy exige `400 TIPO_CUENTA_NO_PERMITIDO`) |
| R3 | Sin restricciones entre tipos: cualquier combinación origen/destino propia es válida. | «No hay restricciones, esto es solo una demo» |
| R4 | Terceros del mismo banco: el destinatario **debe existir** en el banco. | «el destinatario debería estar creado y existente» (ya lo cumple S-18) |
| R5 | Otro banco: **no se valida el destinatario**. Se piden **banco, número de cuenta y tipo de cuenta** del destino; el tipo es solo histórico. | textual |
| R6 | La plata de una transferencia a otro banco va a una **cuenta de sistema** (contrapartida externa). | textual |
| R7 | Una transferencia a otro banco se puede **buscar después, solo lectura**. | textual |
| R8 | **Sin comisión.** | textual |
| R9 | **Tope diario de 200,00 USD** acumulado por **cuenta origen**, **solo** para transferencias a otros bancos. En el mismo banco no hay tope: el único límite es el saldo (`FONDOS_INSUFICIENTES`). La referencia de 50.000 **se descarta**. | respuesta «200/día otros bancos» |
| R10 | El banco destino sale de un **catálogo cerrado** de nombres **ficticios**, sin bancos reales (riesgo de queja o demanda si el repo se publica). | respuesta «Catálogo cerrado» + juego A aprobado |
| R11 | Solo **API** en esta HU. La pantalla es una unidad aparte, siguiente. | respuesta «API ahora, UI después» |

### El catálogo de bancos (juego A, aprobado por el humano el 2026-09-14)

| Código (contrato, viaja en la API) | Nombre visible (puede cambiar sin romper pruebas, C5) |
|---|---|
| `ASERCION` | Banco Aserción |
| `FIXTURE` | Banco Fixture |
| `STUB` | Banco Stub |
| `SANDBOX` | Banco Sandbox |
| `MOCK` | Banco Mock |

ZeroFeeBank **no está** en el catálogo (J5).

## 4 · Decisiones del JUEZ (declaradas para que el humano las discuta)

- **J1 · El día del tope es el día UTC del reloj inyectado** (`00:00:00.000Z`–`23:59:59.999Z`),
  igual que S-13 (M4). Sin esto no se puede probar el reinicio del tope sin esperar un día.
- **J2 · El borde del tope es inclusivo:** si el acumulado del día más el monto nuevo da
  exactamente 200,00, pasa; con 200,01, se rechaza **completa** (no se transfiere una parte).
- **J3 · El acumulado cuenta solo transferencias a otros bancos ejecutadas** desde esa cuenta
  ese día. Un rechazo (por tope, fondos o validación) no suma; un reintento idempotente (D5)
  no suma dos veces.
- **J4 · Tipo de cuenta del destino externo: `CORRIENTE` o `AHORRO`** (los mismos de R1).
  Es un dato histórico: no cambia nada del movimiento.
- **J5 · ZeroFeeBank no está en el catálogo.** Si estuviera habría dos caminos para lo mismo,
  y uno de ellos (V5) no valida el destinatario.
- **J6 · Número de cuenta externa: solo dígitos, de 1 a 20.** Sin guiones ni espacios; se
  guarda tal cual llega (texto, no número: un `0` a la izquierda es parte del número).
- **J7 · La transferencia a otro banco siempre se da por aceptada.** El otro banco no existe;
  no hay rechazo, devolución ni estado «pendiente».
- **J8 · El `GET` de solo lectura lo ve solo el titular de la cuenta origen.** Para cualquier
  otro, `404`, igual que S-18 J4 (no se confirma que el recurso existe).
- **J9 · El rechazo por tope es `409 TOPE_DIARIO_EXCEDIDO`**, coherente con
  `FONDOS_INSUFICIENTES` (409, `src/infra/errores-http.filter.ts:97`). Nombre y precedencia
  exactos se fijan en S-22.
- **J10 · La cuenta de sistema de V5 es una sola** para todos los bancos del catálogo (el banco
  queda en el registro de la transferencia, no en la cuenta). Su código se fija en S-22.

## 5 · Criterios de aceptación (verificables; cada uno será un brazo del arnés de su spec)

**Apertura (S-20)**
- CA1 · `POST /cuentas` con `tipo: "AHORRO"` → `201`, fondeada igual que una `CORRIENTE`.
- CA2 · `SISTEMA` (S-12 B3) y `PRESTAMO` (S-16 G2) siguen dando `400 TIPO_CUENTA_NO_PERMITIDO`,
  y el tipo sigue sin normalizarse: `"ahorro"` en minúscula es error, como `"corriente"` (S-12 B4).
- CA3 · `GET /cuentas` lista la ahorro con su tipo y su saldo derivado.

**Mismo banco (S-21)**
- CA4 · Corriente → ahorro propia y ahorro → corriente propia → `201` (V2).
- CA5 · Destino de tipo `SISTEMA` → `404 CUENTA_NO_ENCONTRADA`, sin escribir en el ledger (V4).
- CA6 · Los 10 casos endurecidos de S-18 siguen verdes; ninguna aserción se relaja.

**Otro banco (S-22)**
- CA7 · Transferencia válida → `201`; el ledger escribe una transacción que suma 0 (I1): débito
  en la cuenta origen, crédito en la cuenta de sistema de J10.
- CA8 · Banco fuera del catálogo → `400`, código tipado; ledger intacto.
- CA9 · Número de cuenta que no cumple J6 (vacío, letras, 21 dígitos) → `400`; ledger intacto.
- CA10 · Tipo de destino fuera de J4 → `400`; ledger intacto.
- CA11 · Tope: 200,00 en una o varias transferencias del día → todas `201`; la que lleva el
  acumulado a 200,01 → `409 TOPE_DIARIO_EXCEDIDO`, ledger intacto.
- CA12 · Reinicio: tras adelantar el reloj de prueba al día UTC siguiente, se puede volver a
  transferir hasta 200,00.
- CA13 · El tope es por cuenta: 200,00 desde la cuenta A no impide 200,00 desde la B del mismo
  titular.
- CA14 · Concurrencia (D4): N transferencias simultáneas que juntas pasan el tope → el
  acumulado ejecutado nunca supera 200,00.
- CA15 · Idempotencia (D5): misma `Idempotency-Key` dos veces → un solo movimiento, misma
  respuesta, y el tope cuenta una sola vez.
- CA16 · Fondos: dentro del tope pero sobre el saldo → `409 FONDOS_INSUFICIENTES`.
- CA17 · Origen ajeno o inexistente → `404`, igual que S-18.
- CA18 · Sin comisión: el débito del origen es exactamente el monto.
- CA19 · El `GET` de solo lectura devuelve banco, número, tipo, monto y fecha al titular del
  origen; a otro titular, `404` (J8).
- CA20 · Monto negativo, cero o mal formado → `400 MONTO_INVALIDO` (D6, igual que S-05).

## 6 · Hueco medido antes de escribir esta HU (V4)

Sonda (2026-09-14): con token válido y saldo, `POST
/transferencias` hacia una cuenta `tipo: SISTEMA` responde **201** y mueve el dinero. El control,
hacia una `CORRIENTE` ajena, también responde 201: la sonda funciona.

Por qué importa: hoy nadie de afuera conoce los UUID de las cuentas de sistema, pero esconderlos
no es una validación. Con V5 aparece una cuenta de sistema más, y transferirle directo se
**saltaría el tope** (R9); transferir a `GARANTIA` descuadraría saldo(GARANTIA) contra las
boletas vigentes (el I6 pendiente).

## 7 · Invariantes que esta HU no puede romper

- I1–I5 del perfil siguen en 5/5 tras cada spec.
- **Nuevo, a medir en S-22:** para toda cuenta y todo día UTC, la suma de sus transferencias a
  otros bancos ejecutadas ≤ 200,00. Se escribe como consulta que devuelve un número y se
  **calibra** rompiendo el tope a propósito.

## 8 · Specs que salen de esta HU, y cómo se reparte cada una

| Spec | Qué | Árbitro | Reparto |
|---|---|---|---|
| **S-20** | `AHORRO` en `POST /cuentas` (R1–R2) | `test:cuentas` con B2 cambiado a `201` (autorizado, R2) + CA1–CA3 | cambio de contrato de un arnés candado; el código es de una línea |
| **S-21** | Destino `SISTEMA` → 404 en `POST /transferencias` + CA4 | brazos nuevos en el arnés de S-18 | con el arnés hecho; es chica |
| **S-22** | Transferencia a otro banco + tope + `GET` de solo lectura | arnés CA7–CA20 + invariante nuevo, **escrito y calibrado antes de implementar** | migración, bloqueo del tope (D4) y borde `bigint` primero · después la función pura del tope en `src/domain/` y el endpoint, con el arnés hecho |
| (siguiente) | Pantalla: tipo de transferencia, selector de banco, error de tope (R11) | `data-testid` sobre el artefacto renderizado | se planifica aparte, como S-10 |

**Orden (Pilar 3):** S-21 antes que S-22, porque S-22 crea la cuenta de sistema que V4 dejaría
abierta. S-20 es independiente y va primero por ser la más chica.

**Ejecución en paralelo:** la implementación de S-22
en paralelo con `ancla_ausente` a `scripts/lib/calibrador.sh`, que tocan
archivos disjuntos. Se lanzan en segundo plano, y
se anota si avisó bien. Si ninguna de las dos está lista con árbitro, **no se inventa una tarea
para probar el vigilante**: se espera a la primera unidad real.

## 9 · No-goals (explícitos, para que no crezca solo)

- Comisiones (R8), intereses de la cuenta de ahorro (R2), moneda distinta del dólar.
- Validar el destinatario de otro banco: RUT, nombre o correo (R5 no los pide).
- Rechazos, devoluciones o estados intermedios del otro banco (J7).
- Tope en el mismo banco o tope por titular (R9); el máximo de 50.000 (descartado).
- Transferencias programadas o recurrentes.
- La pantalla (R11): unidad siguiente.
- Editar o anular una transferencia a otro banco: el ledger es append-only (D3).
