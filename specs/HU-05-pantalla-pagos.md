# HU-05 · Pantalla de pagos a terceros (Bill Pay)

> Historia de pantalla (humano: una HU por pantalla). El backend existe desde S-15
> (`POST /pagos`, `GET /pagos`). Escrita el **2026-09-15** con la decisión
> del humano (sin PDF). Auditada: 5 huecos brutos, 0 reales (§ 6). De ella sale S-17-pagos (§ 8).
> **No pide backend.**

---

## 1 · La historia

> **Como** titular de ZeroFeeBank,
> **quiero** pagarle a un tercero desde una de mis cuentas, indicando sus datos y su cuenta,
> **para** pagar un servicio o una deuda sin salir de la banca en línea,
> **y** ver después la lista de los pagos que hice.

## 2 · Variantes del flujo

| # | Variante | API hoy | Qué falta |
|---|---|---|---|
| V1 | Pagar: cuenta de origen, monto y los 7 datos del beneficiario | ✅ `POST /pagos` (S-15) | pantalla |
| V2 | Ver mis pagos | ✅ `GET /pagos` | pantalla |

## 3 · Reglas de negocio (de las specs del backend o del humano — no inventadas)

| # | Regla | Fuente |
|---|---|---|
| R1 | El beneficiario es **texto libre en cada pago**: sin agenda, ficha ni reutilización. | S-15 N1 |
| R2 | Siete datos obligatorios, no vacíos tras recortar espacios, con máximo: nombre 100 · dirección 100 · ciudad 50 · estado 50 · código postal 20 · teléfono 20 · cuenta del beneficiario 50. | S-15, `pagos.constants.ts:21-29` |
| R3 | Monto **> 0**, sin máximo ni tope diario; el único límite es el saldo (`FONDOS_INSUFICIENTES`). | S-15 N4 |
| R4 | **Sin comisión**: el débito es exactamente el monto. | S-15 N3 |
| R5 | El origen debe ser del titular; uno ajeno responde como inexistente (`404 CUENTA_NO_ENCONTRADA`). | S-15 |
| R6 | Sin anulación, reverso ni pago programado. | S-15 § 1 |
| R7 | **Sin comprobante PDF del pago**: bastan la confirmación en pantalla y la lista. | — |
| R8 | Fechas y horas en **UTC, rotuladas «UTC»**. | — |

## 4 · Decisiones de diseño

- **J1 · La lista muestra lo que la API devuelve:** fecha, cuenta de origen (tipo e id, como en el
  Resumen), beneficiario, cuenta del beneficiario y monto. Los otros 5 datos del beneficiario no
  vuelven en `GET /pagos`, y la lista no los pide (Pilar 0).
- **J2 · Validación en el cliente sólo por comodidad** (largos de R2, monto > 0). La autoridad es la
  API: cada rechazo se muestra con su código (C5), y si hay varios campos malos, la API informa el
  primero según su precedencia (`pagos.controller.ts:32`).
- **J3 · Idempotencia igual que T3** (S-10 T3 § 4.3): una clave nueva por confirmación, la misma si
  hay doble clic.
- **J4 · Confirmación antes de pagar,** con el mismo diálogo que Transferir (`zfb-dialogo`, S-10 T3):
  un pago mueve plata y no tiene reverso (R6).

## 5 · Criterios de aceptación (verificables sobre el artefacto renderizado, C3)

- CA1 · Pago válido → confirmación con su id en un `data-testid`; el saldo del origen baja
  exactamente el monto (R4); el pago aparece primero en la lista.
- CA2 · Cada campo vacío o sobre su máximo → su código (`PAGO_BENEFICIARIO_NOMBRE_INVALIDO` …
  `PAGO_CUENTA_BENEFICIARIO_INVALIDA`), sin mover el saldo. Se prueba en el borde exacto: máximo →
  pasa, máximo + 1 → rechazo.
- CA3 · Monto 0, negativo o mal formado → `MONTO_INVALIDO`; sobre el saldo → `FONDOS_INSUFICIENTES`.
  En ninguno de los dos casos se mueve el saldo.
- CA4 · Doble clic en confirmar → un solo pago (J3).
- CA5 · Cancelar en el diálogo → no se hace ninguna llamada ni se mueve el saldo.
- CA6 · Con la validación del cliente desactivada, la API igual rechaza (J2).
- CA7 · Estado de carga explícito (C4) al pagar y al cargar la lista; estado vacío explícito sin
  pagos.
- CA8 · Fechas rotuladas UTC (R8).

## 6 · Huecos del mapa, clasificados

| Hueco | Clasificación |
|---|---|
| Sin agenda de beneficiarios | no-goal de S-15 (R1) |
| Sin `GET /pagos/:id` | no hace falta: la lista y la respuesta del `POST` alcanzan |
| La lista no trae 5 de los 7 datos | no hace falta para la pantalla (J1) |
| Sin PDF del pago | **decidido por el humano: no se hace** (R7) |
| Sin filtros ni paginación en `GET /pagos` | no se pide para el demo |

## 7 · Invariantes

I1–I5 e I7 en verde; V3 de S-15: toda transacción `PAGO_SERVICIO` tiene exactamente 2 movimientos.

## 8 · Specs que salen de esta HU

| Spec | Qué | Árbitro | Reparto |
|---|---|---|---|
| **S-17-pagos** | Pantalla y entrada `nav-pagos` | CA1–CA8 y la lista de `data-testid` | delegable con el arnés hecho |

## 9 · No-goals

- Agenda de beneficiarios, anulación, pago programado (S-15).
- Campo «verificar cuenta» de ParaBank: S-15 no lo tiene, y agregarlo sería una regla nueva.
- Comprobante PDF (R7), filtros en la lista.
- Hora local chilena (R8).
