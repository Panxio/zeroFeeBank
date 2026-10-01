# S-10 · Catálogo de desafíos del frontend — spec

> Estado: **aprobada la entrada** (2026-09-11). Construcción: pendiente.
> Entrada: la síntesis de 15 filas + respuestas a D-a…D-f.
> Complementa a `specs/S-10-frontend.md` (el prototipo v0 congelado). Donde esta spec cambia algo
> del v0, lo dice con la palabra **cambia** y es la versión vigente.

## 1 · Qué hace, qué queda fuera, cuándo está hecho

- **Hace:** fija qué desafíos de entrevista de QA automation lleva el frontend, en qué pantalla y
  por qué patrón bancario real; y el contrato de `data-testid` **v1**.
- **Fuera:** teclado virtual (D-a) · subida de archivos (regla inventada) · pestañas nuevas
  «porque sí» · alertas nativas, arrastrar y soltar, captcha, scroll infinito (descartadas)
  · segundo factor en la confirmación (no existe en el backend) · préstamo (S-16, P1).
- **Hecho (construcción):** § 7 de `S-10-frontend.md`, aplicado a la lista v1 de § 6 de esta spec.

## 2 · Decisiones de producto — no se rediscuten

| # | Pregunta | Respuesta |
|---|---|---|
| D-a | Teclado virtual | **Fuera** |
| D-b | Comprobante descargable | **PDF generado por el backend** al clic en el ícono de descarga: en el éxito de la transferencia, y en la boleta **al emitirla y al cerrarse** |
| D-b′ | Fecha en el comprobante | **La deuda del reloj va primero** (unidad propia) y el PDF lleva fecha real |
| D-c | Expiración de sesión | Por **inactividad**: aviso a los **90 s**, cuenta atrás de **60 s**, cierre a los **150 s** |
| D-d | `Cuentas ▾` | «Lo más desafiante para la automatización» → **hover** en escritorio (§ 4.4) |
| D-e | Pestañas | Las del **DOM**, no las del navegador: la transferencia es un **asistente por pasos** (1 Origen · 2 Destino · 3 Revisar), como en la banca en línea de Santander y Scotiabank Chile. La pestaña del navegador se fija en § 4.6 |
| D-f | Modal de confirmación | **Aprobado**; el paso 3 es *Revisar* y «Transferir» abre el modal |

## 3 · El catálogo (vigente)

| # | Desafío | Patrón bancario real | Pantalla | Unidad | Estado |
|---|---|---|---|---|---|
| 1 | iframe de otro origen | la página anfitriona no puede leer la clave | popover de login | S-10 | § 4.1 |
| 2 | doble clic / reintento | idempotencia D5 | Transferir | S-10 | v0 |
| 3 | caída de red | «no sé si se envió» ≠ rechazo (P2 de S-10) | Transferir | S-10 | v0 |
| 4 | esperar sin `sleep` | el saldo llega con latencia (C4) | Resumen | S-10 | v0 |
| 5 | Shadow DOM | componente de diálogo de sistema de diseño | diálogos | S-10 | § 4.3 |
| 6 | modal con foco atrapado | mover plata no se deshace | Transferir | S-10 | § 4.2 |
| 7 | expiración por inactividad | sesión olvidada en equipo compartido | estructura base | S-10 | § 4.5 |
| 8 | validación con código | C5 | Transferir | S-10 | v0 |
| 9 | portapapeles | copiar el número de cuenta | Resumen | S-10 | v0 |
| 10 | menú por hover + hamburguesa | la banca web se usa también desde el teléfono | barra superior | S-10 | § 4.4 |
| 11 | canvas animado + prueba visual | portada de marca | Portada | S-10 | § 4.7 |
| 12 | pestaña nueva del navegador | comprobante que se abre en el visor del navegador | Transferir | S-10 + backend | § 4.6 |
| 13 | descarga de archivo | comprobante y resumen de la boleta | Boletas | S-17 + backend | § 4.6 |
| 14 | pestañas del DOM (asistente) | transferencia por pasos (D-e) | Transferir | S-10 | § 4.2 |
| 15 | tabla con filtros y tope | extracto S-13 | Movimientos | S-17 | backend S-13 |
| 16 | estados que dependen del tiempo | boleta VIGENTE → COBRADA \| VENCIDA \| DEVUELTA (nace VIGENTE: EMITIDA no existe en el dominio, HU-02 J3) | Boletas | S-17 | backend S-09 · `specs/S-17-boletas.md` |
| 17 | elemento efímero (toast) | confirmación no bloqueante | Contacto | S-17 | `role=status` |

## 4 · Decisiones de implementación

### 4.1 · Login en iframe y contrato `postMessage`
- El marco lo **sirve el backend** (`GET /auth/marco`, origen `:3000`); la app Angular vive en otro
  origen (`:4200`). Dos orígenes en dev y en CI sin un tercer servidor.
