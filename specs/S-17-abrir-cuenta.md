# S-17 · Abrir cuenta — pantalla de apertura y el tipo real de cada cuenta

> Estado: **spec esperando la aprobación del humano** (2026-09-16). Spec, lista
> de testids, brazos y tabla de defectos quedan fijados **antes** de la entrega y no se tocan
> después. Historia: `specs/HU-04-pantalla-abrir-cuenta-y-transferir.md` (CA1–CA4 y J1).
> Backend ya en `main`: S-12 (`POST /cuentas`), S-20 (AHORRO). **No se toca backend.**
> Molde: `specs/S-17-boletas.md`. Lo visual sigue la dirección visual ya establecida; el humano lo aprueba con captura.

## 1 · Qué hace, qué queda fuera, cuándo está hecho

- **Hace (frontend, `web/`):** la vista **Abrir cuenta**, a la que se llega por `nav-abrir-cuenta` en
  el submenú de cuentas y por un botón en el estado vacío del Resumen; y el **tipo real de cada
  cuenta** (`CORRIENTE` / `AHORRO`) en el Resumen, en «Mis cuentas» y en el selector de origen, que
  hoy rotula todo como «Corriente» (HU-04 J1).
- **Fuera:** backend · la pantalla de Transferir con su destino «Otro banco» (va en S-17-transferir) ·
  cerrar o editar una cuenta (S-12) · mostrar el cupo restante del tope (HU-04 R8) · `GET /bancos`
  (HU-04 J2) · intereses, comisiones u otra moneda · hora local (HU-04 R10).
- **Hecho:** los brazos de § 5 en verde sobre el **artefacto entregado** (el `dist/` del backend y el
  build de `web/`, servidos), cada defecto de § 6 cazado por el brazo que lo declara, la batería de
  § 7 sin moverse, y el humano aprueba la pantalla en escritorio y teléfono: respuesta + captura.

## 2 · Decisiones de diseño (contrato de pantalla, discutibles)

| # | Decisión | Porqué |
|---|---|---|
| JA1 | **Una vista a la vez** (S-17-boletas J4): Resumen, Transferir, Boletas o **Abrir cuenta**. Entrar a Abrir cuenta pide `GET /cuentas` | con dos vistas montadas los testids de carga saldrían dos veces |
| JA2 | **El cliente no valida nada**: envía lo escrito y el API decide con código (C5). El formulario lleva `novalidate` y **ningún** `min`, `max`, `step`, `pattern` ni `required` | la misma regla de T3 H3 y de S-17-boletas J1: una regla duplicada en el cliente sería una regla de negocio inventada y dejaría **inalcanzables desde la UI** los códigos de CA3 |
| JA3 | **Monto**: el texto sin espacios a los lados, enviado como string (D1). Prellenado con `1000.00` | HU-04 R2. `MONTO_APERTURA_MINIMO_CENTAVOS = 100000n` (`cuentas.constants.ts:19`). Como string por el borde de `bigint`: `number` no entra |
| JA4 | **Origen**: si el titular **no tiene** cuentas, el selector de origen **no se renderiza**. Si tiene una o más, el selector aparece con una **opción vacía elegida por defecto** («— elige una cuenta —»). En los dos casos, cuando no hay origen elegido el campo `cuentaOrigenId` **se OMITE del cuerpo**: no se envía `""` ni `null` | HU-04 R3 y JA2. La opción vacía es lo que deja alcanzable `CUENTA_ORIGEN_REQUERIDA` desde la pantalla: con la primera cuenta preseleccionada, ese código del API no se podría provocar nunca. **Y el campo debe omitirse**: `cuentas.service.ts:92-95` valida contra el regex UUID **cualquier** valor distinto de `undefined`, así que un `""` daría `CUENTA_NO_ENCONTRADA` y E3 sería un brazo imposible (hallazgo del ataque a ciegas, F3) |
| JA5 | **Una `Idempotency-Key` por intento**: nace al enviar, **se reusa** en el doble clic, y **se descarta** ante toda respuesta definitiva (2xx o 4xx) | HU-04 J4 y S-17-boletas J3. Tras un 4xx el siguiente intento es otra operación: con la clave vieja el backend devolvería el rechazo guardado. **Sin** el «Reintentar tras respuesta perdida» que sí tiene Boletas: obligaría a brazos de red simulada que esta unidad no necesita (Pilar 0). Queda como no-goal declarado |
| JA6 | **Tras la apertura con éxito** se vuelve al Resumen y se **vuelven a pedir las cuentas** (`GET /cuentas`); la pantalla muestra lo que diga el API, nunca un saldo calculado en el cliente | la lista es la verdad. Es además un defecto que ya se vio: Boletas releía las boletas pero no las cuentas, y el selector mostró $640,00 con el saldo real en 389,90 |
| JA7 | **El tipo se muestra en todas partes** (HU-04 J1): Resumen, «Mis cuentas» y el selector de origen de la apertura (el de Transferir es de S-17-transferir). El código va en `data-tipo` y el **rótulo visible vive DENTRO de ese mismo elemento** (`cuenta-tipo` en la fila, la `<option>` en el selector). Los rótulos son exactamente **«Corriente»** y **«Ahorro»**, nunca el enum crudo en mayúsculas | C3: los brazos afirman sobre el atributo. La co-ubicación se fija acá **porque el ataque a ciegas mostró que sin ella A4 es imposible**: con el rótulo en otro nodo, el brazo lee vacío sobre una app correcta, y K2/K3 dejan de separarse |
| JA8 | **Estados de carga explícitos** (C4): la vista declara cuándo está ocupada y cuándo terminó, con el mismo mecanismo que ya usan T2–T4 y Boletas | sin esto, la única herramienta de la suite es esperar por tiempo, que es lo que el perfil prohíbe |
| JA9 | **El código del error** viaja a la pantalla en un atributo, y el mensaje en prosa es para la persona | C5: la suite afirma sobre el código |

