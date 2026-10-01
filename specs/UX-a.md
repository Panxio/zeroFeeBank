# UX-a · Ajustes visuales sin contrato (unidad UX, primera mitad)

> Estado: **enmendada tras el ataque (2026-09-24)**; pendiente de aprobación.
> Decisiones de origen: las 8 filas de UX-a de las observaciones del humano.

## 1. Qué, qué no, y cuándo está hecho

**Qué hace.** Ocho arreglos de pantalla: O1 (campo Monto de
Transferir con un solo borde), O3/U4 (botonera de la tabla de Boletas), U1 (monto de Boletas en
una línea), U2 (encabezado «Signo» → «Tipo» en Movimientos), U3 (formato del RUT al salir del
campo en emitir boleta), U5 (separación de «Resumen»/«Abrir cuenta» en el menú del teléfono), U6
(presentación del comprobante PDF de la boleta) y s64 (el selector de cuenta de emitir boleta
muestra el saldo vigente).

**No-goals (quedan fuera, a propósito):**
- Nada de UX-b: pestañas de Boletas (O2), id de cuenta abreviado (O4), botón «Transferir» del
  resumen (O5), textos de error armados en el front.
- **Ningún testid nuevo, renombrado ni quitado**; ninguna lista `specs/*testids*.txt` cambia.
- **Ningún cambio de API** (rutas, cuerpos, códigos). U6 toca `pdf.ts` del backend, pero sólo la
  presentación del documento; el endpoint y su contrato no cambian.
- U3 **no** valida el RUT en el cliente (J1 de `specs/S-17-boletas.md` sigue vigente) y **no** toca
  el campo `ventanilla-rut` de la ventanilla pública (VT10 exige que viaje lo escrito).
- **O3/U4, U1 y U5 son sólo CSS**: no se reformatea `web/src/app/app.html:804-829` (bloque de botones,
  anclas de K30/K48 de `calibrar:s17-boletas`) ni `:104-115` (menú; anclas de otros calibradores,
  mapa § 6.5). D3.
- Ningún brazo existente se enmienda en su aserción. La única edición permitida a un árbitro
  existente es el **texto del ancla** de K18/K20 en el calibrador de S-17-movimientos
  (`Signo` → `Tipo`), sin cambiar qué defecto inyectan ni qué brazo esperan (§ 7.3).

**Criterio de hecho:** (a) `verificar:ux-a` **N/N** en verde sobre el artefacto entregado; (b) su
línea base sobre el código de hoy salió con **exactamente** los rojos pre-registrados de § 7.1;
(c) `calibrar:ux-a` **3/3 exactos**; (d) la batería de § 8 en verde con su número real; (e)
aprobación en vivo (respuesta + captura) de lo que sólo el ojo mide (§ 6.3).

## 2. Decisiones que esta spec aplica

| # | Decisión | Fuente |
|---|---|---|
| origen | Las 8 filas de UX-a, tal cual | — |
| D125-1 | U3 formatea **sólo** un valor compuesto únicamente de dígitos + DV, sin guion, sin puntos y sin espacios. Todo otro valor queda como está escrito. J1 y E8 no cambian | choque U3 ↔ J1/E8 detectado en el mapa (§ 5.5) |
| D125-2 | U6: la fecha del PDF **sigue en ISO completo** y se rotula «(UTC)». Q5/Q6/Q8 de `test:pdf` no cambian | choque U6 ↔ `test:pdf` (mapa § 7.5) |

**Decisión de implementación:** D125-3 · s64 se arregla releyendo `GET /cuentas`
**cada vez que se relee la lista de boletas** tras una acción del titular (J10): emitir, devolver y
liberar mueven saldo, así que las tres dejan el selector rancio por la misma causa. Si el alcance se
reduce a «tras emitir», se quita el brazo S64b.

## 3. Comportamiento, fila por fila

**O1.** En Transferir, el campo Monto es **una sola caja**: el contenedor `.con-prefijo` conserva su
borde; el `input#transferir-monto` tiene borde de ancho 0 y sin contorno propio. Con el foco en el
input, el **contenedor** muestra el anillo (`:focus-within`, hoy `web/src/styles.css:883-889`) y el
input no dibuja otro. Causa medida: `.campo input[type="text"]` (`styles.css:1476`, especificidad
0,2,1) le gana a `.con-prefijo input` (`styles.css:903`, 0,1,1) y le devuelve el borde. `.con-prefijo`
hoy aparece una sola vez en `app.html`; el arreglo vale para cualquier `.con-prefijo` futuro.