- Dentro del marco viven login y registro (los dos llevan contraseña) con sus testids v0.
- Contrato **v1**, sólo del marco a la anfitriona, con `targetOrigin` exacto (**nunca** `*`):
  `{v:1, tipo:'zfb.auth.listo'}`, `{v:1, tipo:'zfb.auth.sesion', token, expiraEn}` y
  `{v:1, tipo:'zfb.auth.cerrar'}`.
- **`zfb.auth.cerrar`** (se añade con la dirección visual): el marco lo envía al presionar
  **Esc** dentro de él; la anfitriona cierra `login-popover` y devuelve el foco a `login-abrir`.
  Por qué: al abrir, el foco entra al marco, y como es de otro origen **el Esc no llega a la
  anfitriona**: sin este mensaje, el popover no se cierra con el teclado (accesibilidad, línea
  roja). Se valida igual que los otros dos (origen, `source`, `v`, `tipo`). Hallado al construir
  la dirección visual.
- La anfitriona descarta todo mensaje con `event.origin` distinto del origen de auth, con
  `event.source` distinto del `contentWindow` del marco, o con `v`/`tipo` desconocidos.

### 4.2 · Transferir: asistente de 3 pasos + modal (cambia el v0)
- `role=tablist` con 3 `role=tab`: **1 Origen** · **2 Destino** (destino + monto) · **3 Revisar**.
  Un paso no se habilita (`aria-disabled`) hasta que el anterior es válido; flechas ←/→ entre
  pestañas habilitadas. Los paneles inactivos quedan en el DOM con `hidden`: el estado del
  formulario se conserva al volver, y el desafío es que el elemento **existe pero no se ve**.
- En *Revisar*, `transferir-enviar` **cambia**: ya no envía, abre el modal de confirmación.
  *Confirmar* hace el POST con una `Idempotency-Key` nueva; *Cancelar* cierra y devuelve el foco a
  `transferir-enviar`. Los estados v0 (sin respuesta, reintentar, éxito, repetida) siguen igual,
  después de confirmar. Un rechazo del API se muestra en *Revisar* con `transferir-error[data-codigo]`.

### 4.3 · Shadow DOM: el diálogo
- Un solo componente, `zfb-dialogo` (`ViewEncapsulation.ShadowDom`, raíz **abierta**: una cerrada
  deja los testids inalcanzables y rompe C3), con dos usos: confirmar transferencia e inactividad.
- `role=dialog` + `aria-modal` + `aria-labelledby` **dentro** de la misma raíz (una referencia ARIA
  no cruza el límite del shadow); foco atrapado; Escape = cancelar (en inactividad = seguir).

### 4.4 · `Cuentas ▾` por hover (D-d)
- Escritorio (≥ 768 px): `nav-cuentas` es un **enlace a Resumen**; el submenú se abre con el puntero
  encima y se cierra 300 ms después de salir (tolera el paso en diagonal al submenú). El clic
  **navega**, no abre: la automatización por puntero tiene que hacer hover de verdad.
- Teclado (línea roja de accesibilidad): ↓ sobre `nav-cuentas` abre el submenú, Escape lo cierra,
  `aria-expanded` refleja el estado.
- Teléfono (< 768 px): `nav-hamburguesa` abre un panel lateral con todos los ítems planos, por clic.
- En S-10 el submenú trae sólo Resumen; Movimientos y Abrir cuenta llegan con sus pantallas (S-17).
  Un ítem hacia una pantalla que no existe sería la app mintiendo.

### 4.5 · Inactividad (D-c)
- Actividad = `keydown`, `pointerdown`, `wheel`. **No** cuentan `pointermove` (un roce del mouse no
  debe sostener una sesión en un equipo compartido) ni las llamadas al API.
- A los **90 s** se abre el diálogo con la cuenta atrás visible y `inactividad-segundos[data-segundos]`,
  anunciada con `aria-live="polite"` cada 10 s. *Seguir conectado* reinicia; *Salir* o **0 s** →
  logout y vuelta a la portada con `sesion-aviso[data-motivo="inactividad"]`. Los 60 s cumplen WCAG
  2.2.1 (avisar y dar ≥ 20 s para extender).
- `data-motivo` y no `data-codigo`: la inactividad es **estado del cliente**, como `SIN_RESPUESTA`
  (P2 de S-10). El token de 60 min de S-08 sigue: si vence antes, `data-motivo="token"`.
- **Costura del reloj del navegador (C2):** el temporizador usa un `RelojService` inyectado. Con el
  flag de pruebas del build, la app expone `window.__zfb__.reloj.avanzar(ms)`; sin el flag, no
  existe (análogo a las rutas `/__test__`). Sirve a cualquier framework que ejecute JS (Selenium
  incluido); `page.clock` de Playwright o `cy.clock` también sirven, pero no son la costura.

