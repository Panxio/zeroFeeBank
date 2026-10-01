# UX-b2 · Boletas en dos pestañas, ventanilla que no arrastra estado, logo que lleva al inicio (unidad UX, segunda mitad, parte 2)

> Estado: **F4b mergeada (ux-b2 17/17 tras D144-1: P5 sembraba un RUT inválido)**; F3 cerrada. F2: 27 hallazgos
> distintos; F3: enmiendas y aprobación de D140-5..10,
> D141-1..4 y D142-1..3 (§ 2). Sigue **F4a**.
> Decisiones de origen: D140-1..4 y D140-5..10, y las decisiones D130 (D130-3: O2 va en UX-b2).
> Líneas a la fecha de `main`.

## 1. Qué, qué no, y cuándo está hecho

**Qué hace.** Tres filas:
- **O2**: la vista Boletas se parte en dos pestañas, «Mis boletas» (lista) y «Emitir» (formulario).
- **V**: la ventanilla pública (a) no conserva id, RUT, éxito ni error al salir y volver; (b) con id
  vacío no envía nada y muestra un aviso propio; (c) la caja de error nunca queda vacía (D140-9, en
  toda la app, porque el defecto es de `textoError`).
- **L**: el logo lleva al inicio: con sesión, al Resumen; en la ventanilla (hoy `<span>`), a la portada.

**No-goals (quedan fuera, a propósito):**
- **Ningún cambio de backend ni de API** (D140-3). El 404 genérico de Nest no se tipa.
- **La ventanilla no valida el RUT** en el front: un RUT vacío sigue viajando y lo rechaza el backend.
- **Un id no vacío viaja tal cual se escribió** (con espacios; VT10 no cambia, D140-8).
- **No se renombra ni se quita ningún testid.** Se agregan 6 (§ 3.4).
- **El marcado y los estilos del logo de la portada no cambian un píxel** (BV1/BV2 de `verificar:s10-t4`,
  umbral 0, `verificar-s10-t4.mjs:3285`): sólo se le suman `data-testid` y el manejador.
- **Éxito viejo junto a error nuevo, fuera (F3, D141-4):** `ejecutarCobroVentanilla`
  (`app.ts:1407-1410`) no limpia `exitoVentanilla` al cobrar de nuevo en la misma pantalla. Se deja así.
- **Clave pendiente reusada con otra boleta, fuera** (F2 H3): preexistente, y la huella del cobro
  incluye `boletaId` (`boletas.service.ts:231-234`): da un rechazo de idempotencia, no un replay.

**Criterio de hecho:** (a) `verificar:ux-b2` **N/N** sobre el artefacto entregado; (b) su línea base
sobre `main` salió con **exactamente** los rojos de § 7.1, y los brazos enmendados de § 5 también; (c)
`calibrar:ux-b2` **20/20 exactos** (§ 7.2); (d) la batería de § 8 con su número real, con las K
re-ancladas de § 7.3; (e) aprobación en vivo (respuesta + captura) de § 6.2.

## 2. Decisiones que esta spec aplica

| # | Decisión | Fuente |
|---|---|---|
| D140-1 | Al entrar a Boletas se abre **siempre «Mis boletas»**, también con cero boletas (`boletas-vacio` + la pestaña «Emitir» al lado) | — |
| D140-2 | Tras emitir con éxito **se queda en «Emitir»** con `emitir-exito`; no conmuta | — |
| D140-3 | Ventanilla con id vacío: **el front no envía el POST** y muestra un aviso propio. Sin backend | — |
| D140-4 | El logo de la ventanilla pasa a **enlace a la portada** | — |
| D140-5..10 | `[hidden]` y no `@if` · mensajes de región sobre las pestañas · limpiar al entrar · vacío = `trim()` · genérico en `textoError` · testids en `S-17-testids-boletas.txt` | aprobación en F3 |
| D142-1 | `demo:m6` P9 toma **dos capturas**: el éxito en «Emitir» y la fila en «Mis boletas» (F2 I1) | — |
| D142-2 | Si el aviso de id vacío sale de `ventanilla-reintentar`, **`ventanilla-sin-respuesta` y su botón siguen visibles** (enmienda D141-3; F2 H2) | — |
| D142-3 | `verificar:ux-b2` V5 **demora** la respuesta real en la ruta y la suelta después; no la fabrica (F2 I1) | — |

