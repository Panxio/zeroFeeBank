# HU-03 · Pantalla de movimientos: buscar en el extracto de una cuenta

> Historia de pantalla (humano: una HU por pantalla). El backend existe desde S-13
> (`GET /movimientos`). Escrita el **2026-09-15**. Mapa de capacidades auditado
> (5 huecos brutos, **0 reales**; § 6). De esta HU sale S-17-movimientos (§ 8).
> **No pide backend.**

---

## 1 · La historia

> **Como** titular de ZeroFeeBank,
> **quiero** ver los movimientos de una de mis cuentas y buscarlos por transacción, por fecha, por
> rango de fechas o por monto,
> **para** encontrar un cargo o un abono sin revisar el extracto entero.

## 2 · Variantes del flujo

| # | Variante | API hoy | Qué falta |
|---|---|---|---|
| V1 | Elegir la cuenta y ver sus últimos movimientos | ✅ `GET /cuentas` + `GET /movimientos?cuentaId=` | pantalla |
| V2 | Filtrar por id de transacción | ✅ `transaccionId` | pantalla |
| V3 | Filtrar por un día o por un rango | ✅ `desde`, `hasta` | pantalla |
| V4 | Filtrar por monto (valor absoluto) | ✅ `monto` | pantalla |
| V5 | Combinar filtros (se cumplen todos a la vez) | ✅ S-13 | pantalla |
| V6 | Más de 50 resultados | ✅ tope duro con `hayMas` | pantalla: avisar y pedir que se acote |

## 3 · Reglas de negocio (de las specs del backend o del humano — no inventadas)

| # | Regla | Fuente |
|---|---|---|
| R1 | Se consulta **una cuenta a la vez**, y sólo si es del titular. Una ajena responde como inexistente (`404 CUENTA_NO_ENCONTRADA`). | S-13 |
| R2 | **Tope duro de 50** resultados, **sin paginación**. La respuesta dice `devueltos` y `hayMas`. | S-13 M2–M3 |
| R3 | Los días se cortan en **UTC**, inclusivos: `00:00:00.000Z` a `23:59:59.999Z`. | S-13 M4–M5 |
| R4 | El filtro de monto compara el **valor absoluto**: 25,00 encuentra débitos y créditos de 25,00. | S-13 J1 |
| R5 | Orden: más recientes primero (`creadoEn DESC`, desempate por id). | `movimientos.service.ts:62` |
| R6 | Sin contraparte ni saldo en la respuesta; el saldo vive en `GET /cuentas`. | S-13 § 1 |
| R7 | Fechas y horas en **UTC, rotuladas «UTC»**, igual que el filtro (R3). | humano |

## 4 · Decisiones del JUEZ

- **J1 · La cuenta se elige de la lista de `GET /cuentas`**, mostrada por tipo e id como en el
  Resumen (S-10). La pantalla no ofrece «todas las cuentas» porque la API no la tiene (R1).
- **J2 · Nombres visibles de los conceptos**, que según C5 pueden cambiar sin romper pruebas:
  `TRANSFERENCIA` → Transferencia · `TRANSFERENCIA_OTRO_BANCO` → Transferencia a otro banco ·
  `PAGO_SERVICIO` → Pago de servicio · `APERTURA_CUENTA` → Apertura de cuenta · `EMISION_BOLETA` →
  Emisión de boleta · `COBRO_BOLETA` → Cobro de boleta · `VENCIMIENTO_BOLETA` → Liberación de boleta
  vencida · `DEVOLUCION_BOLETA` → Devolución de boleta · `OTORGAMIENTO_PRESTAMO` → Préstamo. Un
  concepto que no esté en la lista se muestra con su código tal cual, sin error. Pasa con los
  `SIEMBRA*` de las costuras. La suite afirma sobre el código, que va en un atributo, y no sobre el
  texto.
- **J3 · El signo se ve como débito o crédito**, y el monto se muestra sin signo, en su propia
  columna o con su marca. La suite lo lee de un atributo, no del formato.
- **J4 · Los filtros se validan en el cliente sólo por comodidad.** La autoridad es la API (C5): un
  rechazo del servidor (`FECHA_INVALIDA`, `RANGO_INVALIDO`, `MONTO_INVALIDO`,
  `TRANSACCION_ID_INVALIDO`) se muestra con su código.
- **J5 · Aviso de `hayMas`:** «Se muestran los 50 más recientes; acota la búsqueda para ver el
  resto». No hay botón de «más», por R2.

## 5 · Criterios de aceptación (verificables sobre el artefacto renderizado, C3)

Oráculo: `seed movimientos-buscables` (S-13 § arnés), que devuelve sus 10 movimientos y la cuenta de
51 (`cuentaTopeId`).

- CA1 · Sin filtros → los 10 movimientos, en el orden de R5.
- CA2 · Día 2026-03-01 → 3 de 10, con los dos bordes del día dentro (R3).
- CA3 · Rango 2026-03-01..2026-03-02 → 6 de 10.
- CA4 · Monto 25,00 → 3 de 10, débitos y crédito (R4).
- CA5 · Día 2026-03-01 **y** monto 25,00 → 1 de 10: el brazo que caza «ignora uno de los filtros».
- CA6 · Cuenta de 51 → 50 filas y el aviso de J5 visible; con 10 el aviso no aparece.
- CA7 · Cada rechazo de J4 se ve con su código; `desde > hasta` → `RANGO_INVALIDO`; 2026-02-30 →
  `FECHA_INVALIDA` (S-13 A10).
- CA8 · Estado de carga explícito (C4) mientras la consulta está en vuelo, y estado vacío explícito
  cuando no hay resultados (distinto de «cargando»).
- CA9 · Fechas rotuladas UTC (R7).
- CA10 · Accesibilidad: la tabla tiene encabezados y los filtros tienen etiqueta.

## 6 · Huecos del mapa, clasificados (auditoría)

| Hueco del mapa | Clasificación |
|---|---|
| `cuentaId` obligatorio, sin vista consolidada | no es un hueco: selector de cuenta (J1), como Find Transactions de ParaBank |
| Sin paginación | no-goal de S-13 (R2) |
| Sin contraparte | no-goal de S-13 (R6) |
| Sin saldo progresivo | no-goal de S-13 (R6) |
| Sin filtro por concepto o tipo | no se pide; se puede filtrar en el cliente si alguna vez hace falta |

## 7 · Invariantes

No mueve plata: I1–I5 e I7 no pueden cambiar por usar esta pantalla.

## 8 · Specs que salen de esta HU

| Spec | Qué | Árbitro | Reparto |
|---|---|---|---|
| **S-17-movimientos** | Pantalla y entrada `nav-movimientos` en la barra | CA1–CA10 y la lista de `data-testid` versionada, sobre el artefacto renderizado | arnés y ataque a ciegas antes de implementar; implementable con el arnés hecho |

## 9 · No-goals

- Paginación, contraparte, saldo progresivo (S-13).
- Vista de todas las cuentas juntas (J1).
- Exportar el extracto (CSV o PDF).
- Hora local chilena (R7).
