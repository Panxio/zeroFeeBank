# S-17 · Pagos — pantalla de pagos a terceros (Bill Pay)

> Estado: **spec esperando la aprobación del humano** (2026-09-22). Spec, lista
> de testids, brazos y tabla de defectos quedan fijados **antes** de la entrega y no se tocan después
> (REGLA DE ORO). Historia: `specs/HU-05-pantalla-pagos.md` (CA1–CA8, R1–R8, J1–J4).
> Backend ya en `main`: S-15 (`POST /pagos`, `GET /pagos`). **No se toca backend.** Molde:
> `specs/S-17-movimientos.md`. Lo visual sigue la dirección visual ya establecida; el humano lo aprueba con captura.
>
> F1a se fundió en esta fase (D106-1). Lo que sigue es **F2** (el arnés) y **F3** (el ataque a
> ciegas), por separado; recién después se implementa F4.

---

## 1 · Qué hace, qué queda fuera, cuándo está hecho

- **Hace (frontend, `web/`):** la vista **Pagos**, a la que se llega por `nav-pagos`, **entrada propia
  de la barra** junto a Transferir y Movimientos (JP1). Tiene un formulario con cuenta de origen, monto
  y los 7 datos del beneficiario, que pide confirmación en `zfb-dialogo` y hace `POST /pagos` con
  `Idempotency-Key`. Tiene también una tabla con lo que devuelve `GET /pagos`.
- **Fuera:** backend (S-15 ya está) · agenda de beneficiarios, anulación y pago programado (HU-05 R1,
  R6) · comprobante PDF (R7) · filtros y paginación de la lista (HU-05 § 6) · los 5 datos del
  beneficiario que `GET /pagos` no devuelve (J1) · hora local chilena (R8) · la pantalla de Contacto.
- **Hecho:** los **24 brazos** de § 5 en verde sobre el **artefacto entregado** (el `dist/` del backend
  y el build de `web/`, servidos). Además, cada defecto de § 6 cazado por el brazo que lo declara, la
  batería de § 7 sin moverse (con la enmienda de los siete candados de § 5.1, aprobada por el humano),
  y el humano aprueba la pantalla en escritorio y teléfono: respuesta + captura.

---

## 2 · Lo que viene decidido (no se re-discute aquí)

| Fuente | Decisión | Dónde aterriza |
|---|---|---|
| HU-05 R2 | 7 datos obligatorios, no vacíos tras `trim`, máximos 100·100·50·50·20·20·50 | B1–B4 |
| HU-05 R3/R4 | monto > 0, sin tope; el débito es exactamente el monto | P1, E1, E2 |
| HU-05 R7/R8 | sin PDF; fechas UTC rotuladas «UTC» | A1 |
| HU-05 J1 | la lista muestra fecha, origen, beneficiario, cuenta del beneficiario y monto | P1 |
| HU-05 J3/J4 | idempotencia como T3 y confirmación con `zfb-dialogo` | D1–D3, I1, I2 |
| D106-1 | F1a no va aparte: el titular se arma por API y el único dato (`SALDO_BASE`) se lee acá | § 4 |

**El 404 de cuenta ajena (R5) no es brazo de pantalla.** El selector sólo ofrece cuentas del titular.
Provocarlo exigiría que la suite tocara la app, y el perfil SUT lo prohíbe. Lo cubre `test:billpay`.
Por la misma razón quedan fuera `CUERPO_INVALIDO`, `IDEMPOTENCY_KEY_AUSENTE/INVALIDA/REUSADA` y los
`TOKEN_*`: la pantalla no puede emitirlos sin un defecto.

---

## 3 · Decisiones de diseño (contrato de pantalla, discutibles)

