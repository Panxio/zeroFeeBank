# S-10 · T3 — Transferir: asistente de 3 pasos, modal en Shadow DOM y comprobante

> Estado: **en construcción** (2026-09-11). Spec, lista de testids, árbitro y tabla de
> defectos se fijan **antes** de la entrega. Trozo 3 de 4 de S-10: T1 portada + acceso ✅ ·
> T2 barra + Resumen ✅ · **T3** Transferir · T4 inactividad + baseline visual.
> Fuentes: `S-10-catalogo.md` § 4.2, § 4.3, § 4.6 y § 6; `S-10-frontend.md` § 2–§ 4 (v0 congelado:
> estados, códigos, P1–P5); el prototipo `S-10-prototipo.html` v4 (`enviarTransferencia`, `vistaTransferir`);
> contratos de S-18 (`POST /transferencias`) y S-19 (`GET /transferencias/:id/comprobante.pdf`).
> Lo visual sigue la dirección visual, aprobada con captura.

## 1 · Qué hace, qué queda fuera, cuándo está hecho

- **Hace (frontend, `web/`):** la pantalla Transferir, a la que se llega por `nav-transferir` (barra y
  panel de teléfono) y por `ir-transferir` (Resumen) (retirado en UX-b1, O5: a Transferir se llega por `nav-transferir`). Asistente de 3 pasos en pestañas del DOM, modal
  de confirmación `zfb-dialogo` en Shadow DOM abierto, envío con `Idempotency-Key`, los estados v0
  (sin respuesta, reintentar, éxito, repetida) y el comprobante PDF en pestaña nueva.
- **Hace (backend):** CORS expone `Idempotency-Replayed` (§ 2, decisión H1).
- **Fuera:** inactividad, `inactividad-*` y `data-motivo="inactividad"` (T4; el componente `zfb-dialogo`
  nace aquí con un solo uso) · baseline visual (T4) · Movimientos, Pagos, Boletas, Contacto (S-17) ·
  tipos de transferencia (deuda de negocio) · fecha y hora en el comprobante en pantalla
  (P4 del v0; el PDF sí la trae, S-19) · URL por pantalla (el token vive en memoria, T1) ·
  `TOKEN_EXPIRADO` de verdad.
- **Hecho:** los brazos de § 5 en verde sobre el **artefacto entregado** (el `dist/` del backend y el build
  de producción de `web/`, servidos), cada defecto de § 6 cazado por su brazo, la batería de § 7 sin
  moverse, y se compara Transferir en escritorio y teléfono: respuesta + captura.

## 2 · Decisiones

### Decisiones de producto

