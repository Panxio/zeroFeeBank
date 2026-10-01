# S-10 · T4 — Inactividad, costura del reloj del navegador y baseline visual

> Estado: **en construcción** (2026-09-13; H1–H3 confirmadas). Spec, lista de testids, árbitro y tabla de
> defectos se fijan **antes** de la entrega. Trozo 4 de 4 de S-10: T1 portada + acceso ✅ ·
> T2 barra + Resumen ✅ · T3 Transferir ✅ · **T4** inactividad + baseline visual.
> Fuentes: `S-10-catalogo.md` § 4.3 (diálogo), § 4.5 (inactividad, D-c), § 4.7 (canvas congelable) y § 6;
> S-08 (token de 60 min); S-07 (`POST /__test__/reloj`); `specs/S-10-T3-transferir.md` (el `zfb-dialogo`
> nace allí con un solo uso). Lo visual sigue la dirección visual, aprobada con captura.

## 1 · Qué hace, qué queda fuera, cuándo está hecho

- **Hace (frontend, `web/`):** cierre de sesión por inactividad (aviso a los 90 s, cuenta atrás de 60 s,
  cierre a los 150 s) con el segundo uso de `zfb-dialogo`; un `RelojService` del navegador y su costura
  `window.__zfb__.reloj`, que existe sólo en el build de pruebas.
- **Hace (backend):** `auth.service.ts` lee el reloj inyectado al emitir y al validar el token (H1).
- **Hace (arnés):** baseline visual de la portada congelada, escritorio y teléfono (H3).
- **Fuera:** la bruma animándose durante la sesión (H2, sigue como deuda) · detección proactiva del
  vencimiento del token en el cliente (J9) · sesión compartida entre pestañas (el token vive en memoria
  por pestaña, T1) · baseline de las pantallas con sesión (el catálogo pide sólo la portada) · Movimientos,
  Pagos, Boletas, Contacto (S-17) · tipos de transferencia (deuda de negocio).
- **Hecho:** los brazos de § 5 en verde sobre el **artefacto entregado** (el `dist/` del backend, el build
  de pruebas de `web/` servido, y el build de producción para RL1), cada defecto de § 6 cazado por su
  brazo, la batería de § 7 sin moverse, y se revisa el diálogo de inactividad en escritorio y
  teléfono: respuesta + captura.

## 2 · Decisiones

### Decisiones de producto (confirmadas)

