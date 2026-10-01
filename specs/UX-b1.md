# UX-b1 · Id de cuenta abreviado, sin «Transferir» en el resumen, errores sin centavos (unidad UX, segunda mitad, parte 1)

> Estado: **enmendada en F3 (2026-09-24)** con el ataque F2 (§ 10) y D130-6/7/8. **Aprobación en F3
> (D131-1 a D131-4):** D130-4, D130-5, los cuatro literales de § 3.3 y K6–K9. Lista para F4a.
> Decisiones de origen: tabla UX-b del humano (filas O4, O5 y Errores) y decisiones D130.
> Ataque F2 (26 ciertos, 0 falsos): los `#n` de esta spec son sus filas.

## 1. Qué, qué no, y cuándo está hecho

**Qué hace.** Tres filas de UX-b:
- **O5**: se quita el botón «Transferir» (`ir-transferir`) del resumen de cuentas. A Transferir se
  sigue llegando por la barra (`nav-transferir`).
- **O4**: todo id de cuenta de zeroFeeBank que se muestra en pantalla se muestra **abreviado** (§ 3.2),
  con una excepción escrita (D130-7); el id completo sigue en `data-cuenta-id` (o en `value` en los
  `<option>`) y en el nombre accesible.
- **Errores**: los tres códigos cuyo `mensaje` del backend trae centavos crudos y que el front puede
  recibir, más `MISMA_CUENTA`, cuyo `mensaje` trae el id completo (D130-6), se muestran con un texto
  del front, **sin cifras** (§ 3.3).

**No-goals (quedan fuera, a propósito):**
- **O2** (pestañas de Boletas): es UX-b2, spec propia (D130-3).
- **Ningún cambio de backend ni de API.** El cuerpo de error sigue siendo `{ codigo, mensaje }`
  (`src/infra/errores-http.filter.ts:31-36`); no se agregan `detalles` (D130-2).
