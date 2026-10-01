# S-17 · Boletas — pantalla del titular y ventanilla pública de cobro

> Estado: **spec aprobada por el humano** (2026-09-15; H1–H3 y J1–J11), con la
> **enmienda § 5.1** previa a la entrega (Z1–Z15, JZ2–JZ3; defectos K40–K49). Spec, lista de testids, árbitro y tabla de
> defectos se fijan **antes** de la entrega. Historia: `specs/HU-02-pantalla-boletas.md` (CA4–CA14).
> Backend ya en `main`: S-09 (API), S-19 (PDF), S-23 (`fondosLiberados` y escenario
> `boletas-en-cada-estado` con credencial). Molde: `specs/S-10-T3-transferir.md`. Lo visual sigue la
> dirección de la 28; el humano lo aprueba con captura.

## 1 · Qué hace, qué queda fuera, cuándo está hecho

- **Hace (frontend, `web/`):** la vista **Boletas** del titular (lista con el estado de cada boleta,
  formulario de emisión, «Devolver», «Liberar fondos», comprobante y resumen PDF por descarga), a la
  que se llega por `nav-boletas`; y la **ventanilla pública** de cobro, sin sesión, a la que se llega
  desde la portada (`ir-ventanilla`) y por URL directa.
- **Fuera:** backend (no se toca: todo lo que la pantalla necesita ya existe) · confirmación en modal
  para emitir, devolver o liberar (J8) · filtros o paginación (HU-02 § 9) · hora local (R10) ·
  «repetida» (`Idempotency-Replayed`) en pantalla · proceso batch de vencimiento · URL por pantalla
  para la vista del titular (el token vive en memoria, T1).
- **Hecho:** los brazos de § 5 en verde sobre el **artefacto entregado** (el `dist/` del backend y el
  build de `web/`, servidos), cada defecto de § 6 cazado por su brazo, la batería de § 7 sin moverse,
  y el humano compara Boletas y la ventanilla en escritorio y teléfono: respuesta + captura.

## 2 · Decisiones

### Decisiones del humano (H1–H3)

| # | Decisión | Porqué |
|---|---|---|
| H1 | **Dos runners**: `verificar:s10-t4` (cuyo R1 exige igualdad exacta con los 73 testids de T4 y va a ver `nav-boletas` e `ir-ventanilla`) sigue, con R1 enmendado |  `verificar:s17-boletas` trae sólo los brazos nuevos; en `verificar:s10-t4` se enmienda **una línea** de R1: lo que *sobra* se mide contra T4 ∪ `S-17-testids-boletas.txt` (lo que *falta*, contra T4 como hoy). Un testid ajeno sigue poniéndolo rojo: no se relaja, se actualiza el contrato versionado. La alternativa (copiar los 3273 líneas de T4 en el runner nuevo, como T2→T3→T4) duplica el tiempo de cada corrida |
| H2 | **Nueva baseline de la portada** (BV1/BV2 de T4, umbral 0): `ir-ventanilla` es un enlace visible en la portada (CA11) | Nueva baseline **capturada después de la entrega y aprobada por el humano** con las dos capturas; `UMBRAL_BV` sigue en 0. Hasta esa aprobación BV1/BV2 están rojos, y su árbitro es la aprobación del humano, no una etiqueta |
| H3 | **URL directa de la ventanilla: `http://localhost:4200/#ventanilla`** | el front se sirve con `python3 -m http.server`, sin *fallback* de SPA: una ruta `/ventanilla` responde 404. El fragmento funciona en cualquier servidor estático sin tocar el backend. Alternativa: servidor con *fallback* en el runner y en el despliegue |

### Decisiones de contrato de pantalla (discutibles)

| # | Decisión | Porqué |
|---|---|---|
| J1 | **El cliente no valida nada**: envía lo escrito y el API decide con código (C5). El formulario lleva `novalidate` y **ningún** `maxlength`, `min`, `max`, `step` ni `pattern` | la misma regla que T3 H3: una regla duplicada en el cliente sería una regla de negocio inventada y dejaría inalcanzables los códigos de CA5 desde la UI |
| J2 | **Monto**: el texto sin espacios a los lados, como string (D1). **Plazo**: si el texto sin espacios es sólo dígitos, se envía como número entero; si no, se envía el texto tal cual, y el API responde `PLAZO_INVALIDO` | el API exige `plazoDias` numérico y `monto` string; ninguna de las dos conversiones decide validez |
| J3 | **Una `Idempotency-Key` por intento** (emitir, devolver, liberar, cobrar): nace al enviar, **se reusa** en el doble clic y en «Reintentar» tras una respuesta perdida, y **se descarta** ante toda respuesta definitiva (2xx o 4xx) | HU-02 J6 y T3 § 4.3. Después de un 4xx el siguiente intento es otra operación: con la clave vieja el backend devolvería el rechazo guardado |
| J4 | **Una vista a la vez** (T3 J5): Resumen, Transferir o Boletas. Entrar a Boletas pide `GET /boletas` y `GET /cuentas` (la cuenta de origen del formulario y la de cada fila, HU-02 J1) | con dos vistas montadas los testids de carga saldrían dos veces |
| J5 | **Estado visible** de cada fila: VIGENTE «Vigente» · VENCIDA con `fondosLiberados=false` «Vencida · fondos por liberar» · VENCIDA con `true` «Vencida · fondos liberados» · COBRADA «Cobrada» · DEVUELTA «Devuelta». Los brazos afirman sobre `data-estado` y `data-fondos-liberados`, no sobre el texto (C3) | R9: la pantalla distingue las dos vencidas |
| J6 | **Acciones por fila** (HU-02 J2): «Devolver» sólo en VIGENTE · «Liberar fondos» sólo en VENCIDA con `fondosLiberados=false` · comprobante siempre · resumen **sólo con `fondosLiberados=true`** | el backend da el resumen sólo con asiento de cierre (`comprobantes.service.ts:121`), que es exactamente lo que marca `fondosLiberados` (S-23 J2) |
| J7 | **Fechas**: `AAAA-MM-DD HH:MM UTC`, recortadas del ISO que da el API (sin pasar por `Date` ni por la zona del navegador). El ISO completo va en `data-instante` | R10. Recortar el string evita por construcción el defecto de la hora local |
| J8 | **Sin modal de confirmación** en emitir, devolver ni liberar | HU-02 no lo pide y el modal de T3 protege una operación que no se deshace; una emisión se deshace con «Devolver». Discutible: si el humano lo quiere, entra con sus brazos D1–D3 de T3 |
| J9 | **Ventanilla sólo sin sesión**: con sesión abierta, `#ventanilla` se ignora (la vista del titular sigue) | el token vive en memoria: una carga de la URL nunca tiene sesión, y la ventanilla no identifica a nadie (R7) |
| J10 | **Tras toda acción del titular** (con éxito, rechazo o sin respuesta) la lista **se vuelve a pedir** (`GET /boletas`), y la fila muestra lo que diga el API | la lista es la verdad; una fila actualizada a mano desde la respuesta puede mentir si el estado cambió detrás |
| J11 | **Etiqueta de la cuenta** en la fila y en el selector: `CORRIENTE` → «Corriente», `AHORRO` → «Ahorro», seguida del id | HU-02 J1. El API no impide emitir desde una AHORRO, así que la pantalla no lo impide |

