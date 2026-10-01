# S-17 · Movimientos — pantalla de extracto y búsqueda de una cuenta

> Estado: **spec esperando la aprobación del humano** (2026-09-21). Spec, lista
> de testids, brazos y tabla de defectos quedan fijados **antes** de la entrega y no se tocan después
> (REGLA DE ORO). Historia: `specs/HU-03-pantalla-movimientos.md` (CA1–CA10, R1–R7, J1–J5).
> Backend ya en `main`: S-13 (`GET /movimientos`) y **S-28** (el seed devuelve credencial usable).
> **No se toca backend.** Molde: `specs/S-17-abrir-cuenta.md`. Lo visual sigue la dirección visual ya establecida;
> el humano lo aprueba con captura.
>
> Los datos que esta spec **no puede inventar** se midieron antes de escribirla (§ 9). Lo que sigue
> después de esta spec es F2 (el arnés), por separado.

---

## 1 · Qué hace, qué queda fuera, cuándo está hecho

- **Hace (frontend, `web/`):** la vista **Movimientos**, a la que se llega por `nav-movimientos`,
  **entrada propia de la barra** junto a Transferir (D90-2); un formulario que busca los movimientos
  de **una** cuenta del titular por id de transacción, por día, por rango de días y por monto, solos
  o combinados; y una tabla que pinta lo que devuelve `GET /movimientos` con el concepto, el monto
  sin signo, el signo y la fecha en UTC.
- **Fuera:** backend (S-13 y S-28 ya están) · paginación y botón «ver más» (HU-03 R2) · contraparte
  y saldo progresivo (HU-03 R6) · vista de todas las cuentas juntas (HU-03 J1) · exportar el extracto
  a CSV o PDF · hora local chilena (HU-03 R7) · filtro por concepto (HU-03 § 6) · las pantallas de
  Pagos y Contacto.
- **Hecho:** los 23 brazos de § 5 en verde sobre el **artefacto entregado** (el `dist/` del backend y
  el build de `web/`, servidos), cada defecto de § 6 cazado por el brazo que lo declara, la batería
  de § 7 sin moverse (con la enmienda de los seis candados de § 5.1, aprobada por el humano), y el
  humano aprueba la pantalla en escritorio y teléfono: respuesta + captura.

---

## 2 · Decisiones del humano, ya tomadas (no se re-discuten)

Se tomaron antes de escribir esta spec.

| # | Decisión | Dónde aterriza en esta spec |
|---|---|---|
| **D90-1** | El seed `movimientos-buscables` hashea una clave real y devuelve email y contraseña | **ya entregada** como S-28. Esta spec la **usa**, no la especifica: § 3, fila «Titular del oráculo» |
| **D90-2** | `nav-movimientos` es **entrada propia** de la barra, junto a Transferir | JM1 y brazo N1. El submenú de Cuentas **no se toca**, así que el brazo N2 de `verificar:s17-abrir-cuenta` sigue como está |
| **D90-3** | Se agrega **CA11**: filtrar por el `transaccionId` de un movimiento del seed → 1 fila, y es la correcta | brazo B6 |
| **D90-4** | El brazo que cierra K5/K16 compara **las 10 filas × 4 campos** (`data-monto` sin signo, `data-signo`, `data-fecha` ISO, `data-concepto`) contra la respuesta que el propio brazo le pide a `GET /movimientos`, más `devueltos === filas pintadas` | brazo **B1**, y la misma técnica en B7 |

Y las dos declaradas por la propia spec:

- **El 404 de cuenta ajena no es brazo de pantalla.** Desde la UI el selector sólo ofrece cuentas del
  titular, así que provocarlo exigiría que la suite tocara el código de la app, y el perfil SUT lo
  prohíbe. Lo cubre la integración del backend (`test/movimientos.int.spec.ts`). Por la misma razón
  queda fuera `CUENTA_ID_INVALIDO`: el selector nunca puede emitir un id que no sea UUID.
- **Pulsar «Buscar» sin elegir cuenta sí se prueba** (brazo F6), y por eso el selector nace con una
  opción vacía elegida por defecto: es lo que deja alcanzable `CUENTA_ID_REQUERIDO` desde la
  pantalla. Es la lección de `JA4` de abrir-cuenta.

---

## 3 · Decisiones de diseño (contrato de pantalla, discutibles)