## 3 · Constantes

| Constante | Valor | Porqué |
|---|---|---|
| Viewports del arnés | escritorio **1280×800** · teléfono **390×844** | los de T2–T4 y S-17-boletas |
| Tope de cada espera por condición | **8000 ms** | el de T1–T4: un rojo, no un cuelgue; no es un `sleep` |
| Monto mínimo de apertura | **`1000.00`** (`100000n` centavos) | dato de negocio del humano, 2026-09-07; `src/modules/cuentas/cuentas.constants.ts:19`. **No se inventa: se lee de ahí** |
| Monto bajo el mínimo | **`"999.99"`** → `MONTO_APERTURA_INSUFICIENTE` | un centavo bajo el mínimo: el borde exacto |
| Monto sobre el saldo del origen | **`"2000.00"`** → `FONDOS_INSUFICIENTES` | mayor que los 1.000,00 de la cuenta de partida |
| Titular con una cuenta | **`POST /auth/registro` + `POST /cuentas`** por API | **NO se usa el escenario `cuenta-unica`**: no devuelve credenciales (sólo `boletas-en-cada-estado` las trae, `costuras.service.ts:822`), así que con él **no se puede entrar por la UI** y todo brazo que lo usara sería **imposible**. Cazado en F2, antes de escribir el árbitro. El registro + apertura deja el mismo estado real (1 CORRIENTE con 1.000,00) y con credenciales conocidas; es lo que ya hacen T2 y S-17-boletas en BN4/BN6 |
| Titular sin cuentas | **`POST /auth/registro`** recién hecho | ningún escenario de `seed` deja un titular sin cuentas; el registro sí, y es un estado que el sistema alcanza de verdad |
| Tipos que se pueden abrir | **CORRIENTE, AHORRO** | `TIPOS_APERTURA` (`cuentas.constants.ts:11`); S-20 |

Los datos salen del API real. Cada dato de preparación se construye con una función que **afirma sus
propios límites** (el saldo y el número de cuentas esperados, antes de usarlos): es la defensa contra
el brazo imposible.

