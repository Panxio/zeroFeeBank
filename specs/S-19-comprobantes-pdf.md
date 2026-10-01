# S-19 · Comprobantes en PDF (transferencia y boleta)

> Escrita el **2026-09-11**, antes de tocar código. Es el **paso 2** del
> orden de S-10 (`specs/S-10-catalogo.md` § 4.6 y § 5, decisión D-b del humano).
> Candado: `specs/_CANDADO.md`. **Los casos de § 5 se fijan acá y no se tocan después.**

---

## 0 · Por qué

El frontend (S-10, desafíos #12 y #13) necesita un documento real que abrir en una pestaña nueva
y que descargar. D-b: **el PDF lo genera el backend**, con fechas reales, que
salen del reloj inyectado.

## 1 · Qué, qué no, y cuándo está hecho

- **Hace:** tres rutas de lectura que devuelven `application/pdf`:
  `GET /transferencias/:id/comprobante.pdf`, `GET /boletas/:id/comprobante.pdf` y
  `GET /boletas/:id/resumen.pdf`.
- **No hace:** no escribe nada (ni en el ledger ni en otras tablas) · no incluye la hora local
  chilena (la zona horaria de presentación no está decidida; las fechas van en UTC ISO-8601,
  igual que en la API) · no incluye logo ni diseño · no hace URL firmada (podada en § 4.6) ·
  no hace comprobante de pagos (S-15) ni de aperturas.
- **Hecho:** `npm run test:pdf` en verde, `calibrar:pdf` con cada defecto cazado y la batería de
  § 7 sin moverse.

## 2 · Decisiones

### Del humano

| # | Pregunta | Respuesta |
|---|---|---|
| P-a | Librería | **pdfkit 0.20.2** (mantenida; ajusta las líneas sola). Medido: 25 MB / 18 paquetes / 0 vulnerabilidades. Alternativas descartadas: pdf-lib 1.17.1 (sin release desde 2022, no ajusta líneas) y un escritor propio (el escape del texto del usuario pasaría a ser código nuestro) |
| P-b | Dueño del comprobante de transferencia | **Sólo quien la envió** (titular de la cuenta de origen). El destinatario recibe 404 y ve el abono en Movimientos |

### De diseño (discutibles)

| # | Decisión | Porqué |
|---|---|---|
| J1 | El arnés lee el PDF con **unpdf 1.8.1** (pdf.js), devDependency | Es independiente de la generadora: si pdfkit escribe mal, el lector no se lo perdona. El arnés afirma sobre **texto extraído y metadatos**, nunca sobre bytes (salvo el caso de determinismo) |
| J2 | Hay **dos instantes** distintos: el del hecho (en el cuerpo) y el de la emisión del documento (`CreationDate` y `ModDate`, `reloj.ahora()` al servir) | Un comprobante certifica una operación pasada y lleva la fecha de la operación. Si el arnés usara el mismo instante para las dos, un cuerpo fechado con el reloj pasaría en verde |
| J3 | Comprobante de transferencia: sólo transacciones con `concepto = 'TRANSFERENCIA'` | Una emisión de boleta o una siembra también son transacciones. Si se piden por esta ruta, responden 404 |
| J4 | El resumen exige que la boleta tenga **asiento de cierre** (`transaccion_cierre_id` no nulo). Si no lo tiene → `409 BOLETA_NO_CERRADA` | Una boleta VIGENTE vencida por el tiempo que no se ha pasado por `/vencer` aparece como VENCIDA en la API, pero su dinero sigue inmovilizado y no hay fecha de cierre en el ledger. Poner `venceEn` como fecha de cierre sería inventar un asiento que no existe (D2) |
| J5 | El comprobante de emisión de la boleta se sirve **en cualquier estado** | Documenta la emisión, que ocurrió y no cambia |
| J6 | `Content-Disposition`: transferencia `inline` (se abre en el visor), boleta `attachment` | Coincide con § 4.6: pestaña nueva frente a descarga |
| J7 | Mismo pedido con el mismo reloj → **mismos bytes** | C2: nada de azar en el artefacto. pdfkit lo cumple con los metadatos fijados (sondeado en la 27) |
| J8 | Montos con `formatMoney` (decimal con punto, `1234.56`), igual que la API | D1. Cualquier otro formato de presentación es una decisión que no está tomada |

## 3 · Contrato literal

Todas: `Authorization: Bearer <token>`. Sin token → `401 TOKEN_AUSENTE`; token malo → `401
TOKEN_INVALIDO` (errores existentes de `AuthService.yo`).

### `GET /transferencias/:id/comprobante.pdf`
- `200`, `Content-Type: application/pdf`,
  `Content-Disposition: inline; filename="transferencia-<id>-comprobante.pdf"`.
- Texto: id de la transacción, fecha de la operación (`transaccion.creada_en`, ISO UTC con
  milisegundos), id de la cuenta de origen, id de la cuenta de destino, monto.
- `404 TRANSFERENCIA_NO_ENCONTRADA`, **con el mismo cuerpo** en todos los casos: id malformado, id
  inexistente, transacción de otro concepto, transferencia ajena y transferencia recibida (P-b).

### `GET /boletas/:id/comprobante.pdf`
- `200`, `application/pdf`, `Content-Disposition: attachment; filename="boleta-<id>-comprobante.pdf"`.
- Texto: id, cuenta de origen, monto, `emitidaEn`, `venceEn`, RUT y nombre del beneficiario,
  glosa, RUT y nombre del retirador.
- `404 BOLETA_NO_ENCONTRADA` (código existente): malformada, inexistente o ajena, con el mismo cuerpo.

### `GET /boletas/:id/resumen.pdf`
- `200`, `application/pdf`, `Content-Disposition: attachment; filename="boleta-<id>-resumen.pdf"`.
- Texto: todo lo del comprobante, más el estado final (`COBRADA` | `VENCIDA` | `DEVUELTA`, el
  persistido) y la fecha de cierre (`transaccion.creada_en` del asiento de cierre).
- `409 BOLETA_NO_CERRADA` si no hay asiento de cierre (J4). `404 BOLETA_NO_ENCONTRADA` como arriba.

### Metadatos de los tres
`CreationDate` y `ModDate` = `reloj.ahora()` al servir (la precisión del formato PDF es el
segundo). Nunca el reloj de pared, que es lo que pdfkit pone **por defecto** si no se le pasa `info`.

## 4 · Invariantes y casos borde

- **I-lectura:** servir un PDF no escribe: el número de transacciones y movimientos no cambia.
- **I-dueño:** lo ajeno responde igual que lo inexistente (mismo estado y mismo cuerpo).
- **I-reloj:** ninguna fecha del documento sale del reloj de pared.
- Bordes: el texto del usuario (glosa, nombres) con `(`, `)`, `\`, tildes, `ñ` y raya larga
  (validación de la glosa: 1–200 caracteres) debe salir **tal cual** en el texto extraído. Es
  una frontera de confianza: un paréntesis sin escapar rompe el PDF. Boleta vencida por tiempo
  sin `/vencer` (J4). El destinatario pide la transferencia (P-b). El id de una transacción propia
  que no es transferencia (J3).

## 5 · Arnés: `test/comprobantes-pdf.int.spec.ts` (`npm run test:pdf`)

Instantes: `T` (operaciones), `T2` (cierres) y `T3` (servir el documento), todos lejos de hoy y
distintos entre sí. El texto se normaliza colapsando espacios antes del `includes`.

| Caso | Mide |
|---|---|
| Q1 | comprobante de transferencia: estado, cabeceras, `%PDF-`, los 5 valores en el texto, fecha = `T`, metadatos = `T3` |
| Q2 | mismo pedido dos veces → mismos bytes (J7) |
| Q3 | 404 con cuerpo idéntico en 5 variantes (§ 3) |
| Q4 | sin token y token malo → 401 en las tres rutas |
| Q5 | comprobante de boleta con texto hostil (§ 4): 9 valores en el texto, metadatos = `T3` |
| Q6 | el comprobante de boleta se sigue sirviendo después del cobro (J5) |
| Q7 | resumen de una VIGENTE y de una vencida por tiempo sin asiento → 409 `BOLETA_NO_CERRADA` |
| Q8 | resumen de COBRADA, VENCIDA y DEVUELTA: estado, fecha de cierre `T2` del asiento, metadatos = `T3` |
| Q9 | boleta ajena, inexistente o malformada → 404 con cuerpo idéntico, en las dos rutas |
| Q10 | I-lectura: servir los tres documentos no cambia las cuentas de filas de `transaccion` y `movimiento` |

## 6 · Alcance de archivos (conjunto declarado ANTES de implementar)

**Puede crear y modificar**, y nada más:
```
src/modules/comprobantes/**      módulo nuevo: controller, service, errores, plantillas, module
src/app.module.ts                SÓLO para añadir ComprobantesModule a imports
```
**Prohibido tocar** (si algo de acá parece necesario, es un bloqueo):
```
test/** · specs/** · scripts/** · prisma/** · src/domain/** · src/infra/**
package.json · package-lock.json     (pdfkit, @types/pdfkit, unpdf y test:pdf ya están puestos)
src/modules/<cualquier otro>/**      se importan y se usan (AuthService, RelojService, formatMoney)
```
Los dos códigos nuevos (`TRANSFERENCIA_NO_ENCONTRADA` → 404, `BOLETA_NO_CERRADA` → 409) **ya
están en `src/infra/errores-http.filter.ts`**. `BoletaNoEncontradaError` existe en
`src/modules/boletas/boletas.errors.ts` y se importa, no se duplica.

## 7 · Batería que no debe moverse
typecheck 0 · build 0 · `test:domain` 100/100 · guante 6/6 · `test:integracion` 301 + los de este
arnés · invariantes 5/5 · `invariantes:calibrar` 11/11 · `verify:s04` 6/6.

## 8 · Calibración (fijada ANTES de ver la entrega)

Un defecto por vez sobre la entrega, con las dos mitades: los casos declarados en rojo y **el
resto en verde**. Los anclas de texto se adaptan al código que llegue, pero no el defecto ni
los casos que lo cazan. **Un ancla ausente cuenta como defecto no inyectado** (suma al total y
no al aprobado: deuda de `calibrador.sh`).

| # | Defecto inyectado | Debe cazarlo |
|---|---|---|
| K1 | metadatos con la hora de pared | Q1 Q5 Q8 · **Q2 (enmienda post-corrida, ver abajo)** |
| K2 | cuerpo de la transferencia fechado con el reloj al servir, no con `creadaEn` | Q1 |
| K3 | el titular de destino también es dueño | Q3 |
| K4 | sin filtro de concepto | Q3 |
| K5 | sin validar el uuid de la transferencia (malformado llega a Prisma) | Q3 |
| K6 | resumen sin asiento de cierre: imprime `venceEn` en vez de dar 409 | Q7 |
| K7 | fecha de cierre tomada de `venceEn` siempre | Q8 |
| K8 | boleta con `Content-Disposition: inline` | Q5 Q8 |
| K9 | un dato aleatorio en los metadatos | Q2 |
| K10 | servir un PDF escribe una transacción | Q10 |
| K11 | la glosa se «limpia» (sin paréntesis) | Q5 Q8 |
| K12 | boleta sin control de dueño | Q9 |

Q4 (401) y Q6 (J5) no tienen defecto propio: Q4 lo da `AuthService.yo`, que ya calibró S-08,
y Q6 sólo se rompería agregando una regla que prohíba servir, cosa que nadie escribe por error.
Declarado, no escondido.

### 8.1 · Resultado (sobre la entrega)

- **Contra la tabla fijada antes: 11/12.** K1 puso rojo, además de Q1 Q5 Q8, a **Q2**, que no
  estaba declarado.
- Causa verificada en el código, no supuesta: pdfkit arma el `/ID` del archivo con
  `info.CreationDate.getTime()` (`node_modules/pdfkit/js/pdfkit.js:1480`), al milisegundo. Con la
  hora de pared, dos descargas nunca dan los mismos bytes: el rojo de Q2 es **determinista y
  legítimo** (Q2 también ve la hora de pared). Es el mismo tipo que los rojos legítimos no
  declarados de D4/D5 en S-13.
- Enmienda: K1 declara Q2. **Con la tabla enmendada: 12/12.** Los dos números se registran.
