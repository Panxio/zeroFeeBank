# S-17 · Transferir — el tipo real de cada cuenta y el destino «Otro banco»

> Sale de `specs/HU-04-pantalla-abrir-cuenta-y-transferir.md` (CA5–CA13, J1–J4). Escrita el
> **2026-09-17**. Candado común: `specs/_CANDADO.md`.
> **No pide backend:** la API existe desde S-12, S-20, S-21 y S-22, y F0 la mapeó campo por campo.
> Rama `s17-transferir`. Toca un artefacto con arnés candado (`verificar:s10-t4`, 78/78), y por eso
> HU-04 § 8 la clasificó «arnés y ataque a ciegas previos».

---

## 1 · Qué hace, qué queda fuera, cuándo está hecho

- **Hace (frontend, `web/`):**
  1. El **tipo real** de cada cuenta en los dos selectores de Transferir (origen y destino propio),
     que hoy rotulan toda cuenta como «Corriente» (`web/src/app/app.html:359` y `:415`, F0 § 3).
  2. Un **tercer destino, «Otro banco»**, con banco del catálogo, número y tipo de cuenta.
  3. La **confirmación releída** de esa transferencia con `GET /transferencias/otros-bancos/:id`.
- **Fuera:** backend · mostrar el cupo restante del tope (HU-04 R8) · `GET /bancos` (HU-04 J2) ·
  listar transferencias a otros bancos (S-22 § 7) · la pantalla de apertura (S-17-abrir-cuenta, ya
  entregada) · Movimientos, Pagos y Contacto · intereses, comisiones u otra moneda · hora local
  chilena (HU-04 R10) · el «Reintentar tras respuesta perdida» del modo banco (JT10).
- **Hecho:** los 18 brazos de § 5 en verde sobre el **artefacto servido** (backend `node dist/main.js`
  en :3000 y el build de `web/` en :4200), cada defecto de § 6 cazado por el brazo que lo declara,
  la batería de § 7 sin moverse, y el humano aprueba la pantalla en escritorio y teléfono:
  respuesta + captura.

---

## 2 · Decisiones de contrato de pantalla (discutibles)

| # | Decisión | Porqué |
|---|---|---|
| JT1 | **El tercer destino es una tercera opción del mismo grupo de radios** `name="modoDestino"`, con `value="banco"` y `data-testid="transferir-destino-modo-banco"`. La señal `modoDestino` pasa de `'propia' \| 'otra'` a `'propia' \| 'otra' \| 'banco'` (`web/src/app/app.ts:173`) | HU-04 J3. Reusa el control que ya existe (Pilar 0, peldaño 4): no se inventa un cuarto paso ni una pestaña nueva, que rompería A1 del candado (`tablist` de 3 pestañas) |
| JT2 | **Los tres campos del modo banco** son `transferir-destino-banco` (`<select>`), `transferir-destino-numero` (`<input type="text">`) y `transferir-destino-tipo` (`<select>`). Viajan al API con los nombres **literales del DTO**: `banco`, `numeroCuenta`, `tipoCuenta` | F0 § 5.2, leído de `transferencias-otros-bancos.dto.ts:6-12`. Los nombres no se eligen: se copian |
| JT3 | **El catálogo vive como constante en el front**, código → nombre visible, con los **cinco** códigos de `BANCOS` y los nombres del juego A. ZeroFeeBank **no** está en la lista | HU-04 J2 y R6. Códigos de `src/domain/transferencia/otros-bancos.ts:7`; nombres de `specs/HU-01-tipos-de-transferencia.md:54-63` (aprobados por el humano el 2026-09-14). **El `value` es el código; el nombre es sólo texto visible** (C5): si cambia el nombre, no se rompe ninguna prueba salvo B2, que lo declara |
| JT4 | **El cliente no valida nada** en el modo banco: el `form` lleva `novalidate` y **ningún** campo trae `required`, `pattern`, `minlength`, `maxlength`, `min`, `max` ni `step`. Se envía lo escrito y el API decide con código | La misma regla de T3 H3, de S-17-boletas J1 y de S-17-abrir-cuenta JA2. Es lo que deja **alcanzables desde la UI** los códigos de CA11: con un `maxlength="20"` el brazo del número de 21 dígitos sería **imposible** —daría rojo sobre una app correcta— y esa es la familia de defectos de brazo imposible |
| JT5 | **CA11 se cumple por construcción, y se declara así.** HU-04 CA11 dice «con la validación del cliente desactivada, la API igual rechaza». Como por JT4 **no hay** validación de cliente, la segunda mitad del criterio es vacua: el brazo E3 afirma la **ausencia** de esos atributos sobre el DOM renderizado, que es la forma verificable de lo mismo | No se reinterpreta el criterio a conveniencia: se dice qué se hizo con él y por qué. Si el humano quiere validación de cliente, JT4 y E3 cambian juntos, con aprobación |
| JT6 | **La confirmación se relee, no se reconstruye.** Tras el `201`, la pantalla pide `GET /transferencias/otros-bancos/:id` con el `id` de la respuesta y muestra **lo que devuelve el GET**: banco, número, tipo, monto y fecha. Nada de pintar lo que se escribió en el formulario | HU-04 CA7 y T4 de la HU. Mostrar el formulario de vuelta se vería idéntico en la pantalla y no probaría nada: es la versión de pantalla del «saldo rancio» |
| JT7 | **El código va en un atributo y el rótulo visible dentro del mismo elemento.** El banco se muestra en `transferir-banco-nombre` con `data-banco="<código>"` y el nombre visible como texto; el tipo en `transferir-banco-tipo` con `data-tipo="<código>"`; el monto en `transferir-banco-monto` con `data-monto="<string decimal del GET>"`; la fecha en `transferir-banco-fecha` con `data-realizada-en="<ISO del GET>"` | C3 y JA7 de la spec hermana. La **co-ubicación** del rótulo dentro del elemento del atributo se fija acá porque el ataque a ciegas demostró que sin ella el brazo de texto es imposible |
| JT8 | **La fecha se muestra en UTC y rotulada «UTC».** El texto visible termina en ` UTC`; el ISO crudo va en `data-realizada-en` | HU-04 R10. La suite afirma sobre el ISO, la persona lee el texto |
| JT9 | **El texto del tope es literal y siempre visible en el modo banco**, en `transferir-banco-tope`: **«Máximo 200,00 USD por día (UTC) por cuenta de origen»**. **No se muestra cupo restante** | HU-04 R8, decisión del humano. El cupo no lo expone la API y no se agrega |
| JT10 | **Idempotencia igual que hoy**: la clave nace en `confirmarTransferencia()` (`web/src/app/app.ts:1186`), **se reusa** en el doble clic y en el reintento de red, y se descarta ante toda respuesta definitiva. **Sin** brazos de red simulada en el modo banco | HU-04 J4. T6 y T7 del candado ya cubren la red perdida para `POST /transferencias`; repetirlo acá sería trabajo sin hallazgo nuevo (Pilar 0). Declarado como no-goal, no omitido |
| JT12 | **`transferir-banco-numero` lleva `data-numero`** con el `numeroCuenta` del GET (decisión de F2) | JT7 nombró los atributos de nombre, tipo, monto y fecha, pero **no el del número**, y § 5 B4 afirma «por sus atributos». Se fija acá y en `specs/S-17-testids-transferir.txt` en vez de dejar que el brazo caiga a leer texto visible, que es ancla frágil (C3) |
| JT11 | **Los errores del modo banco usan el `transferir-error[data-codigo]` que ya existe.** No se agrega ni una bifurcación por código en el front | F0 § 8.2: el front ya propaga cualquier `codigo` del API dinámicamente (`app.ts:1254-1258`). Añadir un `switch` por código duplicaría en el cliente una regla del servidor, que es lo que JT4 prohíbe |