| # | Decisión | Porqué |
|---|---|---|
| H1 | **CORS expone `Idempotency-Replayed`** (`exposedHeaders` en `src/main.ts`) | Entre dos orígenes el script no puede leer una cabecera no expuesta: sin esto `transferir-repetida` (v0 aprobado) no aparece nunca y su brazo sería imposible. Hallado en `main.ts:12` |
| H2 | **El PDF en headless se mide como pestaña + descarga** | Sonda (`sonda-blob.mjs`): en Chromium headless la pestaña nueva queda en `about:blank` y el `blob:` de un PDF sale como **descarga desde esa pestaña**. En un navegador con visor se ve el PDF; el mecanismo que se mide es el mismo |
| H3 | **El cliente sólo exige presencia** para habilitar Revisar: destino y monto no vacíos | El formato y las reglas los decide el API y vuelven con código (C5). Una regla de monto duplicada en el cliente sería una regla de negocio inventada, y dejaría `MONTO_INVALIDO` inalcanzable desde la UI (desafío #8) |
| H4 | **`transferir-reintentar` reenvía directo**, sin modal, con la **misma** clave | Es la misma operación, ya confirmada; si el banco la ejecutó, responde repetida y no la ejecuta de nuevo. El modal protege la primera decisión |

### Decisiones de contrato de pantalla (discutibles)

| # | Decisión | Porqué |
|---|---|---|
| J1 | `transferir-paso-origen/-destino/-revisar` son los **`role=tab`**; los paneles (`role=tabpanel`) no llevan testid y se alcanzan por `aria-controls` | el catálogo los lista junto a `transferir-pasos` (el `tablist`); los controles de cada panel ya tienen su testid v0 |
| J2 | Flechas ←/→ con **activación automática**: mueven foco y selección a la pestaña habilitada siguiente, **saltan las `aria-disabled`** y dan la vuelta | APG de pestañas; saltar la deshabilitada es lo que hace que «no se habilita» sea verdad también por teclado |
| J3 | Al abrir el modal, el foco va a **`confirmar-cancelar`** | APG de diálogos: ante una acción que no se deshace, el foco inicial va a la opción menos destructiva |
| J4 | `transferir-revisar-monto[data-monto]` es el texto del monto **tal como se envía** (sin espacios a los lados), el mismo string del cuerpo del POST | D1: el cliente no convierte dinero a `number`; lo que se revisa es lo que se envía |
| J5 | **Una vista a la vez en el DOM**: Resumen o Transferir. Mientras `GET /cuentas` carga dentro de Transferir se ve `cuentas-cargando` (prototipo v4) | con las dos montadas, `cuentas-cargando` saldría dos veces (R1, un solo marcado) |
| J6 | `transferir-form[data-estado]` ∈ {`editando`, `enviando`, `error`}, con `aria-busy="true"` sólo en `enviando`. El éxito **reemplaza** el formulario por `transferir-exito` | el v0 tal cual (`vistaTransferir`): «los estados v0 siguen igual» (catálogo § 4.2) |
| J7 | Si el PDF falla (red o no-`200`), la pestaña abierta **se cierra** y aparece un aviso `role="alert"` dentro de `transferir-exito` | una pestaña en blanco que no llega nunca es la app mintiendo; no se agrega testid (el aviso se ancla por rol) |
| J8 | `transferir-origen` y `transferir-destino-propia` son **`<select>` nativos** (agregada en § 5.1) | el prototipo v4 congelado los usa; sin fijarlo, A3 y A5 eran imposibles sobre un listbox propio |

## 3 · Constantes

| Constante | Valor | Porqué |
|---|---|---|
| Viewports del arnés | escritorio **1280×800** · teléfono **390×844** | los de T2 |
| Tope de cada espera por condición | **8000 ms** | el de T1/T2: un rojo, no un cuelgue; no es un `sleep` |
| Monto de los envíos felices | **`"250.10"`** | con `Number()` se volvería `250.1`: J4 lo distingue |
| Monto con coma (P1) | **`"12,50"`** | P1 del v0: coma decimal → el API responde `MONTO_INVALIDO` |
| Monto que excede | **`"5000.00"`** | mayor que los `1000.00` de la cuenta fondeada |
| Id inexistente para «Otras cuentas» | **`00000000-0000-4000-8000-000000000000`** | UUID v4 bien formado que no existe: `CUENTA_NO_ENCONTRADA` por inexistente, no por mal formado |
| Origen de la descarga del PDF | `blob:http://localhost:4200/` | la URL `blob:` es del origen de la app que la creó (H2) |

Los usuarios y cuentas del arnés salen del API real (`POST /auth/registro`, `POST /cuentas`), como en
T2: con dos cuentas, la primera queda en `"0.00"` y la segunda en `"1000.00"`. **Los envíos felices
salen de la cuenta con `"1000.00"`.** Cada dato de preparación se construye con una función que
afirma sus propios límites (saldo esperado antes de usarlo): defensa contra el brazo imposible.

## 4 · Comportamiento

### 4.1 · Llegada y estados de carga
- `nav-transferir` es un **enlace** (rol `link`) en `nav-panel`, al lado de `nav-cuentas`; en teléfono
  queda plano en el panel, y activarlo cierra el panel. `ir-transferir` vive en Resumen (retirado en UX-b1, O5: a Transferir se llega por `nav-transferir`).
- Entrar a Transferir **pide `GET /cuentas`** (el selector de origen necesita la lista). Con cero
  cuentas: `transferir-sin-cuentas`, sin asistente. Un error de `GET /cuentas` aquí se trata como en T2.
- El asistente arranca siempre en **Origen**, con la primera cuenta del API como origen, modo «Mis
  cuentas» y el monto vacío.

### 4.2 · El asistente (catálogo § 4.2)
- `transferir-pasos` (`role=tablist`) con tres `role=tab` en orden: Origen · Destino · Revisar. La
  pestaña activa tiene `aria-selected="true"`; las otras, `"false"`. Cada una apunta a su panel por
  `aria-controls`.
- **Habilitación:** Destino se habilita cuando hay un origen elegido; Revisar, cuando además el destino
  y el monto no están vacíos (H3). Una pestaña no habilitada lleva `aria-disabled="true"` y **no se
  activa** ni por clic, ni por flechas (J2), ni por `transferir-destino-siguiente`.
- **Paneles inactivos: en el DOM con `hidden`**, nunca retirados. Volver conserva lo escrito.
- Botones: `transferir-origen-siguiente` → Destino; `transferir-destino-volver` → Origen;
  `transferir-destino-siguiente` → Revisar; `transferir-revisar-volver` → Destino.
- Destino: «Mis cuentas» (`transferir-destino-propia`) **excluye el origen** (P3); «Otras cuentas»
  (`transferir-destino-id`) acepta un id pegado. Monto con punto decimal (P1).
- Revisar muestra origen, destino y `transferir-revisar-monto[data-monto]` (J4), y `transferir-enviar`.

### 4.3 · El modal (catálogo § 4.3)
- `transferir-enviar` **no envía**: abre `zfb-dialogo` (`ViewEncapsulation.ShadowDom`, raíz **abierta**)
  con `confirmar-dialogo`, `confirmar-aceptar` y `confirmar-cancelar` **dentro** del shadow root.
- `confirmar-dialogo` lleva `role="dialog"`, `aria-modal="true"` y `aria-labelledby` que apunta a un
  elemento **de la misma raíz** con texto. Foco inicial en `confirmar-cancelar` (J3); **Tab y Shift+Tab
  no salen** del diálogo.
- `confirmar-cancelar` o **Escape**: cierra, **no** hay POST, y el foco vuelve a `transferir-enviar`.
- `confirmar-aceptar`: cierra y hace **un** `POST /transferencias` con una `Idempotency-Key` **nueva**
  (UUID). Un segundo clic, o un doble clic, **no** genera otra clave ni otra operación.

### 4.4 · Resultado del envío (v0, después de confirmar)
- `enviando`: `data-estado="enviando"`, `aria-busy="true"`, controles deshabilitados.
- `201`: `transferir-exito` (`role=status`) con `transferir-transaccion-id` = `transaccionId` del cuerpo.
  Con `Idempotency-Replayed: true` además se ve `transferir-repetida`; sin ella, **no**.
  `transferir-nueva` vuelve al asistente limpio, en Origen, y el próximo envío lleva clave nueva.
- **Rechazo del API** (`4xx` de negocio): el asistente queda en **Revisar**, `data-estado="error"` y
  `transferir-error[data-codigo]` = el `codigo` del cuerpo (C5).
- **Sin respuesta de red**: `transferir-sin-respuesta` con `transferir-reintentar`, **sin**
  `transferir-error` y sin `data-codigo` (P2). Reintentar **reenvía directo con la misma clave** (H4).
- `401` de token en el POST: cierre de sesión igual que T2 § 4 (`sesion-aviso[data-motivo="token"]`).

### 4.5 · Comprobante (catálogo § 4.6, S-19)
- En `transferir-exito`, `transferir-comprobante-pdf` abre una pestaña **sincrónicamente en el clic**
  (antes de cualquier `await`), trae `GET /transferencias/<transaccionId>/comprobante.pdf` con `fetch` y
  `Authorization: Bearer`, y le asigna a esa pestaña la URL `blob:` del PDF. La página de la app no navega.
- Falla (red o no-`200`): J7.

## 5 · Brazos del arnés (fijados antes de la entrega; no se tocan después)

Un solo runner, **`npm run verificar:s10-t3`** (`scripts/verificar-s10-t3.{sh,mjs}`), que monta los
artefactos igual que el de T2. Las fallas de red se provocan **en la red del navegador** (`page.route`),
nunca dentro de la app. Las respuestas de negocio (`201`, `4xx`, repetida) las da el **backend real**.
El efecto de cada envío se mide **en el saldo por el API** (`GET /cuentas`), no en la pantalla.

**Los brazos de T1 y T2 siguen corriendo aquí** con su texto, salvo:
- R1 compara contra `specs/S-10-testids-T3.txt` (69 = los 38 de T2 + 31 de T3).
- **N3 se endurece** (el clic navega ya tiene segunda pantalla): parte desde la vista **Transferir**; verde
  si tras el clic en `nav-cuentas` Resumen queda visible con k+1 filas y `transferir-pasos` ya no está.

Desde T3, `verificar:s10-t2` queda como registro histórico.

| # | Brazo | Verde si |
|---|---|---|
| B3 | CORS expone la cabecera | un `POST /transferencias` crudo con `Origin: http://localhost:4200` y respuesta repetida trae `Access-Control-Expose-Headers` con `Idempotency-Replayed` |
| V1 | `nav-transferir` | escritorio: clic → `transferir-pasos` visible, se pidió `GET /cuentas`, sin `cuentas-region`; `nav-transferir` tiene rol `link` |
| V2 | `ir-transferir` (retirado en UX-b1, O5: a Transferir se llega por `nav-transferir`) | desde Resumen en `listo`, clic → `transferir-pasos` visible y sin `cuentas-region` |
| V3 | panel de teléfono | panel abierto → `nav-transferir` visible sin otro gesto; clic → `nav-panel` oculto y `transferir-pasos` visible |
| V4 | sin cuentas | usuario con 0 cuentas → `transferir-sin-cuentas` visible y sin `transferir-pasos` |
| A1 | pestañas | `transferir-pasos` con rol `tablist`; los tres pasos con rol `tab`, en orden; al entrar: Origen `aria-selected="true"`, Destino y Revisar `aria-selected="false"`, Revisar `aria-disabled="true"`; cada `aria-controls` apunta a un `role=tabpanel` existente y sólo el de Origen es visible |
| A2 | no se salta | en Destino con el monto vacío: clic en `transferir-paso-revisar` y en `transferir-destino-siguiente` → Destino sigue `aria-selected="true"` y el panel de Revisar sigue oculto |
| A3 | existe pero no se ve | en Revisar: `transferir-origen` y `transferir-monto` están en el DOM y **no visibles**; con `transferir-revisar-volver` y `transferir-destino-volver`, el origen elegido (la **segunda** cuenta) y el monto `"250.10"` siguen ahí |
| A4 | flechas | foco en `transferir-paso-origen`, Destino habilitado y Revisar no: → → Destino `aria-selected` y con foco; → → Origen (salta Revisar); ← → Destino |
| A5 | Mis cuentas sin el origen | con 2 cuentas: origen = la primera → las opciones de `transferir-destino-propia` son sólo la segunda; origen = la segunda → sólo la primera |
| A6 | monto literal | monto `"250.10"` → `transferir-revisar-monto[data-monto="250.10"]`, y el cuerpo del POST confirmado lleva `monto: "250.10"` con el `origenId` y `destinoId` elegidos |
| D1 | modal en Shadow DOM | clic en `transferir-enviar` → `confirmar-dialogo` visible, su `getRootNode()` es un `ShadowRoot` con `mode === 'open'`, con `role="dialog"`, `aria-modal="true"` y `aria-labelledby` resuelto **en esa raíz** a un elemento con texto; **cero** `POST /transferencias` |
| D2 | foco atrapado | al abrir, el foco (profundo, atravesando shadow roots) está en `confirmar-cancelar`; tras 6 Tab y luego 6 Shift+Tab, en cada paso el foco profundo está dentro de `confirmar-dialogo` |
| D3 | cancelar | (a) clic en `confirmar-cancelar` y (b) Escape, cada uno por separado: `confirmar-dialogo` oculto o ausente, foco en `transferir-enviar`, cero POST |
| T1 | éxito | `confirmar-aceptar` → un POST con `Idempotency-Key` no vacía; `201`; `transferir-exito` visible con `transferir-transaccion-id` = `transaccionId` de la respuesta y **sin** `transferir-repetida`; por el API, origen −250.10 y destino +250.10 |
| T2 | doble clic | doble clic en `confirmar-aceptar` → todos los POST llevan **la misma** clave y, por el API, el origen baja **una sola vez** |
| T3 | clave nueva por operación | tras T1, `transferir-nueva` → Origen `aria-selected="true"`; un segundo envío confirmado lleva una clave **distinta** de la primera |
| T4 | rechazo con código | monto `"5000.00"` → `transferir-error[data-codigo="FONDOS_INSUFICIENTES"]` visible, `transferir-paso-revisar` `aria-selected="true"`, `data-estado="error"`; saldo sin cambio |
| T5 | validación con código | tres casos, cada uno desde el asistente: monto `"12,50"` → `MONTO_INVALIDO`; «Otras cuentas» con el id del **propio origen** → `MISMA_CUENTA`; con el id inexistente de § 3 → `CUENTA_NO_ENCONTRADA`; cada uno en `transferir-error[data-codigo]` |
| T6 | sin respuesta, ejecutada | el POST llega al backend (`route.fetch`) y su respuesta se pierde (`route.abort`) → `transferir-sin-respuesta` visible, sin `transferir-error`; `transferir-reintentar` → POST con **la misma** clave, `transferir-exito` **con** `transferir-repetida`; por el API, el origen baja **una sola vez** |
| T7 | sin respuesta, no ejecutada | el POST se aborta **antes** del backend → `transferir-sin-respuesta`; reintentar (misma clave) → `transferir-exito` **sin** `transferir-repetida`; el origen baja una vez |
| T8 | token en el POST | `Authorization` quitada en el POST → `401 TOKEN_AUSENTE` del backend; sin `usuario-email`, `sesion-aviso[data-motivo="token"][data-codigo="TOKEN_AUSENTE"]` |
| P1 | comprobante | con el `GET …/comprobante.pdf` **retenido en la red**: clic en `transferir-comprobante-pdf` → la pestaña nueva aparece **antes** de liberarlo; la petición lleva `Authorization: Bearer` y el `transaccionId` en la ruta; liberada, la pestaña emite una descarga con URL que empieza con `blob:http://localhost:4200/`, cuyo archivo empieza con `%PDF-` y cuyo texto (unpdf) contiene el `transaccionId`; la página de la app sigue en `transferir-exito` |
| P2 | comprobante que falla | el `GET …/comprobante.pdf` respondido una vez con `500` → la pestaña nueva se cierra y hay un `role="alert"` dentro de `transferir-exito` |

A2, D1 («cero POST»), D3, T1 y T7 («sin repetida») y V1–V4 («sin …») afirman una **ausencia**. Cada uno
se sincroniza antes con un evento observable (un `aria-selected` que cambia, un `data-estado`
terminal, `transferir-exito` visible, o la respuesta del POST capturada) y recién después mira.
Nada de esperas por tiempo.

### 5.1 · Enmienda previa a la entrega (ataque al arnés)

El ataque a ciegas (15 + 9 hallazgos, 19 distintos ciertos o plausibles, 2 falsos, 3 en común)
cazó estos huecos **antes** de que existiera la pantalla. Se enmienda el árbitro; nada se debilita.

**Imposibles (rojos sobre una app correcta):**
- **N3:** `k` se cuenta por el API (cuentas del usuario antes de abrir la nueva), no con las filas que
  hay en Transferir: con J5, allí hay 0.
- **P1:** la petición del PDF se espera **por condición**, con tope, después de que aparece la pestaña;
  una app correcta abre la pestaña antes de que salga el `fetch`.
- **A3, T3 y A2:** eligen el destino **explícitamente**; la spec no dice si «Mis cuentas» trae uno
  preseleccionado. Esto además cierra un ciego: sin destino, A2 no veía M4.
- **T5:** cada uno de sus tres casos parte de una página nueva; la spec no dice qué hace `nav-transferir`
  estando ya en Transferir.
- **Helpers:** tras cambiar de modo o de paso, los controles se esperan **por condición** y, si no
  llegan, el brazo da rojo con motivo «preparación». Ningún paso de preparación se salta en silencio.
- **A5 y A3:** los selectores son nativos (J8).
- **R1:** se recolecta también con el modo «Otras cuentas» activo (T5), para ver `transferir-destino-id`.

**Frágil:** A2 ya no se sincroniza con un `requestAnimationFrame`. Tras los clics que no deben tener
efecto, llena el monto y espera que `transferir-paso-revisar` deje de tener `aria-disabled="true"` (un cambio
observable posterior). Recién entonces mira que Destino siga seleccionado. Antes de los clics, además,
exige `aria-disabled="true"` en Revisar.

**Ciegos (defectuosa en verde) que se endurecen:**
- **A1:** el orden de los tres `role=tab` dentro de `transferir-pasos` es Origen, Destino, Revisar.
- **D1:** `confirmar-aceptar` y `confirmar-cancelar` están en la **misma** raíz que `confirmar-dialogo`.
- **D2:** en el ciclo de Tab, el foco pasa **por los dos** botones.
- **T1:** `transferir-exito` tiene `role="status"`, y la `Idempotency-Key` tiene forma de UUID.
- **T2:** el doble clic se da como **dos `click()` sincrónicos** sobre `confirmar-aceptar`, dentro de la
  página y antes de cualquier repintado. Con `page.dblclick`, el primer clic podía cerrar el diálogo y
  el segundo no llegar al botón, así que M16 pasaba (plausible, sin medir).
- **T3:** tras `transferir-nueva`, el monto está vacío (asistente limpio) antes de volver a escribirlo.
- **T5:** cada código de `transferir-error[data-codigo]` es **el de la respuesta del POST capturado**
  (hubo un POST y respondió ese código). Un cliente que pinta el código sin preguntar no pasa.
- **Brazo nuevo T9 · enviando:** con el POST retenido en la red: `transferir-form[data-estado="enviando"]`,
  `aria-busy="true"` y `transferir-enviar` deshabilitado. Al liberarlo, `transferir-exito`. Total: **56 brazos**.

**Falsos (no se enmiendan):** V4 con el asistente dibujado pero oculto (no se ve, que es lo que pide
«sin asistente»), y el texto visible de `transferir-revisar-monto` distinto de `data-monto` (C3: el
texto es libre).

### 5.2 · Enmienda tras la entrega

- **A2 era IMPOSIBLE:** `page.click` sin `force` no hace clic sobre un elemento con `aria-disabled="true"`
  (playwright-core 1.60 lo trata como deshabilitado y espera hasta el tope). Como § 4.2 exige ese atributo,
  A2 daba rojo sobre toda app correcta. Medido: la entrega dio **55/56** con
  `A2 ROJO: excepción: page.click: Timeout 8000ms exceeded`; la sonda lo reprodujo en
  aislamiento (botón y `div role=tab` con `aria-disabled`, y `disabled` nativo: los tres hasta el tope; con
  `force: true`, el clic llega). Se enmienda con `{ force: true }` en los dos clics que no deben tener efecto:
  un usuario real sí entrega ese clic, y lo que A2 mide es que no active nada. Nada se debilita: sin
  `force`, A2 nunca llegaba a mirar. Lo prueba M4 en la calibración. Errata: la enmienda § 5.1
  se midió sobre código sin T3, donde A2 salía antes de esos clics.

## 6 · Defectos de calibración (fijados antes de medir)

| # | Defecto inyectado | Debe cazarlo |
|---|---|---|
| M1 | `nav-transferir` con el testid renombrado | R1 |
| M2 | activar `nav-transferir` en el panel de teléfono no cierra el panel | V3 |
| M3 | con cero cuentas se dibuja el asistente | V4 |
| M4 | Revisar se habilita sin monto | A2 |
| M5 | los paneles inactivos salen del DOM (`@if`) en vez de `hidden` | A3 |
| M6 | las flechas no saltan la pestaña deshabilitada | A4 |
| M7 | «Mis cuentas» incluye el origen | A5 |
| M8 | el monto pasa por `Number()` antes de enviarse | A6 |
| M9 | `transferir-enviar` hace el POST directo, sin modal | D1 |
| M10 | `zfb-dialogo` con encapsulación emulada (sin shadow root) | D1 |
| M11 | el título del diálogo fuera del shadow root (`aria-labelledby` no resuelve) | D1 |
| M12 | sin trampa de foco | D2 |
| M13 | cancelar no devuelve el foco a `transferir-enviar` | D3 |
| M14 | Escape no cierra el modal | D3 |
| M15 | una clave fija para toda la sesión | T3 |
| M16 | cada clic en `confirmar-aceptar` genera clave y POST nuevos | T2 |
| M17 | el rechazo lleva el asistente de vuelta a Destino | T4 |
| M18 | el cliente valida el formato del monto y no deja pasar `"12,50"` | T5 |
| M19 | reintentar genera una clave nueva | T6 |
| M20 | `transferir-repetida` se muestra tras todo reintento | T7 |
| M21 | CORS sin `exposedHeaders` (el `main.ts` de hoy) | B3 |
| M22 | el `401` del POST cae en `transferir-error` | T8 |
| M23 | la pestaña se abre después del `fetch` | P1 |
| M24 | la pestaña navega a la URL del PDF sin token | P1 |
| M25 | si el PDF falla, la pestaña queda abierta | P2 |
| M26 | la falla de red sale como `transferir-error[data-codigo="SIN_RESPUESTA"]` | T6 |
| M27 | `transferir-nueva` conserva el monto anterior (§ 5.1) | T3 |
| M28 | la trampa de foco deja el foco fijo en `confirmar-cancelar` (§ 5.1) | D2 |
| M29 | `aria-busy` fijo en `"false"` durante el envío (§ 5.1) | T9 |
| M30 | el cliente pinta `MONTO_INVALIDO` sin hacer el POST (§ 5.1) | T5 |
| M31 | los botones del diálogo fuera del shadow root (§ 5.1) | D1 |
| M32 | los pasos en otro orden en el DOM (§ 5.1) | A1 |
| M33 | `transferir-exito` sin `role="status"` (§ 5.1) | T1 |
| M34 | la `Idempotency-Key` es un contador, no un UUID (§ 5.1) | T1 |

Número esperado: **34/34**, cada uno por su brazo. Sobre el código intacto: todos los brazos verdes.
Un ancla ausente en el calibrador cuenta como **no cazado** (BITÁCORA #130). M21 se inyecta en
`src/main.ts`, así que el calibrador reconstruye el backend para ese defecto.

### 6.1 · Calibración medida

Contra la tabla fijada: **33/34**. El único NO, **M31**, no era un brazo ciego sino un defecto que no se
inyectaba: la mitad B proyectaba los botones con `<ng-content>`, y Angular proyecta moviendo los nodos
a la vista del componente, **dentro** del shadow root; D1 los vio en la misma raíz (`D1 OK`), que es lo
correcto. La inyección se rehizo (botones como hermanos del host, en el DOM exterior); la fila de M31
no cambia. Resultado con M31 rehecho: **34/34** (M31 sola cazada por D1). Una corrida quedó en pausa ~49 min por
suspensión del equipo (tapa, 15:54); ningún NO coincide con ella.

## 7 · Batería que no debe moverse

Integración 368/368 · dominio 122/122 · invariantes 5/5 · guante 6/6 · typecheck y build en exit 0.
`calibrar:s10-t2` sigue midiendo su código: los brazos de T2 viven dentro de `verificar:s10-t3`.

## 8 · Alcance de archivos (fijado antes)

```
web/src/**                      frontend de T3
src/main.ts                     exposedHeaders (H1)
scripts/verificar-s10-t3.*      árbitro (fijado antes)
specs/S-10-testids-T3.txt       contrato de testids (fijado antes)
package.json                    scripts verificar:s10-t3 / calibrar:s10-t3
```