### 4.6 · PDFs: pestaña nueva y descarga (D-b)
- Backend, unidades propias (**fuera de S-10**): `GET /transferencias/:id/comprobante.pdf`,
  `GET /boletas/:id/comprobante.pdf` (al emitir) y `GET /boletas/:id/resumen.pdf` (en estado final;
  si no lo está, error tipado). Con token, dueño o `404` (lo ajeno = inexistente, como S-13).
  Fechas del PDF, **metadatos incluidos**, desde el reloj inyectado; nunca del reloj de pared.
- **Transferencia → pestaña nueva:** el ícono abre el PDF en el visor del navegador. Como el token va
  en un header, el cliente abre la pestaña **sincrónicamente en el clic** (si no, el bloqueador de
  ventanas la corta), trae el PDF con `fetch` y le asigna la URL `blob:`.
- **Boleta → descarga:** `fetch` + `a[download]` con nombre estable (`boleta-<id>-comprobante.pdf`).
- Así cada desafío (#12 y #13) vive en un sitio distinto, y los dos con un patrón real.
- Podado: URL firmada de corta vida (más realista, pero es un mecanismo de auth nuevo; Pilar 0).
- ⚠️ Depende de la **deuda del reloj**, que alcanza también a `transaccion.creada_en`
  (`prisma/schema.prisma`, `@default(now())`): sin ella, ni la hora del comprobante ni la **fecha
  de cierre** del resumen de la boleta son controlables.

### 4.7 · Canvas congelable
- La bruma se genera con ruido procedural de **semilla fija** (sin `Math.random`).
- Con `prefers-reduced-motion: reduce` dibuja **un solo cuadro, el de t = 0**, y marca
  `portada-bruma[data-estado="congelado"]` (si no, `"animando"`). No hay flag de prueba aparte:
  la preferencia del sistema **es** la costura, un estado real que los tres frameworks emulan.
- Baseline visual: la portada congelada, un viewport de escritorio y uno de teléfono.

## 5 · Orden de construcción (recomendado)

1. Deuda del reloj (`creado_en` / `creada_en` desde el reloj inyectado) — backend. ✅ Hecho.
2. PDFs — backend (con el arnés ya dado). ✅ Hecho (`specs/S-19-comprobantes-pdf.md`, en `main`): el testid `transferir-comprobante-pdf` entra, total **73**.
3. Dirección visual en UN artifact (portada + popover). ✅ Hecho (aprobado con capturas): suma `zfb.auth.cerrar` (§ 4.1) y fuentes empaquetadas (`S-10-frontend.md` § 5); testids siguen **73**.
4. Construcción de S-10 en Angular; los botones de PDF entran si 2 ya está en `main`. Trozada en 4: **T1** portada + acceso ✅ (`specs/S-10-T1-acceso.md`) · **T2** barra + Resumen ✅ (`specs/S-10-T2-barra-resumen.md`) · **T3** Transferir ✅ (`specs/S-10-T3-transferir.md`) · **T4** inactividad + baseline visual ✅ (`specs/S-10-T4-inactividad.md`).

## 6 · Contrato `data-testid` v1

**Se mantienen** los 45 de v0 (`S-10-frontend.md` § 4). Cambian de **documento**, no de nombre:
`login-*`, `registro-*`, `ir-registro`, `ir-login` viven **dentro del iframe**. Cambia de
**comportamiento**: `transferir-enviar` (§ 4.2). `sesion-aviso` gana `data-motivo`.

**Nuevos en S-10 (27):**
- Portada y acceso: `portada` `portada-bruma` (+ `data-estado`) `login-abrir` `login-popover` `login-marco`
- Barra: `nav-cuentas` `nav-cuentas-menu` `nav-usuario` `nav-usuario-menu` `nav-hamburguesa` `nav-panel`
- Asistente: `transferir-pasos` `transferir-paso-origen` `transferir-paso-destino` `transferir-paso-revisar`
  `transferir-origen-siguiente` `transferir-destino-volver` `transferir-destino-siguiente`
  `transferir-revisar-volver` `transferir-revisar-monto` (+ `data-monto`)
- Diálogos (dentro del shadow root): `confirmar-dialogo` `confirmar-aceptar` `confirmar-cancelar`
  `inactividad-dialogo` `inactividad-segundos` (+ `data-segundos`) `inactividad-seguir` `inactividad-salir`

**Condicionado a la unidad de PDFs (1):** `transferir-comprobante-pdf`.

**Reservados para S-17** (no se renderizan en S-10): `nav-movimientos` `nav-abrir-cuenta`
`nav-pagos` `nav-boletas` `nav-contacto` `boleta-comprobante-pdf` `boleta-resumen-pdf`.
`nav-boletas`, `boleta-comprobante-pdf` y `boleta-resumen-pdf` están en el contrato de
S-17-boletas (`specs/S-17-testids-boletas.txt`, 47 nuevos).

Total vigente al construir S-10: **45 + 27 = 72** (73 con el PDF).