**O3/U4.** Tabla de Boletas, celda de acciones:
- **Escritorio:** los botones de una fila quedan **en una sola línea**, con el mismo alto, alineados
  arriba, con la **misma separación** entre botones consecutivos en todas las filas; el texto de
  cada botón no se parte («Liberar fondos» incluido). La celda crece lo necesario.
- **Teléfono:** los botones de una fila se **apilan en columna**, con el mismo ancho y el mismo borde
  izquierdo, sin solaparse.
- `.celda-acciones` la usa también el Resumen (botón copiar, `app.html:241`): el cambio **no** puede
  alterar la celda del Resumen (se limita a la tabla de boletas).

**U1.** La celda Monto de la tabla de Boletas (`boleta-monto`) no se parte: «$» y la cifra en una
línea, en escritorio y en teléfono (mismo remedio que `.pago-monto`).

**U2.** El encabezado de la columna de Movimientos que hoy dice «Signo» dice «Tipo». Las celdas y
`data-signo` no cambian.

**U3.** En emitir boleta, los campos `emitir-beneficiario-rut` y `emitir-retirador-rut`:
- **Al salir del campo** (blur), si el valor **completo** calza con `^[0-9]{1,8}[0-9kK]$`, se
  reescribe como `cuerpo con puntos de miles` + `-` + `DV en mayúscula`
  (`123456785` → `12.345.678-5`; `98765433` → `9.876.543-3`; `11` → `1-1`; `12345678k` → `12.345.678-K`).
- **Cualquier otro valor queda intacto** (con guion, con puntos, con espacios, vacío, con letras,
  10 o más caracteres).
- **No se formatea mientras se escribe.**
- Casos borde declarados (ataque, § 10): un cuerpo con ceros a la izquierda que calce se formatea
  tal cual (`012345678` → `01.234.567-8`; el backend quita los ceros, `rut.ts:47`), sin quitarlos en
  el cliente (H-14). Un valor ya formateado que se edita tiene guion, así que queda como se escribió,
  `k` minúscula incluida (H-13; es D125-1).
- Lo que se envía es lo que el campo muestra (J1). No se valida el dígito: `123456789` se formatea
  a `12.345.678-9` y el API responde `400 RUT_INVALIDO` como hoy.
- Constante `1..8` dígitos de cuerpo: es el rango que acepta el backend (`src/domain/rut/rut.ts:47-50`);
  uno más largo no se toca y el API lo rechaza. El backend acepta puntos (`rut.ts:38-42`, brazo A5).

**U5.** En el menú del teléfono, la separación vertical entre «Resumen» y «Abrir cuenta» es la
misma que entre dos opciones consecutivas del resto del menú (hoy 0 px contra 20 px, mapa § 6.2).

**U6.** Los dos PDF de boleta (comprobante y resumen, `src/modules/comprobantes/plantillas/pdf.ts`):
encabezado con el texto «zeroFeeBank»; pares rótulo/valor alineados; el id de la boleta destacado;
cada rótulo de fecha termina en «(UTC)» y el valor sigue siendo el ISO completo
(D125-2). Sin logo (no hay uno en el repo). Los demás PDF (transferencias) no se tocan.

**s64.** Tras emitir (y, por D125-3, tras devolver o liberar) con éxito, las opciones del selector
`emitir-origen` muestran el saldo que devuelve `GET /cuentas` en ese momento. Si esa relectura
falla, el selector conserva la lista anterior (no se inventa saldo); este caso **no tiene brazo** y
se declara como no cubierto.

## 4. Constantes

| Constante | Valor | Por qué |
|---|---|---|
| Escritorio | 1280 × 800 | el que usan los scripts de captura existentes |
| Teléfono | 390 × 844 | ídem; es donde se vieron O3 y U5 |
| Tolerancia geométrica | 1 px | redondeo de subpíxel entre motores; no absorbe un defecto real (el menor medido es 20 px) |
| Patrón de U3 | `^[0-9]{1,8}[0-9kK]$` | D125-1 + rango del backend (§ 3) |
| Escenario de Boletas | `boletas-en-cada-estado` (`specs/S-23-boletas-seed.md`) | trae las 5 filas, así aparecen los 4 botones posibles |

## 5. Invariantes

- La lista de testids renderizados de cada pantalla es **idéntica** antes y después (los árbitros
  existentes lo miran con sus listas).
- El cuerpo del `POST /boletas` es siempre el valor visible del campo (J1): U3 cambia el valor
  visible, nunca agrega una transformación entre el campo y el envío.