---

## 2.1 · Decisiones que F4 aplica

Salen del ataque a ciegas de F3. Las tres **agrandan** el árbitro;
ninguna debilita una aserción. Se escriben acá, y no se editan en silencio, porque tocan casos ya
fijados en § 5 (REGLA DE ORO).

| # | Decisión | Por qué |
|---|---|---|
| D80-1 | **Se exige que `transferir-destino-tipo` ofrezca CORRIENTE y AHORRO**, y una aserción audita sus opciones contra `TIPOS_EXTERNOS`. | Hoy **ningún brazo mira ese selector** y todos usan AHORRO por defecto: una pantalla que sólo ofreciera AHORRO —o tipos inválidos— pasaba los 18 brazos en verde. Hallazgo #9. |
| D80-2 | **B1 comprueba además que `transferir-destino-banco`, `-numero` y `-tipo` estén OCULTOS** en los modos «Mis cuentas» y «Otras cuentas». | B1 sólo verificaba que **aparecieran** al elegir «Otro banco». Una implementación que los dejara siempre visibles daba verde, y eso contradice § 4.2 («oculta los controles de los otros dos modos»). Hallazgo #10. |
| D80-3 | **La vuelta del `4xx` de B7 se afirma por la intención, no por la forma** (opción C): en Revisar se comprueba `transferir-form[data-estado="error"]`, `aria-busy="false"` y `transferir-error[data-codigo]`; y **después se navega de vuelta al paso Destino** para verificar ahí que los tres campos están habilitados y editables. | Leer `disabled` de los campos de Destino mientras la persona está en **Revisar** es un **brazo IMPOSIBLE**: si la app renderiza los pasos con `@if`, esos campos no están en el DOM y B7 da rojo sobre una app correcta. La opción C no dicta `@if` ni `[hidden]`, es **más fuerte** que leer el atributo (prueba que la persona puede reintentar de verdad) y repite la operación ya aprobada en F2 para este mismo brazo. Hallazgo #3. |

> **Lo que D80-3 NO toca:** la mitad de ida de B7 —`data-estado="enviando"`, `aria-busy="true"` y
> los tres campos `disabled`—, que es la que caza **K13**, queda exactamente igual.

