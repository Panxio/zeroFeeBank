# S-10 · T1 — Portada y acceso (marco de login en otro origen)

> Estado: **cerrada** (2026-09-11): `verificar:s10-t1` 13/13,
> `calibrar:s10-t1` 10/12 contra la tabla fijada → 12/12 con la enmienda § 6.1. Tabla fijada
> antes de la entrega. Trozo 1 de 4 de S-10
> (aprobado por el humano): **T1** portada + acceso · **T2** barra + Resumen · **T3**
> Transferir (asistente, `zfb-dialogo` en Shadow DOM, PDF) · **T4** inactividad + baseline visual.
> Fuentes: `S-10-catalogo.md` § 4.1 y § 4.7, `S-10-frontend.md` § 2 y § 5, y la dirección visual
> aprobada (la portada se porta; no se rediseña).

## 1 · Qué hace, qué queda fuera, cuándo está hecho

- **Hace (backend):** `GET /auth/marco` sirve el marco de login/registro, que habla con la
  anfitriona sólo por `postMessage` v1. CORS para el origen de la app.
- **Hace (frontend, `web/`, Angular 21):** portada con la bruma congelable, popover `Login` con el
  iframe del marco, recepción validada de los tres mensajes, `GET /auth/yo` y una vista de sesión
  mínima con `usuario-email` y `salir`.
- **Fuera:** barra de navegación, `Cuentas ▾`, Resumen, `sesion-aviso` (T2) · Transferir y
  `zfb-dialogo` (T3) · inactividad, `window.__zfb__` y baseline visual (T4) · persistir el token
  al recargar (vive en memoria: Pilar 0, y es lo más seguro) · rutas de Angular.
- **Hecho:** los brazos de § 5 en verde sobre el **artefacto entregado** (el `dist/` del backend
  y el build de producción de `web/`, servidos), cada defecto de § 6 cazado por su brazo, y el
  humano compara la portada con la dirección visual de la 28: respuesta + captura.

## 2 · Constantes

| Constante | Valor | Porqué |
|---|---|---|
| `ZFB_ORIGEN_APP` (entorno del backend) | por defecto `http://localhost:4200` | puerto por defecto de `ng serve`; el arnés sirve el build en el mismo puerto para no tener dos configuraciones. Debe ser un origen exacto (`new URL(v).origin === v`): si no, el backend **no arranca** |
| Origen de auth (en `web/`) | `http://localhost:3000` | el puerto del backend (S-00 § Constantes) |
| Versión del contrato | `v: 1` | § 4.1 del catálogo |

## 3 · Contrato del marco (`GET /auth/marco`)

- `200`, `Content-Type: text/html; charset=utf-8`, y `Content-Security-Policy` con
  **`frame-ancestors <ZFB_ORIGEN_APP>`** exacto: sólo la app puede enmarcar el login (sin él, cualquier
  sitio podría enmarcarlo y montar un clickjacking; es la razón real del patrón).
- Todo `postMessage` del marco usa como `targetOrigin` el **`ZFB_ORIGEN_APP` literal; nunca `*`**
  (con `*`, el token viaja a quien sea que enmarque la página).
- Mensajes (sólo del marco a la anfitriona): `{v:1, tipo:'zfb.auth.listo'}` al cargar ·
  `{v:1, tipo:'zfb.auth.sesion', token, expiraEn}` tras un `200` de `POST /auth/login` ·
  `{v:1, tipo:'zfb.auth.cerrar'}` con **Esc** en cualquier punto del marco.
- Login fallido: `login-error` visible con `data-codigo` = el `codigo` del API (C5). Sin respuesta
  de red: `login-error` con `data-motivo="SIN_RESPUESTA"` (estado del cliente, P2).
- Registro: `POST /auth/registro`; con `201`, vuelve a la vista de login con `login-email` ya
  escrito y `registro-exito` visible **en la vista de login** (como el prototipo v0). Fallido:
  `registro-error[data-codigo]`. `ir-registro` / `ir-login` alternan las vistas (la otra queda `hidden`).
- Las llamadas del marco al API son del **mismo origen** (`:3000`): el marco no necesita CORS.

## 4 · La anfitriona (`web/`)

- **Portada** (`portada`): marca, mensaje central y `login-abrir` (píldora arriba a la derecha).
  `portada-bruma`: canvas con ruido procedural de **semilla fija** (sin `Math.random`); con
  `prefers-reduced-motion: reduce` dibuja **un solo cuadro, el de t = 0**, y marca
  `data-estado="congelado"`; si no, `"animando"`. Reacciona al cambio de la preferencia en vivo.
- **Fuentes empaquetadas:** Spectral itálica 300/400 y Jost 400/500/600 desde `@fontsource/*`
  (ya instalados), dentro del build. **Ninguna** petición a un host que no sea `:4200` o `:3000`.
- **Popover** `login-popover` (atributo `popover` nativo) con el iframe `login-marco`
  (`src` = origen de auth + `/auth/marco`, `title` accesible). Declara su carga (C4):
  `login-popover[data-estado="cargando"]` hasta recibir `zfb.auth.listo`, luego `"listo"`.
- **Recepción de mensajes:** se descarta todo mensaje con `event.origin` ≠ origen de auth, con
  `event.source` ≠ `contentWindow` de `login-marco`, con `v` ≠ `1`, con `tipo` desconocido, o con
  `token`/`expiraEn` que no sean `string` no vacíos. Descartar = no hacer nada, en silencio.
- `zfb.auth.sesion` → token en memoria → `GET /auth/yo` (Bearer) → cierra el popover y muestra la
  vista de sesión: `usuario-email` (el email del `yo`) y `salir`. Si `yo` falla, se descarta el
  token y el popover sigue abierto.