## 3 · Constantes

| Constante | Valor | Porqué |
|---|---|---|
| Viewports del arnés | escritorio **1280×800** · teléfono **390×844** | los de T2–T4 |
| Tope de cada espera por condición | **8000 ms** | el de T1–T4: un rojo, no un cuelgue; no es un `sleep` |
| Instante fijo del backend `F` | **`2026-09-15T01:30:00.000Z`** | en `America/Santiago` (UTC−3 en septiembre) son las 22:30 del **14**: una fecha formateada en hora local cambia de día y L5 lo ve |
| Zona del navegador en L5 | **`America/Santiago`** | la zona real del público; hace visible el defecto de la hora local |
| Fechas esperadas en L5 (boleta `VIGENTE` sembrada en `F`) | emitida **`2026-09-14 01:30 UTC`** · vence **`2026-10-14 01:30 UTC`** | S-23: `F − 1 d` y `F + 29 d` |
| Avance del reloj en A2 | **31 días** (`2 678 400 000` ms) | plazo 30 (E1): 31 lo deja vencido con un día de margen |
| Monto de las emisiones felices | **`"250.10"`** | con `Number()` sería `250.1`: J2 lo distingue |
| Montos inválidos | **`"12,50"`** → `MONTO_INVALIDO` · **`"5000.00"`** → `FONDOS_INSUFICIENTES` | P1 del v0; mayor que los 740,00 de la cuenta sembrada |
| Plazo feliz / inválidos | **`"30"`** · **`"0"`** → `PLAZO_INVALIDO` · **`"1.5"`** → `PLAZO_INVALIDO` | R1 (1–365); `"1.5"` es lo que una validación nativa con `step` bloquearía (J1) |
| Beneficiario / retirador | `12345678-5` Constructora Andes SpA · `9876543-3` Ana Soto · glosa «Fiel cumplimiento contrato 123» | los de S-09 y S-23 |
| RUT con dígito verificador malo | **`12345678-9`** → `RUT_INVALIDO` | el DV de 12345678 es 5 |
| Nombre y glosa largos | **121** y **201** veces `a` → `NOMBRE_INVALIDO` · `GLOSA_INVALIDA` | un carácter sobre `LARGO_MAXIMO_NOMBRE`/`_GLOSA`: un `maxlength` los recortaría a válidos |
| Id inexistente / malformado | **`00000000-0000-4000-8000-000000000000`** · **`abc`** → `BOLETA_NO_ENCONTRADA` | UUID v4 bien formado que no existe; y uno que no es UUID (el controlador responde igual) |
| Nombres de descarga | `boleta-<id>-comprobante.pdf` · `boleta-<id>-resumen.pdf` | catálogo § 4.6 |
| URL directa de la ventanilla | `http://localhost:4200/#ventanilla` | H3 |

Los datos salen del API real: el escenario `boletas-en-cada-estado` (S-23: 5 boletas, cuenta en 740,00,
`credenciales` que sirven para entrar) y, para BN4/BN6, `POST /auth/registro` y `POST /cuentas` como en T2.
Cada dato de preparación se construye con una función que **afirma sus propios límites** (saldo y estados
esperados antes de usarlos): defensa contra el brazo imposible. Todo brazo que fija o mueve el reloj del
backend lo **desfija al terminar** (`POST /__test__/reloj`), pase lo que pase.

## 4 · Comportamiento

### 4.1 · Llegada y estados de carga (C4)
- `nav-boletas` es un **enlace** (rol `link`) en `nav-panel`, junto a `nav-transferir`; en teléfono queda
  plano en el panel, y activarlo cierra el panel.
- `boletas-region` lleva `data-estado` ∈ {`cargando`, `listo`, `vacio`, `error`} y `aria-busy="true"` sólo
  en `cargando`. Mientras carga se ve `boletas-cargando`. Pasa a `listo` o `vacio` cuando **las dos**
  lecturas (J4) respondieron; `vacio` = cero boletas, con el formulario igual disponible.
- Error de `GET /boletas` o `GET /cuentas` (no-`2xx` que no sea `401`, o red): `data-estado="error"`,
  `boletas-error` y `boletas-reintentar`, que repite las dos lecturas. `401` en cualquier petición:
  cierre de sesión igual que T2 § 4 (`sesion-aviso[data-motivo="token"]`).
- Cero cuentas: `boletas-sin-cuentas` en lugar del formulario.
- **Nota UX-b2:** La vista se organiza en dos pestañas («Mis boletas» y «Emitir») con paneles montados con `[hidden]`. Ver `specs/UX-b2.md` § 3.1.

### 4.2 · La lista
- `boletas-tabla` con una `boleta-fila` por boleta, en el orden del API, con `data-boleta-id`,
  `data-estado` (el `estado` del API) y `data-fondos-liberados` (`"true"`/`"false"`).