> **Las tres nacen SIN CALIBRAR.** Como los 18 brazos de § 5, se calibran en **F6**: hasta que cada
> una se haya visto roja ante su defecto, es una afirmación y no un brazo.

---

## 2.2 · La enmienda F4: qué cambió del árbitro y por qué

Aplica los **12 hallazgos ciertos** del ataque a ciegas de F3 (9 sitios) y las tres decisiones
de § 2.1. **Regla que mandó:** sólo se refuerza una aserción o se reemplaza una **inalcanzable** por
otra alcanzable; **ninguna se debilita**, y ningún caso fijado se edita en silencio (REGLA DE ORO).
**Todo lo que nace acá nace SIN CALIBRAR:** sus defectos son K19–K26 de § 6 y se miden en **F6**.

| Hallazgo | Sitio | Qué se hizo | Clase |
|---|---|---|---|
| #1 #7 | **B8, nuevo** | § 4.2 exige que Revisar muestre banco, número y tipo antes de enviar y **ningún brazo lo miraba**: un criterio de aceptación entero sin árbitro. Nace B8 y con él **JT13** (abajo). **BRAZOS_TOTAL pasa de 18 a 19** | refuerza |
| #2 #1 | B4 | El DTO del `201` y el del `GET` traen los mismos campos, así que comparar contra el GET no distinguía «releer» de «pintar el formulario». El árbitro **intercepta el GET y cambia un valor testigo** (`numeroCuenta` → `87654321`), como B7(b) inyecta su 400: sólo una pantalla que relee lo muestra | refuerza |
| #3 #13 | B4 | Se lee el **cuerpo de la respuesta** del POST y se compara el `:id` del GET contra el `id` del `201`. Antes sólo se miraba `gets.length` | refuerza |
| #4 #11 | E3 | JT4 dice «**ningún** campo»: entra `transferir-monto`. **Medido antes de escribirlo** (`app.html:443-451`): hoy no lleva ninguno de los 7 atributos, así que la aserción es alcanzable y no mueve el candado | refuerza |
| #5 #3 | E3 | `hasAttribute` no ve un binding (`[maxlength]="20"` escribe la **propiedad**), así que **K15 —el defecto que E3 existe para cazar— se le escapaba**. Ahora mira atributo **y** propiedad efectiva. También el `novalidate` del form (M2) | refuerza |
| #6/#7 #12 / #5 | B3 | El check por ausencia de cupo vivía en `#panel-destino` —un `id`, **no** contrato versionado— y con `.catch(() => '')`: si lo renombraban, medía **nada** y decía VERDE. Pasa al testid `transferir-form` (Destino **y** Revisar), sin catch silencioso, y B4 cubre además la confirmación | refuerza |
| #8/#9/#10 #2, #4, #7 | `opcionesDe`, TR3, B2 | Un `<option>` sin `value` devolvía su **texto** como value: hacía fallar TR3 y B2 sobre app correcta (**imposible**) y escondía del conteo y del chequeo R6 una opción con `value=""`. Ahora el placeholder se reconoce aparte; **R6 se mira sobre todas** las opciones y el conteo sobre las reales | reemplaza una imposible + refuerza |
| #11 #1 | P1 | `filasResumen` no esperaba el refresco del Resumen y podía leer saldos rancios (recaída de F2-v). Se espera por condición a que el saldo **deje de ser el de antes** —no a que sea el esperado, que sería auto-cumplirse— y recién ahí se afirma el valor exacto | reemplaza una frágil |
| #12 #8 | X1/X2 → E1–E4, N1 | `relojDesfijar` se tragaba todo fallo con `.catch(() => {})`. Ahora afirma `{fijado:false}`, reintenta una vez y, si no lo consigue, **ensucia la corrida**: todo brazo posterior sale **rojo** con ese motivo | refuerza |
| M1 (único solape) | B4/B6 | El `await res.json()` del listener es asíncrono: el cuerpo del GET y el id del POST se **esperan por condición**, no se leen y se reza | refuerza |
| M3 | B3 | `TERMINOS_CUPO` traía «disponible» a secas, que pondría rojo un rótulo legítimo («Saldo disponible»): **brazo imposible por la puerta de atrás**. Se **reemplaza** ese término por las formas en que un cupo restante se escribe de verdad (`disponible hoy`, `te queda`); los otros cuatro no se tocan, y el **ámbito del check se amplía** de un panel a todo el formulario, así que el chequeo neto es más ancho, no más angosto | reemplaza + refuerza |

**Decisión de encuadre:** D80-1 vive en **B2** —es auditoría de las opciones de los `<select>`
del modo banco, igual que el catálogo— y D80-2 en **B1**, que es el brazo de la visibilidad por modo.
Ninguna crea un brazo nuevo: sólo B8 lo hace, y por eso el conteo pasa a 19.