## 4 · Comportamiento

### 4.1 · Llegada y estados de carga (C4)
Entrar a Abrir cuenta pide `GET /cuentas` y declara su carga (JA8). **El formulario se renderiza
siempre**, también durante la carga, y lo que cambia es que `abrir-cuenta-enviar` está
**deshabilitado** hasta que la carga termina. Se fija así, y no «el formulario aparece cuando
termina», porque las dos cumplirían «mientras carga no se puede enviar» pero sólo una es
verificable: con el botón ausente, C1 daría rojo sobre una app correcta (hallazgo del ataque a
ciegas, F3).

### 4.2 · El formulario
- **Tipo**: CORRIENTE o AHORRO (JA7), con el código en el valor y el rótulo visible traducido.
- **Monto**: prellenado con `1000.00` (JA3), sin validación de cliente (JA2).
- **Origen**: según JA4 — ausente sin cuentas; con opción vacía por defecto si hay cuentas.

### 4.3 · Enviar
`POST /cuentas` con `Idempotency-Key` (JA5), `tipo`, `monto` como string y, si corresponde,
`cuentaOrigenId`. Con `201`: se vuelve al Resumen y se releen las cuentas (JA6). Con `4xx`: se muestra
el código (JA9), **no aparece ninguna cuenta nueva** y la clave se descarta.

### 4.4 · El tipo real en el Resumen y en «Mis cuentas» (HU-04 J1)
Cada cuenta muestra su `tipo` tal como lo entrega `GET /cuentas`, con el código en `data-tipo` (JA7).
Esto **cambia el artefacto de S-10**, así que `verificar:s10-t4` tiene que seguir verde o enmendarse
con aprobación del humano, sin relajar ninguna aserción (HU-04 CA13).

## 5 · Brazos del arnés (fijados antes de la entrega; no se tocan después)

Runner nuevo: `verificar:s17-abrir-cuenta`, **17 brazos**. Corre contra el artefacto servido
(backend `node dist/main.js` en :3000 y el build de `web/` en :4200). No importa código de la app.

> ⚠️ **Trampa medida en F0, obligatoria para todo brazo que use `nav-abrir-cuenta`:** el submenú
> `nav-cuentas-menu` está en `display:none` hasta `aria-expanded="true"` (`web/src/styles.css:166`
> y `:181`), y hacer **click** en `nav-cuentas` lo **cierra** y navega al Resumen
> (`web/src/app/app.ts:354`). El menú se abre con `mouseenter` (`app.ts:318`) o con flecha abajo
> (`app.ts:336`). Un brazo que haga click y después busque el ítem es **imposible**: da rojo sobre
> una app sana. Es el defecto P10 de la 64, cazado esta vez antes de escribirlo.

### Navegación y contrato (N)

| # | Qué afirma | Cómo |
|---|---|---|
| N1 | Con hover sobre `nav-cuentas`, `nav-abrir-cuenta` es visible y al pulsarlo se muestra `abrir-cuenta-region` **y el Resumen deja de estar montado** (JA1) | hover, no click |
| N2 | Con flecha abajo sobre `nav-cuentas`, `nav-abrir-cuenta` es alcanzable por teclado y tiene **nombre accesible** correcto (rol + etiqueta) | accesibilidad: línea roja del núcleo |
| N3 | Con un titular sin cuentas, el estado vacío del Resumen muestra `abrir-primera-cuenta` y al pulsarlo se llega a `abrir-cuenta-region` | hoy ese estado vacío **no ofrece nada** (`app.html:167-171`) |
| N4 | Contrato de testids **sobre el artefacto renderizado**: están todos los de `S-17-testids-abrir-cuenta.txt`, ninguno se repite salvo los de fila, y no aparece ninguno fuera de T4 ∪ S-17-boletas ∪ esta lista | el grep del código fuente pasa en verde con un componente que nunca se monta |

### Carga (C) — costura C4

