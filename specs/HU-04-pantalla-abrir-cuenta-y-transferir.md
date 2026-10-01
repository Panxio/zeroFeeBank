# HU-04 · Pantalla de abrir cuenta y las variantes nuevas de Transferir (HU-01 en pantalla)

> Historia de pantalla (humano: una HU por pantalla). Es la pantalla que HU-01 R11 dejó para
> después: su API existe desde S-12, S-20, S-21 y S-22. Escrita el **2026-09-15**
> con las decisiones del humano.
> Auditoría de huecos: 5 brutos, 1 real; el humano decidió no cubrirlo en la API (§ 6).
> De ella salen S-17-abrir-cuenta y S-17-transferir (§ 8). **No pide backend.**

---

## 1 · La historia

> **Como** titular de ZeroFeeBank,
> **quiero** abrir una cuenta corriente o de ahorro desde la banca en línea, y transferir a mis
> cuentas de cualquier tipo, a la cuenta de otro cliente o a una cuenta de otro banco,
> **para** ordenar mi dinero sin salir de la aplicación,
> **y** ver, después de transferir a otro banco, a qué banco, número y tipo de cuenta fue el dinero.

## 2 · Variantes del flujo (qué existe hoy en pantalla y qué falta)

| # | Variante | Pantalla hoy | Qué falta |
|---|---|---|---|
| A1 | Abrir la **primera** cuenta (sin cuentas: se fondea desde la caja) | ❌ el Resumen dice «No tienes cuentas registradas» y no ofrece nada | pantalla de apertura |
| A2 | Abrir otra cuenta, fondeada desde una cuenta propia | ❌ | pantalla de apertura |
| T1 | Transferir entre cuentas propias (HU-01 V1–V2) | ⚠️ existe (S-10 T3), pero **rotula toda cuenta como «Corriente»** (`web/src/app/app.html:267`, `:323`) y el Resumen no muestra el tipo | mostrar el tipo real |
| T2 | Transferir a un tercero del banco, por id (HU-01 V3–V4) | ✅ S-10 T3, «Otras cuentas» | nada (una cuenta de sistema responde 404: se ve con su código) |
| T3 | Transferir a otro banco (HU-01 V5) | ❌ | tercer destino: banco, número, tipo |
| T4 | Ver la transferencia a otro banco recién hecha (HU-01 V6) | ❌ | confirmación que la relee con `GET /transferencias/otros-bancos/:id` |

## 3 · Reglas de negocio (de las specs del backend o del humano — no inventadas)

| # | Regla | Fuente |
|---|---|---|
| R1 | Tipos que se pueden abrir: **CORRIENTE y AHORRO**, con las mismas reglas. | HU-01 R1–R2, S-20 |
| R2 | Monto de apertura mínimo **1.000,00 USD**; si no se indica, se deposita el mínimo. | S-12 § Constantes |
| R3 | La **primera** cuenta se fondea desde la caja del sistema; de la segunda en adelante, desde una cuenta propia con fondos (`CUENTA_ORIGEN_REQUERIDA`, `FONDOS_INSUFICIENTES`). | S-12 Decisión 1 (humano, 2026-09-07) |
| R4 | Sin restricciones entre tipos de cuenta al transferir. | HU-01 R3 |
| R5 | Otro banco: **banco del catálogo cerrado, número de 1 a 20 dígitos, tipo CORRIENTE o AHORRO**. El destinatario no se valida. | HU-01 R5, R10, J4, J6 |
| R6 | Catálogo con nombres visibles: Banco Aserción, Banco Fixture, Banco Stub, Banco Sandbox, Banco Mock. | HU-01 § 3 (juego A) |
| R7 | **Tope de 200,00 USD por día UTC y por cuenta de origen**, sólo hacia otros bancos; borde inclusivo. | HU-01 R9, J1–J2 |
| R8 | La pantalla **muestra la regla del tope como texto** («Máximo 200,00 USD por día (UTC) por cuenta de origen») y maneja `409 TOPE_DIARIO_EXCEDIDO`. **No muestra el cupo restante**: la API no lo expone, y no se agrega. | — |
| R9 | Sin comisión en ninguna modalidad. | HU-01 R8 |
| R10 | Fechas y horas en **UTC, rotuladas «UTC»**. | — |

## 4 · Decisiones de diseño

- **J1 · El tipo de la cuenta se muestra en todas partes:** Resumen, selector de origen, «Mis
  cuentas» y apertura, a partir del `tipo` que `GET /cuentas` ya entrega. Los rótulos visibles son
  «Corriente» y «Ahorro»; la suite afirma sobre un atributo con el código, no sobre el texto. Esto
  **cambia el artefacto de S-10**, así que su arnés (`verificar:s10-t4`) tiene que seguir verde o
  enmendarse con aprobación.
- **J2 · El catálogo de bancos vive como constante en el front**, código → nombre visible (R6). Es
  lo que S-22 § 7 dejó para esta unidad. No se agrega `GET /bancos` (Pilar 0): el código es el
  contrato y ya lo valida la API (`BANCO_NO_PERMITIDO`). Si el catálogo del front se desfasa del
  backend, el síntoma es un 400 con código, no dinero mal movido.