- **Los PDF de comprobante** conservan el id completo: no son pantalla, y tocarlos es backend (D130-8).
- **El número de cuenta de otro banco** (`destinoNumero`, modo banco) no es un id de zeroFeeBank: no se
  abrevia (#24).
- **Ninguna cifra en los textos de error**: ni el tope, ni el mínimo, ni saldos. La pista estática
  «Máximo 200,00 USD por día (UTC)» de `web/src/app/app.html:566` ya existe y no se toca.
- Los códigos que no están en la tabla de § 3.3 se siguen mostrando como hoy (su `mensaje` no trae
  montos ni ids: recorrido de los 59 códigos). Movimientos ya arma su
  texto en el front (`mensajeErrorMovimientos`) y no cambia.
- Préstamos no tiene pantalla (`grep -c prestamo web/src/app/app.html` → 0): sus códigos con centavos
  quedan fuera.
- El botón «Copiar» del resumen (`cuenta-copiar-id`) sigue copiando el id **completo**; el campo
  donde se teclea un id de destino en Transferir sigue aceptando el id completo.
- No se renombra ni se agrega ningún testid. Se **quita** uno: `ir-transferir` (§ 5).

**Criterio de hecho:** (a) `verificar:ux-b1` **N/N** sobre el artefacto entregado; (b) su línea base
sobre `main` salió con **exactamente** los rojos pre-registrados de § 7.1; (c) los brazos enmendados de
§ 5 en verde, y la mitad roja de § 7.2 cazada por `calibrar:ux-b1` **9/9 exactos**; (d) la batería de
§ 8 con su número real, incluidos los calibradores re-anclados; (e) aprobación en vivo
(respuesta + captura) lo que sólo el ojo mide (§ 6.2).

## 2. Decisiones que esta spec aplica

| # | Decisión | Fuente |
|---|---|---|
| UX-b | Filas O4, O5 y Errores de la tabla UX-b | — |
| D130-1 | O4: los árbitros que hoy exigen el id completo en el texto visible (**E3** de `verificar:s10-t2/t3/t4`, **L4** de `verificar:s17-boletas`, **P7** de `demo:m6`) **se enmiendan**: comparan el atributo contra el id del API y el texto contra la abreviatura. Deja sin efecto el «L4 no cambia» anterior, que suponía que L4 leía sólo el atributo | — |
| D130-2 | Errores: texto del front **sin cifras**; nada de backend | — |
| D130-3 | UX-b se parte: **UX-b1** (esta) y **UX-b2** (O2) | — |
| D130-6 | `MISMA_CUENTA`: 4.º texto literal del front, **sin id**, en § 3.3, con brazo M5 | #1 |
| D130-7 | Destino tecleado en modo «otra cuenta»: **completo en Revisar** (la persona comprueba lo que tecleó antes de una transferencia irreversible) y abreviado en éxito. Excepción escrita a O4 | #17 |
| D130-8 | Los PDF de comprobante no son pantalla: conservan el id completo; no-goal | #18 |
| D133-1 | `boleta-cuenta`: el **tipo va fuera del `aria-hidden`** (texto normal, lo lee el lector); el hijo `aria-hidden` lleva sólo `abreviar(id)`. Con el contrato de F3 el lector perdía «Corriente/Ahorro» (la tabla no tiene columna de tipo). `formatearCuenta` devuelve sólo el tipo: su línea `const tipo` (ancla K10) no se toca. Enmienda A5 (y «Elementos de texto» para este nodo) y L4: hijo `aria-hidden` == `abreviar(id)`; texto fuera del `aria-hidden` y del `.sr-only` == tipo | auditoría de F4b |

**Decisiones aprobadas en F3 (D131-1, D131-2; los literales D131-3; K6–K9 D131-4):**
- **D130-4 · forma de la abreviatura**: `…` (U+2026) seguido de los **6 últimos** caracteres del id
  (§ 4, constante). Se toma el final y no el principio porque es la convención de las cuentas
  bancarias («terminada en …»). Un id de **6 caracteres o menos**, o vacío, se muestra tal cual (#21).
- **D130-5 · alcance de Errores = 4 códigos** (§ 3.3): los tres que el front puede recibir con montos
  en el `mensaje` (verificado sobre los 59 códigos) más `MISMA_CUENTA` por el id (D130-6).
  Dos de ellos ya se habían observado. Un catálogo del front para **todos** los códigos
  es más texto que aprobar y va en una unidad aparte.

## 3. Comportamiento

### 3.1 O5
En el Resumen (`vistaActual = 'resumen'`, estado listo) no existe ningún elemento con
`data-testid="ir-transferir"` ni el botón `.boton-transferir-resumen`. La regla CSS
`.boton-transferir-resumen` (`web/src/styles.css:476-490`) y el manejador `alActivarTransferir`
se quitan si quedan sin uso (`grep` → 0 usos). `nav-transferir` sigue llevando a `transferir-pasos`
(en el teléfono, tras abrir `nav-hamburguesa`).

### 3.2 O4 — dónde y cómo
Abreviatura: `abreviar(id) = id.length > LARGO_ID_CORTO ? '…' + id.slice(-LARGO_ID_CORTO) : id`
(D130-4, #21). Se aplica en **todos** estos lugares (inventario: mapa § 2.1, `web/src/app/app.html`
a la fecha de `main`):

| Lugar | Hoy | Contrato |
|---|---|---|
| Resumen, `cuenta-id` (`:233`) | `{{ cuenta.id }}` | «Elementos de texto» |
| Selectores de cuenta: Transferir origen (`:431`), destino propia (`:498`), Boletas emitir (`:882`), Abrir cuenta origen (`:1034`), Movimientos (`:1093`), Pagos (`:1260`) | `Tipo <id> · $ saldo` | «Opciones» |
| Transferir, Revisar: origen (`:612`); destino en modo **propia** (`:640`) | id completo en `<dd>` | «Elementos de texto» |
| Transferir, Revisar: destino en modo **otra** (`:640`, `destinoFinal`, `app.ts:324-335`) | id tecleado completo | **sin cambio: completo** (D130-7) |
| Transferir, éxito: origen y destino en modos **propia** y **otra** (`:294`, `:296`), origen en modo banco (`:331`) | id completo en `<dd>` | «Elementos de texto» |
| Boletas, `boleta-cuenta` (`:796`, `formatearCuenta`) | `Tipo <id>` | «Elementos de texto» |
| Pagos, `pago-origen` (`:1400-1401`) | id completo | «Elementos de texto» |

- **Elementos de texto:** el texto **visible** es la abreviatura (con el tipo delante donde hoy lo
  hay). El id completo va en un hijo `.sr-only` (clase existente, `web/src/styles.css:684`) y la
  abreviatura en un hijo con `aria-hidden="true"`: el lector de pantalla lee el id completo, el ojo
  ve el corto. **Fuera del `.sr-only` no hay ningún nodo de texto que contenga el id completo** (#6).
  Donde hoy hay `data-cuenta-id` se conserva con el id completo; en `cuenta-id` y en los `<dd>` de
  Revisar y éxito **se agrega** `data-cuenta-id` con el id completo (no es un testid: C3 no aplica).
  **Excepción `boleta-cuenta` (D133-1):** el tipo va **fuera** del `aria-hidden`, como texto que
  el lector lee; el hijo `aria-hidden` lleva sólo `abreviar(id)`. Plantilla:
  `{{ formatearCuenta(id) }} <span aria-hidden="true">{{ abreviar(id) }}</span><span class="sr-only">{{ id }}</span>`.
- **Opciones (`<option>`):** `value` = id completo (sin cambio); texto = `Tipo …xxxxxx · $ saldo`
  (o sin saldo donde hoy no lo hay); `aria-label` = el mismo texto con el id **completo**. El
  placeholder de `value=""` (`:1031`, `:1090`) no cambia.
- **Una sola función** de abreviar en `app.ts`; ninguna plantilla corta el id por su cuenta.
- En `formatearCuenta` (`app.ts:1462-1466`) la línea `const tipo = c?.tipo === 'AHORRO' ? …` **no se
  toca**: es el ancla de K10 de `calibrar:s17-boletas` (#16). ~~La abreviatura va en el `return`.~~ Tras D133-1 el `return` devuelve sólo `tipo`; la
  abreviatura la pone la plantilla, dentro del `aria-hidden`.

### 3.3 Errores
Una función del front `textoError(codigo, mensaje)` devuelve el texto de la tabla para esos cuatro
códigos y `mensaje` para el resto; los respaldos que hoy existen para un `mensaje` vacío (`:743`,
`:1000`) se conservan (#20). La usan **todas** las zonas de error que hoy pintan `err.mensaje`
(ventanilla `:36`, transferir `:659`, boletas acción `:743`, emitir `:859`, abrir cuenta `:1000`, pagos
`:1226`, contacto `:1471`); ninguna plantilla pinta `err.mensaje` sin pasar por ella (#19, brazo S1).
`data-codigo`, los testids de error y el `<p>` que en Pagos y Contacto pinta el código no cambian.

| Código | Texto literal (se muestra tal cual) | Dónde puede aparecer |
|---|---|---|
| `FONDOS_INSUFICIENTES` | `El saldo disponible de la cuenta de origen no alcanza para este monto.` | Transferir, emitir boleta, abrir cuenta, pagos |
| `MONTO_APERTURA_INSUFICIENTE` | `El monto de apertura es menor al mínimo requerido para abrir una cuenta.` | Abrir cuenta |
| `TOPE_DIARIO_EXCEDIDO` | `Este monto supera el tope diario de transferencias a otros bancos para la cuenta de origen.` | Transferir (modo banco) |
| `MISMA_CUENTA` | `La cuenta de destino no puede ser la misma que la cuenta de origen.` | Transferir (modo otra: el id tecleado es el de origen; en modo propia el origen no se ofrece). Lo lanza también el ledger (`src/domain/ledger/ledger.ts:39`): cualquier otra zona que lo reciba pasa igual por `textoError` |

Ninguno de los cuatro literales lleva dígitos: es lo que permite a M1–M5 afirmar «zona sin dígitos» (#5).

## 4. Constantes

| Constante | Valor | Por qué |
|---|---|---|
| `LARGO_ID_CORTO` | `6` | 16⁶ ≈ 16,7 millones de sufijos: con 5 cuentas por titular la probabilidad de que dos se vean iguales es ≈ 6·10⁻⁷; el id completo siempre está en «Copiar» y en el nombre accesible |
| prefijo | `…` (U+2026, un carácter) | un solo carácter; tres puntos ASCII se confunden con texto |
| Textos de § 3.3 | literales de la tabla | aprobados en F3; el árbitro los compara exactos |

## 5. Enmiendas a árbitros existentes (D130-1, O5)

**En F4a** (sin tocar la app):

| Árbitro · brazo | Hoy afirma | Tras la enmienda afirma |
|---|---|---|
| `verificar:s10-t2` E3 (`:475`), `s10-t3` E3 (`:511`), `s10-t4` E3 (`:588`) | texto de `cuenta-id` == id del API | `data-cuenta-id` de `cuenta-id` == id del API **y** texto del hijo `aria-hidden` == `abreviar(id)` **y** `.sr-only` == id |
| `verificar:s17-boletas` L4 (`:805-812`) | texto contiene tipo e id completo | texto del hijo `aria-hidden` (**no** el `textContent` del nodo, que siempre contiene el `.sr-only`: #3) contiene tipo y `abreviar(id)` y **no** el id completo; `data-cuenta-id` sin cambio. **D133-1:** texto del hijo `aria-hidden` == `abreviar(id)`; texto del nodo **fuera** del `aria-hidden` y del `.sr-only`, recortado, == tipo; ningún texto fuera del `.sr-only` contiene el id completo |
| `demo:m6` P7 (`:278-282`) | texto de `cuenta-id` == id | igual que E3 |
| `verificar:s10-t3` V2 (`:904-919`), `s10-t4` V2 (`:981-996`) | `ir-transferir` visible y lleva a `transferir-pasos` | `ir-transferir` **ausente** en Resumen listo **y** `nav-transferir` lleva a `transferir-pasos` |

**En F4b, junto con la baja del botón** (#10, #11): quitar `ir-transferir` de una lista la hace caer en
**toda** suite cuya `UNION` o exención la lea (R1 de t2/t3/t4, N1 de `verificar-s17-transferir.mjs:131`,
N4 de `verificar-s17-abrir-cuenta.mjs:49`). Si se enmendara en F4a, la línea base sobre `main` tendría
rojos de transición; por eso se mueve con el cambio de la app. Es la **única** excepción a «F4b no toca
los árbitros», y se limita a estos archivos:
- `specs/S-10-testids-T3.txt:49` y `S-10-testids-T4.txt:49`: sin `ir-transferir`; el encabezado de la
  sección `# Anfitriona · navegación hacia Transferir (2)` pasa a `(1)` y el total de la cabecera baja
  en uno. Registro de cambios en **el formato de bloque** de `S-17-testids-contacto.txt:6-8` (#23):
  `#   - se quita ir-transferir (O5, UX-b1); a Transferir se llega por nav-transferir.`
- `specs/S-10-frontend.md:39` y `specs/S-10-T3-transferir.md:14,72,137`, que siguen definiendo
  `ir-transferir` (#22): nota de que UX-b1 lo retira, sin reescribir la historia.

Nada más se toca en esos árbitros. Los demás `verificar:*` que nombran `cuenta-id`, `pago-origen` o los
`<option>` leen el atributo o sólo el tipo (`verificar-s17-abrir-cuenta.mjs:556` A5 busca «Corriente»/
«Ahorro»): no cambian (re-verificado en F3 con `grep` sobre `textContent|innerText`). Ningún árbitro
compara el texto de un error con el `mensaje` del backend.

## 6. Árbitro nuevo: `verificar:ux-b1`

### 6.1 Brazos
**Montaje (#2):** estado desde `/__test__/reset` y **por la API pública**, como lo hacen
`verificar:s17-transferir`, `s17-abrir-cuenta` y `s17-pagos` para esos mismos códigos: registro,
apertura de cuentas, transferencias, pagos (Pagos exige un `POST /pagos` previo para que exista
`pago-origen`) y el reloj de la costura. `/__test__/seed` sólo para `boletas-en-cada-estado` (A5).
Nunca la BD. Si un escenario no se puede montar así, F4a **se detiene y escala**; no se agrega costura.
Esperas por estado (C4), nunca por tiempo.

**Preparación (#7):** todo brazo «para cada» afirma primero que el conjunto no está vacío y que su
tamaño es el del API (filas == cuentas del API, ≥ 1; opciones con UUID == cuentas del API). Un
conjunto vacío es ROJO de preparación, nunca verde.

**«Elementos de texto» cumplido** significa, sobre el nodo: `data-cuenta-id` == id; texto del hijo
`aria-hidden="true"` == `abreviar(id)` (con el tipo delante donde corresponde, **salvo `boleta-cuenta`**
por D133-1: ahí el hijo `aria-hidden` == `abreviar(id)` y el texto del nodo fuera del `aria-hidden` y del
`.sr-only`, recortado, == tipo); el hijo `.sr-only`
tiene texto == id, **clase `sr-only` y `clip`/`clip-path` computado que recorta** (#25); y ningún nodo de
texto fuera del `.sr-only` contiene el id completo (#6).

| Brazo | Afirma |
|---|---|
| X1 | Resumen listo: 0 elementos `ir-transferir` (escritorio y teléfono); `nav-transferir` lleva a `transferir-pasos` (en el teléfono, tras abrir `nav-hamburguesa`, molde `verificar-s10-t4.mjs:829-830`) (#9) |
| A1 | Resumen, con 2 cuentas: cada `cuenta-id` cumple «Elementos de texto» |
| A2 | Los seis selectores de § 3.2, con 2 cuentas (destino propia las exige, #8): cada `<option>` cuyo `value` es un UUID tiene `value` == id del API, `textContent` con `abreviar(id)` y sin el id completo, y atributo `aria-label` con el id completo. Se lee `textContent` y el atributo, no roles (`getByRole('option')` usa el `aria-label`, #26) |
| A3 | Transferir en modo **propia**, Revisar y éxito: los `<dd>` de origen y destino cumplen «Elementos de texto» |
| A3o | Transferir en modo **otra** (D130-7): en Revisar el `<dd>` de destino muestra el id tecleado **completo**; en éxito, origen y destino cumplen «Elementos de texto» |
| A4 | Transferir a otro banco, éxito: el `<dd>` de origen cumple «Elementos de texto»; el número del otro banco se muestra tal cual (#24) |
| A5 | `boleta-cuenta` y `pago-origen`: cumplen «Elementos de texto» |
| M1 | Transferir con monto mayor al saldo: zona `transferir-error[data-codigo=FONDOS_INSUFICIENTES]` |
| M2 | Abrir cuenta bajo el mínimo: zona `abrir-cuenta-codigo-error[data-codigo=MONTO_APERTURA_INSUFICIENTE]` |
| M3 | Transferir a otro banco sobre el tope diario: `transferir-error[data-codigo=TOPE_DIARIO_EXCEDIDO]` |
| M4 | Pagos con monto mayor al saldo: `pagos-error[data-codigo=FONDOS_INSUFICIENTES]` (segunda pantalla, misma función) |
| M5 | Transferir en modo otra con el id de origen tecleado: `transferir-error[data-codigo=MISMA_CUENTA]` |
| S1 | Estático, sobre `web/src/app/app.html` del artefacto: 0 ocurrencias de `err.mensaje` fuera de una llamada a `textoError(` (#19) |

**M1–M5 afirman, las tres cosas (#4, #5):** (1) `data-codigo` == código; (2) el **nodo de mensaje** ==
literal de § 3.3 — el único `<p>` de la zona, salvo en Pagos, donde es `.pagos-mensaje-error` (el otro
`<p>`, `pagos-codigo-error`, pinta el código); (3) el `innerText` de **toda la zona** no contiene dígitos
ni el id completo. El (3) es el que caza que se pinte además `err.mensaje`.

### 6.2 Qué no mide el árbitro (lo mide la revisión en vivo, F6)
Que la abreviatura se lea bien en cada pantalla y en el teléfono; que el Resumen sin el botón no
quede con un hueco; que los cuatro textos de error se entiendan; y que FONDOS en emitir boleta y abrir
cuenta, y la ventanilla, se vean bien: no tienen brazo propio; los cubre S1 más el ojo (#19).

## 7. Calibración

### 7.1 Línea base roja pre-registrada (sobre `main`, sin UX-b1)
- **ROJOS esperados:** X1, A1, A2, A3, A3o, A4, A5, M1, M2, M3, M4, M5, S1 (13).
- **VERDES esperados:** ninguno. (En A3o, la mitad «Revisar completo» ya se cumple en `main`; el brazo
  cae por la mitad de éxito. Esa mitad verde sólo se ve roja bajo K9.)
Si un rojo pre-registrado sale verde, el brazo está ciego: se arregla el brazo antes de implementar,
nunca se mueve la predicción. Si sale rojo por otro motivo que el declarado (p. ej. no pudo montar el
escenario), igual.
Los brazos enmendados de § 5 en F4a, corridos sobre `main`, también deben dar rojo (E3 ×3, L4, P7,
V2 ×2) y **nada más** debe caer en esas suites: las listas no se tocan hasta F4b (#11).

### 7.2 Defectos sobre el código ya arreglado (`calibrar:ux-b1`)

Suites que corre el calibrador: `verificar:ux-b1` y `verificar:s10-t2`/`t3`/`t4` (sólo las que la K
nombra). La columna «también caería» es predicción **declarada y no calibrada aquí**: su suite no entra
por costo (L4 vive en un árbitro de ~46 min; `demo:m6` y `s17-*` son largos). Su mitad roja es la de
§ 7.1 sobre `main` (L4, P7) o queda sin calibrar y se dice (N1, N4).

| K | Defecto | Cae en el calibrador, y sólo eso | También caería (no se corre) |
|---|---|---|---|
| K1 | devolver el botón `ir-transferir` al Resumen | X1; V2 de t3 y t4; R1 de t2, t3 y t4 (#12) | N1 `s17-transferir`, N4 `s17-abrir-cuenta` |
| K2 | que `cuenta-id` muestre el id completo como texto visible | A1; E3 de t2, t3 y t4 | P7 `demo:m6` |
| K3 | `LARGO_ID_CORTO` = 4 | A1, A2, A3, A3o, A4, A5; E3 de t2, t3 y t4 | L4, P7 |
| K4 | quitar el `aria-label` de las `<option>` | A2 | — |
| K5 | que `textoError` devuelva `mensaje` para `FONDOS_INSUFICIENTES` | M1, M4 | — |
| K6 | pintar además `err.mensaje` en `transferir-error` (#5) | M1, M3, M5, S1 | — |
| K7 | quitar el recorte (`clip`) de `.sr-only` (#25) | A1, A3, A3o, A4, A5 | — |
| K8 | que `textoError` devuelva `mensaje` para `MISMA_CUENTA` | M5 | — |
| K9 | abreviar también el destino tecleado en Revisar, modo otra (D130-7) | A3o | — |

Si al fijar un ancla la K cae en algo más que lo declarado (p. ej. K7 en un brazo de `ux-a`), se escala
con el resultado a la vista; no se estrecha la K a escondidas. Las anclas literales de K1–K9 se fijan
**leyendo la entrega de F4b y antes de la primera corrida**, y se commitean antes de correr (molde
UX-a § 7.2). Denominador fijo 9; ancla ausente o repetida = NO CAZADO. Salida
`calibrar:ux-b1: X/9 defectos con el resultado EXACTO`, exit 0 sólo con 9/9.

### 7.3 Anclas de otros calibradores que UX-b1 rompe (#14, #15; re-verificado en F3)
Cambiar `{{ c.id }}` en los `<option>` y agregar su `aria-label` deja sin ancla a estas K ajenas:

| Calibrador | K | Ancla (líneas del script a la fecha) |
|---|---|---|
| `calibrar:s17-transferir` | K1, K2, K3, K4 | `calibrar-s17-transferir.sh:202-245` |
| `calibrar:s17-abrir-cuenta` | K1b | `calibrar-s17-abrir-cuenta.sh:160` |
| `calibrar:s17-boletas` | K49 | `calibrar-s17-boletas-defectos-b.sh:426-428` |
| `calibrar:s17-pagos` | K4, K20 | `calibrar-s17-pagos.sh:432-433, 555-556, 1080-1081, 1237-1238` |
| `calibrar:s17-movimientos` | K8 | `calibrar-s17-movimientos.sh:337-338, 401-402` |

Se re-anclan en **F4c**, después de F4b: la K conserva **la misma mutación** (el mismo defecto sobre el
texto nuevo) y su mismo brazo declarado; el diff se audita. **Aplicado en F4c:** pagos
K4/K20 traían además `{{ err.mensaje }}`, que F4b cambió a `textoError(...)`: el ancla nueva lo trae
(misma mutación) · abrir-cuenta K1b sigue mutando los 6 selectores (D135-1).
Si una K re-anclada da un resultado
distinto del que tenía, se escala: no se ajusta. La K M5 de `calibrar:s10-t3` (`calibrar-s10-t3-defectos-a.sh:42-43,
68-69`) **ya está sin ancla hoy** (`Corriente {{ c.id }}` no existe en `main`): deuda previa, no de UX-b1;
se declara y no se arregla aquí.

## 8. Batería de cierre (número real, el día del merge)
`verificar:ux-b1` · `calibrar:ux-b1` · `verificar:s10-t2..t4` · todos los `verificar:s17-*` ·
`verificar:ux-a` · `calibrar:ux-a` · `calibrar:s17-boletas` (desatendido; **52/54** esperado con K49
re-anclada; sin re-anclar daría 51/54, #14) · `calibrar:s17-transferir`, `calibrar:s17-abrir-cuenta`,
`calibrar:s17-pagos`, `calibrar:s17-movimientos` (re-anclados en F4c; el número esperado de cada uno
se escribe aquí antes de correr) ·
`capturas:s17-*` · `demo:m6` · `test:domain` · `test:integracion` · `invariantes` · `guante` ·
typecheck · build.

## 9. Fases

| Fase | Quién | Entrega |
|---|---|---|
| F2 | — | ataque a esta spec y a sus árbitros (hecho, § 10) |
| F3 | — | enmienda (esta) + aprobación (D130-4, D130-5 y los cuatro textos de § 3.3) |
| F4a | — | `verificar:ux-b1` + enmiendas de § 5 (tabla F4a) + línea base § 7.1 (sin tocar la app) |
| F4b | — | la app + las listas y specs de § 5 (tabla F4b); prohibido tocar cualquier otro árbitro y la línea ancla de K10 (§ 3.2) |
| F4c | — | `calibrar:ux-b1` + re-anclar las K de § 7.3 |
| F5 | — | batería § 8 |
| F6 | — | revisión en vivo, respuesta + captura |

## 10. Registro del ataque (F2) y de la enmienda (F3)

**Ataque 1** (583 s) y **Ataque 2** (tope de 2400 s, **sin doble check**).
**26 ciertos, 0 falsos**; 12 en común, 12 sólo del Ataque 2, 4 sólo del Ataque 1.

**Aplicados, por sección:** § 1 — #18 (D130-8), #24 · § 2 — #1 (D130-6), #17 (D130-7), #21 (D130-4) ·
§ 3.2 — #6, #16, #17, #21, #24 · § 3.3 — #1, #5, #19, #20 · § 5 — #3, #10, #11, #22, #23 · § 6.1 —
#2, #4, #5, #6, #7, #8, #9, #25, #26 · § 6.2 — #19 · § 7.1 — #10, #11 · § 7.2 — #12, #13 (dos columnas),
más K6–K9 para calibrar #5, #25, D130-6 y D130-7 · § 7.3 y § 8 — #14, #15.

**Re-verificado en F3:** #15 venía marcado C (citado); se midió con `grep` y es **más ancho** que
lo citado: 10 K en 5 calibradores (§ 7.3). La M5 de `calibrar:s10-t3` ya estaba sin ancla antes de UX-b1.
#9 (hamburguesa) sigue C: las dos entradas coinciden y el molde existe (`verificar-s10-t4.mjs:829-830`).

**Hallazgo adicional:** #11 (N1 y N4 también caen al quitar el testid de la lista).