| # | Decisión de pantalla | Por qué |
|---|---|---|
| JT13 | **El paso Revisar del modo banco muestra `transferir-revisar-banco` (`data-banco`), `transferir-revisar-numero` (`data-numero`) y `transferir-revisar-tipo` (`data-tipo`)**, con el código en el atributo y el rótulo visible dentro del mismo elemento: nombre del catálogo para el banco, «Corriente»/«Ahorro» para el tipo, nunca el código crudo | Sin contrato, el brazo de #1 sólo podía anclar en el texto de `#panel-revisar`, que es justo el ancla frágil que el hallazgo #7 condena. Sigue el patrón ya aprobado en JT7 y el de `transferir-revisar-monto`, que ya existe (`app.html:485`). Entradas nuevas en `specs/S-17-testids-transferir.txt`, que N1 verifica sobre el artefacto renderizado |

---

## 3 · Constantes

| Constante | Valor | Porqué |
|---|---|---|
| Viewports del arnés | escritorio **1280×800** · teléfono **390×844** | los de T2–T4, S-17-boletas y S-17-abrir-cuenta |
| Tope de cada espera por condición | **8000 ms** | el de T1–T4: un rojo, no un cuelgue; no es un `sleep` |
| Catálogo de bancos | `ASERCION`→Banco Aserción · `FIXTURE`→Banco Fixture · `STUB`→Banco Stub · `SANDBOX`→Banco Sandbox · `MOCK`→Banco Mock | `src/domain/transferencia/otros-bancos.ts:7` (códigos) y `specs/HU-01-tipos-de-transferencia.md:54-63` (nombres, humano 2026-09-14). **No se inventan** |
| Tipos de cuenta externa | **CORRIENTE, AHORRO** | `TIPOS_CUENTA_EXTERNA` (`src/domain/transferencia/otros-bancos.ts:19`) |
| Tope diario a otros bancos | **200,00 USD** (`20000n` centavos), por día UTC y por cuenta de origen, **borde inclusivo** | `TOPE_DIARIO_OTROS_BANCOS_CENTAVOS` (`src/domain/transferencia/otros-bancos.ts:14`); HU-01 R9, J1–J2 |
| Reparto del tope en X1 | **`"150.00"` + `"50.00"` = 200,00 exacto**, y después **`"0.01"`** → `TOPE_DIARIO_EXCEDIDO` | el borde inclusivo se prueba por los dos lados: 200,00 pasa, 200,01 no. Un solo envío de 200,00 no distinguiría «inclusivo» de «exclusivo» |
| Monto de la transferencia propia (P1) | **`"100.00"`** | distinto de los `250.10` de A6 del candado, para que un cruce de brazos se note |
| Número de cuenta externa válido | **`"12345678"`** (8 dígitos, dentro de 1–20) | HU-01 R5 |
| Número con letras (E1) | **`"1234ABCD"`** → `NUMERO_CUENTA_EXTERNA_INVALIDO` | HU-01 R5 |
| Número de 21 dígitos (E2) | **`"123456789012345678901"`** → `NUMERO_CUENTA_EXTERNA_INVALIDO` | un dígito sobre el máximo: el borde exacto |
| Titular de los brazos | **`POST /auth/registro`** + **`POST /cuentas {tipo:CORRIENTE, monto:"2000.00"}`** (desde la caja) + **`POST /cuentas {tipo:AHORRO, monto:"1000.00", cuentaOrigenId:<la corriente>}`** → queda **1 CORRIENTE en 1.000,00 y 1 AHORRO en 1.000,00** | Se necesitan las dos, de tipos distintos, para CA5 y CA6. No se usa un escenario del `seed`: sólo `boletas-en-cada-estado` devuelve credenciales (`costuras.service.ts:822`) y deja una sola cuenta. **No hay monto máximo de apertura** (`cuentas.constants.ts` declara sólo el mínimo) y la suite de integración ya abre con `3000.00` desde la caja (`test/cuentas.int.spec.ts:316`): verificado, no supuesto |
| Id de cuenta de sistema (E4) | **`cuentaSistemaId` de la respuesta de `POST /__test__/seed`** | `SeedRespuesta.cuentaSistemaId` (`costuras.service.ts:43`). La costura ya lo devuelve: la suite **no** toca la BD ni adivina el id (C1) |
| Reloj del día UTC siguiente (X2) | **`POST /__test__/reloj {"instante": "<AAAA-MM-DD>T00:00:00.000Z"}`** del día siguiente al fijado en X1 | F0 § 9.1, `costuras.service.ts:228-254`. X1 fija primero un instante conocido; si no, «el día siguiente» depende del reloj de pared y el brazo es intermitente a medianoche |

> Cada dato de preparación se construye con una función que **afirma sus propios límites** —los dos
> saldos y los dos tipos, antes de usarlos— y aborta ruidosamente si no cuadran. Es la defensa
> contra el **arnés imposible**, que ninguna calibración caza porque en rojo se ve igual que uno
> correcto.

---

## 4 · Comportamiento

### 4.1 · El tipo real en los dos selectores (CA5, HU-04 J1)
Las `<option>` de `transferir-origen` y de `transferir-destino-propia` llevan `data-tipo` con el
código que entrega `GET /cuentas`, y el rótulo visible es **«Corriente»** o **«Ahorro»**, nunca el
enum crudo. Es el mismo patrón ya entregado y probado en `abrir-cuenta-origen`
(`verificar-s17-abrir-cuenta.mjs:533-551`). Hoy las dos líneas rotulan literalmente «Corriente»
(`app.html:359` y `:415`).