- Ningún cambio del ledger ni de la BD (UX-a no toca `src/domain`, `prisma/` ni las costuras).

## 6. Árbitro nuevo: `verificar:ux-a`

Script Playwright nuevo (`scripts/verificar-ux-a.mjs` + `.sh`, molde de `verificar-s17-boletas`),
que levanta el API y la web como los demás, parte de `reset` + `seed`, y **mide sobre la página
renderizada** (estilo computado y geometría), nunca sobre el código fuente. Salida: una línea por
brazo `OK|ROJO <id> · <motivo con los números medidos>` y al final `verificar:ux-a: X/N`.

### 6.1 Brazos

| Brazo | Mide | Verde si |
|---|---|---|
| O1a | estilo computado de `#transferir-monto` | los 4 `border-*-width` = 0 **y** el contenedor `.con-prefijo` tiene borde > 0 |
| O1b | foco por teclado en el input | contenedor con `outline-style` ≠ none y `outline-width` ≥ 2 px; el input con `outline-style` none o ancho 0 y bordes 0 |
| O3a | escritorio, **todas** las filas de `boletas-tabla` (también las de un solo botón, H-10) | en cada botón: texto en **una** línea (los `getClientRects()` de un `Range` sobre su texto comparten un único `top`, ±1) **y sin recorte** (`scrollWidth ≤ clientWidth`, H-02); botón dentro del rectángulo de su celda. En filas con ≥ 2 botones además: mismos `top` y `height` (±1) y separación entre consecutivos igual en todas las filas (±1) y > 0 |
| O3b | teléfono, las mismas filas | botones con mismo `left` y mismo `width` (±1), cada uno debajo del anterior sin solaparse |
| O3c | Resumen, celda `.celda-acciones` del botón copiar | `width` computado = 110 px y `text-align` = right, los valores de hoy (`web/src/styles.css:536`; H-09: sin archivo de línea base) |
| U1 | `boleta-monto` de cada fila, en los dos anchos | texto en una línea (técnica de O3a) |
| U2 | encabezados de `movimientos-tabla` | existe un `th` con texto «Tipo» y ninguno con «Signo» |
| U3a | cada caso a formatear de § 3 (tabla literal), en los dos campos | tras `fill` y **antes** del blur el valor es el tecleado; tras blur es el esperado |
| U3b | cada caso a dejar intacto de § 3, incluidos `' 12345678-5 '` y `23024748-K` | tras blur el valor es idéntico al tecleado |
| U3c | emitir con `123456785` y `98765433` tecleados, blur, enviar | el cuerpo del `POST /boletas` trae `12.345.678-5` y `9.876.543-3` y el API responde 201 |
| U5 | teléfono, menú abierto | separación Resumen→Abrir cuenta = separación Transferir→Movimientos (±1), **y ambas > 0** (H-07) |
| U6a | texto del PDF de comprobante (con `unpdf`, como `test:pdf`) | contiene «zeroFeeBank»; en el texto normalizado, **cada** ISO de fecha (emisión, vencimiento) va precedido de un rótulo que termina en `(UTC):` (regex `\(UTC\):\s*<ISO>`, H-06) |
| U6b | texto del PDF de resumen de una boleta con fondos liberados | lo mismo que U6a para sus 3 fechas (emisión, vencimiento, cierre): «zeroFeeBank» y cada ISO presente y precedido de `(UTC):` (H-03, H-06) |
| S64a | emitir desde una cuenta del selector (la que sea; se afirma sobre **esa** opción, H-11) | la opción de esa cuenta en `emitir-origen` llega a contener `$ <saldo de GET /cuentas tras emitir>`, distinto del de antes. Se espera con **aserción con reintento** (`expect(...).toContainText` o `expect.poll`) con el tiempo de espera estándar del script, nunca leyendo una vez tras `emitir-exito` (H-04: la relectura es asíncrona) |
| S64b | devolver la boleta VIGENTE | ídem, con el saldo tras devolver |
| S64c | liberar la `VENCIDA_POR_LIBERAR` sembrada (misma vía que A2 de `verificar-s17-boletas.mjs`) | ídem, con el saldo tras liberar (D1) |

Las esperas son por estado (C4) o por aserción con reintento de Playwright; **nada de
`waitForTimeout`**. La tabla literal de casos de U3a/U3b va en el script como constante, copiada de
§ 6.3 sin agregar ni quitar casos.

### 6.3 Tabla literal de U3 (A3)