| # | Decisión | Porqué |
|---|---|---|
| JP1 | **Una vista a la vez** y `nav-pagos` es **entrada de primer nivel**, hermana de `nav-transferir` dentro de `nav-panel`, fuera de `nav-cuentas-menu`. Entrar pide `GET /cuentas` (selector) y `GET /pagos` (lista) | precedente D90-2 y JM1: sin submenú no hay `display:none` ni `mouseenter` que vuelvan un brazo imposible, y el brazo `N2` de `verificar:s17-abrir-cuenta` no cambia de significado |
| JP2 | **El cliente no valida nada.** `pagos-form` lleva `novalidate` y ningún campo trae `required`, `pattern`, `min`, `max`, `step`, `minlength` ni `maxlength`. **Los 8 campos son `type="text"`** (atributo literal, D97-3); el monto lleva `inputmode="decimal"` | HU-05 J2 permitía validar «por comodidad», pero un `maxlength` vuelve **inalcanzable** «máximo + 1» (CA2) y un `type="number"` vuelve inalcanzable `10,00` (CA3): F2 nacería imposible. La autoridad sigue siendo la API (J2), así que esto la cumple por construcción. CA6 queda verificado sobre el DOM (E3) |
| JP3 | **El selector de origen nace con la PRIMERA cuenta de `GET /cuentas` elegida**, sin opción vacía. El `value` de cada `<option>` es el **id** de la cuenta (D97-2), y es contrato | Pilar 0: ningún CA pide la opción vacía, y la única que la justificaría (`CUENTA_NO_ENCONTRADA`) queda fuera por § 2 |
| JP4 | **Se envía el texto tal como está escrito, sin `trim` en el cliente.** El campo vacío viaja como `""`, nunca se omite | el `trim` y el rechazo por vacío son de la API (`pagos.controller.ts:30-45`). Un `trim` del cliente es inocuo hoy, pero omitir el campo cambiaría el código que sale (B3/B4 lo afirman) |
| JP5 | **Confirmación antes de pagar:** `pagos-enviar` abre `zfb-dialogo tipo="confirmar"` (testids de T3) con el monto; **no hay POST hasta `confirmar-aceptar`**. Cancelar o `Escape` cierran sin llamar | HU-05 J4: un pago mueve plata y no tiene reverso (R6) |
| JP6 | **Idempotencia como T3** (S-10 T3 H4): cada `confirmar-aceptar` genera una clave **nueva** con `crypto.randomUUID()`. El doble clic produce **un solo pago**. Si la red no responde aparece `pagos-sin-respuesta` con `pagos-reintentar`, que **reenvía directo, sin diálogo y con la MISMA clave**. Con `Idempotency-Replayed: true` además se ve `pagos-repetido` | D5 del perfil. La clave es **única en toda la BD** (`idempotencia.ejecutor.ts:58`, `findUnique({ clave })`), así que un contador o una clave fija chocaría entre titulares: el UUID no es estética. CORS ya expone la cabecera (`src/main.ts:17`) |
| JP7 | **Estados del envío (C4)** en `data-estado` de `pagos-form`: `editando`, `enviando`, `exito`, `error` y `sin-respuesta`. `aria-busy="true"` sólo en `enviando`, junto con `pagos-enviando` y `pagos-enviar` **deshabilitado** | sin estados la suite sólo puede esperar por tiempo, y el perfil lo prohíbe |
| JP8 | **Estados de la lista (C4)** en `data-estado` de `pagos-lista`: `cargando`, `listo`, `vacio` y `error`. `aria-busy="true"` sólo en `cargando`. Tras un pago exitoso **la lista se vuelve a pedir** y el pago nuevo aparece sin salir de la vista | CA1 («aparece primero») y CA7. Recargar en vez de insertar a mano deja que el orden lo decida el API |
| JP9 | **La pantalla pinta el orden del API y nunca re-ordena** (`pagadoEn DESC`, desempate `id ASC`, `pagos.service.ts:162`) | igual que JM5: un `sort` del cliente taparía un cambio de orden del backend |
| JP10 | **Cada fila expone atributos**, y la suite afirma sobre ellos y no sobre el texto. `pago-fila` lleva `data-pago-id` y `data-transaccion-id`. `pago-fecha` lleva `data-fecha` (ISO crudo). `pago-origen` lleva `data-cuenta-id`. `pago-monto` lleva `data-monto` (string decimal del API, sin `$`). El texto de `pago-beneficiario` y `pago-cuenta-beneficiario` es el valor del API | D90-4: pantalla contra API, campo por campo |
| JP11 | **Errores con código (C5).** El código viaja en `data-codigo` sobre `pagos-error` (`role="alert"`) y como texto en `pagos-codigo-error`. El mensaje en prosa es el `mensaje` que manda el API (`errData?.mensaje \|\| codigo`, el patrón de Transferir). Sin respuesta de red **no** hay `pagos-error` ni `data-codigo` | la suite afirma el código y la persona lee la prosa. Pilar 0: no se escribe un mapa nuevo de mensajes |
| JP12 | **Tres fallos distintos, tres testids:** `GET /cuentas` → `pagos-cuentas-error` + `pagos-cuentas-reintentar`; `GET /pagos` → `pagos-lista-error`; `POST /pagos` → `pagos-error`. Titular sin cuentas → `pagos-sin-cuentas` y **no** se monta `pagos-form` | son tres peticiones con tres remedios (JM10) |
| JP13 | **Éxito:** `pagos-exito` (`role="status"`) con `pagos-pago-id` cuyo texto es el `id` de la respuesta; el formulario se limpia | CA1 |
| JP14 | **Accesibilidad:** `pagos-tabla` con `<caption>` y todos sus `<th scope="col">`; cada uno de los 8 campos con `<label for>` a un `id` que existe; `nav-pagos` con rol y nombre accesible | línea roja del núcleo |
| JP15 | **La fecha visible usa `formatearFechaUtc`** (`web/src/app/app.ts:945-948`): se reusa y no se modifica | R8. Pilar 0, peldaño 4; cambiarla movería candados ajenos |
| JP16 | **Foco inicial del diálogo de Pagos en `confirmar-cancelar`** (E6). Es lo que `zfb-dialogo` ya hace con `tipo="confirmar"` (`zfb-dialogo.ts:240`): la vista de Pagos no lo cambia | `Escape` va al elemento enfocado; sin declararlo, D1 dependería de un detalle no escrito (hallazgo #3 de F3). Quitar la opción segura como foco inicial en un pago sin reverso sería además un riesgo para la persona |

---

## 4 · Constantes y datos del oráculo

**Nada se inventa: cada fila apunta a dónde se lee.** Los montos van como string decimal (D1).

| Constante | Valor | De dónde sale |
|---|---|---|
| Viewports | escritorio **1280×800** · teléfono **390×844** | los de T2–T4 y las S-17 anteriores |
| Tope de cada espera por condición | **8000 ms** | el de T1–T4: un rojo, no un cuelgue |
| Apertura de la CORRIENTE del titular | **`1000.00`** desde la caja | mínimo de apertura `MONTO_APERTURA_MINIMO_CENTAVOS = 100000n` (`src/modules/cuentas/cuentas.constants.ts:18`); mismo camino que `verificar-s17-transferir.mjs:303` |
| `SALDO_BASE` | **`1000.00`** | consecuencia de la fila anterior, **afirmada** en la preparación (§ 4.1) |
| Pago previo (preparación de P1) | **`10.00`**, beneficiario `Previo S.A.` | valor libre; sólo tiene que ser distinto del de P1 |
| Pago de P1 | **`123.45`** → saldo final **`866.55`** | 1000.00 − 10.00 − 123.45; sin comisión (R4) |
| Máximos (R2) | nombre **100** · dirección **100** · ciudad **50** · estado **50** · código postal **20** · teléfono **20** · cuenta **50** | `src/modules/pagos/pagos.constants.ts:21-29` |
| Códigos por campo, en orden de precedencia | `PAGO_BENEFICIARIO_NOMBRE_INVALIDO` → `…_DIRECCION_INVALIDA` → `…_CIUDAD_INVALIDA` → `…_ESTADO_INVALIDO` → `…_CODIGO_POSTAL_INVALIDO` → `…_TELEFONO_INVALIDO` → `PAGO_CUENTA_BENEFICIARIO_INVALIDA` | `pagos.errors.ts:39-90`; orden `pagos.controller.ts:32` sobre `CAMPOS_BENEFICIARIO` |
| Precedencia global relevante | `MONTO_INVALIDO` antes que los 7 campos; `FONDOS_INSUFICIENTES` al final | `pagos.controller.ts:50-58` y mapa § 3(d) |
| Montos inválidos | **`0`**, **`-5.00`**, **`10,00`** → `MONTO_INVALIDO` (400) | `pagos.controller.ts:91-103`; regex de `parseMoney` (`src/domain/money/money.ts:1`) |
| Monto sobre el saldo | **`1000.01`** con saldo `1000.00` → `FONDOS_INSUFICIENTES` (409) | `transferencias.service.ts:103` |
| Beneficiario válido de referencia | `Luz del Sur` · `Av. Siempre Viva 742` · `Santiago` · `RM` · `8320000` · `+56 2 2345 6789` · `CL-000123` | valor libre; cada valor bajo su máximo |

### 4.1 · Preparación de datos, y la defensa contra el brazo imposible

Cada dato se construye con una función que **afirma sus propios límites antes de usarlos**:

- **Titular con saldo:** `POST /auth/registro` → login → `POST /cuentas {tipo:'CORRIENTE', monto:'1000.00'}`.
  La función afirma que `GET /cuentas` devuelve **1** cuenta CORRIENTE con saldo **`1000.00`** y que
  `GET /pagos` devuelve **0** pagos. Si algo falla, el arnés muere diciendo qué paso de la preparación
  se rompió, no con un brazo en rojo.
- **Titular con un pago previo (P1):** lo anterior + un `POST /pagos` de `10.00` por API, con una
  clave UUID. La función afirma el `201`, que `GET /pagos` trae **1** pago y que el saldo es `990.00`.
  **Sin esto, «aparece primero» sería trivial sobre una lista vacía** (nota de F0).
- **Titular sin cuentas (C4):** sólo registro y login; se afirma que `GET /cuentas` devuelve 0.
- **Cadenas de borde:** `'a'.repeat(max)` y `'a'.repeat(max + 1)`, afirmando su `length` antes de
  escribirlas. «Sólo espacios» es `'   '` (3 espacios).
- **No se usa ningún escenario de `seed`:** ninguno siembra pagos (mapa § 6(c)). Sólo se usa
  `POST /__test__/reset` al empezar.

---

## 5 · Brazos del arnés (fijados antes de la entrega; no se tocan después)

Runner nuevo: `verificar:s17-pagos`, **24 brazos**. Corre contra el artefacto servido (backend
`node dist/main.js` en :3000 y el build de `web/` en :4200). **No importa código de la app** y no toca
la BD. Todo estado entra por `/__test__/reset` y por el API público. Toda afirmación de «saldo intacto»
o «saldo baja» se hace **por `GET /cuentas`** con el token del titular.

**Enmiendas de F3 al arnés (aprobadas por el humano):**
**E1** el ayudante de pago registra cada `data-estado` de `pagos-form` con un `MutationObserver`, y todo
rechazo (B2–B5, E1, E2) exige que el formulario haya pasado por `enviando` (JP7 en cada envío, no sólo
el primero). **E2** antes de aceptar, el ayudante espera la ausencia de POST con el diálogo abierto
(K10b). **E3** las intercepciones del navegador (`page.route`) casan por host y pathname, no por un
glob literal.

### Navegación y contrato (N)

| # | Qué afirma | Cómo |
|---|---|---|
| N1 | `nav-pagos` es entrada de primer nivel: visible **sin hover**, dentro de `nav-panel`, **no** dentro de `nav-cuentas-menu`, hermana de `nav-transferir`. Al pulsarla se monta `pagos-region` y deja de estar montada `cuentas-tabla`, y salen `GET /cuentas` y `GET /pagos` | posición leída del DOM renderizado (`closest`) |
| N2 | `nav-pagos` es alcanzable por teclado y tiene rol + nombre accesible correctos | JP14 |
| N3 | Contrato de testids **sobre el artefacto renderizado**. Recorriendo los estados que montan los brazos, aparecen todos los de `specs/S-17-testids-pagos.txt`; ninguno se repite salvo `pago-fila` y sus cinco celdas; y no aparece ninguno fuera de T4 ∪ boletas ∪ abrir-cuenta ∪ transferir ∪ movimientos ∪ esta lista | RESTRICCIONES § 2 |

### Carga y estados (C) — CA7

| # | Qué afirma | Cómo |
|---|---|---|
| C1 | Con el `POST /pagos` **retenido en el navegador**: `pagos-form` en `data-estado="enviando"`, `aria-busy="true"`, `pagos-enviando` presente, `pagos-enviar` con `disabled`, **y** un click forzado no genera un segundo POST (contado por intercepción) | mirar sólo `[disabled]` es la ceguera K16 de la 63 |
| C2 | Con `GET /pagos` retenido: `pagos-lista` en `cargando` + `aria-busy="true"` + `pagos-lista-cargando`. Al soltarlo, con un titular sin pagos, queda en **`vacio`**, `pagos-vacio` está presente y `pago-fila` cuenta **0** | CA7, estado vacío explícito |
| C3 | `GET /cuentas` forzado a 500 → `pagos-cuentas-error` y `pagos-cuentas-reintentar`, y el reintento llena el selector. En otra carga, `GET /pagos` forzado a 500 → `pagos-lista-error`, **sin** `pagos-vacio` | JP12; la falla se provoca interceptando **en el navegador** |
| C4 | Titular sin cuentas → `pagos-sin-cuentas` visible y `pagos-form` **no** montado | JP12 |

### Pago feliz (P) — CA1

| # | Qué afirma | Cómo |
|---|---|---|
| P1 | Con el titular del pago previo, se paga **`123.45`** con el beneficiario de referencia → **un** POST, `201`; `pagos-form` en `exito`, y el texto de `pagos-pago-id` es el `id` de la respuesta. Por el API, el saldo pasa de `990.00` a **`866.55`**. La lista queda con **2** `pago-fila`, **la primera con `data-pago-id` igual al nuevo**, y las 2 filas son iguales campo por campo a `GET /pagos`: `data-pago-id`, `data-transaccion-id`, `data-fecha`, `data-cuenta-id`, `data-monto`, texto de beneficiario y de cuenta. Además, `devueltos === filas pintadas` | CA1 + J1 + JP9/JP10. Compara pantalla contra API, no contra constantes |
| P2 | Con un titular de **dos** cuentas, las `<option>` de `pagos-origen` tienen `value` igual a los ids de `GET /cuentas`, en su orden, y la elegida al entrar es la primera. Si se elige la segunda y se paga, el POST lleva `cuentaOrigenId` = segunda y baja **esa** cuenta | JP3, D97-2 |

### Beneficiario (B) — CA2, con el borde exacto

Cada rechazo afirma: el POST **salió** (intención, D80-3), `data-codigo` y `pagos-codigo-error` con el
código esperado, `pagos-form` en `error`, el saldo por API **intacto** y ninguna `pago-fila` nueva.

| # | Qué afirma |
|---|---|
| B1 | Los **7 campos a la vez en su máximo exacto** (100·100·50·50·20·20·50) → `201` y el saldo baja el monto |
| B2 | **Cada campo en máximo + 1**, con los otros 6 válidos → su código propio (7 sub-casos, uno por campo) |
| B3 | **Cada campo vacío** (`""`), con los otros 6 válidos → su código propio (7 sub-casos) |
| B4 | `beneficiarioNombre` = **sólo espacios** → `PAGO_BENEFICIARIO_NOMBRE_INVALIDO` |
| B5 | **Precedencia:** dirección vacía **y** teléfono en máximo + 1 a la vez → **`PAGO_BENEFICIARIO_DIRECCION_INVALIDA`** (el primero en orden) |

### Monto y errores (E) — CA3 y CA6

| # | Qué afirma |
|---|---|
| E1 | `0`, `-5.00` y `10,00` → **`MONTO_INVALIDO`**, cada uno con las afirmaciones de rechazo de B |
| E2 | `1000.01` sobre saldo `1000.00` → **`FONDOS_INSUFICIENTES`**, saldo intacto |
| E3 | Sobre el DOM renderizado: `pagos-form` lleva `novalidate`; ninguno de sus 8 campos trae `required`, `pattern`, `min`, `max`, `step`, `minlength` ni `maxlength`; los 8 inputs de texto tienen **atributo** `type="text"` (JP2, D97-3) |

### Diálogo e idempotencia (D, I) — CA4, CA5, J3, J4

| # | Qué afirma | Cómo |
|---|---|---|
| D1 | **CA5** · `pagos-enviar` → `confirmar-dialogo` abierto → `confirmar-cancelar` → **0** POST, diálogo cerrado, saldo intacto. Lo mismo con `Escape` | intercepción `page.on('request')` antes del gesto |
| D2 | **CA4** · doble `click()` sincrónico sobre `confirmar-aceptar` (dentro del shadow root) → todas las peticiones salidas llevan **la misma** clave, `GET /pagos` crece en **exactamente 1** y el saldo baja **una** vez | técnica de `verificar-s10-t4.mjs:1598-1625` |
| D3 | **J4** · pulsar `pagos-enviar` abre el diálogo y **no** hace POST hasta aceptar | contado por intercepción |
| I1 | **Sin respuesta, ejecutado:** el POST llega al backend (`route.fetch`) y su respuesta se pierde (`route.abort`). Se afirma `pagos-sin-respuesta` visible, `pagos-form` en `sin-respuesta` y **sin** `pagos-error` ni `data-codigo`. Luego `pagos-reintentar` → POST **con la misma clave**, **sin** diálogo, `pagos-exito` **con** `pagos-repetido`, y el saldo baja **una sola** vez | JP6; T6 de S-10 T3 |
| I2 | Dos pagos seguidos de la misma sesión llevan claves **distintas**, y las dos tienen forma de UUID | JP6: la clave es única en toda la BD |

### Formato y accesibilidad (A) — CA8

| # | Qué afirma |
|---|---|
| A1 | En la fila del pago de P1, el `data-fecha` es **igual** al `pagadoEn` del API, y el texto visible de `pago-fecha` es exactamente `formatearFechaUtc(pagadoEn)`: `AAAA-MM-DD HH:MM UTC`, calculado por el brazo desde el ISO y terminado en ` UTC`. **Ancla de texto deliberada**: el rótulo UTC es regla del humano (R8) |
| A2 | `pagos-tabla` tiene `<caption>` no vacío y todos sus `<th>` con `scope="col"`; los 8 campos tienen `<label for>` que apunta a un `id` **que existe**; `pagos-error` tiene `role="alert"` y `pagos-exito` `role="status"` |

### 5.1 · Los siete candados que esta unidad rompe, y la enmienda prevista

`nav-pagos` está en la barra de **toda** vista autenticada y no está en ninguna lista blanca, así que
los siete candados se ponen **rojos** en su auditoría de testids. Líneas verificadas en
disco:

| Candado | Brazo | Enmienda, de una línea |
|---|---|---|
| `verificar:s10-t2` (31) | `R1`, `:740` | sumar `'S-17-testids-pagos.txt'` al `Set` `UNION_POSTERIORES` de `:38` (filtra **sólo** `sobran`, E2) |
| `verificar:s10-t3` (56) | `R1`, `:2105` | idem, `UNION_POSTERIORES` de `:44` |
| `verificar:s10-t4` (78) | `R1`, `:3284` | leer `LISTA_S17PAG` y sumarla al filtro de `sobran` |
| `verificar:s17-boletas` (42) | `R1`, `:2361` | extender `UNION_T4_S17` de `:56` |
| `verificar:s17-abrir-cuenta` (18) | `N4`, `:749` | extender `UNION` de `:41` |
| `verificar:s17-transferir` (19) | `N1`, `:1282` | sumar `leerLista('S-17-testids-pagos.txt')` a `UNION` de `:131` |
| `verificar:s17-movimientos` (23) | `N3`, `:1022` | idem, `UNION` de `:135` |

**Lo que FALTA se sigue midiendo como hoy, y un testid ajeno sigue poniendo rojo cada candado.** No se
relaja ninguna aserción: se actualiza el contrato versionado (C3). La enmienda **requiere la
aprobación del humano** y se calibra. Con ella puesta, K15 de § 6 tiene que seguir cazando a N3, y cada
candado enmendado tiene que ponerse rojo si se le cuela un testid que no está en ninguna lista
(calibración `7/7`, como las anteriores `2/2` y `6/6`).

---

## 6 · Defectos de calibración (fijados antes de medir)

| # | Defecto inyectado | Debe poner ROJO | Debe seguir VERDE |
|---|---|---|---|
| K1 | La lista se re-ordena por fecha **ascendente** | **sólo P1** | A1, C2 |
| K2 | `data-monto` de la fila lleva el `$` o un signo `-` | **sólo P1** | A1 |
| K3 | Los campos del beneficiario llevan `maxlength` = su máximo | **E3 y B2** | B1, B3, B4 |
| K4 | `pagos-form` pierde `novalidate` y los campos llevan `required`; `pagos-enviar` pierde su `(click)` y el envío pasa por el `(submit)` del form, con la validación nativa (D114-2) | **E3, B3 y B5** (B5 lleva la dirección vacía: `required` la bloquea por la misma causa que B3; D115-1) | B1, B2, **B4** (los espacios satisfacen `required`) |
| K5 | `pagos-monto` pasa a `type="number"` | **E3 y E1** (`10,00` no se puede escribir) | E2, P1 |
| K6 | `beneficiarioTelefono` se envía con el valor del código postal | **B2 y B3** (sub-caso teléfono) | P1, B1, B5 |
| K7 | Cada click de aceptar genera **clave nueva** y no hay bandera de envío: la de la vista **y** la guarda `enviado` de `zfb-dialogo` (`zfb-dialogo.ts:249-256`, M16), que también se quita al inyectar (E5; sin eso el doble clic emite una vez y K7 no es inyectable) | **sólo D2** | D1, I1 |
| K8 | `pagos-reintentar` genera **clave nueva** | **I1**, y **N3** por arrastre: el brazo caído no monta `pagos-repetido` y ese testid no llega a la unión (mismo patrón E4 de K10; D114-3) | D2, I2 |
| K9 | `confirmar-cancelar` hace el POST igual | **sólo D1** | D2, D3 |
| K10 | `pagos-enviar` hace el POST **directo**, sin diálogo | **D3, D1, D2 y todo brazo que paga por la UI** (P1, P2, B1–B5, E1, E2, I1, I2, C1, **A1, A2**): el ayudante de pago **exige** el diálogo, porque J4 es contrato y no cortesía. **N3** también, por arrastre: los testids que recolectan los brazos caídos no llegan a la unión (E4) | N1, N2, C2, C3, C4, E3 |
| K10b | `pagos-enviar` hace el POST **y además** abre el diálogo (E2) | **los mismos que K10 menos C1**: el ayudante espera la **ausencia** de POST durante `ESPERA_AUSENCIA_MS` con el diálogo abierto antes de aceptar. C1 no usa el ayudante y lo que afirma (`enviando`, `disabled`, un solo POST) se cumple; J4 es de D3 (D115-2) | los mismos que K10, **y C1** |
| K11 | Sin pagos, la lista se queda en `cargando` (no existe `vacio`) | **C2**, y por arrastre **C1, P2, B1–B5, E1–E3, D1–D3, I1, I2 y N3**: el ayudante de entrada espera `pagos-lista` en `listo\|vacio` antes de cada brazo y, con la lista pegada en `cargando`, se agota en todos los que parten sin pagos (los 17 rojos medidos — un recuento previo decía 19 por un error de cuenta; D114-4). C1 estaba antes en la columna verde | C3, C4, N1, N2, P1, A1, A2 |
| K12 | `pagos-enviar` no se deshabilita durante el envío | **sólo C1** | C2 |
| K13 | El fallo de `GET /cuentas` se muestra como titular **sin cuentas** | **C3**, y **N3** por arrastre: el brazo caído no monta `pagos-cuentas-error` ni `pagos-reintentar` (patrón E4; D114-3) | C4 |
| K14 | La fecha visible pierde « UTC» | **sólo A1** | P1 (compara `data-fecha`) |
| K15 | Un testid ajeno (`pagos-extra`) se cuela en la plantilla | **sólo N3** | los demás |
| K16 | `nav-pagos` se monta **dentro** de `nav-cuentas-menu` | **sólo N1** | N3 |
| K17 | La tabla pierde `<caption>` y `scope="col"` | **sólo A2** | los demás |
| K18 | Sin respuesta de red se pinta `pagos-error` con un código | **I1**, y **N3** por arrastre: el brazo caído no monta `pagos-sin-respuesta` (patrón E4; D114-3) | D2 |
| K19 | Tras pagar, la lista **no** se vuelve a pedir | **sólo P1** | B1 |

**K3/K4 son un par a propósito:** cada uno debe cazar un conjunto **distinto** de brazos de B (B2
frente a B3). Si cayeran igual, B2 y B3 medirían lo mismo. Lo mismo pasa con **K7/K8** (D2 frente a
I1). **K3, K4, K5, K10 y K10b caen sobre más de un brazo, declarado antes de medir.** En K3–K5 ese segundo
rojo **es el punto**: el atributo vuelve inalcanzable el código de la API (JP2).

**Sonda de ceguera declarada (su verde se escribe antes de medir):**

| # | Cambio | Deben seguir VERDES | Árbitro que sí lo mira |
|---|---|---|---|
| K20 | Se cambia la prosa de `pagos-vacio`, de `pagos-exito` y del mensaje de error | **los 24** | el ojo del humano sobre la captura (C5) |

---

## 7 · Batería que no debe moverse

Última medición, sobre `main`, el día del merge de movimientos: `typecheck` **0** · `guante`
**6/6** · `test:domain` **140/140** · `test:integracion` **446/446** · `invariantes` **6/6** ·
`invariantes:calibrar` **16/16** · `demo:m6` **3/3 · 42/42**. **Se re-mide el día de la entrega.**
Los siete candados de § 5.1 (31 · 56 · 78 · 42 · 18 · 19 · 23, los `BRAZOS_TOTAL` declarados) se
corren con su enmienda y el número real va al cierre. `demo:m6` se re-corre porque la barra cambia.

---

## 8 · Alcance de archivos (declarado antes de implementar)

**La implementación toca sólo esto:** `web/src/app/app.html` (entrada de barra, vista, formulario, tabla y
la instancia de `zfb-dialogo` de Pagos) · `web/src/app/app.ts` (estado, cargas, envío, idempotencia,
estados de JP7/JP8) · `web/src/styles.css` (lo visual, dirección visual ya establecida; **en teléfono la tabla no
se recorta dentro de `.tabla-scroll`**).

**Se escriben aparte:** esta spec, `specs/S-17-testids-pagos.txt`, `scripts/verificar-s17-pagos.mjs`
y su `.sh`, la línea de `package.json` y las siete enmiendas de § 5.1.

**Nadie toca:** `src/` (S-15 ya está), las migraciones, `zfb-dialogo.ts`, `formatearFechaUtc`, ni las
pantallas de Transferir, Boletas, Abrir cuenta y Movimientos.

---

## 9 · Lo que se midió antes de escribir esta spec

| Fase | Sesión | Qué dejó | Dónde |
|---|---|---|---|
| **F0** · mapa | — | contrato real de `/pagos`, precedencia, 5 seeds (0 con pagos), 7 candados, fuente de cada CA; 345 citas, 3 corregidas, 0 errores de contenido | — |
| **F1b** · esta spec | — | 15 decisiones de pantalla, 24 brazos, 19 defectos + 1 sonda; verificados en disco: mínimo de apertura (`cuentas.constants.ts:18`), `Escape` del diálogo (`zfb-dialogo.ts:278`), CORS (`main.ts:17`), unicidad global de la clave (`idempotencia.ejecutor.ts:58`) y las 7 líneas de lista blanca | este archivo |

**Lo que falta:** **F2** = `scripts/verificar-s17-pagos.mjs`; **F3** = el
ataque al arnés a ciegas, que es compuerta antes de implementar F4.