### 4.2 · El paso Destino con tres opciones (CA7, JT1–JT3)
El `fieldset` de Destino (`app.html:377-402`) suma la opción «Otro banco». Elegirla muestra los tres
campos de JT2 y el texto del tope (JT9), y oculta los controles de los otros dos modos. El paso
Revisar muestra banco (nombre visible), número y tipo antes de enviar (HU-04 J3).

### 4.3 · Enviar (JT2, JT10)
`POST /transferencias/otros-bancos` con `Authorization`, `Idempotency-Key` y el cuerpo
`{cuentaOrigenId, monto, banco, numeroCuenta, tipoCuenta}`, todos string (D1: el monto viaja como
string decimal, nunca como `number`). Durante el envío la pantalla declara que está ocupada con el
mecanismo que ya existe: `transferir-form[data-estado="enviando"]`, `aria-busy="true"` y los
controles deshabilitados (C4, F0 § 8.1).

### 4.4 · La confirmación releída (CA7, JT6–JT8)
Con `201`, la pantalla toma el `id` de la respuesta, pide `GET /transferencias/otros-bancos/:id` y
pinta **lo que ese GET devuelve**, con los atributos de JT7. Con `4xx`, se muestra el código en
`transferir-error[data-codigo]` (JT11) y **el saldo del origen no se mueve**.

### 4.5 · Lo que no cambia
El destino «Mis cuentas» y «Otras cuentas» siguen llamando a `POST /transferencias` con el cuerpo
`{origenId, destinoId, monto}` de hoy (F0 § 4.1). Esta unidad **no toca** esa ruta.

---

## 5 · Brazos del arnés (fijados antes de la entrega; NO se tocan después)

Runner nuevo: `verificar:s17-transferir`, **19 brazos** (18 hasta F3; **B8 nace en F4**, § 2.2).
Corre contra el artefacto servido. No
importa código de la app y no toca la base de datos.

> ⚠️ **Trampa heredada, vigente acá:** todo brazo que llegue a Transferir por el menú
> usa **hover** o flecha abajo sobre `nav-cuentas`, nunca click — el click cierra el submenú y
> navega al Resumen (`app.ts:354`). En Transferir hay además la vía directa `nav-transferir`
> (candado V1), que es la que estos brazos usan salvo donde se diga.

### Tipo real (TR) — CA5

| # | Qué afirma | Cómo |
|---|---|---|
| TR1 | En `transferir-origen`, la opción de la CORRIENTE tiene `data-tipo="CORRIENTE"` y la de la AHORRO `data-tipo="AHORRO"` | por `option.getAttribute`, contra lo que devuelve `GET /cuentas` |
| TR2 | El **rótulo visible** de esas dos opciones contiene «Corriente» y «Ahorro» respectivamente, y **no** contiene el enum crudo «CORRIENTE»/«AHORRO» | **ancla de texto deliberada y declarada.** Es lo único que prueba que la persona ve el tipo; TR1 no lo cubre (K2 y K3 de § 6 lo demuestran) |
| TR3 | Lo mismo que TR1 y TR2 en `transferir-destino-propia` | son dos lugares distintos del artefacto (`:359` y `:415`): un solo brazo dejaría la mitad ciega |

### Transferencia propia (P) — CA6

| # | Qué afirma | Cómo |
|---|---|---|
| P1 | Corriente → ahorro propia por `100.00` → `201`; el origen queda en **`900.00`** y el destino en **`1100.00`**, exactos, leídos del `GET /cuentas` **y** del `data-monto` del Resumen | los dos saldos se mueven exactamente el monto (R9, sin comisión) |

### Otro banco (B) — CA7, CA8

| # | Qué afirma | Cómo |
|---|---|---|
| B1 | Existe `transferir-destino-modo-banco`; al elegirlo aparecen `transferir-destino-banco`, `transferir-destino-numero` y `transferir-destino-tipo`, y `transferir-destino-propia` y `transferir-destino-id` dejan de estar disponibles | sobre el DOM renderizado |
| B2 | `transferir-destino-banco` ofrece **exactamente 5** opciones con `value` ∈ {ASERCION, FIXTURE, STUB, SANDBOX, MOCK}, cada una con su nombre visible del catálogo, y **ninguna** dice «ZeroFeeBank» | el `value` es el contrato; el nombre es el ancla de texto que JT3 declara |
| B3 | **CA8** · En el modo banco, `transferir-banco-tope` está visible y su texto es exactamente «Máximo 200,00 USD por día (UTC) por cuenta de origen»; **no** aparece ningún cupo restante | JT9. El texto es literal porque es la regla que la persona lee |
| B4 | **CA7** · Transferencia válida (`SANDBOX`, `12345678`, `AHORRO`, `100.00`) → `201`, y la pantalla **hizo** `GET /transferencias/otros-bancos/:id`; los valores mostrados en `transferir-banco-nombre`, `-numero`, `-tipo` y `-monto` coinciden con los de **ese GET**, por sus atributos | la llamada se cuenta interceptando la red en el navegador. Sin contar la llamada, una pantalla que pintara el formulario pasaría igual: es el defecto K7 |
| B5 | **CA7** · Tras B4, el saldo del origen bajó **exactamente** `100.00` y ninguna otra cuenta del titular se movió | leído del API, no de la pantalla |
| B6 | **R10** · `transferir-banco-fecha` tiene `data-realizada-en` igual al `realizadaEn` del GET, y su texto visible termina en «UTC» | JT8 |
| B7 | **C4** · Durante el envío del modo banco, `transferir-form` tiene `data-estado="enviando"` y `aria-busy="true"`, y los tres campos de JT2 están `disabled`; ~~al terminar, vuelve a `editando`~~ → **al terminar: con `201` el formulario se desmonta y aparece la confirmación; con `4xx` queda en `data-estado="error"` y los tres campos se re-habilitan** (enmienda de F2, abajo) | sin esto la suite sólo puede esperar por tiempo |