| # | Qué afirma | Cómo |
|---|---|---|
| C1 | Mientras carga, `abrir-cuenta-cargando` está presente y `abrir-cuenta-enviar` **no envía**: se comprueba el atributo `disabled` **y** que un click forzado no crea ninguna cuenta (contado por API) | un brazo que sólo mire `[disabled]` es ciego: es la ceguera K16 de la 63 |
| C2 | Si `GET /cuentas` falla, aparecen `abrir-cuenta-error` y `abrir-cuenta-reintentar`, y el reintento carga bien | la falla se provoca interceptando la ruta en el navegador, sin tocar el backend |

### Apertura feliz (A) — CA1, CA2 y J1

| # | Qué afirma | Cómo |
|---|---|---|
| A1 | **CA1** · Titular recién registrado (sin cuentas): el selector de origen **no se renderiza**; abre una CORRIENTE; el Resumen queda con **exactamente una** fila, `data-tipo="CORRIENTE"` y `data-monto="1000.00"` | leído de atributos, nunca del texto formateado |
| A2 | **CA2** · Con un titular de 1 CORRIENTE en 1.000,00: abre una AHORRO desde ella por `1000.00`; el origen queda en **`0.00` exacto** y la nueva en `1000.00`, las dos por `data-monto`; la nueva con `data-tipo="AHORRO"` | borde exacto: 1000 − 1000 = 0, que es el límite pactado (I4) |
| A3 | **J1** · Tras A2 el Resumen muestra las dos filas con `data-tipo` **distintos** (CORRIENTE y AHORRO) | el contrato de la suite |
| A4 | **J1** · El **rótulo visible** de la fila AHORRO contiene «Ahorro» y el de la CORRIENTE «Corriente» | **ancla de texto deliberada y declarada**: es lo único que prueba que la persona ve el tipo. A3 no lo cubre — K2 y K3 de § 6 lo demuestran. Si el rótulo cambia, A4 se enmienda en la spec, con el número al lado |

### Errores de negocio (E) — CA3 y JA2

| # | Qué afirma | Cómo |
|---|---|---|
| E1 | Monto `999.99` → `MONTO_APERTURA_INSUFICIENTE` en `abrir-cuenta-codigo-error`, y el número de cuentas del titular **no cambió** | el conteo se lee del API, no de la pantalla |
| E2 | Monto `2000.00` sobre un origen de 1.000,00 → `FONDOS_INSUFICIENTES`; sin cuenta nueva y saldo del origen intacto | |
| E3 | Con cuentas y **sin elegir origen** (la opción vacía de JA4) → `CUENTA_ORIGEN_REQUERIDA`; sin cuenta nueva | este brazo es el que justifica la opción vacía: sin ella el código sería inalcanzable |
| E4 | El `form` lleva `novalidate` y ninguno de sus campos trae `min`, `max`, `step`, `pattern` ni `required`, **comprobado sobre el DOM renderizado** | es lo que hace alcanzables E1–E3 desde la UI (JA2) |

### Idempotencia (I) — CA4 y JA5

| # | Qué afirma | Cómo |
|---|---|---|
| I1 | Doble clic en `abrir-cuenta-enviar` → **exactamente una** cuenta nueva | contado por API |
| I2 | Tras el rechazo de E1, un segundo envío ya corregido **sí** crea la cuenta | si la clave se reusara, el backend devolvería el rechazo guardado |

### Saldo fresco (S) — JA6

| # | Qué afirma | Cómo |
|---|---|---|
| S1 | Tras abrir desde una cuenta propia, el `data-monto` del origen en el Resumen es **igual al que devuelve `GET /cuentas`**, no el anterior | es el defecto real visto en la 64: Boletas mostró $640,00 con el saldo real en 389,90 |

### Candado de S-10 (HU-04 CA13)