| Tecleado | Tras blur | Brazo |
|---|---|---|
| `123456785` | `12.345.678-5` | U3a |
| `98765433` | `9.876.543-3` | U3a |
| `11` | `1-1` | U3a |
| `1k` | `1-K` | U3a |
| `12345678k` | `12.345.678-K` | U3a |
| `12345678K` | `12.345.678-K` | U3a |
| `123456789` | `12.345.678-9` | U3a |
| `012345678` | `01.234.567-8` | U3a |
| ` 12345678-5 ` | ` 12345678-5 ` | U3b |
| `12345678-5` | `12345678-5` | U3b |
| `23024748-K` | `23024748-K` | U3b |
| `12.345.678-5` | `12.345.678-5` | U3b |
| ` 123456785` | ` 123456785` | U3b |
| `1234567895` | `1234567895` | U3b |
| `abc` | `abc` | U3b |
| (vacío) | (vacío) | U3b |

### 6.2 Qué no mide el árbitro (lo mide la revisión en vivo, F6)

«Se ve como una sola caja» (O1), «ordenado y profesional», el id destacado y la alineación de pares
del PDF (U6), y el aspecto general de la botonera, **incluido que los botones no se vean pegados**
(«muy juntos» de U4: la spec no trae un mínimo en px y no se inventa; D5). Van a la revisión en
vivo (F6) con captura.

## 7. Calibración

### 7.1 Línea base roja pre-registrada (sobre `main` sin UX-a)

El código de hoy **es** el defecto. Antes de implementar, `verificar:ux-a` corre sobre la rama sin
cambios de la app y debe dar:
- **ROJOS esperados:** O1a, O1b, O3a, O3b (H-05: hoy los botones van en línea), U1 (al menos en teléfono), U2, U3a, U3c, U5, U6a, U6b, S64a, S64b, S64c.
  **O3a es la candidata n.º 1 a salir verde** (C3: separación uniforme de 6 px y la celda puede
  crecer hoy). Si sale verde, se refuerza sólo con lo que § 3 exige y hoy no se mide, y se
  **re-corre** la línea base hasta ver el rojo; la predicción no se mueve.
- **VERDES esperados:** O3c (hoy 110 px/right), U3b (hoy nada se formatea).
- O3b pasó de «sin predicción» a rojo esperado por H-05 del ataque (§ 10).

Si un brazo pre-registrado rojo sale verde, **el brazo está ciego**: se arregla el brazo antes de
implementar, nunca se mueve la predicción. Si sale rojo por otro motivo que el declarado, igual.

### 7.2 Defectos sobre el código ya arreglado (`calibrar:ux-a`)

| K | Defecto (reemplazo literal único) | Brazo que debe caer, y sólo ése |
|---|---|---|
| K1 | devolverle al `input` del monto un borde de 1 px | O1a y O1b (H-01: O1b también exige bordes 0) |
| K2 | que el formateo de U3 acepte también valores con guion o con espacios alrededor | U3b (E8 también caería si se corriera con el defecto; no entra al denominador, C5) |
| K3 | quitar la relectura de cuentas del camino compartido (`releerBoletas` o donde F4b la ponga, C2) | S64a, S64b y S64c |

**Procedimiento de las anclas (D4, molde S-23):** K2 y K3 apuntan a código que se escribe en F4b.
El literal de cada ancla y sus rojos exactos se fijan por escrito **leyendo la entrega de F4b y
antes de la primera corrida** de `calibrar:ux-a`; ese texto se commitea antes de correr.

Denominador fijo 3; ancla ausente o repetida = NO CAZADO. Salida
`calibrar:ux-a: X/3 defectos con el resultado EXACTO`, exit 0 sólo con 3/3.

### 7.3 Ancla de K18/K20 en `calibrar-s17-movimientos`

Esas dos anclas contienen el texto literal `<th scope="col">Signo</th>`, y sus reemplazos también
dicen `Signo` (`calibrar-s17-movimientos.sh:659`, H-12). Tras U2 se cambia **sólo** `Signo` → `Tipo`
en el ancla **y en el reemplazo**; lo que el defecto quita o rompe y el brazo esperado no cambian.
Son **cuatro** líneas, contadas con `grep -n 'Signo</th>'` (B2): `:650`, `:659`, `:698` y `:740`.
Prohibido reemplazar la palabra suelta: `obtenerSigno` y `data-signo` del calibrador no se tocan. Árbitro de esta edición:
`calibrar:s17-movimientos` con el mismo número que antes de UX-a.

## 8. Batería de cierre (número real, el día del merge)

