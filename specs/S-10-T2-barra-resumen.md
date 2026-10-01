# S-10 · T2 — Barra superior y Resumen de cuentas

> Estado: **cerrada** (2026-09-11): `verificar:s10-t2` 31/31 (27/31 contra el fijado) ·
> `calibrar:s10-t2` 17/19 fijada → 19/19 enmendada. Trozo 2 de 4 de S-10: T1 portada
> + acceso ✅ · **T2** barra + Resumen · T3 Transferir · T4 inactividad + baseline visual.
> Fuentes: `S-10-catalogo.md` § 4.4 y § 6, `S-10-frontend.md` § 2 y § 5, el prototipo congelado
> `S-10-prototipo.html` v4 (flujos, estados y códigos), y la deuda de las fuentes del marco.
> Lo visual sigue la dirección visual; la aprobación es con captura.

## 1 · Qué hace, qué queda fuera, cuándo está hecho

- **Hace (frontend, `web/`):** tras el login, la vista de sesión pasa a ser **barra superior + Resumen**.
  Barra: `Cuentas ▾` (hover en escritorio, teclado, hamburguesa en teléfono) y menú de usuario con
  `Salir`. Resumen: `GET /cuentas` con sus cuatro estados declarados (C4), copiar el id y el saldo
  crudo en `data-monto`. Un `401` de token en cualquier llamada cierra la sesión con `sesion-aviso`.
- **Hace (backend):** el marco (`GET /auth/marco`) carga **Jost** empaquetada desde su propio origen.
- **Fuera:** Transferir, `nav-transferir` e `ir-transferir` (T3: un ítem hacia una pantalla que no
  existe es la app mintiendo, catálogo § 4.4) · Movimientos, Abrir cuenta, Pagos, Boletas, Datos de
  contacto (S-17, testids reservados) · inactividad y `data-motivo="inactividad"` (T4) · URL por
  pantalla y enlaces profundos (el token vive en memoria: recargar ya cierra la sesión, T1) ·
  `TOKEN_EXPIRADO` de verdad (ver § 7).
- **Hecho:** los brazos de § 5 en verde sobre el **artefacto entregado** (el `dist/` del backend y el
  build de producción de `web/`, servidos), cada defecto de § 6 cazado por su brazo, y se compara
  la vista de sesión en escritorio y teléfono: respuesta + captura.

## 2 · Constantes

| Constante | Valor | Porqué |
|---|---|---|
| Corte escritorio / teléfono | **768 px** de ancho | catálogo § 4.4 |
| Cierre diferido del submenú | **300 ms** tras salir el puntero | catálogo § 4.4: tolera el paso en diagonal al submenú |
| Ventana que acepta el arnés para ese cierre | **[280, 1500] ms** | un temporizador no dispara antes de su plazo (el piso deja 20 ms de redondeo del reloj); el techo absorbe una máquina cargada sin aceptar «no cierra nunca» |
| Viewports del arnés | escritorio **1280×800** · teléfono **390×844** | uno a cada lado del corte, con margen; el de teléfono es un móvil común |
| Fuentes del marco | Jost **400** y **500** | las dos que usa hoy su CSS (`marco.pagina.ts:15` y `:22`) |
| Rutas de las fuentes | `GET /auth/marco/fuentes/jost-400.woff2` y `…/jost-500.woff2` | bajo el prefijo del marco, mismo origen: no hace falta tocar la CSP |
| Paquete de la fuente (backend) | `@fontsource/jost` **5.3.0** en la raíz | la misma versión que ya usa `web/`; el backend no lee `web/node_modules` |

## 3 · Barra superior (sesión iniciada)

- **Un solo marcado para las dos anchuras.** Ningún `data-testid` aparece dos veces en el DOM, salvo
  los de fila (`cuenta-fila`, `cuenta-id`, `cuenta-copiar-id`, `cuenta-saldo`). Con dos copias
  —una oculta—, `getByTestId` de cualquier framework es ambiguo, y el modo estricto de Playwright falla.
- `nav-panel` contiene los ítems de navegación. En escritorio se ve en la barra; en teléfono está
  oculto hasta que se abre con `nav-hamburguesa`.