- Dentro de cada fila: `boleta-estado` (texto de J5) · `boleta-monto[data-monto]` (el string del API) ·
  `boleta-cuenta[data-cuenta-id]` (J11) · `boleta-emitida-en[data-instante]` y
  `boleta-vence-en[data-instante]` (J7) · y las acciones de J6: `boleta-devolver`, `boleta-liberar`,
  `boleta-comprobante-pdf`, `boleta-resumen-pdf`. Una acción que no corresponde **no se renderiza**.

### 4.3 · Emitir (V1, CA4–CA5)
- `emitir-form[data-estado]` ∈ {`editando`, `enviando`, `error`}, `aria-busy="true"` sólo en `enviando`,
  con `novalidate` (J1). Campos: `emitir-origen` (`<select>` nativo, opciones de `GET /cuentas`, la
  primera elegida), `emitir-monto`, `emitir-plazo`, `emitir-beneficiario-rut`,
  `emitir-beneficiario-nombre`, `emitir-retirador-rut`, `emitir-retirador-nombre`, `emitir-glosa`, y
  `emitir-enviar`. Cada campo con etiqueta accesible.
- `emitir-enviar` hace **un** `POST /boletas` con el cuerpo de J2 y la clave de J3; en `enviando` los
  controles quedan deshabilitados.
- `201`: `emitir-exito` (`role=status`) con `emitir-boleta-id` = `id` de la respuesta; el formulario
  vuelve a `editando` con los campos vacíos (origen: la primera cuenta) y la lista se relee (J10).
- Rechazo del API (`4xx` de negocio): `data-estado="error"` y `emitir-error[data-codigo]` = `codigo` del
  cuerpo; lo escrito se conserva.
- Sin respuesta de red: `emitir-sin-respuesta` con `emitir-reintentar`, **sin** `emitir-error` (P2 de
  S-10). Reintentar reenvía directo con **la misma** clave (J3).
- **Nota UX-b2:** Tras emitir con éxito se permanece en la pestaña «Emitir» (D140-2). El formulario vive en `boletas-panel-emitir`. Ver `specs/UX-b2.md` § 3.1.

### 4.4 · Devolver y liberar (V4–V5, CA6–CA7)
- `boleta-devolver` → `POST /boletas/:id/devolver`; `boleta-liberar` → `POST /boletas/:id/vencer`. Con
  clave (J3), sin modal (J8); mientras la acción está en curso, sus botones quedan deshabilitados.
- Rechazo: `boletas-accion-error[data-codigo][data-boleta-id]` en la región (fuera de la fila, que se
  vuelve a pintar). Sin respuesta: `boletas-accion-sin-respuesta`, sin código. En los tres desenlaces la
  lista se relee (J10).

### 4.5 · PDFs (V6, CA9; catálogo § 4.6)
- `boleta-comprobante-pdf` → `GET /boletas/:id/comprobante.pdf`; `boleta-resumen-pdf` →
  `GET /boletas/:id/resumen.pdf`. Con `fetch` + `Authorization: Bearer` y `a[download]` con el nombre de
  § 3. **Descarga, no pestaña**: la página no navega ni abre ventana.
- Falla (red o no-`200`): un aviso `role="alert"` dentro de `boletas-region`, sin descarga (como T3 J7,
  sin testid).

### 4.6 · Ventanilla pública (V3, R7, CA11–CA14)
- En la portada, `ir-ventanilla` es un **enlace** a `#ventanilla`. Con `#ventanilla` y sin sesión
  (al cargar o por `hashchange`) se ve `ventanilla` en lugar de la portada. `ventanilla-volver` es un
  enlace a la portada que **quita** el fragmento; el botón «atrás» del navegador también vuelve.
  Con sesión, el fragmento se ignora (J9).
- `ventanilla-form` (con `novalidate`): `ventanilla-boleta-id`, `ventanilla-rut` y `ventanilla-cobrar`,
  con etiquetas accesibles. `ventanilla-cobrar` hace **un** `POST /boletas/<id>/cobrar` con
  `{ "rutRetirador": <texto> }`, la clave de J3 y **sin `Authorization`**. El id va en la ruta tal como
  se escribió, codificado (`encodeURIComponent`).
- `200`: `ventanilla-exito` (`role=status`, `data-estado` = `estado` de la respuesta) con
  `ventanilla-monto[data-monto]` = `monto` de la respuesta.
- Rechazo: `ventanilla-error[data-codigo]`. Sin respuesta: `ventanilla-sin-respuesta` con
  `ventanilla-reintentar` (misma clave), sin `ventanilla-error`.
- **Nota UX-b2:** Ventanilla no conserva estado al salir y volver; con ID vacío muestra `ventanilla-aviso` y no envía POST; el logo pasa a `<a>` con `marca-inicio` hacia la portada; y la caja de error nunca queda vacía. Ver `specs/UX-b2.md` § 3.2 y § 3.3.

## 5 · Brazos del arnés (fijados antes de la entrega; no se tocan después)