**Decisiones de la F1, aprobadas en F3:**
- **D141-1 · testid del logo: `marca-inicio`, en `specs/S-17-testids-boletas.txt`.** La F0 temía
  que `verificar-s10-t1.mjs:188` lo viera sobrante; ese árbitro es **histórico** desde el cierre de S-10
  y no está en ninguna
  batería. Las R1 vivas (t2, t3, t4 y los seis `verificar:s17-*`) eximen `sobran` con una unión que
  **ya** incluye `S-17-testids-boletas.txt` (medido con `grep`), y R1 de `verificar:s17-boletas`
  exige verlo (`faltan`), lo que obliga a que se monte. Una lista nueva obligaría a tocar nueve uniones.
  Se descarta «sin testid»: C3 exige testid a todo elemento con el que un flujo interactúa, y el logo
  pasa a serlo. **Un solo testid** para los dos logos: nunca coexisten (`@if (enVentanilla())`, `app.html:1`).
- **D141-2 · respuesta tardía de la ventanilla.** Si se sale de la ventanilla con un cobro en vuelo y se
  vuelve a entrar, la respuesta de ese cobro **se descarta** (no pinta éxito ni error en la pantalla
  limpia). Sin esto, D140-7 falla en el caso borde de la red lenta.
- **D141-3 · el vacío se chequea donde se envía**, no sólo en el botón: `ventanilla-reintentar` relee el
  id al ejecutar (`app.ts:1412`), así que borrar el id tras un «sin respuesta» y reintentar también da
  el aviso y ningún POST. La clave pendiente **no** se descarta (el cobro anterior pudo procesarse), y
  con D142-2 `ventanilla-sin-respuesta` y su botón quedan a la vista para usarla.
- **D141-4 · literales** (sin dígitos), **aprobados en F3**:
  - aviso de id vacío: `Ingresa el ID de la boleta.`
  - genérico de `textoError`: `No se pudo completar la operación.`
  - el éxito anterior **no** se limpia al cobrar de nuevo (no-goal de § 1).

## 3. Comportamiento

### 3.1 O2 — pestañas
- Con `boletas-region[data-estado]` ∈ {`listo`, `vacio`} se ve un `role="tablist"` (`aria-label="Boletas"`)
  con dos `<button role="tab">`: `boletas-pestana-lista` («Mis boletas») y `boletas-pestana-emitir`
  («Emitir»), cada uno con `aria-controls` a su panel, `aria-selected` y `tabindex` 0 / −1 (molde
  `transferir-pasos`, `app.html:375-415`). Con `cargando` o `error` no hay pestañas.
- Paneles `role="tabpanel"` con `aria-labelledby` al id de su pestaña: `boletas-panel-lista` (hoy `app.html:762-843`:
  `boletas-vacio` y la tabla) y `boletas-panel-emitir` (hoy `:845-970`: `boletas-sin-cuentas` o el
  formulario). **Los dos quedan montados; el inactivo lleva `hidden`** (D140-5). Lo tecleado en «Emitir»
  sobrevive a ir y volver de pestaña dentro de la vista; también el error de emisión del formulario,
  que vive dentro del panel «Emitir» (F2 H1).
- Sobre las pestañas, fuera de los paneles y sin cambios: `boletas-cargando`, `boletas-error`,
  `boletas-accion-error`, `boletas-accion-sin-respuesta` y el error de PDF (D140-6).
- **Pestaña inicial:** `alActivarBoletas` fija «Mis boletas» cada vez que se entra (D140-1). La pestaña
  se fija al entrar, no al cargar: `boletas-reintentar` no la toca (F2 H3).
- **Emitir con éxito:** la pestaña no cambia (D140-2); la lista se relee como hoy (J10) y la fila nueva
  está en «Mis boletas» al abrirla.
- **Teclado:** ← / → sobre una pestaña activan la otra y le pasan el foco (cíclico con dos); clic igual.
  Un manejador propio: `alPulsarTeclaTab` (`app.ts:2001`) es de los pasos de Transferir y no se toca.