- **`nav-cuentas`** es un **enlace** (rol `link`) a Resumen. `nav-cuentas-menu` contiene sólo `nav-resumen`.
  - Escritorio: el submenú se abre con el puntero encima y se cierra 300 ms después de que sale.
    `aria-expanded` en `nav-cuentas` refleja el estado.
  - **El clic navega, no abre:** activar `nav-cuentas` o `nav-resumen` muestra Resumen y **vuelve a
    pedir `GET /cuentas`** (prototipo v0, `ir("resumen")`), **sin recargar el documento** (recargar
    borraría el token).
  - Teclado: ↓ sobre `nav-cuentas` abre el submenú y lleva el foco a `nav-resumen`; Escape lo cierra,
    `aria-expanded="false"` y el foco vuelve a `nav-cuentas`.
- **`nav-usuario`** es un botón que muestra el email (`usuario-email` va dentro) y abre por clic
  `nav-usuario-menu`, que contiene `salir`. `aria-expanded` refleja el estado; Escape lo cierra y
  devuelve el foco a `nav-usuario`.
- **Teléfono (< 768 px):** `nav-hamburguesa` (visible sólo en teléfono, con `aria-expanded`) abre
  `nav-panel` como panel lateral **por clic**. Adentro, todos los ítems quedan **planos**: `nav-resumen`,
  `usuario-email` y `salir` se ven sin abrir submenús. Activar un ítem cierra el panel. Escape lo cierra y
  devuelve el foco a `nav-hamburguesa`.
- `salir` hace lo mismo que en T1: borra el token, vuelve a la portada y deja el foco en `login-abrir`.

## 4 · Resumen y cierre por token

- `cuentas-region` declara su estado en **`data-estado`** ∈ {`cargando`, `listo`, `vacio`, `error`}
  (ASCII, sin tilde) y en `aria-busy` (`"true"` sólo en `cargando`), con `aria-live="polite"` (C4).
  - `cargando`: se ve `cuentas-cargando`.
  - `listo`: `cuentas-tabla` con una `cuenta-fila[data-cuenta-id]` por cuenta, **en el orden del API**,
    sin reordenar. `cuenta-id` muestra el id completo. `cuenta-saldo[data-monto]` es el `saldo` del API
    **literal** (`"1000.00"`); el texto visible es libre (C3). Tabla con `caption` y `th scope`.
  - `vacio` (`{"cuentas": []}`): se ve `cuentas-vacio`, sin tabla. No es un error (S-12).
  - `error`: `cuentas-error` con **`data-codigo`** = el `codigo` del API (C5). Sin respuesta de red:
    `cuentas-error[data-motivo="SIN_RESPUESTA"]` **sin** `data-codigo`, porque es un estado del cliente
    y no un código del banco (P2 de S-10, y el mismo criterio que `login-error` en T1).
    `cuentas-reintentar` vuelve a pedir `GET /cuentas`.
- `cuenta-copiar-id` copia al portapapeles el id de **su** fila, con `aria-label` que nombra la cuenta.
- **Cierre por token:** un `401` con `TOKEN_EXPIRADO`, `TOKEN_INVALIDO` o `TOKEN_AUSENTE` en cualquier
  llamada de la anfitriona borra el token y vuelve a la portada. Allí aparece `sesion-aviso`
  (`role="status"`), con `data-motivo="token"` y `data-codigo` = el código (prototipo v0).
  El foco queda en `login-abrir`, porque el elemento que lo tenía desapareció. El aviso desaparece
  con el siguiente login.

## 5 · Brazos del arnés (fijados antes de la entrega; no se tocan después)

Un solo runner, **`npm run verificar:s10-t2`**, que monta los artefactos igual que el de T1. Usuarios
nuevos por `POST /auth/registro` y cuentas por `POST /cuentas` con su token (API real, sin tocar la
BD). Las fallas de red y de servidor se provocan **en la red del navegador** (`page.route`), nunca
dentro de la app. Los `401` de token los devuelve el **backend real**: el arnés sólo altera la
cabecera `Authorization` de la petición.

**Los brazos de T1 siguen corriendo aquí** (B1, B2, R2–R11) con su texto, salvo dos cambios que trae
esta spec:
- R1 compara contra `specs/S-10-testids-T2.txt` (38).
- R10 abre `nav-usuario` antes de pulsar `salir`.

Desde T2, `verificar:s10-t1` queda como registro histórico y deja de ser un árbitro vigente.