- **J3 · Destino como tercera opción del paso Destino** de T3: «Mis cuentas» · «Otras cuentas» ·
  «Otro banco». El paso Revisar muestra banco (nombre visible), número y tipo antes de enviar.
- **J4 · Idempotencia igual que T3** (S-10 T3 § 4.3): una clave nueva por confirmación y la misma si
  hay doble clic. Vale también para `POST /cuentas`.
- **J5 · Apertura:** si el titular no tiene cuentas, no se pide origen (R3). Si tiene, el origen es
  obligatorio y se elige de sus cuentas. El monto viene prellenado con 1.000,00 (R2).
- **J6 · Entrada a la apertura:** `nav-abrir-cuenta` en el submenú de cuentas (reservado en S-10
  § 6) y un botón en el estado vacío del Resumen.

## 5 · Criterios de aceptación (verificables sobre el artefacto renderizado, C3)

**Apertura (S-17-abrir-cuenta)**
- CA1 · Usuario sin cuentas → abre una CORRIENTE sin elegir origen; aparece en el Resumen con saldo
  igual al monto de apertura y tipo Corriente, ambos leídos de atributos y no del texto formateado.
- CA2 · Con una cuenta → abre una AHORRO desde ella; el origen baja exactamente el monto y la nueva
  aparece con tipo Ahorro.
- CA3 · Monto bajo 1.000,00 → `MONTO_APERTURA_INSUFICIENTE`; sobre el saldo del origen →
  `FONDOS_INSUFICIENTES`. En ambos casos no aparece ninguna cuenta nueva.
- CA4 · Doble clic en abrir → una sola cuenta nueva (J4).

**Transferir (S-17-transferir)**
- CA5 · Con una CORRIENTE y una AHORRO, el selector de origen y «Mis cuentas» muestran el tipo real
  de cada una (J1).
- CA6 · Corriente → ahorro propia → `201`, y los dos saldos se mueven exactamente el monto.
- CA7 · Otro banco válido → confirmación con banco, número, tipo, monto y fecha, releídos del `GET`
  (T4); el saldo del origen baja exactamente el monto (R9).
- CA8 · El texto del tope (R8) está visible en «Otro banco».
- CA9 · Tope: 200,00 en una o varias transferencias → todas pasan; la que lleva el acumulado a 200,01
  → `TOPE_DIARIO_EXCEDIDO`, sin mover el saldo.
- CA10 · Con el reloj de prueba adelantado al día UTC siguiente, vuelve a pasar 200,00.
- CA11 · Número con letras o de 21 dígitos → `NUMERO_CUENTA_EXTERNA_INVALIDO`, sin mover el saldo.
  La validación del cliente no reemplaza a la de la API: con ella desactivada, la API igual rechaza.
- CA12 · El id de una cuenta de sistema pegado en «Otras cuentas» → `CUENTA_NO_ENCONTRADA` (HU-01 V4).
- CA13 · `verificar:s10-t4` sigue verde o se enmienda con aprobación del humano (J1); ninguna
  aserción se relaja en silencio.

## 6 · Huecos del mapa, clasificados

| Hueco | Clasificación |
|---|---|
| Sin `GET /bancos` | constante en el front (J2) |
| Sin listar transferencias a otros bancos | no-goal de S-22 § 7 (se consulta una, CA19 de HU-01) |
| Sin consultar el cupo restante del tope | **real, decidido por el humano: no se agrega** (R8) |
| Sin `GET` de transferencias internas | no es un hueco: Movimientos (HU-03) las muestra |
| Sin número de cuenta legible | decidido en S-10: id visible con botón de copiar |
| **Hueco no detectado:** la pantalla rotula toda cuenta como «Corriente» | real, sólo del front (J1) |

## 7 · Invariantes

I1–I5 e I7 en verde. I7 (el tope, S-22) no puede romperse por la pantalla: la autoridad es la API.

## 8 · Specs que salen de esta HU

| Spec | Qué | Árbitro | Reparto |
|---|---|---|---|
| **S-17-abrir-cuenta** | Apertura (A1–A2) + tipo visible en el Resumen (J1) | CA1–CA4 y la lista de `data-testid` | delegable con el arnés hecho |
| **S-17-transferir** | Tipo visible en T3 + destino «Otro banco» + confirmación releída (T1, T3, T4) | CA5–CA13, con `verificar:s10-t4` como candado | requiere arnés y ataque a ciegas: toca un artefacto con arnés candado |

**Orden (Pilar 3):** S-17-abrir-cuenta primero. Crea la AHORRO que CA5 y CA6 necesitan desde la
pantalla, y su cambio a S-10 es el más chico (sólo el Resumen).

## 9 · No-goals

- Mostrar el cupo restante del tope (R8), `GET /bancos` (J2), listar transferencias.
- Cerrar o editar una cuenta (S-12).
- Intereses, comisiones, otra moneda (HU-01 § 9).
- Hora local chilena (R10).