`verificar:ux-a` · `calibrar:ux-a` · todos los `verificar:s10-t1..t4` y `verificar:s17-*` (U5 toca
el menú de todas las pantallas) · `test:domain` · `test:integracion` (incluye `test:pdf`) ·
`calibrar:pdf` · `calibrar:s17-boletas` · `calibrar:s17-movimientos` · `capturas:s17-movimientos` ·
`invariantes` · `guante` · typecheck · build · `demo:m6`.

### 8.1 Enmiendas (decididas con la batería a la vista)

- **D128-1 · `verificar:s10-t1` sale de § 8.** Dio 11/13 (R10, R1) y **lo mismo sobre `main`**,
  antes de UX-a: R1 compara contra los 20 testids de la T1 y la app tiene los de T2 en adelante. Está
  «pasa a histórico» desde la T2; incluirlo con «t1..t4» fue un error.
  t2–t4 cubren el menú (U5). El 11/13 queda publicado en el log.
- **D128-2 · K46 de `calibrar:s17-boletas` se rehace.** Dio 51/54: K16 y K20 no cazados a propósito,
  y **K46 nuevo**: su inyección (click → `releerBoletas()`) dejó de ser defecto porque D125-3
  hizo que `releerBoletas` pida también `GET /cuentas`, que es lo que BN5 afirma. El defecto declarado
  (S-17-boletas § 6, Z13) no cambia; la inyección nueva se fija antes de correr, con resultado esperado
  **EXACTO {BN5}**, y el número esperado del calibrador vuelve a **52/54** (K16, K20).
- **D128-3 · F6 rechazó O3/U4 y nace el brazo O3d.** La revisión en vivo (captura) detectó el borde inferior
  de la celda de acciones de Boletas más arriba que el de la fila: el `display:flex` sobre el `<td>`
  lo sacaba del modelo de tabla. Ningún brazo lo medía. **O3d**: en escritorio y teléfono, toda celda de
  cada fila de `boletas-tabla` con el `top`/`bottom` de su `<tr>` (±1). Fijado antes de corregir: rojo
  sobre el código de F4b (**16/17**, sólo O3d), verde con la corrección
  CSS (márgenes en vez de `flex`): **17/17**, separación 8,0 px. El árbitro pasa de 16 a 17 brazos.

## 9. Fases

| Fase | Quién | Entrega |
|---|---|---|
| F2 | — | ataque a esta spec y a su árbitro |
| F3 | — | enmienda + aprobación |
| F4a | — | `verificar:ux-a` + línea base § 7.1 (sin tocar la app) |
| F4b | — | la app; prohibido tocar el árbitro |
| F4c | — | `calibrar:ux-a` |
| F5 | — | batería § 8 |
| F6 | — | revisión en vivo, respuesta + captura |

## 10. Registro del ataque (F2)

**Ataque 1** (923 s): 14
hallazgos. **Ciertos y aplicados (11):** H-01 (K1 tumba también O1b) · H-02 (recorte sin partirse) ·
H-03 (U6b no exigía los ISO) · H-04 (S64 leído antes de la relectura: aserción con reintento) ·
H-05 (O3b rojo) · H-06 («(UTC)» suelto) · H-07 (U5 con las dos en 0 px) · H-09 (O3c sin archivo) ·
H-10 (filas de un botón) · H-11 (S64 sobre la opción usada) · H-12 (el reemplazo de K18/K20 dice
`Signo`). **Declarados sin brazo (2):** H-13, H-14 (§ 3, U3). **Falso (1):** H-08 (subpíxel en la
separación): la separación se mide entre rectángulos de botones, no depende del ancho del texto, y
la tolerancia ±1 px ya cubre el redondeo.

**Ataque 2** (1233 s): 18 hallazgos. **8 coinciden
con el Ataque 1** (A1=H-06, A2=H-02, A4=H-10, A5=H-09, B1=H-04, C1=H-01, D2=H-11, D6=H-13). **Nuevos y
aplicados (10):** A3 (tabla literal de U3, § 6.3) · B2+C4 (4 líneas `Signo`, no 2) · C2 (K3 tumba
S64a/b/c) · C3 (O3a candidata a verde) · C5 (E8 fuera del denominador) · D1 (S64c para liberar) ·
D3 (HTML congelado) · D4 (anclas fijadas tras F4b) · D5 («muy juntos» al ojo). B3 es un cierre de
descartes, no un hallazgo. **Falsos:** ninguno.

**Cruce:** 24 hallazgos distintos, 8 en común; 6 del Ataque 1 no los vio el Ataque 2 (H-03, H-05, H-07, H-12,
H-14, H-08 falso) y 10 del Ataque 2 no los vio el Ataque 1.