| # | Brazo | Verde si |
|---|---|---|
| R1 | testids | la unión de los testids vistos en el DOM (anfitriona + marco) en todo el recorrido del runner es **igual** a la lista de 38; y en ninguna foto del DOM un testid que no sea de fila aparece dos veces |
| N1 | hover abre | escritorio: `nav-hamburguesa` no visible; hover sobre `nav-cuentas` → `nav-cuentas-menu` y `nav-resumen` visibles, `aria-expanded="true"` |
| N2 | cierre diferido | el puntero sale a un punto neutro; el lapso entre la salida y `aria-expanded="false"` (medido en la página, sin esperas del arnés) cae en [280, 1500] ms |
| N3 | el clic navega | con Resumen en `listo` y k filas, el arnés abre otra cuenta por API y hace clic en `nav-cuentas` → k+1 filas y `usuario-email` sigue presente; `nav-cuentas` tiene rol `link` |
| N4 | teclado | foco en `nav-cuentas`, ↓ → submenú visible, `aria-expanded="true"`, foco en `nav-resumen`; Escape → submenú oculto, `"false"`, foco en `nav-cuentas` |
| N5 | menú de usuario | clic en `nav-usuario` → `nav-usuario-menu` y `salir` visibles, `aria-expanded="true"`; Escape → oculto y foco en `nav-usuario` |
| N6 | hamburguesa | teléfono: `nav-panel` y `nav-cuentas` no visibles; clic en `nav-hamburguesa` → `aria-expanded="true"` y `nav-resumen`, `usuario-email`, `salir` visibles sin otro gesto; Escape → `nav-panel` oculto y foco en `nav-hamburguesa` |
| N7 | panel navega | teléfono, panel abierto, cuenta nueva abierta por API: clic en `nav-resumen` → `nav-panel` oculto y k+1 filas |
| E1 | cargando | `GET /cuentas` retenido en la red → `data-estado="cargando"`, `aria-busy="true"`, `cuentas-cargando` visible; se libera → `"listo"`, `aria-busy="false"`, sin `cuentas-cargando` |
| E2 | vacío | usuario sin cuentas → `data-estado="vacio"`, `cuentas-vacio` visible, sin `cuentas-tabla` |
| E3 | listo, orden y monto | usuario con dos cuentas de saldos distintos (`"0.00"` y `"1000.00"`) → los `data-cuenta-id` en el orden de `GET /cuentas`, cada `data-monto` igual al `saldo` del API y cada `cuenta-id` igual a su id |
| E4 | copiar | clic en `cuenta-copiar-id` de la **segunda** fila → el portapapeles tiene el `data-cuenta-id` de esa fila |
| E5 | error con código | `GET /cuentas` respondido una vez con `500 {"codigo":"ERROR_INTERNO"}` (el código real del filtro, `errores-http.filter.ts:80`) → `data-estado="error"` y `cuentas-error[data-codigo="ERROR_INTERNO"]`; `cuentas-reintentar` → `"listo"` |
| E6 | sin respuesta | `GET /cuentas` abortado una vez → `cuentas-error[data-motivo="SIN_RESPUESTA"]` sin `data-codigo`; `cuentas-reintentar` → `"listo"` |
| S1 | token inválido | `Authorization` alterada a un token mal formado en `GET /cuentas` → el backend responde `401 TOKEN_INVALIDO`; sin `usuario-email`, `sesion-aviso[data-motivo="token"][data-codigo="TOKEN_INVALIDO"]` visible, foco en `login-abrir` |
| S2 | token ausente | `Authorization` quitada → `401 TOKEN_AUSENTE`; mismo cierre con `data-codigo="TOKEN_AUSENTE"` |
| S3 | el aviso se va | tras S1, un login válido → sin `sesion-aviso` |
| F1 | fuentes del marco | en el documento **de `login-marco`**, las caras Jost 400 y 500 de `document.fonts` con `status === 'loaded'`; ninguna petición del marco fuera de `:3000` |
| F2 | rutas de fuente cerradas | las dos rutas de § 2 → `200` con `Content-Type: font/woff2`; `…/fuentes/jost-700.woff2` y `…/fuentes/..%2F..%2Fpackage.json` → `404`, sin el contenido de `package.json` en el cuerpo |

N2, E2, S3 y el «no visible» de N1 y N6 afirman una **ausencia** o un lapso. Cada uno se sincroniza
con un evento observable (un cambio de `aria-expanded`, `data-estado` terminal, o la vista de sesión
ya montada) antes de mirar. Nada de esperas por tiempo.