| B8 | **§ 4.2 / HU-04 J3 · NACE EN F4** · En el paso Revisar del modo banco están `transferir-revisar-banco`, `-numero` y `-tipo` con el código en su atributo (JT13) y el rótulo visible dentro del mismo elemento —nombre del catálogo, «Corriente»/«Ahorro»—, y **nada se ha enviado todavía** (cero POST) | el hallazgo #1 de F3: «Revisar muestra banco, número y tipo antes de enviar» era un criterio de aceptación **sin ningún árbitro**, y un paso Revisar vacío pasaba los 18 brazos |

> **Enmienda de B7 · F2, aprobada por el humano.** La mitad de vuelta de B7 —«vuelve a
> `editando`»— era un **brazo imposible**: habría dado rojo sobre una app correcta.
> · Con `201`, `app.ts:1243` sí pone `editando`, pero el formulario **se desmonta** en el mismo
>   instante (`app.html:265` y `:299`: la confirmación va en el `@if` y el form en el `@else`), así
>   que no hay elemento al que leerle el atributo.
> · Con `4xx`, el estado es `error` (`app.ts:1259`) — y es lo que el **candado** afirma literalmente
>   en T4 (`verificar-s10-t4.mjs:1704`). Ponerlo en `editando` habría movido el 78/78 que § 7
>   declara inamovible.
> La mitad de ida (`enviando` + `aria-busy` + los tres campos `disabled`), que es la que caza K13,
> **no se tocó**: no se debilitó ninguna aserción, se reemplazó una inalcanzable por las dos
> alcanzables. El árbitro retiene el POST para medir la ida y, en la rama del `4xx`, inyecta él
> mismo la respuesta definitiva: no mueve un centavo.

### Tope diario (X) — CA9, CA10

| # | Qué afirma | Cómo |
|---|---|---|
| X1 | **CA9** · Con el reloj fijado en un instante conocido: `150.00` y `50.00` pasan las dos (`201`); la siguiente de `0.01` da `TOPE_DIARIO_EXCEDIDO` en `transferir-error[data-codigo]`, y el saldo del origen **no se movió** en ese tercer intento | el borde inclusivo por los dos lados (200,00 sí, 200,01 no) |
| X2 | **CA10** · Tras X1, fijando el reloj al día UTC siguiente a las 00:00:00.000Z, una transferencia de `200.00` vuelve a pasar | la costura del reloj, no una espera real |

### Errores y ausencia de validación de cliente (E) — CA11, CA12

| # | Qué afirma | Cómo |
|---|---|---|
| E1 | **CA11** · Número `1234ABCD` → `NUMERO_CUENTA_EXTERNA_INVALIDO`; saldo del origen intacto y cero transferencias nuevas | contadas por API |
| E2 | **CA11** · Número de 21 dígitos → `NUMERO_CUENTA_EXTERNA_INVALIDO`; saldo intacto | un dígito sobre el máximo |
| E3 | **CA11/JT5** · El `form` lleva `novalidate` y **ninguno** de `transferir-destino-banco`, `transferir-destino-numero` y `transferir-destino-tipo` trae `required`, `pattern`, `minlength`, `maxlength`, `min`, `max` ni `step`, **comprobado sobre el DOM renderizado** | es lo que hace alcanzables E1 y E2 desde la UI. Lista de términos versionada acá, junto al resultado |
| E4 | **CA12** · El `cuentaSistemaId` que devuelve `POST /__test__/seed`, pegado en «Otras cuentas» → `CUENTA_NO_ENCONTRADA`; saldo intacto | HU-01 V4 y S-21 C3. El id sale de la costura, no de la BD ni del DOM |

### Contrato de testids (N)

| # | Qué afirma | Cómo |
|---|---|---|
| N1 | Sobre el **artefacto renderizado**: están todos los de `specs/S-17-testids-transferir.txt`, ninguno se repite, y no aparece ninguno fuera de T4 ∪ boletas ∪ abrir-cuenta ∪ esta lista | el grep del código fuente pasa en verde con un componente que nunca se monta (RESTRICCIONES.md § 2) |