| # | Decisión | Porqué |
|---|---|---|
| JM1 | **Una vista a la vez** (S-17-boletas J4, abrir-cuenta JA1): Resumen, Transferir, Boletas, Abrir cuenta o **Movimientos**. `nav-movimientos` es hermano de `nav-transferir` en la barra (D90-2) y entrar a la vista pide `GET /cuentas` para llenar el selector | con dos vistas montadas los testids de carga saldrían dos veces. Y siendo entrada de primer nivel **no hereda la trampa del submenú**: no hay `display:none` ni `mouseenter` que la vuelvan un brazo imposible (P10 de la 64) |
| JM2 | **El cliente no valida nada**: envía lo escrito y el API decide con código (C5). El formulario lleva `novalidate` y **ningún** `min`, `max`, `step`, `pattern` ni `required` | la misma regla de T3 H3, S-17-boletas J1 y abrir-cuenta JA2. Una regla duplicada en el cliente dejaría **inalcanzables desde la UI** los cuatro códigos de CA7 |
| JM3 | **Los cuatro campos de filtro son `type="text"`.** Ni `type="date"` para `desde`/`hasta`, ni `type="number"` para `monto` | **es la decisión que hace posible el arnés, no una preferencia.** Un `type="date"` nativo se niega a sostener `2026-02-30`, así que `FECHA_INVALIDA` (CA7 y S-13 A10) sería **inalcanzable desde la pantalla** y F2 nacería imposible. Lo mismo hace `type="number"` con `-25.00` y `MONTO_INVALIDO`. Los campos llevan `placeholder` `AAAA-MM-DD` y `inputmode` adecuado, que orientan sin validar |
| JM4 | **El selector de cuenta nace con una opción vacía elegida** («— elige una cuenta —») y, mientras no haya cuenta elegida, `cuentaId` **se OMITE de la query**: no se envía `cuentaId=` ni `cuentaId=null`. Igual con los cuatro filtros: **un campo vacío no viaja** | precedente `JA4`. La opción vacía es lo único que deja alcanzable `CUENTA_ID_REQUERIDO`. Omitir en vez de mandar vacío es lo consistente; el controlador trata los dos igual (`movimientos.controller.ts:57-59`), así que F6 no depende de cuál de los dos se elija |
| JM5 | **La pantalla pinta el orden que devuelve el API y nunca re-ordena en el cliente** (HU-03 R5: `creadoEn DESC`, desempate por id) | el orden es una afirmación del backend. Un `sort` en el cliente rompería B1 y, peor, taparía un cambio de orden del API |
| JM6 | **Cada fila expone cuatro atributos**, sobre el elemento con su propio testid: `data-monto` con el **valor absoluto** (`"25.00"`, nunca `"-25.00"`), `data-signo` con `DEBITO` o `CREDITO`, `data-fecha` con el **ISO crudo tal como lo manda el API** y `data-concepto` con el **código crudo**. La fila lleva además `data-mov-id` y `data-transaccion-id` | D90-4 y HU-03 J3. El signo se deriva del prefijo `-` del `monto` del API (`movimientos.service.ts:84` vía `formatMoney`); un monto exactamente `0.00` es `CREDITO`, porque `formatMoney` nunca emite `-0.00` (`src/domain/money/money.ts:21-27`). La suite afirma sobre atributos, jamás sobre el texto formateado |
| JM7 | **El rótulo visible del concepto sale del mapa de HU-03 J2** y vive **DENTRO** del mismo elemento que lleva `data-concepto`. Un concepto que no esté en el mapa se muestra con su código tal cual, **sin error** | HU-03 J2, que ya previó que pasa con los `SIEMBRA*` de las costuras. La co-ubicación se fija acá por el hallazgo `JA7` de abrir-cuenta: con el rótulo en otro nodo, el brazo lee vacío sobre una app correcta y B8/B9 dejan de separarse |
| JM8 | **Cinco estados explícitos** (C4) en `data-estado` de `movimientos-region`: `inicial` (al llegar, antes de la primera búsqueda), `cargando`, `listo`, `vacio` (la búsqueda respondió 0 movimientos) y `error` (rechazo de negocio). `aria-busy="true"` sólo en `cargando`. **`vacio` e `inicial` son distintos** | CA8. Sin estados la única herramienta de la suite es esperar por tiempo, que el perfil prohíbe con compuerta dura. Y una pantalla que mostrara «no hay resultados» **antes** de buscar estaría mintiendo: por eso `inicial` existe y C3 lo afirma |
| JM9 | **El código del error de negocio** viaja en `data-codigo` sobre `movimientos-error` (con `role="alert"`) y su valor también como texto dentro de `movimientos-codigo-error`; el mensaje en prosa es para la persona | C5, y el mismo mecanismo de `abrir-cuenta-codigo-error`. La suite afirma sobre el código; el texto visible puede cambiar sin romper una prueba |
| JM10 | **La carga del selector y la búsqueda son dos fallos distintos.** Si `GET /cuentas` falla aparecen `movimientos-cuentas-error` y `movimientos-reintentar`; si falla `GET /movimientos` aparece `movimientos-error` con su código | son dos peticiones con dos remedios distintos: una se reintenta, la otra se corrige escribiendo otro filtro. Precedente: `transferir-cuentas-error` |
| JM11 | **Aviso de tope** (HU-03 J5): con `hayMas: true` aparece `movimientos-aviso-tope`, con texto no vacío, y **no hay botón de «más»** (R2). Con `hayMas: false` el aviso **no está en el DOM** | el brazo afirma presencia/ausencia y que el texto no está vacío; **no** ancla la prosa, que es del humano sobre la captura (C5) |
| JM12 | **Accesibilidad** (línea roja del núcleo, y CA10): `movimientos-tabla` lleva `<caption>` y todos sus `<th>` con `scope="col"`; cada campo del formulario tiene su `<label for>` apuntando a un `id` que existe; `nav-movimientos` tiene rol y nombre accesible correctos | la pereza no recorta accesibilidad. Y el `data-testid` no reemplaza al nombre accesible: van los dos (C3) |
| JM13 | **La fecha visible se rotula UTC** con el formateador que ya existe, `formatearFechaUtc` (`web/src/app/app.ts:705-708`), que produce `2026-03-01 00:00 UTC` | HU-03 R7 y CA9. Pilar 0, peldaño 4: la función ya está instalada y en uso en tres sitios; no se escribe otra |
| JM14 | **Ningún botón «limpiar filtros», ningún estado en la URL, ningún guardado del último filtro** | Pilar 0, peldaño 1: no hace falta para ningún criterio de aceptación y cada uno traería brazos propios |