Un runner, **`npm run verificar:s17-boletas`** (`scripts/verificar-s17-boletas.{sh,mjs}`), que monta los
artefactos igual que `verificar:s10-t4` (backend `dist/` en :3000, build `pruebas` de `web/` en :4200) y
reusa sus ayudantes (`paginaNueva`, `entrarUI`, `recolectar`, cierre de contextos por brazo, #184).
Las fallas de red se provocan **en la red del navegador** (`page.route`), nunca dentro de la app. Las
respuestas de negocio las da el **backend real**. El efecto de cada operación se mide **por el API**
(`GET /cuentas`, `GET /boletas`, `GET /boletas/:id`, con el token del titular), no en la pantalla.

| # | Brazo | Verde si |
|---|---|---|
| BN1 | `nav-boletas` | escritorio, con sesión: `nav-boletas` tiene rol `link`; clic → `boletas-region` visible, se pidieron `GET /boletas` y `GET /cuentas`, y no están `cuentas-region` ni `transferir-pasos` |
| BN2 | panel de teléfono | panel abierto → `nav-boletas` visible sin otro gesto; clic → `nav-panel` oculto y `boletas-region` visible |
| BN3 | carga | con `GET /boletas` **retenido en la red**: `boletas-region[data-estado="cargando"][aria-busy="true"]` y `boletas-cargando` visible; liberado → `data-estado="listo"`, sin `aria-busy="true"` y sin `boletas-cargando` |
| BN4 | vacío | usuario con una cuenta y cero boletas → `data-estado="vacio"`, `boletas-vacio` visible y `emitir-form` visible |
| BN5 | error y reintento | `GET /boletas` respondido **una vez** con `500` → `data-estado="error"` y `boletas-error` visible; `boletas-reintentar` → `data-estado="listo"` con las 5 filas del escenario |
| BN6 | sin cuentas | usuario con cero cuentas → `boletas-sin-cuentas` visible y sin `emitir-form` |
| L1 | las 5 del escenario | escenario sembrado, entrada con sus `credenciales` → exactamente 5 `boleta-fila`, cuyos `data-boleta-id` son los 5 ids devueltos por `seed`; buscada cada una por su id: VIGENTE → `data-estado="VIGENTE"`, `data-fondos-liberados="false"` · VENCIDA_POR_LIBERAR → `VENCIDA`, `false` · VENCIDA_LIBERADA → `VENCIDA`, `true` · COBRADA → `COBRADA`, `true` · DEVUELTA → `DEVUELTA`, `true` |
| L2 | acciones por estado (CA8) | en esas 5 filas: `boleta-devolver` **sólo** en VIGENTE; `boleta-liberar` **sólo** en VENCIDA_POR_LIBERAR; `boleta-comprobante-pdf` en las 5; `boleta-resumen-pdf` **sólo** en VENCIDA_LIBERADA, COBRADA y DEVUELTA |
| L3 | las dos vencidas se distinguen (R9) | el texto de `boleta-estado` de VENCIDA_POR_LIBERAR y el de VENCIDA_LIBERADA no están vacíos y son **distintos** |
| L4 | cuenta de origen (J11) | toda `boleta-cuenta[data-cuenta-id]` = `cuentaOrigenId` del API; con una boleta emitida por el API desde una cuenta **AHORRO** del mismo titular, su `boleta-cuenta` contiene «Ahorro» y el id, y la de una CORRIENTE contiene «Corriente» |
| L5 | fechas UTC (CA10) | backend fijado en `F`, escenario sembrado, navegador en `America/Santiago`: en la fila VIGENTE, `boleta-emitida-en` dice `2026-09-14 01:30 UTC` y `boleta-vence-en` `2026-10-14 01:30 UTC`, y sus `data-instante` son los `emitidaEn`/`venceEn` del API |
| L6 | monto literal | en las 5 filas, `boleta-monto[data-monto]` = `monto` del API (`"160.00"` … `"10.00"`) |
| E1 | emitir (CA4) | desde la cuenta sembrada, datos felices de § 3 → un `POST /boletas` con `Idempotency-Key` no vacía y cuerpo con `monto: "250.10"` (string) y `plazoDias: 30` (número); `201`; `emitir-exito` visible con `emitir-boleta-id` = `id` de la respuesta; aparece una `boleta-fila[data-boleta-id=<ese id>][data-estado="VIGENTE"]`; por el API, la cuenta baja **exactamente** 250,10 |
| E2 | doble clic | doble clic en `emitir-enviar` → todos los `POST /boletas` llevan **la misma** clave; por el API, la cuenta baja 250,10 **una sola vez** y hay **una** boleta más |
| E3 | clave nueva por operación | tras E1, una segunda emisión feliz lleva una clave **distinta** de la primera |
| E4 | rechazos con código (CA5) | siete casos, cada uno con el resto de los campos felices: plazo `"0"` → `PLAZO_INVALIDO`; beneficiario RUT `12345678-9` → `RUT_INVALIDO`; retirador RUT `12345678-9` → `RUT_INVALIDO`; beneficiario nombre de 121 `a` → `NOMBRE_INVALIDO`; glosa de 201 `a` → `GLOSA_INVALIDA`; monto `"12,50"` → `MONTO_INVALIDO`; monto `"5000.00"` → `FONDOS_INSUFICIENTES`; en cada uno `emitir-error[data-codigo]` visible, `emitir-form[data-estado="error"]`, y por el API el saldo y la cantidad de boletas **sin cambio** |
| E5 | sin validación nativa (J1) | plazo `"1.5"` → **sale** un `POST /boletas` y vuelve `emitir-error[data-codigo="PLAZO_INVALIDO"]` |
| E6 | sin respuesta, ejecutada | el POST llega al backend (`route.fetch`) y su respuesta se pierde (`route.abort`) → `emitir-sin-respuesta` visible, sin `emitir-error`; `emitir-reintentar` → POST con **la misma** clave y `emitir-exito`; por el API, la cuenta baja **una sola vez** y hay **una** boleta más |
| E7 | token en el POST | `Authorization` quitada en el `POST /boletas` → `401 TOKEN_AUSENTE` del backend; sin `usuario-email`, `sesion-aviso[data-motivo="token"][data-codigo="TOKEN_AUSENTE"]` |
| A1 | devolver (CA7) | fila VIGENTE sembrada → `boleta-devolver` → un `POST /boletas/<id>/devolver` con clave; la fila queda `data-estado="DEVUELTA"`, `data-fondos-liberados="true"`, sin `boleta-devolver` y **con** `boleta-resumen-pdf`; por el API, la cuenta pasa de 740,00 a **900,00** |
| A2 | liberar (CA6) | con el backend fijado, emisión feliz por la UI (cuenta de *s* a *s* − 250,10); el reloj avanza 31 días; entrada de nuevo → esa fila `data-estado="VENCIDA"`, `data-fondos-liberados="false"`, con `boleta-liberar` y sin `boleta-devolver`; `boleta-liberar` → un `POST /boletas/<id>/vencer`; la fila queda `data-fondos-liberados="true"` sin `boleta-liberar`; por el API, la cuenta vuelve a **exactamente *s*** |
| A3 | doble clic en una acción | doble clic en `boleta-devolver` → todos los POST llevan **la misma** clave; por el API, la cuenta sube 160,00 **una sola vez** |
| A4 | acción rechazada | pantalla en `listo` con la VIGENTE; la misma boleta se devuelve **por el API**; clic en `boleta-devolver` en la pantalla → `boletas-accion-error[data-codigo="TRANSICION_INVALIDA"][data-boleta-id=<id>]` visible; se pidió `GET /boletas` después y la fila queda `data-estado="DEVUELTA"`; la cuenta subió 160,00 una sola vez |
| A5 | acción sin respuesta | la respuesta del `POST …/devolver` se pierde tras llegar al backend → `boletas-accion-sin-respuesta` visible, **sin** `boletas-accion-error`; se pidió `GET /boletas` después y la fila queda `DEVUELTA` |
| P1 | comprobante | con el `GET …/comprobante.pdf` observado: clic en `boleta-comprobante-pdf` de la VIGENTE → la petición lleva `Authorization: Bearer` y el id en la ruta; hay **una descarga** con nombre `boleta-<id>-comprobante.pdf`, cuyo archivo empieza con `%PDF-` y cuyo texto (unpdf) contiene el id; **no** se abrió otra página y la app sigue en `boletas-region` |
| P2 | resumen | igual que P1 sobre la COBRADA, con `GET …/resumen.pdf` y nombre `boleta-<id>-resumen.pdf` |
| P3 | PDF que falla | el `GET …/comprobante.pdf` respondido una vez con `500` → un `role="alert"` dentro de `boletas-region` y **ninguna** descarga |
| VT1 | llegada desde la portada (CA11) | sin sesión, `ir-ventanilla` visible con rol `link`; clic → `ventanilla` visible, `portada` no visible, `location.hash === '#ventanilla'` |
| VT2 | URL directa (CA11) | una página nueva que abre la URL de § 3 → `ventanilla` visible sin ningún gesto y sin sesión |
| VT3 | volver | desde VT1, `ventanilla-volver` → `portada` visible, sin `ventanilla`, `location.hash === ''`; y desde VT1 otra vez, `page.goBack()` → `portada` visible |
| VT4 | cobro (CA12) | escenario sembrado; id de la VIGENTE y RUT `9876543-3` → un `POST /boletas/<id>/cobrar` con clave, cuerpo `rutRetirador` y **sin** cabecera `Authorization`; `200`; `ventanilla-exito[data-estado="COBRADA"]` con `ventanilla-monto[data-monto="160.00"]`; el titular, en otro contexto y con sus `credenciales`, ve esa fila `data-estado="COBRADA"` |
| VT5 | rechazos (CA13) | cinco casos: VIGENTE con RUT `12345678-5` → `RETIRADOR_NO_AUTORIZADO`; COBRADA con `9876543-3` → `TRANSICION_INVALIDA`; id inexistente → `BOLETA_NO_ENCONTRADA`; id `abc` → `BOLETA_NO_ENCONTRADA`; VIGENTE con RUT `12345678-9` → `RUT_INVALIDO`; en cada uno `ventanilla-error[data-codigo]` y, por el API del titular, los 5 estados y el saldo **sin cambio** |
| VT6 | doble clic (CA14) | doble clic en `ventanilla-cobrar` → todos los POST llevan **la misma** clave; la VIGENTE queda COBRADA; ningún POST de esa clave respondió con otro código que `200` |
| VT7 | sin respuesta | la respuesta del cobro se pierde tras llegar al backend → `ventanilla-sin-respuesta`, sin `ventanilla-error`; `ventanilla-reintentar` → POST con **la misma** clave → `ventanilla-exito[data-estado="COBRADA"]` |
| VT8 | clave nueva tras un rechazo | RUT `12345678-5` → `RETIRADOR_NO_AUTORIZADO`; se corrige a `9876543-3` y se cobra → la clave es **distinta** de la del rechazo y `ventanilla-exito[data-estado="COBRADA"]` |
| VT9 | con sesión se ignora (J9) | con sesión en Resumen, `location.hash = '#ventanilla'` → tras el `hashchange`, `usuario-email` sigue visible y `ventanilla` no está |
| R1 | testids nuevos renderizados | la unión de los testids vistos a lo largo de los brazos (anfitriona, marco y shadow roots, como `recolectar` de T4) cumple: todos los de `specs/S-17-testids-boletas.txt` aparecen; ninguno visto queda fuera de T4 ∪ esa lista; ninguno se repite en una página salvo los **de fila** (`DE_FILA` de T4 más `boleta-fila`, `boleta-estado`, `boleta-monto`, `boleta-cuenta`, `boleta-emitida-en`, `boleta-vence-en`, `boleta-devolver`, `boleta-liberar`, `boleta-comprobante-pdf`, `boleta-resumen-pdf`) |

BN3, BN6, E4 («sin cambio»), E6, A5, P1, P3, VT1, VT3, VT5 y VT9 afirman una **ausencia**. Cada uno se
sincroniza antes con un evento observable (un `data-estado` terminal, la respuesta capturada, un
elemento visible, el `hashchange`) y recién después mira. Nada de esperas por tiempo.

**Enmienda a `verificar:s10-t4` (H1):** en R1, `sobran` se calcula
contra T4 ∪ `specs/S-17-testids-boletas.txt`; `faltan`, contra T4 como hoy. BV1/BV2 contra la baseline
nueva (H2). Nada más cambia.

### 5.1 · Enmienda previa a la entrega (decisiones Z7 y Z8 del humano)

Sale del ataque a ciegas al árbitro y
de la auditoría (JZ1–JZ3). Se aplica **antes** de que exista el frontend: ninguna fila se
enmienda mirando un rojo de la implementación. Los brazos siguen siendo **37** y las filas de § 5 no cambian de
sentido: cada punto dice cómo el runner **llega** a lo que la fila ya pedía (IMPOSIBLE, rojo sobre la app
correcta) o qué parte de la fila no miraba (CIEGO, verde sobre la app rota).

| # | clase | brazo | cómo queda |
|---|---|---|---|
| Z1 | IMPOSIBLE | todo lo que entra por `irABoletas`, y BN1 | `irABoletas` espera, tras el clic, `boletas-region[data-estado]` ∈ {`listo`, `vacio`, `error`} (§ 4.1: ahí ya respondieron las dos lecturas) y devuelve ese estado. BN1 espera lo mismo antes de mirar `GET /boletas` y `GET /cuentas`. Hoy se mira la tabla en cuanto la región es visible, con la lista todavía en vuelo (JZ1) |
| Z2 | IMPOSIBLE | E2, A3, VT6 | el doble clic es **un gesto**: `dblclick` sobre el elemento, no dos `click` en `Promise.all` (el segundo espera a que el botón, deshabilitado en `enviando`, se habilite). Se exige **≥ 1** POST, todos con la misma clave, y el efecto una sola vez (E2: saldo y cantidad; A3: saldo; VT6: estado y códigos 200) |
| Z3 | IMPOSIBLE | A2 | después de avanzar 31 días, toda lectura del API (el saldo final) va con un **token nuevo** (`tokenDe` con las credenciales sembradas): el sembrado vence |
| Z4 | IMPOSIBLE | R1 (por E6, VT7 y A5) | `recolectar` se llama **mientras** se ve cada testid transitorio, no sólo al final: `emitir-sin-respuesta` y `emitir-reintentar` (E6), `ventanilla-sin-respuesta` y `ventanilla-reintentar` (VT7), `boletas-accion-sin-respuesta` (A5), `boletas-accion-error` (A4) y `emitir-exito` con `emitir-boleta-id` (E1). Tras el reintento esos testids desaparecen y R1 los daba por faltantes |
| Z5 | CIEGO | E4, VT5 | cada caso crea, **antes** de su clic, la espera de la respuesta de **su propio** POST (`waitForResponse`) y la consume antes de mirar `data-codigo`. Hoy el 3.º caso de E4 (`RUT_INVALIDO`) lee el error que dejó el 2.º, y el 4.º de VT5 el del 3.º |
| Z6 | CIEGO | E1, E2, E4, A2 | `selectOption` sin `.catch(() => {})`: si la opción con `value` = id de la cuenta no existe, el brazo es rojo. E1 afirma además `cuentaOrigenId` del cuerpo = la cuenta elegida |
| Z7 | CIEGO | R1 | R1 exige también que `fuera` (peticiones a hosts fuera de `HOSTS_PERMITIDOS`, de todas las páginas) quede **vacío**. Hoy se junta y nunca se mira. Decisión del humano: afirmarlo, no borrarlo |
| Z8 | CIEGO | VT5 | un sexto caso: id **`a/b`** con RUT `9876543-3` → `BOLETA_NO_ENCONTRADA`. Medido sobre el backend: `POST /boletas/a/b/cobrar` crudo responde el 404 genérico de Nest **sin `codigo`**; `a%2Fb` responde `BOLETA_NO_ENCONTRADA`. Discrimina el `encodeURIComponent` de § 4.6 |
| Z9 | CIEGO | P1, P2 | **exactamente una** descarga y **exactamente un** `GET` del PDF por clic, contados después de la descarga y de la respuesta de ese `GET` |
| Z10 | CIEGO | A1 | se exige un `GET /boletas` **después** del `POST …/devolver` (J10) |
| Z11 | CIEGO | E1 | tras el éxito, `emitir-form[data-estado="editando"]` y los siete campos de texto vacíos (§ 4.3) |
| Z12 | CIEGO | VT2 | `portada` no visible |
| Z13 | CIEGO | BN5 | `boletas-reintentar` pide **las dos** lecturas: `GET /boletas` y `GET /cuentas` después del clic |
| Z14 | CIEGO | L1 | el orden de los `data-boleta-id` de las filas en el DOM = el del `GET /boletas` (§ 4.2) |
| Z15 | CIEGO | A4 | la fila, ya `DEVUELTA`, no tiene `boleta-devolver` |
| JZ2 | IMPOSIBLE | E3 | la segunda emisión espera la respuesta de **su** `POST /boletas` antes de `emitir-exito`: el `emitir-exito` de la primera puede seguir visible y la espera se resolvía antes del segundo POST |
| JZ3 | IMPOSIBLE | A1, A4, A5 | «se pidió `GET /boletas` después» se mide con una espera de la petición (`waitForRequest`, creada antes del clic, tope de § 3), no con una bandera leída en cuanto aparece el aviso: la relectura puede salir un instante después |

Rechazado: R1 acumula estado entre brazos: es el diseño de R1 desde T1.

**Calibración de la enmienda:** antes de entregarla, el runner sobre `main` sin frontend
sigue en **0/37** y cada rojo tiene su motivo; los defectos nuevos K40–K49 se miden en la calibración
(fase 7) con los demás.

Registro: el mensaje del commit dice 36 brazos; son 37 (BN1–BN6, L1–L6, E1–E7, A1–A5,
P1–P3, VT1–VT9, R1). Los rótulos JZ2 y JZ3 valen sólo para la numeración de esta § 5.1.

### 5.2 · Enmienda tras la primera entrega (aprobada por el humano)

La primera corrida sobre un frontend (la entrega parcial, cortada por el tope de 40 min) dio
**34/37**, y dos de los tres rojos eran del árbitro: salían con **cualquier** app, correcta o no. Se
corrigen **sólo** en cómo el brazo llega a lo que ya afirmaba; ninguna aserción cambia. El tercero (BN5)
es de la app y no se toca. Los dos sobreviven a los dos ataques porque el código nunca se
había ejecutado (§ 5.1: los 37 caían en el primer paso).

| # | clase | brazo | causa | cómo queda |
|---|---|---|---|---|
| JZ4 | IMPOSIBLE | A1, A2 | `visible(page, t)` envuelve `t` con `sel()`; en cuatro sitios recibía un selector compuesto (`${filaSel} ${sel(…)}`) → `SyntaxError` de `querySelectorAll` | esos cuatro sitios llaman `page.isVisible(…)` directo. Medido: con el cambio, A1 pasa sobre la entrega |
| JZ5 | IMPOSIBLE | A2 | el arreglo de Z3 guardaba en `tokenNuevo` el cuerpo entero del login (`{token, tipo, expiraEn}`) y lo mandaba como `Bearer [object Object]` → `401 TOKEN_INVALIDO` | `const { token: tokenNuevo } = await tokenDe(…)`, como en la preparación de BN4 |

Siguen **37** brazos. La calibración de la fase 7 los mide con los demás.

### 5.3 · Enmienda por hallazgos de lectura (decisión del humano: arreglo + brazos)

La entrega da **37/37** con cuatro desvíos de § 4 que se encontraron **leyendo** el código,
no por un rojo: ningún brazo los mira. Con esta enmienda nacen **cuatro brazos nuevos**, sin tocar los 37.
Esta vez no hay un defecto que haya que inventar: el propio código de la entrega sirve de defecto (K50–K53),
así que la calibración natural es **rojo sobre la entrega** y verde después del arreglo.

| # | brazo | hallazgo (`web/src/app/app.ts` en la entrega) | Verde si |
|---|---|---|---|
| H-1 | **E8** · emitir envía lo escrito (J1) | `ejecutarEmision` hace `trim()` a los cinco campos de texto | desde la cuenta sembrada, datos felices de § 3 pero con **un espacio a cada lado** en `emitir-beneficiario-rut`, `emitir-beneficiario-nombre`, `emitir-retirador-rut`, `emitir-retirador-nombre` y `emitir-glosa` → sale **un** `POST /boletas` cuyo cuerpo trae esos cinco campos **idénticos a lo escrito**, espacios incluidos. Se sincroniza con la respuesta de ese POST, cualquiera sea. No afirma qué responde el API: eso es de E4 |
| H-2 | **VT10** · la ventanilla envía lo escrito (§ 4.6) | `trim()` al id y al RUT | escenario sembrado; `ventanilla-boleta-id` = id de la VIGENTE con un espacio a cada lado y `ventanilla-rut` = ` 9876543-3 ` → sale **un** `POST` cuya ruta es `/boletas/` + `encodeURIComponent(<id escrito>)` + `/cobrar` y cuyo `rutRetirador` es **idéntico a lo escrito**. Se sincroniza con la respuesta de ese POST |
| H-3 | **BN7** · relectura que falla (§ 4.1, J10) | `releerBoletas` descarta un no-`2xx` ≠ `401` y también la falla de red | dos casos, cada uno desde el escenario sembrado en `listo`: `boleta-devolver` en la VIGENTE, y el `GET /boletas` **siguiente** al `POST …/devolver` (a) respondido una vez con `500` en la red del navegador, (b) abortado → en los dos, `boletas-region[data-estado="error"]` y `boletas-error` visibles. Se sincroniza con ese `GET` (`waitForResponse` en (a), `requestfailed` en (b)) |
| H-4 | **P4** · el `401` de un PDF cierra la sesión (§ 4.1) | `descargarPdf` trata el `401` como falla de descarga | `Authorization` quitada **en la red** del `GET …/comprobante.pdf` de la VIGENTE (como E7) → `401 TOKEN_AUSENTE` del backend; `sesion-aviso[data-motivo="token"][data-codigo="TOKEN_AUSENTE"]` visible, sin `usuario-email` y **ninguna** descarga |

H-3 (b) se agrega: al leer la función, el mismo `catch` que ignora el `500` también ignora la red,
y § 4.1 pide `error` para las dos.

Pasa a haber **41** brazos (BN1–BN7, L1–L6, E1–E8, A1–A5, P1–P4, VT1–VT10, R1). E8, VT10, BN7 y P4 afirman
también una ausencia (P4) o un valor del cuerpo tras una respuesta: se sincronizan como dice el párrafo de § 5.

**Calibración de la enmienda (antes del arreglo):** el runner sobre la entrega da **37/41**, y los cuatro
rojos son exactamente E8, VT10, BN7 y P4, cada uno con el motivo de su hallazgo. Después del arreglo:
**41/41**.

### 5.4 · Enmienda por ceguera de E2 (arreglo + brazo nuevo)

La calibración de fase 7 dejó **K16 sin cazar**: con la app generando **clave nueva en cada clic** de
`emitir-enviar`, el árbitro sigue en 41/41. La causa no es el defecto ni la app, es el brazo: el botón
lleva `[disabled]="estadoEmitir() === 'enviando'"`, así que el doble clic de E2 **nunca produce un
segundo POST**, y la clave que E2 dice medir jamás se pone a prueba. E2 no puede fallar por la vía que
declara — la ley del arnés: *un arnés que no puede fallar es decoración*.

La protección real de la app contra el doble envío **existe y es correcta**: es el botón deshabilitado.
Lo que falta es que esa protección sea **contrato**, y no un efecto colateral que nadie mira. Nace un
brazo, sin tocar los 41:

| # | brazo | Verde si |
|---|---|---|
| H-5 | **E9** · el envío de emitir se cierra mientras está en curso (§ 4.3) | desde la cuenta sembrada y el formulario con los datos felices de § 3, con el `POST /boletas` **retenido en la red del navegador** hasta que el brazo lo suelte: mientras el envío está en curso, `emitir-enviar` está **deshabilitado** (propiedad `disabled` del elemento, no una clase); al soltar la respuesta y llegar a `emitir-exito`, vuelve a estar **habilitado**. Se sincroniza con el `POST` retenido y con `emitir-exito`, nunca por tiempo |

Pasa a haber **42** brazos (BN1–BN7, L1–L6, E1–E9, A1–A5, P1–P4, VT1–VT10, R1).

**Qué NO hace esta enmienda, a propósito:** no toca E2 ni K16. E2 se queda como está y K16 se queda
**no cazado** en el número de fase 7 — retocar un brazo después de ver su resultado sería elegir la
pregunta después de la respuesta. Lo que se agrega es el brazo que cubre el camino por el que la app
sí se protege.

**Defecto que la calibra (K54, fijado antes de medir):** quitar el `[disabled]` del botón
`emitir-enviar` → **E9 rojo**, y sólo E9. Con el `[disabled]` quitado, K16 vuelve a ser observable por
E2: esa es justamente la prueba de que la ceguera venía de ahí, y queda anotada en la bitácora del arnés.

## 6 · Defectos de calibración (fijados antes de medir)

| # | Defecto inyectado | Debe cazarlo |
|---|---|---|
| K1 | `nav-boletas` con el testid renombrado | R1 |
| K2 | `nav-boletas` es un `<button>`, no un enlace | BN1 |
| K3 | elegir Boletas en el teléfono no cierra el panel | BN2 |
| K4 | sin `aria-busy` mientras carga | BN3 |
| K5 | con cero boletas no aparece `boletas-vacio` | BN4 |
| K6 | `boletas-reintentar` sólo repite `GET /cuentas` | BN5 |
| K7 | «Liberar fondos» en toda VENCIDA (ignora `fondosLiberados`) | L2 |
| K8 | resumen PDF en toda boleta que no sea VIGENTE | L2 |
| K9 | las dos vencidas con el mismo texto | L3 |
| K10 | la cuenta rotulada «Corriente» siempre | L4 |
| K11 | fechas con `toLocaleString` (hora del navegador) | L5 |
| K12 | fechas sin el rótulo «UTC» | L5 |
| K13 | el monto se envía con `Number()` | E1 |
| K14 | el plazo se envía como string | E1 |
| K15 | no se relee la lista tras emitir | E1 |
| K16 | clave nueva en cada clic de `emitir-enviar` | E2 |
| K17 | una sola clave para toda la vida del formulario | E3 |
| K18 | `maxlength="120"` en el nombre del beneficiario | E4 |
| K19 | `emitir-error` sin `data-codigo` | E4 |
| K20 | plazo `type="number" step="1"` sin `novalidate` | E5 |
| K21 | reintentar de emitir con clave nueva | E6 |
| K22 | sin respuesta mostrado como `emitir-error` | E6 |
| K23 | el `401` de emitir no cierra la sesión | E7 |
| K24 | tras devolver, la fila se deja como estaba (sin releer) | A1 |
| K25 | «Liberar fondos» llama a `/devolver` | A2 |
| K26 | clave nueva en cada clic de una acción | A3 |
| K27 | el rechazo de una acción sin `data-codigo` | A4 |
| K28 | acción sin respuesta sin releer la lista | A5 |
| K29 | el PDF se abre en pestaña nueva en vez de descargarse | P1 |
| K30 | `boleta-resumen-pdf` pide el comprobante | P2 |
| K31 | un PDF que falla no avisa | P3 |
| K32 | la ventanilla sólo por clic: al cargar con `#ventanilla` se ve la portada | VT2 |
| K33 | `ventanilla-volver` deja el fragmento | VT3 |
| K34 | el cobro con clave nueva en cada clic | VT6 |
| K35 | `ventanilla-error` sin `data-codigo` | VT5 |
| K36 | sin respuesta del cobro mostrado como error | VT7 |
| K37 | una sola clave para toda la vida de la ventanilla | VT8 |
| K38 | con sesión, `#ventanilla` muestra la ventanilla | VT9 |
| K39 | un testid ajeno de más en la ventanilla | R1 (y R1 de T4 con la enmienda) |
| K40 | la vista Boletas pide una fuente a un host ajeno (Z7) | R1 |
| K41 | el id de la ventanilla va en la ruta sin `encodeURIComponent` (Z8) | VT5 |
| K42 | un clic en un PDF descarga dos veces (Z9) | P1 |
| K43 | tras devolver, la fila se actualiza desde la respuesta del POST, sin releer (Z10) | A1 |
| K44 | tras emitir, el formulario conserva lo escrito (Z11) | E1 |
| K45 | con `#ventanilla`, la portada se ve **además** de la ventanilla (Z12) | VT2 |
| K46 | `boletas-reintentar` sólo repite `GET /boletas` (Z13) | BN5 |
| K47 | las filas en orden inverso al del API (Z14) | L1 |
| K48 | tras un rechazo, la fila muestra el estado nuevo pero conserva sus acciones viejas (Z15) | A4 |
| K49 | las opciones de `emitir-origen` con `value` = índice, no el id (Z6) | E1 |
| K50 | `trim()` a los cinco campos de texto de emitir (el código de la entrega, H-1) | E8 |
| K51 | `trim()` al id y al RUT de la ventanilla (el código de la entrega, H-2) | VT10 |
| K52 | la relectura tras una acción ignora un `500` y la red (el código de la entrega, H-3) | BN7 |
| K53 | el `401` de un PDF se muestra como falla de descarga (el código de la entrega, H-4) | P4 |
| K54 | el botón `emitir-enviar` sin `[disabled]` mientras el envío está en curso (§ 5.4, H-5) | E9 |

Por cada defecto, antes de fijar la fila: «¿qué observa el brazo con el defecto puesto?» (BITÁCORA #168).
Cada defecto parte de un `reset` **antes** de parchar (deuda de la biblioteca del calibrador).

## 7 · Batería que no debe moverse

Integración 440/440 · dominio 140/140 · invariantes 6/6 · guante 6/6 · typecheck y build en exit 0 ·
`verificar:s10-t4` **78/78** con la enmienda de H1 y la baseline de H2. `calibrar:s10-t4` sigue midiendo
su código.

## 8 · Alcance de archivos (declarado antes de empezar)

```
web/src/**                         frontend de S-17-boletas
scripts/verificar-s17-boletas.*    árbitro (fijado antes)
specs/S-17-testids-boletas.txt     contrato de testids (fijado antes)
scripts/verificar-s10-t4.mjs       enmienda de R1 (H1)
specs/S-10-baseline/*.png          baseline nueva (la aprueba el humano, H2)
specs/S-10-catalogo.md             desafío 16 sin EMITIDA (HU-02 J3)
package.json                       scripts verificar:s17-boletas / calibrar:s17-boletas
```