`verificar:s10-t4` R1 compara lo que sobra contra T4 ∪ `S-17-testids-boletas.txt`
(`scripts/verificar-s10-t4.mjs:45` y `:3267`). Con `cuenta-tipo` y `nav-abrir-cuenta`
renderizados **se pondrá rojo**. Enmienda prevista, de una línea: sumar
`S-17-testids-abrir-cuenta.txt` a esa unión. Lo que **falta** se sigue midiendo contra T4 como
hoy, y un testid ajeno lo sigue poniendo rojo: **no se relaja, se actualiza el contrato
versionado**. Requiere aprobación del humano antes de aplicarse.

### 5.1 · Enmienda previa a la entrega (hallazgos del ataque a ciegas de F3)

El arnés se atacó **a ciegas y en paralelo** por dos atacantes antes de que existiera una sola línea de
la pantalla. Entregaron **28 hallazgos** (13 y 15) y se
verificó contra el código los que cambiaban el veredicto. El brazo total pasa de **17 a 18**: entra
**A5**. Ningún brazo se relajó: los que cambiaron, cambiaron para **mirar más**.

| Hallazgo | Quién | Clase | Qué estaba mal | Qué se hizo |
|---|---|---|---|---|
| I2 no podía ver lo que decía ver | — | ciego | El brazo afirmaba que «el backend devolvería el rechazo guardado». **Este backend no hace eso**: `idempotencia.ejecutor.ts:74` guarda la clave **después** del éxito, y `MONTO_APERTURA_INSUFICIENTE` se lanza antes aún, en `cuentas.controller.ts:76`. Un `4xx` **nunca** persiste la clave | I2 pasa a observar la clave que sale del navegador: tras un `4xx` tiene que ser **otra**. K6 vuelve a ser cazable |
| N4 exigía testids que sus propios brazos desmontaban | — | imposible | `abrir-primera-cuenta`, `abrir-cuenta-error` y `abrir-cuenta-reintentar` se recolectaban **después** de abandonar el estado que los contiene: nunca entraban a `vistos` | N3 y C2 recolectan **dentro** del estado transitorio |
| El formulario podía no existir durante la carga | — | imposible | C1 leía `disabled` de un botón que una app correcta podía no haber montado | Se fija en § 4.1: el formulario **se renderiza siempre**; C1 además diagnostica el botón ausente en vez de confundirlo con un `disabled=false` |
| El doble clic moría por timeout | — | imposible | Dos `click` en `Promise.all` contra un botón que la app deshabilita al primero: el click normal espera `enabled` para siempre | `dblclick`, que es el gesto real y el que ya usa el árbitro de boletas (`:975`) |
| `novalidate` ignora `min` | — | ciego | § 6 declaraba que K7 pondría rojo a E1 y a E4. Con `novalidate` (JA2) el navegador **no valida**: el envío pasa igual y E1 sigue verde | K7 declara **sólo E4**. La predicción equivocada queda registrada acá, no se disimula |
| `cuentaOrigenId: ""` no da el código esperado | — | imposible | `cuentas.service.ts:92-95` valida contra UUID cualquier valor definido: un `""` da `CUENTA_NO_ENCONTRADA`, no `CUENTA_ORIGEN_REQUERIDA` | JA4 fija que el campo **se omite** cuando no hay origen elegido |
| K4 también tumba A1 | — | imposible | A1 parte sin cuentas y espera `cuentas-tabla`, que sin releer nunca se monta. § 6 decía «A1 verde» | La predicción de K4 se corrige: **S1 y A1** |
| A4 aceptaba el enum crudo | — | ciego | `/Ahorro/i` da verde con «AHORRO», que es justo lo que JA7 prohíbe mostrar | Rótulo exacto, sensible a mayúsculas |
| A4 asumía co-ubicación no pactada | — | imposible | El rótulo podía vivir en otro nodo que el del `data-tipo` | JA7 **fija** la co-ubicación (y con ella K2/K3 vuelven a separarse) |
| N2 era un colador | — | ciego | `enfocable: tabIndex >= 0 \|\| tagName === 'a'` daba verde a un `<a>` sin `href` ni `tabindex`; el rol se leía sin afirmarse. Y `ArrowDown` enfoca `nav-resumen` (`app.ts:344`), no el ítem | N2 **camina el submenú con Tab** y le pregunta al navegador quién tiene el foco; el rol se afirma |
| A1 nunca miró el prellenado | — | ciego | A1 enviaba sin tocar el monto: el `1000.00` venía del **defecto del backend**, no del prellenado de JA3 | A1 afirma el prellenado antes de enviar |
| S1 pasaba con un cálculo en el cliente | — | ciego | `1000 − 1000 = 0.00` calza exacto sin releer nada, que es lo que JA6 prohíbe | S1 observa que el `GET /cuentas` **ocurra** tras el `201` |
| Nadie miraba el tipo en el selector de origen | — | ciego | JA7 y § 1 lo exigían y **ningún brazo lo verificaba** | **Brazo A5 nuevo**, con su defecto K1b |
| E4 prohibía de más | — | imposible | Pedía ausencia de `maxlength`/`minlength`, que JA2 no prohíbe | La lista del brazo queda **idéntica** a la de JA2 |
| El efecto se leía antes de existir | — | frágil | C1 contaba cuentas ~30 ms después del click: un POST en vuelo aterrizaba después | C1 espera el estado terminal de la vista antes de contar |
| El timeout se leía como dato | — | frágil | `waitForFunction(...).catch(() => {})` en A2 y S1 dejaba seguir con la tabla incompleta | Sin `catch`: el timeout vuelve a ser un rojo claro |
| N4 podía culpar a la app de un fallo ajeno | — | frágil | `vistos` depende de que los 17 brazos previos lleguen a recolectar | N4 sigue rojo, pero **nombra el arrastre**: un rojo mal diagnosticado cuesta una sesión |