### 3.2 V — ventanilla
- **Limpieza al entrar (D140-7):** cuando `enVentanilla` pasa de `false` a `true` (enlace
  `ir-ventanilla`, hash tecleado, «adelante» del navegador) quedan vacíos id y RUT, y nulos éxito,
  error, sin-respuesta, aviso y `claveVentanilla`; `cobrandoVentanilla` = `false`. Cubre cualquier forma
  de haber salido (`ventanilla-volver`, «atrás», `marca-inicio`).
- **Respuesta tardía:** D141-2.
- **Id vacío (D140-3, D140-8, D141-3):** si `ventanillaBoletaId().trim().length === 0` al ir a enviar
  (cobrar o reintentar), no hay `fetch`; se ve `ventanilla-aviso` (`role="alert"`) con el literal de
  D141-4, y se ocultan éxito y error. `ventanilla-sin-respuesta` se oculta al cobrar, pero **sigue
  visible, con su botón, si el aviso salió de reintentar** (D142-2); la clave pendiente se conserva. El aviso desaparece al enviar un cobro con id no
  vacío y al entrar. **La línea `app.html:35` (`ventanilla-error`) no se toca**: es ancla de K35.
- **Caja nunca vacía (D140-9):** `textoError` devuelve el literal genérico cuando no hay código mapeado
  y `mensaje` es nulo, indefinido o vacío tras `trim()`. Consecuencia: los respaldos `|| (...)` de
  `app.html:745` y `:1003` quedan inalcanzables y **se quitan** (una sola regla en una sola función;
  deja sin efecto el «se conservan» de UX-b1 #20). Ningún calibrador los ancla (`grep`).

### 3.3 L — logo
- Portada (`app.html:75`): `<a class="marca" href="#" aria-label="zeroFeeBank, inicio" data-testid="marca-inicio" (click)=…>`.
  **Con sesión:** mismo efecto que `alActivarResumen` (`app.ts:517-527`): Resumen y relectura de cuentas.
  **Sin sesión:** `preventDefault` y nada más (ya es la portada): la URL no cambia (sin él quedaría `/#`).
- Ventanilla (`app.html:4`): el `<span>` pasa a `<a class="marca" href="#" aria-label="zeroFeeBank, inicio" data-testid="marca-inicio">`
  con el mismo efecto que `ventanilla-volver` (`alVolverVentanilla`, `app.ts:1388`): la URL queda sin
  `#`. Un `href="#"` desnudo también cierra la ventanilla (por `hashchange`), pero deja `/#`; en eso se
  distinguen (F2 C4).

### 3.4 Testids nuevos (6) → `specs/S-17-testids-boletas.txt` (D140-10, D141-1)
`boletas-pestana-lista`, `boletas-pestana-emitir`, `boletas-panel-lista`, `boletas-panel-emitir`,
`ventanilla-aviso`, `marca-inicio`. Cabecera: 47 → **53**; T4 ∪ lista = 120 → **126**. Registro de
cambios en formato de bloque (`S-17-testids-contacto.txt:6-8`): `#   s14x · UX-b2: pestañas de Boletas,
aviso de id vacío y logo (marca-inicio va aquí porque esta lista está en todas las uniones de R1).`

## 4. Constantes

| Constante | Valor | Por qué |
|---|---|---|
| pestaña inicial | `lista` | D140-1 |
| criterio de vacío | `trim().length === 0` | D140-8: un id de sólo espacios nunca es un UUID y arma una URL absurda |
| literales | los de D141-4 | aprobados en F3; el árbitro los compara exactos |

## 5. Enmiendas a árbitros existentes (O2)

**Regla de la enmienda:** se inserta **sólo** el clic en la pestaña y la espera por su panel visible
(C4); ninguna otra aserción cambia, **salvo** las que la tabla suma de forma explícita (E1, BN4 y las
dos capturas de P9; F2 H4). Sin tolerancia: si la pestaña no existe, el brazo cae.

**En F4a** (sin tocar la app; sobre `main` estos brazos **deben** caer, § 7.1):

| Árbitro · brazo | Enmienda |
|---|---|
| `verificar:s17-boletas` E1–E9, A2 (`:916`, `:995`, `:1050`, `:1116`, `:1182`, `:1237`, `:1301`, `:1339`, `:1415`, `:1524`) | clic en `boletas-pestana-emitir` antes de exigir `emitir-form` visible. **E1**, además: tras `emitir-exito`, afirma `boletas-pestana-emitir[aria-selected=true]` (D140-2) y recién entonces clic en `boletas-pestana-lista` y espera la fila (`:964`) |
| `verificar:s17-boletas` BN4 (`:531`) | con cero boletas: `boletas-vacio` visible, `boletas-pestana-lista[aria-selected=true]`, `emitir-form` **no visible**; clic en «Emitir» → `emitir-form` visible |
| `verificar:s17-boletas` BN6 (`:606`) | clic en «Emitir» antes de exigir `boletas-sin-cuentas` visible; `emitir-form` ausente sin cambio |
| `verificar:ux-a` U3a, U3b, U3c, S64a (`:772`, `:809`, `:839`, `:1045`) | clic en «Emitir» tras `irABoletas` |
| `demo:m6` P9 (`:348-383`) | clic en «Emitir» antes de `:349`. Tras `emitir-exito` (y leer el id), la captura `p9-boleta-exito.png` con el éxito en el viewport; después, clic en «Mis boletas», espera la fila (`:372`), la trae al viewport y toma `p9-boleta-fila.png` (D142-1). Sale `p9-boleta.png`: con pestañas, el éxito y la fila no caben en una imagen (el `scrollIntoViewIfNeeded` de `:382` esperaría un elemento oculto hasta el timeout; F2 I1) |
| `verificar:s17-boletas` **VT11 (brazo nuevo)** | id vacío + RUT → `ventanilla-cobrar`: `ventanilla-aviso` visible; `recolectar`. Existe para que R1 vea `ventanilla-aviso` (F2 PF2): ningún otro brazo de la suite deja el id vacío. Una exención en R1 debilitaría el árbitro; el brazo no |

**No se enmiendan (predicción, se mide en F5):** `verificar:ux-a` S64b/S64c (leen la `<option>` con
`$eval`, que ve el panel oculto, y operan la tabla en la pestaña inicial) · `verificar:ux-b1` A2
(`state: 'attached'` + `$$eval`, `:419-423`) y A5 (tabla en la pestaña inicial) · `verificar:ux-a` O3a,
O3b, O3d y U1 (`:433`, `:544`, `:651`, `:685`: tras `irABoletas` leen `boletas-tabla` y `boleta-monto`,
que están en la pestaña inicial; F2 H5) · los demás brazos de
`verificar:s17-boletas` · VT1–VT10 (ninguno sale y vuelve con datos, ninguno usa id vacío) ·
el script de capturas (no es árbitro). Si alguno cae en F5, se escala; no se enmienda sobre la marcha.

**En F4b, junto con la app** (única excepción a «F4b no toca árbitros», molde UX-b1 § 5): los 6 testids
en `specs/S-17-testids-boletas.txt` (§ 3.4); y en `specs/S-17-boletas.md` § 4.1 (`:81-84`, `:88`),
§ 4.3 (`:104-106`) y § 4.6 una nota de que UX-b2 lo cambia, sin reescribir la historia. En F4a la lista
pondría rojo de transición en R1 (`faltan`).

## 6. Árbitro nuevo: `verificar:ux-b2`

**Montaje:** `/__test__/reset` y la API pública (registro, apertura de cuentas, emisión); `/__test__/seed`
sólo para `boletas-en-cada-estado` (5 boletas). Nunca la BD. Esperas por estado (C4). La red sólo se
intercepta para contar peticiones, para abortar un POST (molde VT7) y para **demorar** uno (V5, D142-3:
`route.continue()` diferido, la respuesta es la real); **nunca se fabrica una respuesta**. El conteo de
POST a `/cobrar` usa un patrón que ve también el segmento vacío (`/boletas//cobrar`, `app.ts:1412-1419`;
F2 C3).
Escritorio salvo que se diga. Si un escenario no se puede montar así, F4a se detiene y escala.

### 6.1 Brazos

| Brazo | Afirma |
|---|---|
| P1 | Con 5 boletas, al entrar: tablist con `aria-label="Boletas"` y 2 `role=tab`, «Mis boletas» `aria-selected=true` y `tabindex=0`, «Emitir» `false`/`-1`; cada pestaña con `aria-controls` = id de su panel, y cada panel con `role=tabpanel` y `aria-labelledby` = id de su pestaña (F2 C6); `boletas-tabla` visible; `boletas-panel-emitir` **montado y no visible**, con `emitir-origen` y sus opciones en el DOM |
| P2 | Con 0 boletas **y ≥1 cuenta** (F2 I2): `boletas-vacio` visible, «Mis boletas» seleccionada, `boletas-pestana-emitir` visible, `boletas-sin-cuentas` ausente, `emitir-form` **en el DOM** y no visible |
| P3 | Clic en «Emitir»: su panel visible, el de lista no visible, `aria-selected`/`tabindex` intercambiados |
| P4 | Foco en «Mis boletas», → : «Emitir» seleccionada **y con el foco**; ← : vuelve |
| P5 | Emitir con éxito: `emitir-exito` visible y «Emitir» sigue seleccionada; clic en «Mis boletas» → la fila del id emitido, `VIGENTE`, visible |
| P6 | Teclear un monto en «Emitir», ir a «Mis boletas» y volver: el monto sigue (D140-5) |
| P7 | Abrir «Emitir», ir al Resumen por la barra y volver a Boletas: «Mis boletas» seleccionada (D140-1) |
| V1 | Id aleatorio (UUID válido, inexistente) + RUT → `ventanilla-error`; `ventanilla-volver`; `ir-ventanilla`: id y RUT vacíos, sin error, éxito, sin-respuesta ni aviso |
| V2 | Cobro feliz (boleta sembrada) → éxito; «atrás» del navegador; re-entra con **«adelante»** (F2 C2): igual que V1 |
| V3 | Primero id inexistente + RUT → `ventanilla-error` visible (F2 H1); luego id vacío y, en otra vuelta, id `"   "`: **0 POST** a `/cobrar`; `ventanilla-aviso` con el literal exacto; `ventanilla-error` ausente |
| V4 | Primer POST abortado → `ventanilla-sin-respuesta`; borrar el id; `ventanilla-reintentar`: 0 POST nuevos, aviso visible **y `ventanilla-sin-respuesta` con `ventanilla-reintentar` visibles** (D142-2); escribir de nuevo el id y `ventanilla-reintentar`: sale 1 POST con el **mismo** `Idempotency-Key` que el abortado (D141-3; F2 H2) |
| V5 | Cobro con la respuesta demorada (D142-3); salir con `ventanilla-volver` y volver a entrar: id vacío y `ventanilla-boleta-id`, `ventanilla-rut` y `ventanilla-cobrar` habilitados (F2 C2); soltar la respuesta, esperar su `requestfinished` y dos `requestAnimationFrame` en la página (F2 C4); recién entonces: ni éxito ni error (D141-2) |
| V6 | Id inexistente + RUT → error; salir con `marca-inicio`; re-entrar tecleando la URL con `#ventanilla` (`page.goto`, F2 C2): igual que V1 |
| G1 | Id `..`: el navegador normaliza la ruta a `POST /cobrar` y Nest responde su 404 sin `codigo` ni `mensaje`. `ventanilla-error[data-codigo=ERROR]` con `<p>` == literal genérico. **F4a verifica primero** que la petición salió a `/cobrar` y volvió 404 sin `codigo`; si no, se detiene y escala |
| L1 | Con sesión, desde Boletas: `marca-inicio` tiene rol `link` y nombre «zeroFeeBank, inicio»; clic → `cuentas-region` visible y ≥1 `GET /cuentas` iniciado después del clic (la relectura de § 3.3; F2 C5) |
| L2 | En la ventanilla: `marca-inicio` es `<a>` con rol `link` y el mismo nombre; clic → `portada` visible, sin `ventanilla`, y la URL sin `#` (F2 C4) |
| L3 | Sin sesión, en la portada: clic en `marca-inicio` → `portada` visible y la URL idéntica a la de antes del clic (F2 H5) |

### 6.2 Qué no mide el árbitro (lo mide la revisión en vivo, F6)
Cómo se ven las pestañas (escritorio y teléfono) y que no salten al cambiar; que el aviso y el genérico se
entiendan; el logo de la ventanilla con foco y sin foco. (El logo de la portada sin sesión sí tiene
brazo, L3: su mitad roja es creíble, la URL pasa a `/#`; F2 H5.)

## 7. Calibración

### 7.1 Línea base sobre `main` (sin UX-b2)
- **ROJOS esperados:** P1–P7, V1–V6, G1, L1–L3 (**17**); los **17** brazos enmendados de § 5
  (s17-boletas E1–E9, A2, BN4, BN6 = 12; ux-a U3a–c, S64a = 4; demo-m6 P9 = 1; F2 PF2); el brazo nuevo
  VT11 de s17-boletas; y **R1 de s17-boletas** (F2 PF1). Total fuera de `ux-b2`: **19**. **VERDES
  esperados:** ninguno de los 17; y en esas tres suites, todo lo demás.
- Motivo declarado de cada rojo: P* y los enmendados, la pestaña no existe · V1/V2, el estado se
  conserva · V3/V4/VT11, sale el POST · V5, el estado se conserva **antes** de soltar la respuesta · V6 y
  L1–L3, sin `marca-inicio` · G1, `<p>` vacío · R1 de s17-boletas, `faltan` los testids que sólo ven
  E*, A2 y BN6 (`emitir-exito`, `emitir-reintentar`, `boletas-sin-cuentas`), porque esos brazos caen antes.
  Un rojo por otro motivo, o un verde, es un brazo ciego: se arregla el brazo, no la predicción.
- **Mitad sin calibrar en § 7.1** (sólo se ve roja bajo una K; el defecto muere antes del paso): P6 cae
  por la pestaña, su comportamiento lo mide K14 (F2 PF3); V5 muere antes de soltar, la «respuesta
  vieja» la mide K10; V6 y L1–L3 caen por el testid, su comportamiento lo miden K6, K12, K13 y K15 (F2 PF4).

### 7.2 Defectos sobre el código ya arreglado (`calibrar:ux-b2`, sólo corre `verificar:ux-b2`)

| K | Defecto | Cae, y sólo eso | También caería (no se corre) |
|---|---|---|---|
| K1 | paneles con `@if` en vez de `hidden` | P1, P2 (F2 PF3: el monto de P6 vive en una signal y sobrevive al `@if`) | S64b/S64c `ux-a`, A2 `ux-b1` |
| K2 | no fijar «Mis boletas» al entrar | P7 | — |
| K3 | conmutar a «Mis boletas» tras emitir | P5 | E1 `s17-boletas` |
| K4 | quitar el manejador de flechas | P4 | — |
| K5 | `aria-selected` fijo en «Mis boletas» | P3, P4, P5 (F2 PF4), P7 (**D146-1**) | E1 `s17-boletas` |
| K6 | no limpiar al entrar | V1, V2, V5, V6 | — |
| K7 | sin chequeo de vacío | V3, V4 | VT11 `s17-boletas` |
| K8 | chequeo de vacío sin `trim()` | V3 | — |
| K9 | chequeo sólo en el botón, no al enviar | V4 | — |
| K10 | no descartar la respuesta tardía | V5 | — |
| K11 | `textoError` vuelve a `mensaje ?? ''` | G1 | — |
| K12 | logo con sesión sin manejador · logo de ventanilla vuelve a `<span>` (dos mutaciones, un defecto de L) | L1, L2, V6 (sale por `marca-inicio`) | — |
| K13 | logo de ventanilla como `<a href="#">` sin manejador | L2 | — |
| K14 | cambiar de pestaña vacía el monto de «Emitir» | P6 | — |
| K15 | logo de la portada sin `preventDefault` (sin sesión) | L3 | — |
| K16 | la limpieza al entrar no repone `cobrandoVentanilla` | V5 | — |
| K17 | el aviso de vacío no oculta `ventanilla-error` | V3 | — |
| K18 | el aviso de vacío descarta la clave pendiente | V4 | — |
| K19 | el aviso de vacío oculta `ventanilla-sin-respuesta` también al reintentar | V4 | — |
| K20 | los dos `marca-inicio` sin `href` (el `<a>` pierde el rol link; el `(click)` sigue) | L1, L2 | — (L3: la URL no cambia igual) · D143-1: el rol computado de L1/L2 no tenía K |

Denominador fijo 20 (K1–K20; decía 19); ancla ausente o repetida = NO CAZADO. Las anclas se fijan leyendo F4b y se
commitean antes de la primera corrida (molde UX-a § 7.2). Salida `calibrar:ux-b2: X/20 defectos con el
resultado EXACTO`, exit 0 sólo con 20/20. Si una K cae en más de lo declarado, se escala con el resultado a la vista.

### 7.3 Anclas de otros calibradores que UX-b2 puede romper
`calibrar:s17-boletas`: K5, K18, K19, K20 (`-a.sh:60, 203, 213, 221`), K40, K47, K49, K54 (`-b.sh:248, 399,
426, 541`) anclan la vista Boletas; K32, K33, K38, K45 (`-b.sh:107-116, 127-131, 216-221, 344`) anclan
`actualizarRutaHash`/`alVolverVentanilla`; K35 (`-b.sh:166`) ancla `app.html:35`; K30 y K48 (`-b.sh:74`,
`:412`) anclan con sangría literal (F2 PF5). `calibrar:ux-b1` (vigente **9/9**): K4
(`calibrar-ux-b1.sh:367-382`) ancla la `<option>` de `emitir-origen` con sangría literal, y el panel
nuevo la re-sangra (F2 PF6). F4b **no** toca las
líneas ancla de la ventanilla si puede evitarlo (la limpieza va en un método nuevo llamado dentro de la
rama `else`). Lo que se mueva se re-ancla en **F4c** con la misma mutación y el mismo brazo; un resultado
distinto del vigente (**52/54** en `s17-boletas`, **9/9** en `ux-b1`) se escala.

**Enmiendas (con el resultado a la vista):**
- **D146-1.** La primera corrida completa de `calibrar:ux-b2` dio **19/20**: K5 también tumba P7, porque la
  preparación de P7 espera `boletas-pestana-emitir[aria-selected="true"]` y K5 la fija en `false`. El rojo es
  legítimo y la predicción estaba corta; K5 pasa a declarar P3, P4, P5 y P7. El defecto no cambia.
- **D146-2.** La primera corrida completa de `calibrar:s17-boletas` dio **50/54**: además de K16 y K20 (NO de
  siempre), K34 y K36 (`-b.sh`, `alCobrarVentanilla` y el `catch` del cobro) dieron ANCLA AUSENTE. F4b metió
  líneas entre la firma y el bloque mutado, y esta § 7.3 no los listaba (el seco previo sólo cubrió la
  lista). Se re-anclan acotando el ancla al bloque intacto, con la misma mutación y el mismo brazo.

## 8. Batería de cierre (número real, el día del merge)
`verificar:ux-b2` · `calibrar:ux-b2` · `verificar:s10-t2..t4` (BV1/BV2 incluidos) · todos los
`verificar:s17-*` · `verificar:ux-a` · `verificar:ux-b1` · `calibrar:ux-a` · `calibrar:ux-b1` ·
`calibrar:s17-boletas` (desatendido, **52/54** esperado) · `capturas:s17-*` · `demo:m6` ·
`test:domain` · `test:integracion` · `invariantes` · `guante` · typecheck · build. El número esperado de
cada uno se copia aquí del vigente antes de correr.

## 9. Fases

| Fase | Quién | Entrega |
|---|---|---|
| F2 | — | ataque a esta spec y a sus árbitros |
| F3 | — | enmienda (27 hallazgos de F2); aprobación de D140-5..10, D141-1..4, D142-1..3; casuísticas registradas |
| F4a | — | `verificar:ux-b2` + enmiendas de § 5 (tabla F4a) + línea base § 7.1, sin tocar la app |
| F4b | — | la app + lista y notas de § 5 (F4b); prohibido tocar otro árbitro |
| F4c | — | `calibrar:ux-b2` + re-anclas de § 7.3 |
| F5 | — | batería § 8 |
| F6 | — | revisión en vivo, respuesta + captura |