### Enmienda prevista del candado (HU-04 CA13)

`verificar:s10-t4` R1 mide lo que **sobra** contra T4 ∪ `S-17-testids-boletas.txt` ∪
`S-17-testids-abrir-cuenta.txt` (`verificar-s10-t4.mjs:42-51` y `:3274`). Con los testids nuevos del
modo banco **se pondrá rojo**. Enmienda prevista, de tres líneas: sumar
`specs/S-17-testids-transferir.txt` a esa unión, igual que ya se hizo.
Lo que **falta** se sigue midiendo contra T4, y un testid ajeno lo sigue poniendo rojo:
**no se relaja, se actualiza el contrato versionado.** Requiere aprobación del humano antes de
aplicarse.

> **Lo que F0 midió y ahorra trabajo:** ningún brazo del candado depende del texto «Corriente» —su
> única aparición en `verificar-s10-t4.mjs` es el cuerpo de una siembra, línea 150. Lista de
> términos del check por ausencia, versionada junto al resultado:
> `Corriente|CORRIENTE|corriente|Ahorro|AHORRO`. Es decir: **4.1 no puede romper el candado**, y lo
> único que lo pone rojo es R1 por los testids nuevos.

---

## 6 · Defectos de calibración (fijados ANTES de medir; no se tocan después)

> **La ley del arnés:** un árbitro que no mira algo dice VERDE. Cada defecto se inyecta a
> propósito en el artefacto y se declara **qué brazo lo caza**. Un brazo que nunca se vio en rojo
> no es un brazo: es una afirmación.

| # | Defecto inyectado | Brazo que debe cazarlo |
|---|---|---|
| K1 | El `data-tipo` de las opciones de `transferir-origen` se escribe siempre `CORRIENTE` | TR1 |
| K2 | El `data-tipo` es correcto pero el rótulo visible vuelve a decir «Corriente» para las dos | **TR2** (TR1 sigue verde: es la razón de que TR2 exista) |
| K3 | El rótulo visible muestra el enum crudo «AHORRO» en vez de «Ahorro» | **TR2** |
| K4 | Se arregla `transferir-origen` y se deja `transferir-destino-propia` como está hoy | **TR3** (TR1 y TR2 siguen verdes) |
| K5 | La transferencia propia acredita al destino pero no debita al origen | P1 |
| K6 | La opción «Otro banco» existe pero no oculta `transferir-destino-propia` | B1 |
| K7 | La confirmación pinta **lo que se escribió en el formulario** y nunca llama al GET | **B4** (el brazo cuenta la llamada; sin ese conteo el defecto pasa invisible) |
| K8 | El GET se llama pero la pantalla sigue pintando el formulario, y el número mostrado difiere del devuelto | B4 |
| K9 | Falta un banco del catálogo (quedan 4 opciones) | B2 |
| K10 | El texto del tope dice «100,00 USD» | B3 |
| K11 | El texto del tope se muestra también en los modos «Mis cuentas» y «Otras cuentas» | B3 |
| K12 | La fecha se muestra en hora local, sin el rótulo «UTC» | B6 |
| K13 | El envío del modo banco no pone `data-estado="enviando"` | B7 |
| K14 | El monto del modo banco se envía como `number` en vez de string decimal | B4 (el `201` no llega: el API rechaza) — **y si llegara, es rojo de D1** |
| K15 | El campo del número lleva `maxlength="20"` | **E3** (y E2 se volvería imposible sin él: es el defecto que E3 previene) |
| K16 | Tras un `4xx` del modo banco, la pantalla resta el monto del saldo igual | E1 y B5 |
| K17 | El tercer envío que excede el tope muestra el error pero también la confirmación de éxito | X1 |
| K18 | Un testid nuevo del modo banco no se agrega a `S-17-testids-transferir.txt` | N1 |

### Defectos que nacen con la enmienda F4 — fijados ANTES de medir, se miden en F6

Lo que F4 agregó al árbitro **nace sin calibrar**: hasta que cada aserción nueva se haya visto roja
ante su defecto, es una afirmación y no un brazo. Se fijan acá y no se tocan después.