- `zfb.auth.cerrar`, o Esc con el foco en la anfitriona → cierra el popover y **devuelve el foco a
  `login-abrir`** (accesibilidad: línea roja).
- `salir` → borra el token, vuelve a la portada con el foco en `login-abrir`.

## 5 · Brazos del arnés (fijados antes de la entrega; no se tocan después)

Un solo runner, `npm run verificar:s10-t1`: levanta `node dist/main.js` (`.env`) y sirve el build de
producción de `web/` en `:4200`, y corre Chromium headless (`playwright-core`) contra los dos.
Los usuarios se crean por `POST /auth/registro` (los sembrados no pueden hacer login: S-07).

| # | Brazo | Verde si |
|---|---|---|
| B1 | cabeceras del marco | `GET /auth/marco` → 200, `text/html`, CSP con `frame-ancestors http://localhost:4200` exacto; el HTML servido no contiene un `postMessage` con `"*"` |
| B2 | CORS | preflight de `GET /auth/yo` con `Origin: http://localhost:4200` → `Access-Control-Allow-Origin` exacto y `Authorization` permitido; con `Origin: http://evil.test` → sin `Access-Control-Allow-Origin` |
| R1 | testids renderizados | la unión de los testids vistos en el DOM (anfitriona + marco) al recorrer portada → popover → registro → login → sesión es **igual** a `specs/S-10-testids-T1.txt` (20): ni falta ni sobra |
| R2 | login | credenciales válidas en el marco → `usuario-email` muestra el email; popover cerrado |
| R3 | registro | registro nuevo → `registro-exito` visible y `login-email` con ese email |
| R4 | error con código | clave errada → `login-error[data-codigo="CREDENCIALES_INVALIDAS"]` |
| R5 | Esc en el marco | foco en `login-email`, Esc → popover cerrado y `document.activeElement` = `login-abrir` |
| R6 | origen ajeno | la anfitriona se envía a sí misma un `zfb.auth.sesion` con un token **válido** → no inicia sesión |
| R7 | `source` ajeno | un segundo iframe del origen de auth (no `login-marco`) envía `zfb.auth.sesion` con token válido → no inicia sesión |
| R8 | versión ajena | `login-marco` envía `{v:2, tipo:'zfb.auth.sesion'}` con token válido → no inicia sesión |
| R9 | bruma congelable | con `reducedMotion: 'reduce'` → `data-estado="congelado"`; sin él → `"animando"` |
| R10 | salir | `salir` → sin `usuario-email`, `login-abrir` visible y con el foco |
| R11 | fuentes empaquetadas | ninguna petición fuera de `:4200`/`:3000`; en `document.fonts`, las caras Spectral itálica 300 y Jost 400 con `status === 'loaded'` (texto alineado al arnés en el cierre de la 32: `document.fonts.check()` da verdadero si la familia no existe, y el arnés nunca lo usó) |

R6–R8 afirman una **ausencia**: cada uno se sincroniza con un evento posterior observable (un
`zfb.auth.cerrar` legítimo del marco, que llega después) y recién entonces mira que no haya sesión.
Nada de esperas por tiempo.

## 6 · Defectos de calibración (fijados antes de medir)

| # | Defecto inyectado | Debe cazarlo |
|---|---|---|
| M1 | un testid de la anfitriona renombrado (`login-abrir`) | R1 |
| M2 | `registro-exito` sin testid en el marco | R1 |
| M3 | la anfitriona no mira `event.origin` | R6 |
| M4 | la anfitriona no mira `event.source` | R7 |
| M5 | la anfitriona no mira `v` | R8 |
| M6 | el marco envía con `targetOrigin` `"*"` | B1 |
| M7 | el marco no envía `zfb.auth.cerrar` con Esc | R5 |
| M8 | cerrar el popover no devuelve el foco a `login-abrir` | R5 |
| M9 | la bruma ignora `prefers-reduced-motion` | R9 |
| M10 | una fuente desde Google Fonts (CDN) | R11 |
| M11 | CORS con `origin: true` (refleja cualquier origen) | B2 |
| M12 | CSP sin `frame-ancestors` | B1 |

Número esperado: **12/12**, cada uno por su brazo. Sobre el código intacto: todos los brazos verdes.

### 6.1 · Enmienda (aprobada por el humano tras la primera medición: **10/12**)

La tabla fijada dio 10/12 sobre la entrega (`calibrar:s10-t1`). Dos no cazados, dos causas distintas:

- **M3 → R6 era ciego.** R6 enviaba el mensaje desde la anfitriona: su `source` también era ajeno y
  el chequeo de `source` lo descartaba igual. R6 nunca aislaba el chequeo de origen. **R6 enmendado:**
  el mensaje sale de `login-marco` mismo, navegado a `http://127.0.0.1:3000` (otro origen, mismo
  servidor); el `contentWindow` del iframe es el mismo objeto, así que sólo el chequeo de origen lo
  frena. Es el caso real que ese chequeo cubre: el marco navegando fuera del origen de auth.
- **M8 era imposible.** Con el popover nativo, «no devolver el foco» no rompe nada: al cerrarse con el
  foco adentro, el navegador lo devuelve solo al invocador (`popovertarget`). Borrados los dos
  `focus()` de la entrega, R5 siguió verde. Ese código era redundante y **se elimina** (Pilar 0,
  peldaño 3). **M8 enmendado:** «al cerrar, la anfitriona se lleva el foco» (`blur()` en el `toggle`).

Número exigido tras la enmienda: **12/12**, cada uno por su brazo; la tabla fijada queda en 10/12.