**Lo que este ataque demuestra, medido:** de los 17 arreglos, **16 son defectos del arnés o de la
spec** y ninguno es un defecto de la app —que todavía no existe—. Sin esta compuerta, I2
habría viajado hasta el final en verde sin medir nada, y N4, C1, E3, A4 y E4 habrían dado rojo sobre
una entrega correcta, mandando a quien implementa a depurar una app sana.

## 6 · Defectos de calibración (fijados antes de medir)

Cada uno declara qué brazos **debe** poner rojos y cuáles deben **seguir verdes**.

| # | Defecto inyectado | Debe poner ROJO | Debe seguir VERDE |
|---|---|---|---|
| K1 | El selector de origen se renderiza también sin cuentas | A1 | A2, E3 |
| K1b | El selector de origen rotula todas las cuentas «Corriente» | **A5** | A3, A4 |
| K2 | `data-tipo` se escribe fijo `CORRIENTE` | A3 | **A4** |
| K3 | El rótulo visible se escribe fijo «Corriente» | **A4** | A3 |
| K4 | Tras el `201` no se releen las cuentas (se pinta el saldo previo) | S1, **y también A1** | A3 |
| K5 | La `Idempotency-Key` se regenera en cada envío | I1 | I2 |
| K6 | La clave **no** se descarta tras un `4xx` | I2 | I1 |
| K7 | El campo monto recupera `min="1000"` | **sólo E4** | **E1**, E2 |
| K8 | `abrir-primera-cuenta` se renderiza pero no navega | N3 | N1 |
| K9 | Un testid ajeno (`abrir-cuenta-extra`) se cuela en la plantilla | N4 | los demás |
| K10 | El botón de enviar no se deshabilita durante la carga | C1 | C2 |

**K2 y K3 son un par a propósito:** cada uno debe cazar exactamente un brazo y dejar verde al otro.
Si los dos cayeran juntos, A3 y A4 estarían midiendo lo mismo y sobraría uno.

**Sonda de ceguera declarada (su verde se escribe antes de medir):**