| # | Defecto inyectado | Brazo que debe cazarlo |
|---|---|---|
| K19 | El paso Revisar del modo banco muestra sólo el monto: no pinta banco, número ni tipo | **B8** (hallazgo #1: hoy ningún brazo lo vería) |
| K20 | La pantalla **llama** al GET pero pinta lo que se escribió en el formulario | **B4** (el testigo del GET interceptado; K7 sólo cubría el caso de no llamar) |
| K21 | `transferir-destino-numero` lleva **`[maxlength]="20"` como binding** | **E3** (es K15 en la forma que hoy se le escapaba: el atributo no existe, la propiedad sí) |
| K22 | `transferir-destino-tipo` ofrece sólo AHORRO | **B2** (D80-1) |
| K23 | Los tres campos del modo banco quedan visibles también en «Mis cuentas» | **B1** (D80-2) |
| K24 | Tras el `4xx`, al volver al paso Destino los campos siguen `disabled` | **B7** (D80-3) |
| K25 | El cupo restante se pinta en el paso **Revisar** | **B3** (el ámbito ampliado; encerrado en `#panel-destino` no se veía) |
| K26 | La pantalla hace el GET de confirmación con un id **fijo** en vez del que devolvió el `201` | **B4** (hallazgo #3) |

> **Los tres sitios que NO llevan defecto nuevo, y por qué se declara en vez de inventarlo:** #8, #9
> y #10 (el placeholder) y #11 (el saldo rancio del Resumen) corrigen **brazos imposibles o
> frágiles** —fallaban sobre una app *correcta*—, así que su calibración es la contraria: se
> comprueba en F6 que con la app correcta quedan **verdes**. Y #12 (el reloj) se calibra rompiendo
> la costura, no la app: entra en la misma corrida de F6 con ese nombre.

**18 defectos declarados sobre 18 brazos** (antes de F4; con la enmienda son **26 sobre 19**). Los brazos sin defecto propio son **X2**, **E4** y
**E2**: X2 sólo puede fallar por la costura del reloj, que ya calibra `calibrar:reloj`, y E4 por el
`seed`, que ya calibra `calibrar:s23`. **Se declara así en vez de inventarles un defecto**, y el
número de § 7 se reporta como 18/18.

> **Corrección de F2 (con el humano).** Esta sección decía «18 defectos sobre 19
> brazos» y nombraba sólo a X2 y E4. Las dos cosas estaban mal y se corrigen acá:
> 1. La tabla de § 5 declara **18** brazos (`TR1–TR3 · P1 · B1–B7 · X1 X2 · E1–E4 · N1`), contados
>    mecánicamente. El «19» era un error de conteo. Manda la tabla: `BRAZOS_TOTAL = 18`.
> 2. **E2 tampoco tiene defecto propio.** K15 (`maxlength="20"`) lo nombra de pasada, pero su
>    cazador declarado es **E3**, en negrita. Decisión del humano: se declara sin defecto y el
>    ataque a ciegas de F3 decide si le nace uno; inventarle uno ahora sería tocar § 6 después de
>    fijada. Ninguna aserción se debilitó — se corrigió el conteo, no el umbral.

---

## 7 · Batería que no debe moverse

Corrida sobre `main` antes de entregar y otra vez después, con el número real de cada una:

```
verificar:s10-t4          78/78   ← el candado (enmienda de R1 prevista en § 5, con aprobación)
verificar:s17-abrir-cuenta 18/18
verificar:s17-boletas      42/42
test:domain               140/140
test:integracion          440/440
test:otros-bancos         (el número que dé; es la API que esta unidad consume)
invariantes                 6/6
guante                      6/6
typecheck                  exit 0
```

---

## 8 · Alcance de archivos (declarado ANTES de empezar)

**Puede crear o modificar:**
```
web/src/app/app.html
web/src/app/app.ts
web/src/app/app.css            (si el modo banco necesita estilo propio)
specs/S-17-testids-transferir.txt        (nuevo, contrato versionado)
scripts/verificar-s17-transferir.sh      (nuevo, lo escribe el JUEZ)
scripts/verificar-s17-transferir.mjs     (nuevo, lo escribe el JUEZ)
scripts/calibrar-s17-transferir.sh       (nuevo, lo escribe el JUEZ)
package.json                   (sólo para sumar los tres scripts nuevos)
```

**Fuera de alcance, sin excepción:** todo `src/` (esta unidad no toca backend), todo `test/`,
`scripts/verificar-s10-t4.mjs` (enmienda de R1, tras la aprobación del humano)
y cualquier otro `specs/*.md`.

---

## 9 · Lo que se midió antes de escribir esta spec (F0)

El mapa previo (652 s, exit 0, 1 archivo tocado) contiene tres afirmaciones
verificadas contra `main` antes de usarlas:

1. El DTO de otros bancos, campo por campo (`transferencias-otros-bancos.dto.ts:6-23`).
2. `BANCOS`, `TIPOS_CUENTA_EXTERNA` y `TOPE_DIARIO_OTROS_BANCOS_CENTAVOS = 20000n`.
3. El rótulo fijo «Corriente» vive hoy en `app.html:359` y `:415` — **HU-04 § 2 decía `:267` y
   `:323`, y estaba rancio**: las líneas se corrieron 92 al entrar la ventanilla.

Y dos cosas que el mapa no traía, buscadas después:

4. `verificar-s17-abrir-cuenta.mjs` A5 sí asserta tipo real con texto visible, pero sobre
   `abrir-cuenta-origen`: **no hay un segundo candado** sobre los selectores de Transferir.
5. `SeedRespuesta.cuentaSistemaId` ya existe (`costuras.service.ts:43`), así que **CA12 no necesita
   una costura nueva**; y no hay monto máximo de apertura, verificado en `cuentas.constants.ts` y en
   `test/cuentas.int.spec.ts:316`.