| # | Decisión | Porqué |
|---|---|---|
| H1 | **`TOKEN_EXPIRADO` se provoca de verdad en T4**: `auth.service.ts:228` y `:298` pasan de `Date.now()` a `this.reloj.ahora()` | `RelojService` ya está inyectado en el constructor (`:37`): son 2 líneas (Pilar 0, peldaño 5). Sin esto, `data-motivo="token"` (catálogo § 4.5) sólo se prueba falseando un `401` en la red, y la deuda sigue abierta |
| H2 | **La bruma en sesión queda fuera de T4** y sigue como deuda (BITÁCORA #142) | Se ve detrás del vidrio de la sesión (fondos `rgba`/`--vidrio`, `styles.css`): congelarla cambia la estética aprobada, y la latencia de ~520 ms que se le atribuye sigue sin medirse. No se toca una estética aprobada por una causa no medida |
| H3 | **La baseline se captura de `main`** (previa a los cambios de T4) y se aprueba con captura | T4 no toca la portada: la baseline mide que los cambios no la rompan. Si se capturara del artefacto entregado, compararía la entrega consigo misma |

### Decisiones de contrato de pantalla (discutibles)

| # | Decisión | Porqué |
|---|---|---|
| J1 | La costura del navegador es `window.__zfb__.reloj` con **`fijar(ms)`, `avanzar(ms)` y `desfijar()`**; `avanzar` con el reloj sin fijar **lanza** un `Error` con `name === 'RELOJ_NO_FIJADO'` | calca `POST /__test__/reloj` del backend (`instante` / `avanzarMs`, `RelojNoFijadoError`). Con el reloj corriendo, el tiempo real que tarda el arnés movería `data-segundos` y el brazo sería intermitente; fijado, la cuenta es exacta |
| J2 | El estado de inactividad **se deriva del reloj**: `inactivo = ahora() − últimaActividad`. Un tic real re-evalúa, y `avanzar`/`fijar` re-evalúan en el acto | contar tics se atrasa con la pestaña en segundo plano o el equipo suspendido (medido: tapa cerrada, 49 min). Al volver, un salto ≥ 150 s cierra sin pasar por el diálogo |
| J3 | Actividad = `keydown`, `pointerdown`, `wheel` **en la anfitriona, sólo con sesión abierta**. Con el diálogo abierto **no** reinicia: sólo `inactividad-seguir` o Escape | si una tecla reiniciara, el Tab para llegar a `inactividad-salir` cerraría el aviso. WCAG 2.2.1 pide una acción simple para extender, y es ésa |
| J4 | Al abrir el diálogo, el foco va a **`inactividad-seguir`**; al seguir, **vuelve al elemento que lo tenía** antes | APG de diálogos: la acción que se espera y no destruye nada. Devolver el foco evita que el teclado quede en `body` |
| J5 | `inactividad-segundos[data-segundos]` = **`ceil((150 000 − inactivo) / 1000)`**, entero, al segundo. El anuncio vive en **otra** región dentro del diálogo, con `aria-live="polite"`, cuyo texto trae el último múltiplo de 10 alcanzado (60, 50, …, 10) | el catálogo pide contador visible y anuncio cada 10 s: si el contador fuera la región viva, el lector anunciaría 60 veces. `ceil` da 60 justo al abrir y 1 en el último segundo |
| J6 | Si el diálogo de confirmar transferencia está abierto al llegar a los 90 s, **se cierra como si se cancelara** (sin POST) y se abre el de inactividad. Al seguir, la vista queda en Revisar con los mismos datos y el foco en `transferir-enviar` | una confirmación de dinero abierta en un equipo compartido no debe quedar a un clic de ejecutarse. Dos `zfb-dialogo` apilados partirían el foco atrapado |
| J7 | Salir, o llegar a 0 s: el mismo cierre que `cerrarSesion()` y además `sesion-aviso[data-motivo="inactividad"]` **sin** `data-codigo`, con el foco en `login-abrir` | catálogo § 4.5: la inactividad es estado del cliente, como `SIN_RESPUESTA` |
| J8 | El flag de pruebas del front es una **configuración de build `pruebas`** en `web/angular.json`, que es **producción + el flag y nada más** (enmienda § 5.1: BV compara el build de pruebas contra una baseline de producción); el build por defecto (producción) **no trae la costura en el bundle** (ni el texto `__zfb__`) | análogo a `ZFB_COSTURAS_PRUEBA`: sin el flag, la costura no existe. Que no esté en el bundle es verificable sobre el artefacto; que no esté «en tiempo de ejecución» no alcanza |
| J9 | El cliente **no programa** el vencimiento del token: lo detecta el siguiente `401 TOKEN_EXPIRADO` del API, con el cierre de T2 | la inactividad cierra a los 150 s, mucho antes que los 60 min del token: sólo vence con uso continuo, y ese uso llama al API. Un segundo temporizador sería código sin caso (Pilar 0) |
| J10 | Cerrar la sesión por cualquier vía (Salir de `nav-usuario`, token, inactividad) **apaga** el temporizador; el siguiente login parte de cero | un temporizador vivo sin sesión abriría el diálogo sobre la portada |

## 3 · Constantes

| Constante | Valor | Porqué |
|---|---|---|
| Aviso de inactividad | **90 000 ms** | catálogo D-c |
| Cuenta atrás | **60 000 ms** (cierre a los **150 000 ms**) | catálogo D-c; cumple WCAG 2.2.1 (≥ 20 s para extender) |
| Paso del anuncio | **10 s** | catálogo § 4.5 |
| Tic de re-evaluación | **≤ 1000 ms** reales | el contador es al segundo; el valor exacto queda a elección |
| Instante fijado del arnés | **`2026-09-13T12:00:00.000Z`** (segundo entero) | con el segundo entero, `exp = t0 + 3600 s` exacto: TK1 distingue 3 599 999 ms de 3 600 000 ms |
| Vigencia del token | **60 min** | `VIGENCIA_TOKEN_MINUTOS`, S-08; no cambia |
| Viewports | escritorio **1280×800** · teléfono **390×844** | los de T2/T3 |
| Tope de cada espera por condición | **8000 ms** | el de T1–T3: un rojo, no un cuelgue |
| Baseline: diferencia máxima tolerada | **0 píxeles con algún canal distinto** (`UMBRAL_BV = 0`) | medido en § 3.1: ruido 0 en 8 de 8 pares; el menor defecto (M-BV3) mueve 0,001288. Sin ruido medido no hay tolerancia que justificar |

### 3.1 · Medición que fija el umbral de la baseline (fijada antes)

Sobre `main` sin cambios: 5 capturas de cada viewport con `reducedMotion: 'reduce'`, portada sin sesión,
`document.fonts.ready` resuelto, sin popover. Se mide la fracción de píxeles distintos entre cada par
(comparación en el propio navegador con `getImageData`, sin dependencias nuevas). Umbral = por encima
del ruido máximo medido y **por debajo del menor defecto de § 6 (M-BV*)**; si no hay hueco entre los dos,
se escala. La primera captura queda como baseline en `specs/S-10-baseline/`.

**Medido (195 s, US$ 0,034; Chromium 148.0.7778.96 de
playwright-core 1.60.0):** las 5 capturas limpias de cada viewport, idénticas (Δ>0 = 0,000000 y Δ máx 0 en
los 8 pares). Defectos contra la limpia, fracción Δ>0 escritorio / teléfono: M-BV1 0,002651 / 0,008248 ·
M-BV2 0,974470 / 0,947837 · M-BV3 0,001288 / 0,003038. **Umbral = 0.** Consecuencia declarada: la
baseline vale para este Chromium; con otro equipo o al subir playwright-core se **re-mide** con
`bash scripts/medir-baseline-s10.sh` antes de tocar el umbral. En reposo la portada pide
`GET :3000/auth/marco` (el marco del popover cerrado); la medición se hizo sin backend y los brazos BV
corren con él: si eso moviera un píxel, BV da rojo sobre `main` y se escala.

## 4 · Comportamiento

### 4.1 · La costura (J1, J8)
- `ng build --configuration pruebas` expone `window.__zfb__.reloj` desde el arranque, con o sin sesión.
  `ng build` (producción) no la expone y su bundle no trae el texto `__zfb__`.
- `fijar(ms)` congela `ahora()` en ese instante (epoch en ms); `avanzar(ms)` lo mueve; `desfijar()`
  vuelve al reloj real. Las tres re-evalúan la inactividad en el acto (J2).

### 4.2 · Inactividad (catálogo § 4.5, J2–J7, J10)
- Empieza al llegar `zfb.auth.sesion` (esa llegada cuenta como actividad) y se apaga en todo cierre (J10).
- A los 90 s: se abre `zfb-dialogo` con `inactividad-dialogo` (`role=dialog`, `aria-modal="true"`,
  `aria-labelledby` dentro de la misma raíz), `inactividad-segundos[data-segundos="60"]`,
  `inactividad-seguir` e `inactividad-salir`; foco atrapado entre los dos botones.
- *Seguir* o Escape: se cierra y la cuenta vuelve a cero desde ese instante.
- *Salir* o 0 s: J7.

### 4.3 · Token (H1, J9)
- Con el reloj del backend fijado en t0 y avanzado 3 600 000 ms, la primera llamada al API responde
  `401 TOKEN_EXPIRADO` y la app cierra con `sesion-aviso[data-motivo="token"][data-codigo="TOKEN_EXPIRADO"]`
  (el cierre de T2, sin cambios).

## 5 · Brazos del arnés (fijados antes de la entrega; no se tocan después)

Un solo runner, **`npm run verificar:s10-t4`** (`scripts/verificar-s10-t4.{sh,mjs}`), que monta los
artefactos igual que el de T3 y **además** construye `web/` en producción para RL1. Los brazos de T1–T3
siguen corriendo aquí con su texto, sobre el build de pruebas, salvo R1, que compara contra
`specs/S-10-testids-T4.txt` (**73** = los 69 de T3 + `inactividad-dialogo` `inactividad-segundos`
`inactividad-seguir` `inactividad-salir`) y abre el diálogo de inactividad para verlos renderizados.
Todo brazo de inactividad fija el reloj en t0 **antes** del login y lo avanza sólo con la costura:
el arnés no hace clic, tecla ni rueda en la anfitriona salvo cuando el brazo lo dice.
Desde T4, `verificar:s10-t3` queda como registro histórico.

| # | Brazo | Verde si |
|---|---|---|
| RL1 | sin flag no hay costura | build de producción servido: `typeof window.__zfb__ === 'undefined'`, y ningún `.js` de `web/dist` producción contiene `__zfb__` (término versionado aquí) |
| RL2 | la costura existe | build de pruebas, sin sesión: `fijar`, `avanzar` y `desfijar` son funciones; `avanzar(1)` sin fijar lanza con `name === 'RELOJ_NO_FIJADO'` |
| IN1 | sin sesión no cuenta | portada sin sesión, `fijar(t0)`, `avanzar(150000)` → sin `inactividad-dialogo` y sin `sesion-aviso` |
| IN2 | aviso a los 90 s | login; `avanzar(89999)` → sin diálogo; `avanzar(1)` → `inactividad-dialogo` visible y `data-segundos="60"` |
| IN3 | contrato del diálogo | con IN2 abierto: `inactividad-*` dentro del shadow root **abierto** de `zfb-dialogo`; `role=dialog`, `aria-modal="true"`, `aria-labelledby` resuelve dentro de esa raíz; foco en `inactividad-seguir`; Tab y Shift+Tab no salen de los dos botones |
| IN4 | cuenta atrás al segundo | desde IN2: `avanzar(1000)` → `data-segundos="59"`; `avanzar(58500)` → `"1"` |
| IN5 | anuncio cada 10 s | desde IN2: una sola región `aria-live="polite"` en el diálogo, distinta de `inactividad-segundos`; su texto trae `60`; tras `avanzar(9999)` sigue con `60`; tras `avanzar(1)` trae `50` |
| IN6 | seguir reinicia | desde IN2 con el foco previo en `nav-usuario`: clic en `inactividad-seguir` → diálogo cerrado, foco en `nav-usuario`; `avanzar(89999)` → sin diálogo; `avanzar(1)` → diálogo |
| IN7 | Escape = seguir | desde IN2: Escape → diálogo cerrado; `avanzar(89999)` → sin diálogo |
| IN8 | salir | desde IN2: clic en `inactividad-salir` → `login-abrir` visible y enfocado, sin `nav-usuario`, `sesion-aviso[data-motivo="inactividad"]` sin `data-codigo` |
| IN9 | cierre a los 150 s | desde IN2: `avanzar(60000)` → lo mismo que IN8 |
| IN10 | salto largo | login; `avanzar(600000)` de una vez → lo mismo que IN8, sin pasar por el diálogo |
| IN11 | actividad que cuenta | login; por cada uno de tecla (Shift sobre `body`), `pointerdown` en zona vacía y rueda: `avanzar(89000)`, el gesto, `avanzar(89000)` → sin diálogo; `avanzar(1000)` → diálogo (se reinicia sesión entre gestos) |
| IN12 | lo que no cuenta | login; `avanzar(89000)`, `mouse.move` por la página, `avanzar(1000)` → diálogo visible |
| IN13 | con el diálogo abierto, una tecla no reinicia | desde IN2: Tab, luego `avanzar(60000)` → lo mismo que IN8 |
| IN14 | inactividad sobre la confirmación | cuenta con `"1000.00"`, asistente hasta `confirmar-dialogo` abierto con `"250.10"`; `avanzar(90000)` → sin `confirmar-dialogo`, con `inactividad-dialogo`; clic en `inactividad-seguir` → Revisar con `data-monto="250.10"`, foco en `transferir-enviar`; el saldo por el API sigue en `"1000.00"` |
| IN15 | cerrar apaga el temporizador | login; Salir desde `nav-usuario`; `avanzar(150000)` → sin diálogo y sin `sesion-aviso`; login de nuevo, `avanzar(89999)` → sin diálogo |
| TK1 | el backend lee su reloj | `POST /__test__/reloj {instante: t0}`, login por el API; `avanzarMs: 3599999` → `GET /cuentas` `200`; `avanzarMs: 1` → `401` con `codigo: "TOKEN_EXPIRADO"` |
| TK2 | la app cierra por token | reloj del backend en t0, login por la UI, `avanzarMs: 3600000`; clic en `nav-cuentas` → `sesion-aviso[data-motivo="token"][data-codigo="TOKEN_EXPIRADO"]`, `login-abrir` visible |
| BV1 | baseline escritorio | 1280×800, `reducedMotion: 'reduce'`, portada sin sesión, `portada-bruma[data-estado="congelado"]`, fuentes cargadas → diferencia con `specs/S-10-baseline/portada-escritorio.png` ≤ umbral (§ 3.1) |
| BV2 | baseline teléfono | lo mismo a 390×844 contra `portada-telefono.png` |

### 5.1 · Enmienda previa a la entrega (ataque al arnés)

Ataque a ciegas: 15 hallazgos (12 ciertos) + 8 (6 ciertos),
3 en común. Descartados: #12 (`scroll`/`focus` no son negativos del contrato), #15
(el popover nunca está abierto en una página nueva), #5 (el cierre por `401` de cualquier llamada es
contrato de T2/T3). Cambios, sin debilitar ninguna aserción existente:

- **Asentar (nuevo contrato, J1/J2):** tras `fijar`/`avanzar`/`desfijar`, el DOM refleja el nuevo estado
  en **≤ 2 cuadros de animación** (el arnés espera 2 `requestAnimationFrame` + una macrotarea, un evento
  y no un tiempo). Toda ausencia leída tras mover el reloj se lee **después de asentar**. IN2: el diálogo
  a los 90 000 ms se exige visible **tras asentar**, no con la espera de 8000 ms (#10, #4).
- **Búsquedas de `inactividad-*`** siempre con selectores que atraviesan el shadow root; nunca
  `document.querySelector` (#1–2, #1). La región viva de IN5 se busca **dentro de la raíz de
  `inactividad-dialogo`**, no en todo el documento (`cuentas-region` también es `aria-live`) (#8).
- **IN1:** fija el navegador en su hora real (`Date.now()` de la página), no en t0, y avanza **90 000**
  (M4 con t0 contaría contra la hora de pared y no se vería: #8) (#1).
- **IN3:** Shift+Tab también tiene que visitar los dos botones (#9).
- **IN7:** además, `avanzar(1)` → diálogo de nuevo (reinicia, no apaga), y el foco vuelve al previo (#7).
- **IN8, IN9, IN10, IN13** («lo mismo que IN8»): además, `inactividad-dialogo` no está visible; IN13
  exige también sin `data-codigo` (#4–5).
- **IN11:** tras el segundo `avanzar(89000)` se exige la sesión abierta (`nav-usuario` visible), para que
  el rojo de M18 diga M18 (#13, no cambia el color).
- **IN13:** con el diálogo abierto, además de Tab: tecla Shift, `pointerdown` sobre el título del
  diálogo y rueda; ninguno reinicia (#6, #3).
- **IN15:** en la segunda sesión, `avanzar(1)` → diálogo (#3).
- **TK2:** fija también el navegador en t0 antes del login; tras el cierre por token, sin `nav-usuario`,
  y `avanzar(150000)` en el navegador → sin `inactividad-dialogo` y `sesion-aviso` sigue con
  `data-motivo="token"` (J10) (#11).
- **BV1, BV2:** antes de capturar, esperan por condición el canvas pintado (un píxel con alfa 255),
  como lo hace la medición de baseline (#14, #6).
- **Brazo nuevo IN16 · el tic real existe (J2, #2):** contexto con `reducedMotion: 'reduce'` y
  `page.clock.install()` **antes** del `goto`; login sin fijar la costura; `page.clock.runFor(90000)` →
  `inactividad-dialogo` visible. Es el único brazo con `page.clock`: la costura re-evalúa por sí misma y
  por eso no puede probar que exista un temporizador real (catálogo § 4.5 admite `page.clock`).
  **BRAZOS_TOTAL = 78.**

Defectos nuevos (§ 6): M25 sin tic real, sólo re-evalúa en `avanzar` → IN16 · M26 `avanzar` no
re-evalúa, sólo el tic → IN2 · M27 *Salir* deja montado el diálogo → IN8 · M28 `pointerdown` o rueda
con el diálogo abierto reinician → IN13 · M29 Escape cierra y apaga el temporizador → IN7 · M30 tras
el primer cierre el temporizador no vuelve a arrancar → IN15 · M31 el cierre por token no apaga el
temporizador → TK2 · M32 el anuncio se queda en 60 → IN5 · M33 Shift+Tab no se mueve → IN3.

### 5.2 · Enmienda posterior a la entrega

**IN11 asienta tras cada gesto** (`asentar(page)` entre el gesto y el segundo `avanzar(89000)`).
Causa medida: Chromium entrega la rueda de un listener **pasivo** alineada al siguiente cuadro, y el
`page.evaluate` de `avanzar` corría antes que el evento; se tapó con un `wheel` **no
pasivo** en `window` (un listener bloqueante de desplazamiento que sólo existía por el arnés).
Medido sobre la entrega: no pasivo + IN11 fijado 78/78 · pasivo + IN11 fijado **77/78** (IN11: «rueda no
reinició… la sesión cerró») · pasivo + IN11 asentado **78/78**. `asentar` es un evento, no un tiempo,
y no debilita ninguna aserción; el calibrador tiene que confirmar que **M18 sigue en rojo** con IN11
asentado. El producto queda con `wheel` pasivo.

**IN1 sigue hasta 150 000**. Después de la lectura a los 90 000,
`avanzar(60000)`, asentar, y ni `inactividad-dialogo` ni `sesion-aviso` visibles. Causa medida: el
diálogo vive dentro del bloque con sesión (`app.html`), así que sin sesión no se monta a los 90 000, y
M4 (temporizador arrancado con la app) dio 78/78 en la calibración real; el rastro aparece recién con
el cierre a los 150 000. Suma una aserción y no debilita ninguna. Medido: entrega 78/78 · M4 sola
**77/78**, rojo sólo IN1 («sesion-aviso presente a 150000»).

## 6 · Defectos de calibración (fijados antes de medir)

| # | Defecto inyectado | Debe cazarlo |
|---|---|---|
| M1 | `inactividad-segundos` con el testid renombrado | R1 |
| M2 | la costura también en el build de producción | RL1 |
| M3 | `avanzar` sin fijar no lanza (suma sobre el reloj real) | RL2 |
| M4 | el temporizador arranca con la app, no con la sesión | IN1 |
| M5 | aviso a los 60 s | IN2 |
| M6 | el temporizador usa `Date.now()` y no el `RelojService` | IN2 |
| M7 | el diálogo de inactividad con encapsulación emulada (sin shadow root) | IN3 |
| M8 | foco inicial en `inactividad-salir` | IN3 |
| M9 | contador con `Math.floor` en vez de `ceil` | IN4 |
| M10 | el contador es la región viva (anuncia cada segundo) | IN5 |
| M11 | *Seguir* cierra el diálogo sin reiniciar la cuenta | IN6 |
| M12 | *Seguir* deja el foco en `body` | IN6 |
| M13 | Escape no hace nada en el diálogo de inactividad | IN7 |
| M14 | *Salir* cierra la sesión sin `sesion-aviso` | IN8 |
| M15 | el aviso sale con `data-motivo="token"` | IN8 |
| M16 | a los 0 s el diálogo se queda en `0` sin cerrar | IN9 |
| M17 | la cuenta se lleva por tics y no se deriva del reloj | IN10 |
| M18 | `wheel` no cuenta como actividad | IN11 |
| M19 | `pointermove` cuenta como actividad | IN12 |
| M20 | con el diálogo abierto, cualquier tecla reinicia | IN13 |
| M21 | el diálogo de confirmar queda abierto bajo el de inactividad | IN14 |
| M22 | cerrar desde `nav-usuario` no apaga el temporizador | IN15 |
| M23 | `auth.service.ts:298` vuelve a `Date.now()` | TK1 |
| M24 | el cliente no cierra ante `TOKEN_EXPIRADO` | TK2 |
| M-BV1 | el color de `login-abrir` cambia un tono (`--hueso` → `#fff`) | BV1, BV2 |
| M-BV2 | la semilla de la bruma cambia | BV1, BV2 |
| M-BV3 | la marca se corre 2 px | BV1, BV2 |
| M25 | sin tic real: sólo re-evalúa dentro de `avanzar`/`fijar` | IN16 |
| M26 | `avanzar` no re-evalúa; sólo el tic | IN2 |
| M27 | *Salir* cierra la sesión y deja montado el diálogo | IN8 |
| M28 | con el diálogo abierto, `pointerdown` o rueda reinician | IN13 |
| M29 | Escape cierra el diálogo y apaga el temporizador | IN7 |
| M30 | tras el primer cierre, el temporizador no vuelve a arrancar | IN15 |
| M31 | el cierre por token no apaga el temporizador | TK2 |
| M32 | la región viva se queda en 60 | IN5 |
| M33 | Shift+Tab no mueve el foco | IN3 |

M-BV1–3 se miden también en § 3.1: el umbral tiene que dejarlos afuera. Por cada defecto, antes de fijar
la fila: «¿qué observa el brazo con el defecto puesto?» (BITÁCORA #168).

**Medido:** calibración real (2026-09-13, ~5 h 45 min) **35/36 contra la tabla
fijada**; único NO: M4 (IN1 verde, 78/78). Con la enmienda de IN1 (§ 5.2), M4 re-medida sola:
cazada por IN1 → **36/36 enmendada**. M18 en rojo sólo con IN11 asentado («la sesión cerró (M18)»);
M26 en rojo con IN2 («no re-evaluó en el acto (M26)»), no fue verde por azar.

## 7 · Batería que no debe moverse

Integración 368/368 (con H1, `test:auth` 11/11 incluido) · dominio 122/122 · invariantes 5/5 · guante 6/6 ·
typecheck y build en exit 0. `calibrar:s10-t3` sigue midiendo su código: los brazos de T3 viven dentro de
`verificar:s10-t4`.

## 8 · Alcance de archivos (fijado antes)

```
web/src/**                      frontend de T4
web/angular.json                configuración de build «pruebas» (J8)
src/modules/auth/auth.service.ts  :228 y :298 al reloj inyectado (H1)
scripts/verificar-s10-t4.*      árbitro (fijado antes)
specs/S-10-testids-T4.txt       contrato de testids (fijado antes)
specs/S-10-baseline/*.png       baseline aprobada por el humano (fijada antes, H3)
package.json                    scripts verificar:s10-t4 / calibrar:s10-t4
```