| # | Cambio | Brazos que deben seguir VERDES | Árbitro que sí lo miraría |
|---|---|---|---|
| K11 | Se cambia el texto del `<p>` del estado vacío del Resumen | **todos** | el ojo del humano sobre la captura. El arnés **no mira** ese texto y es correcto que no lo mire (C5): el texto visible puede cambiar sin romper una prueba |

### 6.1 · Resultado de la calibración (medido; la tabla de § 6 no se tocó)

`calibrar:s17-abrir-cuenta` (12 defectos, cada uno con sus
**dos mitades**: los brazos que deben ponerse rojos y los que deben seguir verdes).

```
calibrar:s17-abrir-cuenta → 11/12 defectos con el resultado EXACTO que declara la spec
```

| defecto | rojo esperado | rojos observados | verdes exigidos | exacto |
|---|---|---|---|---|
| K1 | A1 | A1 | A2, E3 | sí |
| K1b | A5 | A5 | A3, A4 | sí |
| K2 | A3 | A2, A3 | A4 | sí |
| K3 | A4 | A4 | A3 | sí |
| K4 | S1+A1 | A1, A2, S1 | A3 | sí |
| **K5** | **I1** | **ninguno** | I2 | **NO** |
| K6 | I2 | I2 | I1 | sí |
| K7 | E4 | E4 | E1, E2 | sí |
| K8 | N3 | N3 | N1 | sí |
| K9 | N4 | N4 | los otros 17 | sí |
| K10 | C1 | C1 | C2 | sí |
| K11 (sonda de ceguera) | — | ninguno | los 18 | sí |

**K2 y K4 ponen rojo también a A2, que § 6 no nombraba.** Las columnas de § 6 son las que se fijaron
antes de medir y no se reescriben; el rojo extra queda acá, con su causa: A2 abre una AHORRO y lee su
`data-tipo` (K2 lo escribe fijo) y su `data-monto` tras releer (K4 no relee). Que un defecto caiga
además sobre un brazo vecino no relaja nada: lo que la spec exigía —el brazo declarado en rojo y el
declarado verde en verde— se cumplió en los dos.

**K5 · NO CAZADO, declarado, con la causa medida.** Decisión del humano: se declara y no se
sustituye por otro defecto que sí calce, porque eso sería elegir la pregunta después de ver la
respuesta (misma regla que E5 en S-18 y que K16/K20 en S-17-boletas).

Diagnóstico (Pilar 6), corrido con el defecto puesto y el motivo del brazo forzado a imprimirse:

```
I1 con K5 → cuentas en API=2 · POST observados=1 · claves distintas=false
```

Con K5 puesto sale **un solo POST**: el botón se deshabilita en el primer click
(`enviandoAbrirCuenta` más `detectChanges` síncrono) y el segundo click del `dblclick` no dispara
nada. Sin un segundo POST no hay segunda clave que comparar, y la mitad discriminante de I1 nunca se
evalúa. **I1 prueba que el doble clic no abre dos cuentas, pero lo prueba por la vía del botón
deshabilitado, no por la idempotencia de la clave**: el estado que I1 declara observar —dos POST con
la misma clave— es **inalcanzable desde esta interfaz**. Es la familia «arnés imposible»:
en rojo se vería igual que uno correcto.

**Lo que sí tiene árbitro** es la otra mitad de JA5, el descarte de la clave tras un `4xx`: K6 lo
caza con I2 y quedó exacto.

**Deuda abierta que nace acá:** la mitad «la clave se reusa» de JA5 no tiene árbitro en esta unidad.
Las dos salidas evaluadas y **no** tomadas, con su porqué: (a) que I1 fabrique el segundo POST
saltándose el botón deshabilitado convertiría al brazo en cómplice de la app y probaría un estado que
la interfaz no alcanza (perfil SUT); (b) darle a la pantalla el «Reintentar tras respuesta perdida»
de Boletas haría el doble POST real y alcanzable, pero JA5 lo declaró no-goal y es alcance nuevo, con
su spec y su ronda de arnés. Si alguna vez se levanta ese no-goal, K5 vuelve a ser cazable.