### 3.1 · Decisiones de F3d, nacidas del ataque a ciegas

El ataque a ciegas de F3 mostró que **tres cosas que el arnés daba por
sabidas no estaban escritas en ninguna parte**. Las tres se declaran acá: agrandan el contrato y
ninguna debilita un brazo, que es la misma regla con que se tomaron D80-1 a D80-3 en transferir.

| # | Decisión | Porqué, y qué hallazgo cierra |
|---|---|---|
| **D97-1** | **La consulta sale SÓLO al pulsar `movimientos-buscar`.** La pantalla no consulta al entrar, ni al cambiar el `<select>` de cuenta, ni al escribir un filtro | sin esto, el contador de C1 le atribuía al click forzado **cualquier** petición de la ventana y el brazo daba rojo con el motivo equivocado sobre una app defendible (hallazgo #6, pendiente J10). Además es lo que hace coherente el estado `inicial` de JM8: una pantalla que buscara sola nunca lo mostraría |
| **D97-2** | **El `value` de cada `<option>` del selector es el id de la cuenta.** Es contrato versionado, igual que un testid | ~16 brazos entran por `elegirCuenta`, que hace `selectOption(…, cuentaId)`. Un `<option>` sin `value=id` era compatible con la spec tal como estaba escrita y los tumbaba a todos **por excepción**, no por aserción (hallazgo #8, pendiente J9). La opción vacía de JM4 lleva `value=""` |
| **D97-3** | **F1 exige el ATRIBUTO `type="text"` literal**, no basta con que la propiedad valga `text` | decisión del humano. Un `<input>` sin atributo `type` cumple el propósito de JM3 pero no su letra; aceptar la propiedad relajaría qué cuenta como éxito, y esa llamada es del humano. Se resuelve dejando el brazo **como estaba**: `getAttribute('type')` |

---

## 4 · Constantes y datos del oráculo

**Nada de esta tabla se inventa: cada fila apunta a dónde se lee.** Los montos se expresan como los
manda el API: string decimal (D1).

| Constante | Valor | De dónde sale |
|---|---|---|
| Viewports del arnés | escritorio **1280×800** · teléfono **390×844** | los de T2–T4, S-17-boletas, abrir-cuenta y transferir |
| Tope de cada espera por condición | **8000 ms** | el de T1–T4: un rojo, no un cuelgue; no es un `sleep` |
| Escenario del oráculo | **`movimientos-buscables`** | `costuras.service.ts:453`; se pide con `POST /__test__/seed` |
| Titular del oráculo | el `credenciales: { email, password }` que **devuelve el seed** | **S-28** (`specs/S-28-credencial-movimientos.md`). Antes de S-28 el seed no las devolvía y todo brazo de pantalla sobre él habría sido **imposible**; es el mismo hueco que cazó abrir-cuenta con `cuenta-unica` |
| Cuenta con 10 movimientos | `cuentas[0].id` del seed, campo propio **`movimientos[*].cuentaId`** | `costuras.service.ts:575-601` (el retorno del escenario) |
| Cuenta con 51 movimientos | **`cuentaTopeId`** | `costuras.service.ts:598`; `TOPE_CANTIDAD = 51` en `:176` |
| Oráculo de los 10 movimientos | **`movimientos[]`** del seed: `id`, `transaccionId`, `cuentaId`, `montoCentavos`, `creadoEn` | `costuras.service.ts:29-37`, armado en `:548-554` y devuelto en `:599` |
| Tope de resultados del API | **50**, con `hayMas` | `TOPE_MOVIMIENTOS = 50` en `movimientos.constants.ts:5` |
| Concepto de todo lo sembrado | **`SIEMBRA_BUSQUEDA`** | `costuras.service.ts:179`. **No está en el mapa de HU-03 J2**, y por eso se muestra crudo (JM7): eso es lo que afirma B8 |

### 4.1 · Los 10 movimientos del oráculo, en el orden en que el seed los devuelve

Ascendente por fecha (`MOVIMIENTOS_BUSCABLES`, `costuras.service.ts:149-160`). El índice **i** es el
del array que devuelve el seed, y es como los brazos nombran a cada movimiento: **ningún brazo
escribe un id a mano.**

| i | `creadoEn` | monto del API | `data-monto` | `data-signo` |
|---|---|---|---|---|
| 1 | `2026-03-01T00:00:00.000Z` | `1000.00` | `1000.00` | CREDITO |
| 2 | `2026-03-01T12:00:00.000Z` | `-25.00` | `25.00` | DEBITO |
| 3 | `2026-03-01T23:59:59.999Z` | `75.00` | `75.00` | CREDITO |
| 4 | `2026-03-02T00:00:00.000Z` | `-25.00` | `25.00` | DEBITO |
| 5 | `2026-03-02T09:30:00.000Z` | `500.00` | `500.00` | CREDITO |
| 6 | `2026-03-02T18:45:00.000Z` | `-123.45` | `123.45` | DEBITO |
| 7 | `2026-03-03T00:00:00.000Z` | `75.00` | `75.00` | CREDITO |
| 8 | `2026-03-03T06:15:00.000Z` | `-999.99` | `999.99` | DEBITO |
| 9 | `2026-03-03T23:59:59.999Z` | `25.00` | `25.00` | CREDITO |
| 10 | `2026-03-04T00:00:00.000Z` | `-0.01` | `0.01` | DEBITO |

> ⚠️ **Trampa medida, obligatoria para quien escriba el arnés:** el oráculo del seed entrega
> **`montoCentavos` en centavos** (`"100000"`, `"-2500"`; `costuras.service.ts:548-554`), mientras el
> API de pantalla entrega **decimal con signo** (`"1000.00"`, `"-25.00"`;
> `movimientos.service.ts:84`). Comparar uno contra otro da rojo sobre una app correcta. Los brazos
> comparan la pantalla contra **`GET /movimientos`** (D90-4) y usan el oráculo sólo para los **ids**,
> los `transaccionId` y los conteos.
>
> Los tres movimientos de `cuentaAjenaId` **colisionan a propósito** en fecha y monto con los del
> titular (`costuras.service.ts:166-170`): si el filtro de titularidad desapareciera, «día
> 2026-03-01» pasaría de 3 a 5 y «monto 25.00» de 3 a 4, y B2/B4 se pondrían rojos. Esa es la razón
> por la que el 404 de cuenta ajena no necesita brazo de pantalla.

### 4.2 · Qué devuelve cada filtro (los conteos ya vienen medidos y verificados)

Los cuatro subconjuntos son propios, no vacíos, y el AND de dos es distinto de cada uno por
separado: es lo que hace que un brazo distinga «filtró» de «no filtró»
(`costuras.service.ts:140-148`, re-contado contra la tabla de § 4.1).

| Filtro que escribe el brazo | Devuelve | Cuáles (por índice de § 4.1), en el orden del API |
|---|---|---|
| ninguno | **10 de 10** | 10, 9, 8, 7, 6, 5, 4, 3, 2, 1 |
| `desde` = `hasta` = `2026-03-01` | **3 de 10** | 3, 2, 1 — con los **dos bordes del día dentro** (R3) |
| `desde` = `2026-03-01`, `hasta` = `2026-03-02` | **6 de 10** | 6, 5, 4, 3, 2, 1 |
| `monto` = `25.00` | **3 de 10** | 9 (CREDITO), 4 (DEBITO), 2 (DEBITO) — el valor absoluto, R4 |
| `desde` = `hasta` = `2026-03-01` **y** `monto` = `25.00` | **1 de 10** | 2 |
| `transaccionId` = el de i=6 | **1 de 10** | 6 |
| cuenta de 51, sin filtros | **50**, `hayMas: true` | 50 comparten instante y 1 es 1 h más nueva (D15); el orden lo decide el API (fecha descendente, desempate por id), así que B7 compara contra la respuesta del propio API y **no** contra una lista escrita a mano |
| `monto` = `777.77` | **0** | ninguno: es el caso de `vacio` de C3 |

### 4.3 · Las entradas que provocan cada rechazo (CA7)

| Campo y valor | Código esperado | Fuente del código |
|---|---|---|
| ninguna cuenta elegida (`cuentaId` omitido) | **`CUENTA_ID_REQUERIDO`** | `movimientos.controller.ts:59`, `:68` |
| `desde` = `2026-02-30` | **`FECHA_INVALIDA`** | `movimientos.controller.ts:16-38`, `:93`; S-13 A10 |
| `desde` = `2026-03-02`, `hasta` = `2026-03-01` | **`RANGO_INVALIDO`** | `movimientos.controller.ts:113` |
| `monto` = `-25.00` | **`MONTO_INVALIDO`** | `movimientos.controller.ts:124-125` (rechaza el signo) |
| `transaccionId` = `no-es-un-uuid` | **`TRANSACCION_ID_INVALIDO`** | `movimientos.controller.ts:83` |

El orden de precedencia del controlador es fijo —`cuentaId → transaccionId → desde → hasta → rango →
monto` (`movimientos.controller.ts:53`)—, así que **cada brazo de § 5 deja limpios los campos que no
está probando**: un brazo que llenara dos campos malos a la vez estaría afirmando sobre la
precedencia y no sobre el código que dice medir.

### 4.4 · Preparación de datos, y la defensa contra el brazo imposible

Cada dato de preparación se construye con una función que **afirma sus propios límites antes de
usarlos** (la lección de `arnes-imposible-no-solo-ciego`):

- **Titular del oráculo:** `POST /__test__/reset` → `POST /__test__/seed {"escenario":"movimientos-buscables"}`.
  La función afirma que la respuesta trae `credenciales.email`, `credenciales.password`,
  `movimientos.length === 10`, `cuentaTopeId` y `cuentaAjenaId` **antes de devolverla**, y que
  `POST /auth/login` con esa credencial responde 200. Si algo de eso falla, el arnés muere con un
  mensaje que dice **qué costura se rompió**, no con un brazo en rojo.
- **Titular con un movimiento de concepto mapeado (para B9):** `POST /auth/registro` + dos
  `POST /cuentas` + un `POST /transferencias` entre ellas, todo por API. La función afirma que la
  transferencia respondió con su `transaccionId` y que `GET /movimientos` de la cuenta de origen
  contiene un movimiento con `concepto === 'TRANSFERENCIA'`. **No se usa un escenario de `seed`**:
  ninguno siembra un concepto del mapa de J2.

---

## 5 · Brazos del arnés (fijados antes de la entrega; no se tocan después)

Runner nuevo: `verificar:s17-movimientos`, **23 brazos**. Corre contra el artefacto servido (backend
`node dist/main.js` en :3000 y el build de `web/` en :4200). **No importa código de la app** y no
toca la BD directamente: todo estado entra por las costuras `/__test__/` y por el API público.

### Navegación y contrato (N)

| # | Qué afirma | Cómo |
|---|---|---|
| N1 | `nav-movimientos` es **entrada de primer nivel de la barra** (D90-2): está visible **sin hover ni despliegue previo**, es hermano de `nav-transferir` dentro de `nav-panel` y **no** está dentro de `nav-cuentas-menu`; al pulsarlo se monta `movimientos-region` y el Resumen **deja de estar montado** (JM1) | la posición se lee del DOM renderizado (`closest`), no del código fuente |
| N2 | `nav-movimientos` es alcanzable por teclado y tiene **nombre accesible** correcto (rol + etiqueta) | accesibilidad: línea roja del núcleo (JM12) |
| N3 | Contrato de testids **sobre el artefacto renderizado**: están todos los de `specs/S-17-testids-movimientos.txt`, ninguno se repite salvo los cinco de fila, y no aparece ninguno fuera de T4 ∪ boletas ∪ abrir-cuenta ∪ transferir ∪ esta lista | el grep del código fuente pasa en verde con un componente que nunca se monta (RESTRICCIONES § 2) |

### Carga y estados (C) — costura C4, CA8

| # | Qué afirma | Cómo |
|---|---|---|
| C1 | Mientras `GET /movimientos` está en vuelo: `data-estado="cargando"`, `aria-busy="true"`, `movimientos-cargando` presente, y `movimientos-buscar` **no dispara una segunda consulta** — se comprueba el atributo `disabled` **y** que un click forzado no genera otra petición, contada en la intercepción | un brazo que sólo mire `[disabled]` es ciego: es la ceguera K16 de la 63 y la de la 85 |
| C2 | Si `GET /cuentas` falla, aparecen `movimientos-cuentas-error` y `movimientos-reintentar`, y el reintento carga bien el selector (JM10) | la falla se provoca interceptando la ruta **en el navegador**, sin tocar el backend |
| C3 | Al llegar a la vista el estado es **`inicial`** y `movimientos-vacio` **no está**; tras buscar `monto = 777.77` el estado es **`vacio`**, `movimientos-vacio` está presente y `movimiento-fila` cuenta **0** | los dos en un brazo porque lo que se afirma es que **son distintos** (JM8) |

### Búsqueda (B) — CA1 a CA6 y CA11

| # | Qué afirma | Cómo |
|---|---|---|
| B1 | **CA1 y D90-4** · Sin filtros, la cuenta de 10: las **10 filas × 4 campos** (`data-monto` sin signo, `data-signo`, `data-fecha` ISO, `data-concepto`) son **exactamente iguales, en el mismo orden**, a lo que el propio brazo le pide a `GET /movimientos` con el token del titular; y `devueltos` **===** número de `movimiento-fila` pintadas | es el brazo que cierra el hueco K5/K16 que quedó abierto en boletas, abrir-cuenta y transferir. Compara pantalla contra API, nunca contra los centavos del oráculo (§ 4.1) |
| B2 | **CA2** · `desde` = `hasta` = `2026-03-01` → **3** filas, y su conjunto de `data-mov-id` es exactamente el de los índices 3, 2 y 1 del oráculo, **con los dos bordes del día dentro** | conjunto, no orden: el orden lo afirma B1, y así K1 caza sólo a B1 |
| B3 | **CA3** · `desde` = `2026-03-01`, `hasta` = `2026-03-02` → **6** filas, conjunto igual a los índices 6…1 | idem |
| B4 | **CA4** · `monto` = `25.00` → **3** filas, conjunto igual a los índices 9, 4 y 2, con `data-signo` **CREDITO, DEBITO, DEBITO** respectivamente | el valor absoluto (R4): el signo no confunde al filtro pero sí se pinta |
| B5 | **CA5** · `desde` = `hasta` = `2026-03-01` **y** `monto` = `25.00` → **1** fila, la del índice 2 | es el brazo que caza «la pantalla ignora uno de los dos filtros» |
| B6 | **CA11 (D90-3)** · `transaccionId` = el `transaccionId` del índice 6 del oráculo → **1** fila, y su `data-mov-id` y `data-transaccion-id` son los de ese movimiento | cubre V2 de HU-03, que no tenía camino feliz |
| B7 | **CA6** · La cuenta de 51: **50** filas, iguales campo por campo a la respuesta del API (técnica de B1), y `movimientos-aviso-tope` presente con **texto no vacío**; volviendo a la cuenta de 10, el aviso **no está en el DOM** y no hay ningún control de «ver más» | 50 de los 51 comparten instante (1 es 1 h más nueva, D15), así que el orden lo decide el API; escribir la lista a mano sería un brazo intermitente (JM11, C2 del perfil) |
| B8 | **JM7** · Con la cuenta del oráculo, `data-concepto` vale `SIEMBRA_BUSQUEDA` en las 10 filas y el **texto visible dentro de ese mismo elemento** contiene `SIEMBRA_BUSQUEDA`: un concepto fuera del mapa de J2 se muestra crudo y **sin error** | HU-03 J2 lo previó. El texto se lee del mismo nodo que lleva el atributo (JM7) |
| B9 | **HU-03 J2** · Con el titular de § 4.4 y una transferencia real, la fila de ese movimiento tiene `data-concepto="TRANSFERENCIA"` y su **rótulo visible** es **«Transferencia»** | **ancla de texto deliberada y declarada**: es lo único que prueba que la persona ve el concepto traducido. B8 no lo cubre — K13 y K14 de § 6 lo demuestran. Si el rótulo cambia, B9 se enmienda en la spec, con el número al lado |

### Formulario y errores de negocio (F) — CA7 y JM2/JM3

| # | Qué afirma | Cómo |
|---|---|---|
| F1 | `movimientos-form` lleva `novalidate`; ninguno de sus cinco campos trae `min`, `max`, `step`, `pattern` ni `required`; y `movimientos-desde`, `movimientos-hasta`, `movimientos-transaccion` y `movimientos-monto` tienen **`type="text"`** | **comprobado sobre el DOM renderizado.** Es lo que hace alcanzables F2–F5 desde la UI (JM2, JM3) |
| F2 | `desde` = `2026-02-30` → **`FECHA_INVALIDA`** en `data-codigo` y en `movimientos-codigo-error`, estado `error`, y **0** filas pintadas | el código, no la prosa (JM9) |
| F3 | `desde` = `2026-03-02`, `hasta` = `2026-03-01` → **`RANGO_INVALIDO`** | dos fechas válidas: lo que falla es el cruce |
| F4 | `monto` = `-25.00` → **`MONTO_INVALIDO`** | el controlador rechaza el signo (`:124`) |
| F5 | `transaccionId` = `no-es-un-uuid` → **`TRANSACCION_ID_INVALIDO`** | |
| F6 | Con la opción vacía elegida, pulsar `movimientos-buscar` **sí llama al API** y devuelve **`CUENTA_ID_REQUERIDO`**; no se pinta ninguna fila | este brazo es el que justifica la opción vacía de JM4: sin ella el código sería inalcanzable. Y afirma **la intención** (la petición salió), no un `disabled`: es la decisión D80-3 de transferir |

### Formato y accesibilidad (A) — CA9 y CA10

| # | Qué afirma | Cómo |
|---|---|---|
| A1 | `movimientos-tabla` tiene `<caption>` con texto no vacío y **todos** sus `<th>` con `scope="col"`; cada uno de los cinco campos del formulario tiene un `<label for>` que apunta a un `id` **que existe en el DOM** | CA10, JM12. El `for` colgado es el defecto clásico que un check de presencia no ve |
| A2 | El **texto visible** de `movimiento-fecha` de la fila i=1 es `2026-03-01 00:00 UTC` y termina en `UTC`, mientras `data-fecha` lleva el **ISO crudo** `2026-03-01T00:00:00.000Z` | CA9 y R7 (JM13). Es el segundo ancla de texto declarada, y es deliberada: el rótulo UTC es una regla del humano, no un detalle de formato |

### 5.1 · Los seis candados que esta unidad rompe, y la enmienda prevista

`nav-movimientos` y los cinco testids de fila **no existen** en ninguna lista blanca, así que las
seis auditorías de testids se pondrán **rojas** al montar la pantalla. Medido, con su línea exacta:

| Candado | Brazo que rompe | Enmienda, de una línea |
|---|---|---|
| `verificar:s10-t2` (31 brazos, `:21`) | `R1`, `sobran` en `:720` | **E2 (F3d):** un `Set` APARTE que filtre **sólo `sobran`**, no sumar a `LISTA` |
| `verificar:s10-t3` (56 brazos, `:23`) | `R1`, `sobran` en `:2086` | idem, sobre `:2086` |
| `verificar:s10-t4` (78 brazos, `:26`) | `R1`, `sobran` en `:3279` | leer `LISTA_S17MOV` y sumarla al filtro |
| `verificar:s17-boletas` (42 brazos, `:21`) | `R1`, `sobran` en `:2356` | extender el `Set` `UNION_T4_S17` de `:51` |
| `verificar:s17-abrir-cuenta` (18 brazos, `:23`) | `N4`, `sobran` en `:744` | extender el `Set` `UNION` de `:36` |
| `verificar:s17-transferir` (19 brazos, `:72`) | `N1`, `sobran` en `:1278` | sumar `leerLista('S-17-testids-movimientos.txt')` a `UNION` en `:131` |

> **E2 · por qué T2 y T3 no llevan la enmienda que decía esta tabla.** Verificado
> sobre el archivo en disco: `verificar-s10-t2.mjs:719-720` y `verificar-s10-t3.mjs:2085-2086`
> usan **una sola `LISTA`** para `faltan` y para `sobran`. Sumarle ahí el archivo de movimientos
> les exigiría **montar los 22 testids de esta unidad**, que esas dos pantallas no montan nunca:
> los dos árbitros quedarían **rojos para siempre**. T4 (`:3279`), boletas (`:2356`), abrir-cuenta
> (`:744`) y transferir (`:1278`) sí separan las dos listas, y por eso sus filas no cambian.
> Lo cazó el ataque a ciegas de F3 (hallazgo #2); ninguna calibración lo habría visto,
> porque un candado rojo por esta causa se ve igual que uno rojo por un testid ajeno.

**Lo que FALTA se sigue midiendo contra la lista de cada candado como hoy, y un testid ajeno lo
sigue poniendo rojo: no se relaja ninguna aserción, se actualiza el contrato versionado** (C3).
La enmienda **requiere la aprobación del humano antes de aplicarse**, y se calibra: con la enmienda
puesta, K15 de § 6 tiene que seguir cazando a N3, y el candado enmendado tiene que ponerse rojo si
se le cuela un testid que no está en ninguna lista (es la calibración `2/2` que se le hizo a la
enmienda R1).

**El brazo `N2` de `verificar:s17-abrir-cuenta` no se toca**, y es consecuencia de D90-2: recorre
hasta 6 saltos de `Tab` buscando `nav-abrir-cuenta` dentro del submenú de Cuentas, y `nav-movimientos`
nace **fuera** de ese submenú. Si alguien decidiera meterla
al submenú, ese brazo cambia de significado: es la razón técnica de D90-2.

---

## 6 · Defectos de calibración (fijados antes de medir)

Cada uno declara qué brazos **debe** poner rojos y cuáles deben **seguir verdes**. La compuerta del
perfil: romper la app a propósito y comprobar que el arnés se pone rojo. Un invariante que nunca se
vio fallar no es un invariante.

| # | Defecto inyectado | Debe poner ROJO | Debe seguir VERDE |
|---|---|---|---|
| K1 | La pantalla re-ordena las filas por fecha **ascendente** (JM5) | **B1 y B7** (D15: la cuenta del tope lleva una fila más nueva; antes fue «sólo B1», enmienda D102-2) | B2, B3, B4, B5 |
| K2 | `data-monto` conserva el signo del API (`-25.00`) | B1 | **B4** (lee `data-signo`) |
| K3 | `data-signo` se escribe fijo `CREDITO` | **B1 y B4** (B1 compara los cuatro campos, y `data-signo` es uno) | B2, B3, B5 |
| K4 | El filtro `monto` se recoge del campo pero **nunca se agrega a la query** | B4, B5 (+ C3, F4 y **N3**, pre-registrados; N3 por D102-3) | B2, B3 |
| K5 | Los filtros `desde`/`hasta` **nunca se agregan a la query** | B2, B3, B5 | B4 |
| K6 | La pantalla pinta sólo las **9** primeras filas de la respuesta | **B1 y B8** (E3, F3d: B8 afirma `filas.length !== 10`, `:763`) | B2, B3 |
| K7 | `movimientos-aviso-tope` se renderiza **siempre** | **sólo B7** | B1, C3 |
| K8 | `movimientos-monto` recupera `pattern` y el form pierde `novalidate` | F1 **y F4** | F2, F3, F5, F6 |
| K9 | `movimientos-desde`/`-hasta` vuelven a `type="date"` (JM3) | F1 **y F2** | F3, F4, F5, F6 |
| K10 | El cliente valida y **no llama al API** si no hay cuenta elegida | **sólo F6** | F2…F5 |
| K11 | El estado `vacio` no existe: sin resultados queda en `cargando` | **sólo C3** | C1, C2 |
| K12 | `movimientos-buscar` no se deshabilita durante la carga | **sólo C1** | C3 |
| K13 | El rótulo visible del concepto se escribe fijo «Transferencia» | **sólo B8** | **B9** |
| K14 | El mapa de J2 se ignora y siempre se pinta el código crudo | **sólo B9** | **B8** |
| K15 | Un testid ajeno (`movimientos-extra`) se cuela en la plantilla | **sólo N3** | los demás |
| K16 | `nav-movimientos` se monta **dentro** de `nav-cuentas-menu` (contra D90-2) | **sólo N1** (enmienda D102-1) | N2, N3 |
| K17 | La fecha visible pierde el rótulo « UTC» | **sólo A2** | B1 (compara `data-fecha`) |
| K18 | La tabla pierde su `<caption>` y sus `scope="col"` | **sólo A1** | los demás |
| K19 | El `<label for>` de `movimientos-monto` apunta a un `id` inexistente | **sólo A1** | F1 |

**K2/K3, K8/K9, K13/K14 y K4/K5 son pares a propósito:** cada uno debe cazar un conjunto **distinto**
de brazos. Si los dos miembros de un par cayeran igual, los brazos que separan estarían midiendo lo
mismo y sobraría uno.

**K3, K8 y K9 caen sobre dos brazos cada uno, y está declarado antes de medir.** En K8 y K9 ese
segundo rojo **es el punto**: el `pattern` y el `type="date"` son exactamente lo que vuelve
inalcanzable el código del API, así que F4 y F2 tienen que caer con ellos. Un defecto que cazara sólo
F1 diría que el tipo del campo es cosmético, y no lo es (JM3).

**Enmienda D102-1 · K16 pasa de `N1, N2` a `sólo N1`, con el resultado a la vista y por decisión
del humano** (precedente K6; la llamada NO es de quien implementa porque cambia qué cuenta como éxito).
Los dos números se publican: con la fila vieja K16 es **NO CAZADO**, con la nueva es **CAZADO**.
El porqué, previsto **antes** de medir y confirmado por la corrida: la enmienda D101-1
cuelga `nav-movimientos` del submenú pero le conserva `href`, `role="link"` y su etiqueta, así que
el nombre accesible y el alcance por teclado que mide **N2 no cambian** — N2 verde es el resultado
correcto, no un fallo. Una corrida contaminada se descartó (la contaminación tocó sólo F1 y F2, que no
dependen de K16) y se repitió limpia.

**Enmienda D102-2 · K1 pasa de `B1 y B7` a `sólo B1`, decisión del humano con el resultado a la
vista.** Los dos números: con la fila vieja K1 es **NO CAZADO**, con la nueva **CAZADO**. La causa
raíz NO es el producto ni la implementación: las 51 filas del fixture de B7 **comparten instante** a
propósito (`verificar-s17-movimientos.mjs:781`, para que el orden lo decida el API y el brazo no
sea intermitente), y un `sort` estable sobre claves idénticas no mueve ninguna fila. B7 es **ciego
a este defecto por construcción**. B1 sí lo caza, así que K1 no queda sin árbitro. La ceguera queda
ABIERTA como **DEUDA**.

**Enmienda D102-3 · K4 pre-registra también `N3`, decisión del humano.** Los dos números: con la
fila vieja K4 es **NO CAZADO**, con la nueva **CAZADO**. El log da el mecanismo exacto —
`N3 ROJO: faltan [movimientos-vacio]` — y es el **mismo que K11**, donde N3 ya estaba
pre-registrado: sin el filtro aplicado la búsqueda siempre trae filas, el estado `vacio` no se
monta nunca y su testid no se recolecta. Es una consecuencia mecánica del defecto, no una
reclasificación de conveniencia; fue una omisión al pre-registrar.

**Sonda de ceguera declarada (su verde se escribe antes de medir):**

| # | Cambio | Brazos que deben seguir VERDES | Árbitro que sí lo miraría |
|---|---|---|---|
| K20 | Se cambia el texto del `<p>` de `movimientos-vacio` y la prosa del aviso de tope | **todos los 23** | el ojo del humano sobre la captura. El arnés **no mira** esa prosa y es correcto que no la mire (C5): el texto visible puede cambiar sin romper una prueba. Lo que sí se mira es que no esté **vacío** (B7) |

---

## 7 · Batería que no debe moverse

Re-medida sobre `main` el **2026-09-21** antes de escribir esta spec (Pilar 7):

`typecheck` **0** · `build` **0** · `guante` **6/6** · `test:domain` **140/140** ·
`test:integracion` **446/446** · `invariantes` **6/6** · `invariantes:calibrar` **16/16**.

Y los candados de frontend, que **se re-miden el día de la entrega** porque son los que esta unidad
toca: `verificar:s10-t2` **31** · `verificar:s10-t3` **56** · `verificar:s10-t4` **78** ·
`verificar:s17-boletas` **42** · `verificar:s17-abrir-cuenta` **18** · `verificar:s17-transferir`
**19**, cada uno con su enmienda de § 5.1 y **con la enmienda calibrada**. `demo:m6` **3/3 corridas ·
42/42 pasos** después de la entrega, porque la barra cambia.

> Los números de los seis candados son los `BRAZOS_TOTAL` **declarados en su código** (§ 5.1), no una
> medición de hoy: los tres de T2/T3/T4 y los de boletas necesitan la app servida. Se corren y se
> reporta el número real al cerrar la entrega, no ahora.

---

## 8 · Alcance de archivos (declarado antes de implementar)

**La implementación toca sólo esto:**
- `web/src/app/app.html` — la entrada de barra, la vista de Movimientos con su formulario y su tabla.
- `web/src/app/app.ts` — el estado de la vista, la carga del selector, la búsqueda, los cinco estados
  de JM8 y el mapa de rótulos de JM7.
- `web/src/styles.css` — lo visual de la vista nueva, siguiendo la dirección visual ya establecida.

**Se escriben aparte, no en la implementación:** esta spec, `specs/S-17-testids-movimientos.txt`,
`scripts/verificar-s17-movimientos.mjs` y su `.sh`, la línea de `package.json`, y las seis enmiendas
de candado de § 5.1.

**Nadie toca:** `src/` (el backend de esta unidad ya está: S-13 y S-28), las migraciones, ni las
pantallas de Transferir, Boletas y Abrir cuenta. `formatearFechaUtc` (`app.ts:705-708`) **se reusa,
no se duplica ni se modifica**: la usan hoy tres sitios (`app.html:337`, `:781`, `:784`) y cambiarla
movería candados ajenos.

---

## 9 · Lo que se midió antes de escribir esta spec

| Fase | Sesión | Qué dejó | Dónde |
|---|---|---|---|
| **F0** · mapa de la unidad | — | contrato real de `GET /movimientos`, los 15 conceptos que existen, el patrón de entrada de barra, los 6 candados, y de dónde sale el dato de cada CA | — |
| **F1a** · datos que la spec no puede inventar | — | la cuenta ajena y su colisión deliberada, la ausencia de credencial (que motivó S-28), las listas blancas de los 6 candados, el formato del `.txt`, y cómo se pinta hoy un monto | — |
| **decisiones** | — | D90-1 a D90-4 del humano + las 2 declaradas en § 2 | — |
| **S-28** · la costura de D90-1 | — | el seed devuelve una credencial usable: `test:costuras-credencial` **6/6**, `test:costuras` **15/15** sin moverse, calibrado con 2 defectos inyectados | `specs/S-28-credencial-movimientos.md` |
| **F1b** · esta spec | — | el contrato de pantalla, 23 brazos y 19 defectos + 1 sonda de ceguera | este archivo |

**Lo que falta:** **F2** = el arnés
(`scripts/verificar-s17-movimientos.mjs`), y **F3** = el ataque al arnés a ciegas,
que es compuerta antes de la implementación. Recién después se implementa F4.