### 5.1 · Enmienda (aprobada tras medir la entrega)

**S1 y S2 eran imposibles sin una espera por tiempo.** Su preparación (`entrarUI`) esperaba que
`cuentas-region` quedara montada, pero con un `401` inmediato la anfitriona cierra la sesión en el mismo
ciclo y la vista puede no montarse nunca de forma observable. Se compensó dentro de la app con un
`setTimeout` de 80 ms antes de cerrar la sesión: era código escrito sólo para el arnés y se quitó.
Sin él, el arnés fijado dio **27/31** (rojos S1, S2, S3 y R1: sin S1, nadie ve `sesion-aviso`).
**Enmienda:** S1 y S2 se sincronizan con la respuesta `401` de `GET /cuentas`, que ya capturaban, y luego
con `sesion-aviso` visible. **El criterio de verde no cambia.**

### 5.2 · Enmienda (aprobada tras la primera calibración: **17/19**)

**N2 era ciego a M3.** Medía desde que el arnés *pedía* mover el puntero, no desde que el navegador
*procesaba* la salida: con M3 inyectado (cierre en 0 ms) midió **520 ms**, dentro de la ventana. Esa
latencia de entrada en headless es probablemente la bruma, que sigue animándose detrás de la vista de
sesión (observación para T4). **Enmienda:** el lapso se cuenta desde el primer `mouseover` que el
navegador despacha fuera de `nav-cuentas` y `nav-cuentas-menu` (listener de captura en `document`).
La ventana [280, 1500] ms y el criterio no cambian.
El otro no cazado de esa medición, **M8**, no era un brazo ciego sino una **inyección nula**: el
`display: none` de los submenús vive sólo en la media de escritorio, y quitar la regla «planos» del
teléfono no plegaba nada. El ancla se rehízo para inyectar el defecto de verdad; el brazo N6 no cambia.

## 6 · Defectos de calibración (fijados antes de medir)

| # | Defecto inyectado | Debe cazarlo |
|---|---|---|
| M1 | `nav-panel` con el testid renombrado | R1 |
| M2 | `nav-resumen` dibujado dos veces (barra y panel de teléfono) | R1 |
| M3 | el submenú se cierra al instante al salir el puntero | N2 |
| M4 | el submenú no se cierra al salir el puntero | N2 |
| M5 | el clic en `nav-cuentas` abre el submenú en vez de navegar (no pide `GET /cuentas`) | N3 |
| M6 | ↓ no abre el submenú | N4 |
| M7 | Escape en el menú de usuario no lo cierra | N5 |
| M8 | en teléfono, `nav-resumen` sigue plegado dentro de `nav-cuentas-menu` | N6 |
| M9 | activar un ítem del panel no lo cierra | N7 |
| M10 | `aria-busy` fijo en `"false"` | E1 |
| M11 | las cuentas se muestran en orden invertido | E3 |
| M12 | `data-monto` desde un `number` (`"1000"` en vez de `"1000.00"`) | E3 |
| M13 | copiar siempre copia el id de la primera fila | E4 |
| M14 | `cuentas-error` sin `data-codigo` | E5 |
| M15 | la falla de red sale como `data-codigo="SIN_RESPUESTA"` | E6 |
| M16 | sólo `TOKEN_EXPIRADO` cierra la sesión (los otros dos caen en `cuentas-error`) | S1 |
| M17 | `sesion-aviso` no se borra al volver a entrar | S3 |
| M18 | el marco sin `@font-face` (el estado de hoy) | F1 |
| M19 | la ruta de fuentes sirve cualquier archivo del paquete (sin lista cerrada) | F2 |

Número esperado: **19/19**, cada uno por su brazo. Sobre el código intacto: todos los brazos verdes.
Un ancla ausente en el calibrador cuenta como **no cazado** (BITÁCORA #130).

## 7 · Observación fuera de alcance

`TOKEN_EXPIRADO` no se puede provocar de verdad: `auth.service.ts:227` y `:298` leen `Date.now()`, no
el reloj inyectado de la costura (`POST /__test__/reloj`). Por eso S1 y S2 usan los otros dos códigos,
que el backend sí devuelve de verdad. Se anota como deuda (C2 en la autenticación); no se arregla en T2.