### 6.2 · Enmienda del segundo candado: `verificar:s17-boletas` (aprobada por el humano)

§ 5 previó el candado de `verificar:s10-t4` y **no vio el de Boletas**, que compara contra su propia
unión de listas (`verificar-s17-boletas.mjs:45`). Medido en la batería de § 7:

```
verificar:s17-boletas → 41/42 · rojo: R1
R1 ROJO: faltan [] · sobran [nav-abrir-cuenta, cuenta-tipo] · repetidos [] · fuera [] (lista de 47)
```

No es un defecto de la entrega: `cuenta-tipo` y `nav-abrir-cuenta` son exactamente lo que HU-04 J1
pidió renderizar. La enmienda es **la misma forma que la de T4**: `S-17-testids-abrir-cuenta.txt`
entra en la unión contra la que se mide lo que **sobra**; lo que **falta** se sigue midiendo contra
la lista de boletas y un testid ajeno sigue poniendo R1 rojo. **No se relaja ninguna aserción: se
actualiza el contrato versionado.**

Va con ella una corrección que el rojo no mostró todavía: **`cuenta-tipo` entra en `DE_FILA`** de ese
árbitro. Hoy su escenario siembra una sola cuenta y por eso `repetidos` salió vacío, pero con dos
filas R1 daría rojo sobre una app sana. Es la misma trampa de tres líneas de la enmienda de T4.

**La enmienda se calibra, no se cree** (ley del arnés: un check por ausencia versiona su lista y
tiene que poder ponerse rojo por las dos vías). Números en § 7.

## 7 · Batería que no debe moverse

`typecheck` 0 · `build` 0 · `guante` 6/6 · `test:domain` 140/140 · `test:integracion` 440/440 ·
`invariantes` 6/6 · `invariantes:calibrar` 16/16 · `demo:m6` 3/3 · **`verificar:s10-t4` 78/78**
(candado de HU-04 CA13) · `verificar:s17-boletas` 42/42.

## 8 · Alcance de archivos (declarado antes de implementar)

**La implementación toca sólo esto:**
- `web/src/app/app.html` — la vista de apertura, el ítem del submenú, el botón del estado vacío y
  la columna de tipo en la tabla del Resumen.
- `web/src/app/app.ts` — el estado de la vista, la carga, el envío y la clave de idempotencia.
- `web/src/styles.css` — lo visual de la vista nueva, siguiendo la dirección visual ya establecida.

**Se escriben aparte, no en la implementación:** `specs/S-17-abrir-cuenta.md`,
`specs/S-17-testids-abrir-cuenta.txt`, `scripts/verificar-s17-abrir-cuenta.mjs` y su `.sh`, la línea
de `package.json`, y la enmienda de `scripts/verificar-s10-t4.mjs` (candado, § 5).

**Nadie toca:** `src/` (no hay backend en esta unidad), las migraciones, ni los selectores de
Transferir. Los literales «Corriente» de `app.html:346` y `:402` son de los selectores de
**Transferir** y quedan para **S-17-transferir** (HU-04 CA5), para que las dos unidades no se pisen.

## 9 · Lo que se midió antes de escribir esta spec (F0)

Mapa del front pedido a **dos fuentes independientes con la misma tarea**, en paralelo. Coincidieron en todo dato
verificable; se re-midieron los dos números del contrato (110 apariciones, 107 únicos) y se verificó
a mano la tabla del Resumen y el CSS del submenú.

| Fuente | Pared | Exit | Archivos | Costo | Aporte propio |
|---|---|---|---|---|---|
| 1 | **100 s** | 0 | 1 | **US$ 0,034** | el desglose de dónde se arma cada `Idempotency-Key` |
| 2 | **391 s** | 0 | 1 | — | **el CSS del submenú** (`display:none`), que es lo que evitó el brazo imposible |

Una tercera fuente quedó **descartada, re-medido el 2026-09-16**: `403 RegionError`, «only
available hosted in China», muere en 2 s.
