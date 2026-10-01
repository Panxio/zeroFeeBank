# S-17 · Contacto — pantalla de datos de contacto del titular

> Estado: **spec pendiente de aprobación del humano** (2026-09-23). Spec, lista
> de testids, brazos y tabla de defectos quedan fijados **antes** de la entrega y no se tocan después
> (REGLA DE ORO). Historia: `specs/HU-06-pantalla-contacto.md` (CA1–CA7, R1–R5, J1–J5).
> Backend ya en `main`: S-14 (`GET /contacto`, `PUT /contacto`). **No se toca backend.** Molde:
> `specs/S-17-pagos.md`. Lo visual sigue la dirección de la 28; el humano lo aprueba con captura.
>
> **Ciclo reducido (D112-1 (4)):** sin F0 aparte (el mapa P6 se
> auditó con 0 huecos reales, HU-06 § 6); el arnés F2 sale de la plantilla de Pagos; el ataque F3
> lo hace **un solo modelo**. Luego F4 (pantalla ∥ candados) y F5.

---

## 1 · Qué hace, qué queda fuera, cuándo está hecho

- **Hace (frontend, `web/`):** la vista **Contacto**, a la que se llega por `nav-contacto`, **entrada
  propia de la barra** (JC1). Al entrar pide `GET /contacto` y muestra un formulario con los 7 datos
  prellenados y el email en un campo de sólo lectura. **Guardar** hace `PUT /contacto` con los 7 datos
  y, si sale bien, muestra lo que devolvió el API y una confirmación efímera `role="status"`.
- **Fuera:** backend (S-14 ya está) · cambiar el email o la contraseña (R3) · validar formatos (R2) o
  normalizar texto (R4) · guardado parcial `PATCH` · diálogo de confirmación antes de guardar (no mueve
  plata, R5) · la unidad UX (O1–O5, U1–U6).
- **Hecho:** los **19 brazos** de § 5 en verde sobre el **artefacto entregado** (el `dist/` del backend
  y el build de `web/`, servidos). Además, cada defecto de § 6 cazado por el brazo que lo declara, la
  batería de § 7 sin moverse (con la enmienda de los ocho candados de § 5.1, aprobada por el humano),
  y el humano aprueba la pantalla en escritorio y teléfono: respuesta + captura.

---

## 2 · Lo que viene decidido (no se re-discute aquí)

| Fuente | Decisión | Dónde aterriza |
|---|---|---|
| HU-06 R1 / S-14 N1 | 7 datos obligatorios, no vacíos tras `trim`, máximos 50·50·100·50·50·20·20 | B1–B5 |
| HU-06 R2 | teléfono y código postal son texto libre | G3 |
| HU-06 R3, J2 | el email se ve de sólo lectura y **no viaja** en el `PUT` | V1, G1 |
| HU-06 R4, J5 | sólo `trim` en el API; la pantalla muestra lo que devolvió el `PUT` | G2 |
| HU-06 J1 | usuario nuevo: formulario vacío, nunca la palabra «null» | V1 |
| HU-06 J3 | confirmación efímera `role=status`, desafío 17 del catálogo (S-10 § 3) | G1 |
| HU-06 J4 | la autoridad es la API; cada rechazo con su código (C5) | B1–B5, E1 |

**`EMAIL_NO_MODIFICABLE` no es brazo de pantalla** (J2): la pantalla no manda el email, así que no
puede emitirlo sin un defecto. Lo cubre `test:contacto`. Por la misma razón quedan fuera los `TOKEN_*`.

---

## 3 · Decisiones de contrato de pantalla (discutibles)

| # | Decisión | Porqué |
|---|---|---|
| JC1 | **Una vista a la vez** y `nav-contacto` es **entrada de primer nivel** dentro de `nav-panel`, a continuación de `nav-boletas`, fuera de `nav-cuentas-menu` y de `nav-usuario-menu`. Entrar pide `GET /contacto` | precedente JP1 y D90-2: un menú que se abre con clic o con hover añade un estado previo que puede volver imposible un brazo. **Alternativa para el humano:** ponerla en `nav-usuario-menu` («mis datos» junto a «Salir»); cambia N1 y K14, nada más |
| JC2 | **El cliente no valida nada.** `contacto-form` lleva `novalidate` y ninguno de los 7 campos trae `required`, `pattern`, `minlength` ni `maxlength`. **Los 7 son `type="text"`** (atributo literal, D97-3) | como JP2: un `maxlength` vuelve **inalcanzable** «máximo + 1» (CA3) y un `required` vuelve inalcanzable el vacío. CA6 queda verificado sobre el DOM (E1) |
| JC3 | **El email va en `contacto-email`, un `<input type="text" readonly>` con su `<label>`, FUERA de `contacto-form`**, y el cuerpo del `PUT` lleva **exactamente** las 7 claves `nombre`, `apellido`, `direccion`, `ciudad`, `estado`, `codigoPostal`, `telefono` | J2: si el email no viaja, R3 no se puede gatillar desde la pantalla |
| JC4 | **Se envía el texto tal como está escrito, sin `trim` en el cliente.** El campo vacío viaja como `""`, nunca se omite ni viaja `null` | el `trim` es del API (`contacto.service.ts:43`); un `trim` del cliente taparía R4 y J5 (G2 lo afirma) |
| JC5 | **Un `null` del `GET` se pinta como campo vacío** (`value === ""`) | J1 |
| JC6 | **Estados de la carga (C4)** en `data-estado` de `contacto-region`: `cargando`, `listo` y `error`. `aria-busy="true"` sólo en `cargando`, junto con `contacto-cargando`. `contacto-form` **sólo se monta en `listo`** | CA7 al leer; sin formulario montado a medias no hay campos vacíos que parezcan J1 |
| JC7 | **Estados del guardado (C4)** en `data-estado` de `contacto-form`: `editando`, `guardando`, `guardado`, `error` y `sin-respuesta`. `aria-busy="true"` sólo en `guardando`, junto con `contacto-guardando` y `contacto-guardar` **deshabilitado**. Editar un campo tras `guardado` o `error` vuelve a `editando` | CA7 al guardar; la suite espera por estado, no por tiempo |
| JC8 | **Tras un `200`, los 7 campos toman los valores de la respuesta del `PUT`**, no los tecleados | J5 |
| JC9 | **Confirmación efímera:** `contacto-aviso` es una región `role="status"` **siempre montada** en `listo`; al recibir el `200` se inserta dentro `contacto-guardado`, que **se quita sola** a los **`AVISO_MS` = 4000 ms**. No es modal, no roba el foco y no bloquea: mientras se ve, los campos se pueden editar | J3. La región viva montada de antemano es lo que hace que un lector de pantalla anuncie el mensaje (un `role=status` que nace con el texto dentro no siempre se anuncia): accesibilidad, línea roja. El tiempo es de la **UI**, no del dominio (C2 habla del dominio); 4000 ms queda bajo el tope de espera de 8000 ms, así que la desaparición se afirma **por condición** |
| JC10 | **Errores con código (C5).** El código viaja en `data-codigo` sobre `contacto-error` (`role="alert"`) y como texto en `contacto-codigo-error`; la prosa es el `mensaje` del API (`errData?.mensaje \|\| codigo`, patrón de Pagos). Tras un rechazo **los campos conservan lo tecleado**, para corregirlo | la suite afirma el código y la persona lee la prosa |
| JC11 | **Sin respuesta de red:** `contacto-sin-respuesta` (`role="alert"`), `contacto-form` en `sin-respuesta`, **sin** `contacto-error` ni `data-codigo`, y `contacto-guardar` habilitado: se reintenta con el mismo botón | el `PUT` es de reemplazo total, idempotente por naturaleza (R5 no pide `Idempotency-Key`): no hace falta la maquinaria de T3 |
| JC12 | **Dos fallos distintos, dos testids:** `GET /contacto` → `contacto-carga-error` + `contacto-carga-reintentar`; `PUT /contacto` → `contacto-error` | dos peticiones, dos remedios (JP12) |
| JC13 | **Accesibilidad:** cada uno de los 8 campos (7 + email) con `<label for>` a un `id` que existe; `nav-contacto` con rol y nombre accesible | línea roja del núcleo |

---

## 4 · Constantes y datos del oráculo

**Nada se inventa: cada fila apunta a dónde se lee.** Los datos de prueba (nombres, calles) son
arbitrarios: no son reglas de negocio.

| Constante | Valor | De dónde sale |
|---|---|---|
| Viewport del arnés | escritorio **1280×800** | el de las S-17 anteriores; el teléfono lo mira el humano en la captura |
| Tope de cada espera por condición | **8000 ms** | el de T1–T4 y Pagos: un rojo, no un cuelgue |
| Espera de ausencia (un segundo `PUT` que no debe salir) | **1500 ms** | `ESPERA_AUSENCIA_MS` de Pagos |
| `AVISO_MS` | **4000 ms** | JC9; bajo el tope de 8000 |
| Máximos (R1) | nombre **50** · apellido **50** · dirección **100** · ciudad **50** · estado **50** · código postal **20** · teléfono **20** | `src/modules/contacto/contacto.service.ts:96-102` |
| Códigos, en orden de precedencia | `CONTACTO_NOMBRE_INVALIDO` → `…_APELLIDO_INVALIDO` → `…_DIRECCION_INVALIDA` → `…_CIUDAD_INVALIDA` → `…_ESTADO_INVALIDO` → `…_CODIGO_POSTAL_INVALIDO` → `…_TELEFONO_INVALIDO`, todos **400** | `contacto.service.ts:96-102`; status en `src/infra/errores-http.filter.ts:169-177` |
| Respuesta de `GET` y `PUT` | `{ email, nombre, apellido, direccion, ciudad, estado, codigoPostal, telefono }`; los 7 en `null` para un usuario nuevo | `contacto.service.ts:15-24` y `:74-83` |
| Contacto de referencia | `Ana` · `Pérez` · `Av. Siempre Viva 742` · `Santiago` · `RM` · `8320000` · `+56 2 2345 6789` | cada valor bajo su máximo, afirmado al cargar el arnés |
| Contacto previo (preparación) | `Previo` · `Dato` · `Calle Uno 1` · `Valparaíso` · `V` · `2340000` · `322000000` | distinto del de referencia en los 7 campos, afirmado |
| Nombre con espacios (G2) | **`  Ana  `** → se guarda y se ve **`Ana`** | CA4 |
| Teléfono con letras (G3) | **`fono-ABC`** | CA5; bajo 20 |

### 4.1 · Preparación de datos, y la defensa contra el brazo imposible

- **Titular nuevo:** `POST /auth/registro` → login. La función afirma que `GET /contacto` devuelve el
  email del registro y los **7 en `null`**. Si algo falla, el arnés muere diciendo qué paso de la
  preparación se rompió, no con un brazo en rojo.
- **Titular con contacto previo:** lo anterior + `PUT /contacto` con el contacto previo por API,
  afirmando el `200` y que `GET /contacto` lo devuelve igual. **Es el que usan los rechazos:** «los
  datos guardados no cambian» es trivial si no había nada guardado.
- **Cadenas de borde:** `'a'.repeat(max)` y `'a'.repeat(max + 1)`, afirmando su `length` antes de
  escribirlas. «Sólo espacios» es `'   '` (3 espacios).
- **No se usa ningún escenario de `seed`:** el registro por API ya da el usuario nuevo de J1. Sólo se
  usa `POST /__test__/reset` al empezar.

---

## 5 · Brazos del arnés (fijados antes de la entrega; no se tocan después)

Runner nuevo: `verificar:s17-contacto`, **19 brazos**. Corre contra el artefacto servido (backend
`node dist/main.js` en :3000 y el build de `web/` en :4200). **No importa código de la app** y no toca
la BD. Todo estado entra por `/__test__/reset` y por el API público. Toda afirmación sobre «lo
guardado» se hace **por `GET /contacto`** con el token del titular. Las intercepciones del navegador
casan por host y pathname (E3 de Pagos). El ayudante de guardado registra cada `data-estado` de
`contacto-form` con un `MutationObserver` y todo guardado exige haber pasado por `guardando` (E1 de
Pagos).

### Navegación y contrato (N)

| # | Qué afirma | Cómo |
|---|---|---|
| N1 | `nav-contacto` es entrada de primer nivel: visible **sin hover ni clic previo**, dentro de `nav-panel`, **no** dentro de `nav-cuentas-menu` ni de `nav-usuario-menu`, hermana de `nav-boletas` e **inmediatamente después de ella** (`previousElementSibling`; D119-2). Al pulsarla se monta `contacto-region`, deja de estar montada `cuentas-tabla` y sale `GET /contacto` | posición leída del DOM renderizado (`closest`) |
| N2 | `nav-contacto` es alcanzable por teclado y tiene rol + nombre accesible correctos | JC13 |
| N3 | Contrato de testids **sobre el artefacto renderizado**: recorriendo los estados que montan los brazos aparecen todos los de `specs/S-17-testids-contacto.txt`, ninguno se repite, y no aparece ninguno fuera de T4 ∪ boletas ∪ abrir-cuenta ∪ transferir ∪ movimientos ∪ pagos ∪ esta lista | RESTRICCIONES § 2 |

### Carga y estados (C) — CA7

| # | Qué afirma | Cómo |
|---|---|---|
| C1 | Con `GET /contacto` **retenido en el navegador**: `contacto-region` en `cargando`, `aria-busy="true"`, `contacto-cargando` presente y `contacto-form` **no** montado. Al soltarlo, `listo`, sin `aria-busy="true"` y con el formulario montado | JC6 |
| C2 | Con el `PUT /contacto` retenido: `contacto-form` en `guardando`, `aria-busy="true"`, `contacto-guardando` presente, `contacto-guardar` con `disabled`, **y** un clic forzado no genera un segundo `PUT` (contado por intercepción durante la espera de ausencia) | mirar sólo `[disabled]` es la ceguera K16 de la 63 |
| C3 | `GET /contacto` forzado a 500 → `contacto-region` en `error`, `contacto-carga-error` y `contacto-carga-reintentar`, **sin** `contacto-form`. El reintento (ya sin forzar) deja `listo` con los campos llenos del `GET` | JC12; titular con contacto previo |

### Ver (V) — CA1

| # | Qué afirma |
|---|---|
| V1 | Titular nuevo → los 7 campos con `value === ""` (ninguno `"null"`), `contacto-email` con `value` igual al email del registro y con **atributo** `readonly`, y `contacto-email` **fuera** de `contacto-form` |

### Guardar (G) — CA2, CA4, CA5

| # | Qué afirma |
|---|---|
| G1 | **CA2** · Titular nuevo, se escriben los 7 datos de referencia y se pulsa `contacto-guardar` → **un** `PUT`, cuerpo con **exactamente** las 7 claves de JC3 (sin `email`) y los valores tecleados; `200`; `contacto-form` en `guardado`; `contacto-guardado` aparece **dentro** de `contacto-aviso` (`role="status"`) y, mientras está, el foco **no** está dentro de `contacto-aviso` (no roba el foco; D119-3) y un campo acepta lo que se teclea (no bloquea); **desaparece solo** antes del tope, sin que nadie lo cierre. Por el API, `GET /contacto` trae los 7. **Tras recargar la página** y volver a entrar, los 7 campos muestran los datos guardados |
| G2 | **CA4** · nombre = `  Ana  ` → el cuerpo del `PUT` lleva `"  Ana  "` **sin recortar** (JC4); tras el `200` el campo muestra `Ana` (JC8) y el API devuelve `Ana` |
| G3 | **CA5** · teléfono = `fono-ABC` → `200`, el API guarda `fono-ABC` y el campo lo muestra igual |
| G4 | Titular con contacto previo → al entrar los 7 campos muestran el contacto previo. Se cambia **sólo** la ciudad y se guarda → el `PUT` lleva los 7 valores (los otros 6 con el valor previo) y el API devuelve el previo con la ciudad nueva |

### Borde y errores (B) — CA3

Cada rechazo, con el titular del contacto previo, afirma: el `PUT` **salió** (intención, D80-3), el
`400`, `data-codigo` y `contacto-codigo-error` con el código esperado, `contacto-form` en `error`, los
campos con lo tecleado (JC10), **y** `GET /contacto` igual al contacto previo.

| # | Qué afirma |
|---|---|
| B1 | **Los 7 campos a la vez en su máximo exacto** → `200` y el API los devuelve |
| B2 | **Cada campo en máximo + 1**, con los otros 6 válidos → su código propio (7 sub-casos) |
| B3 | **Cada campo vacío** (`""`), con los otros 6 válidos → su código propio (7 sub-casos); el cuerpo lleva la clave con `""` (JC4) |
| B4 | nombre = **sólo espacios** → `CONTACTO_NOMBRE_INVALIDO` |
| B5 | **Precedencia:** dirección vacía **y** teléfono en máximo + 1 a la vez → **`CONTACTO_DIRECCION_INVALIDA`** |

### Cliente sin validación (E) — CA6

| # | Qué afirma |
|---|---|
| E1 | Sobre el DOM renderizado: `contacto-form` lleva `novalidate`; ninguno de sus 7 campos trae `required`, `pattern`, `minlength` ni `maxlength` (ni como atributo ni como propiedad > −1); los 7 tienen **atributo** `type="text"` |

### Sin respuesta (I) — JC11

| # | Qué afirma |
|---|---|
| I1 | El `PUT` llega al backend (`route.fetch`) y su respuesta se pierde (`route.abort`): `contacto-sin-respuesta` visible, `contacto-form` en `sin-respuesta`, **sin** `contacto-error` ni `data-codigo`, `contacto-guardar` habilitado. Volver a pulsarlo → otro `PUT` → `guardado`, y el API trae los datos |

### Accesibilidad (A)

| # | Qué afirma |
|---|---|
| A1 | Los 8 campos (7 + email) tienen `<label for>` que apunta a un `id` **que existe**; `contacto-error` y `contacto-sin-respuesta` tienen `role="alert"`; `contacto-aviso` tiene `role="status"` y está montado **antes** de guardar |

### 5.1 · Los ocho candados que esta unidad rompe, y la enmienda prevista

`nav-contacto` está en la barra de **toda** vista autenticada y no está en ninguna lista blanca, así que
los ocho candados se ponen **rojos** en su auditoría de testids. Es la misma enmienda de Pagos § 5.1,
sumando ahora `S-17-testids-contacto.txt` en el mismo lugar donde se sumó `S-17-testids-pagos.txt`
(verificado en disco):

| Candado | Dónde se sumó la lista de Pagos |
|---|---|
| `verificar:s10-t2` (31) | `UNION_POSTERIORES`, `:45` |
| `verificar:s10-t3` (56) | `UNION_POSTERIORES`, `:50` |
| `verificar:s10-t4` (78) | `LISTA_S17PAG` `:65` y el filtro de `sobran` `:3289` |
| `verificar:s17-boletas` (42) | `LISTA_S17PAG` `:59`, `UNION_T4_S17` `:61` |
| `verificar:s17-abrir-cuenta` (18) | `LISTA_S17PAG` `:44`, `UNION` `:46` |
| `verificar:s17-transferir` (19) | `UNION`, `:142` |
| `verificar:s17-movimientos` (23) | `UNION`, `:144` |
| `verificar:s17-pagos` (24) | `UNION`, `:109-115` (candado nuevo) |

**Lo que FALTA se sigue midiendo como hoy, y un testid ajeno sigue poniendo rojo cada candado.** No se
relaja ninguna aserción: se actualiza el contrato versionado (C3). La enmienda **requiere la aprobación
del humano** y se calibra: cada candado enmendado tiene que ponerse rojo si se le cuela un testid que no
está en ninguna lista (**8/8**, como la `7/7` de Pagos).

---

## 6 · Defectos de calibración (fijados antes de medir)

| # | Defecto inyectado | Debe poner ROJO | Debe seguir VERDE |
|---|---|---|---|
| K1 | Un `null` del `GET` se pinta como `String(valor)` | **sólo V1** | G4 |
| K2 | El `PUT` lleva también `email` (el mismo del titular: el API lo acepta) | **sólo G1** (claves del cuerpo) | G2–G4, B1 |
| K3 | Los 7 campos llevan `maxlength` = su máximo | **E1 y B2**, y **B5** (su teléfono de 21 se corta a 20 y el cuerpo ya no lo lleva; D121-1) | B1, B3, B4 |
| K4 | `contacto-form` pierde `novalidate` y los campos llevan `required`; el envío pasa por el `(submit)` del form con la validación nativa | **E1, B3 y B5** (B5 lleva la dirección vacía), y **A1** por arrastre: `required` bloquea el envío y no se monta `contacto-error` (D121-1) | B1, B2, **B4** (los espacios satisfacen `required`) |
| K5 | El cliente hace `trim` antes de enviar | **G2 y B4** (cuerpo; D119-1) | G1 |
| K6 | Tras el `200` los campos se quedan con lo tecleado y no con la respuesta | **sólo G2** (campo) | G1, G3 |
| K7 | `telefono` se envía con el valor de `codigoPostal` | **G1, G3, G4, y B2 y B3 sólo en su sub-caso teléfono** (en el de código postal la precedencia saca `CODIGO_POSTAL` primero), y **B5** (también afirma el teléfono de 21 en el cuerpo) e **I1** (relee la API y encuentra el teléfono equivocado) (D121-1) | V1, E1, B1 (en el máximo los dos valen `'a'.repeat(20)`) |
| K8 | `contacto-guardado` no se quita nunca | **sólo G1** | G2, G3 |
| K9 | `contacto-guardar` no se deshabilita durante el guardado | **sólo C2** | C1 |
| K10 | El fallo de `GET /contacto` se muestra como formulario vacío en `listo` | **C3**, y **N3** por arrastre: no se monta `contacto-carga-error` ni `contacto-carga-reintentar` | C1, V1 |
| K11 | La región no declara la carga: durante `cargando`, `contacto-region` expone `data-estado="listo"` y no pone `aria-busy` (el formulario sigue sin montarse hasta que llegan los datos). **D121-2** reemplaza al K11 original («se monta el formulario vacío y se llena después»), cuyo arrastre no era determinista: la carrera con el `GET` tardío dio I1 rojo/B1 verde en una corrida y al revés en la otra; esa carrera queda como deuda | **C1**, y **C3** por arrastre: tras reintentar, la región dice `listo` antes de montar `contacto-form` y el brazo lee campos que no existen (D121-3) | V1 |
| K12 | Sin respuesta de red se pinta `contacto-error` con un código | **I1**, y **N3** por arrastre: no se monta `contacto-sin-respuesta`; y **A1** por la misma causa (no hay `role` que leer; D121-1) | B1–B5 |
| K13 | Un testid ajeno (`contacto-extra`) se cuela en la plantilla | **sólo N3** | los demás |
| K14 | `nav-contacto` se monta **dentro** de `nav-cuentas-menu` (la inyección que K16 de Pagos midió exacta; dentro de `nav-usuario-menu`, cerrado por defecto, el clic de entrada se agotaría y arrastraría a todos los brazos) | **sólo N1** | N3 |
| K15 | Los campos pierden su `<label for>` | **sólo A1** | los demás |
| K16 | Guardar **no** hace el `PUT` y marca `guardado` igual | **G1–G4, B1–B5, C2 e I1**, y **N3** por arrastre: no se montan `contacto-error`, `contacto-codigo-error`, `contacto-guardando` ni `contacto-sin-respuesta`; y **A1** por la misma causa (D121-1) | N1, N2, C1, C3, V1, E1 |
| K17 | `nav-contacto` se monta en `nav-panel` **antes** de `nav-boletas` (hermana, primer nivel, orden cambiado) | **sólo N1** (D119-2) | N2, N3 |
| K18 | Al insertar `contacto-guardado`, el aviso toma el foco (`tabindex="-1"` + `focus()`) | **sólo G1** (D119-3) | G2, G3 |

**K3/K4 son un par a propósito:** cada uno debe cazar un conjunto **distinto** de brazos de B (B2
frente a B3). **K5/K6 caen sobre el mismo brazo G2 por dos afirmaciones distintas** (cuerpo frente a
campo): el log de F5 tiene que mostrar cuál de las dos cayó. **K3, K4, K7, K10, K12 y K16 caen sobre más
de un brazo, declarado antes de medir.**

**Enmiendas de la F3d (aprobadas antes de medir):** **D119-1** B4 conserva su aserción del cuerpo sin `trim` y la
fila K5 pasa a «G2 y B4» (hallazgo 2); **D119-2** N1 exige el orden de JC1 (hallazgo 4); **D119-3**
G1 exige que el foco no quede dentro de `contacto-aviso` (hallazgo 1). Las tres agrandan el árbitro;
ninguna lo debilita.

**D121-1 (con el resultado a la vista):** la 1.ª medición dio **13/19 exactos**. Los 6 no exactos (K3, K4, K7, K11, K12, K16) eran cazas
reales o arrastre de un elemento que el defecto no monta, no fallas del árbitro: se declaran en su
fila con la causa. En tres filas la predicción de verdes estaba mal y se corrige (B5 en K7, C3 en K11,
A1 en K16). No se toca el árbitro ni se relaja ninguna aserción; se publican los dos números.

**D121-3 (con el resultado a la vista):** el K11 de D121-2 midió **C1 + C3**. C3 cae por arrastre de causa fija —es el daño que el defecto
representa: una suite que confía en el estado declarado queda engañada (costura C4)— y se declara en la
fila. Condición para darlo por exacto: **dos corridas más de K11 que den exactamente C1 + C3**. No se
toca el árbitro.

**Sonda de ceguera declarada (su verde se escribe antes de medir):**

| # | Cambio | Deben seguir VERDES | Árbitro que sí lo mira |
|---|---|---|---|
| K20 | Se cambia la prosa de `contacto-guardado`, de `contacto-sin-respuesta` y del mensaje de error | **los 19** | el ojo del humano sobre la captura (C5) |

---

## 7 · Batería que no debe moverse

Última medición, el día del merge de Pagos. **Se re-mide el día de
la entrega:** `typecheck` · `guante` · `test:domain` · `test:integracion` · `invariantes` ·
`invariantes:calibrar` · `demo:m6` (la barra cambia). Los ocho candados de § 5.1 se corren con su
enmienda y el número real va al cierre.

---

## 8 · Alcance de archivos (declarado antes de empezar)

**F4a toca sólo esto:** `web/src/app/app.html` (entrada de barra y vista) ·
`web/src/app/app.ts` (estado, carga, guardado, aviso efímero) · `web/src/styles.css` (lo visual,
dirección de la 28; en teléfono los 7 campos no se recortan).

**F2 escribe:** `scripts/verificar-s17-contacto.mjs` y su `.sh`, y la línea de `package.json`.
**F4b escribe:** las ocho enmiendas de § 5.1 y nada más.
**Fijados antes de la entrega:** esta spec y `specs/S-17-testids-contacto.txt`.

**Nadie toca:** `src/` (S-14 ya está), las migraciones, `zfb-dialogo.ts`, las costuras del reloj, ni las
pantallas de Transferir, Boletas, Abrir cuenta, Movimientos y Pagos.

---

## 9 · Lo que se midió antes de escribir esta spec

| Qué | Dónde se verificó |
|---|---|
| Contrato real de `GET`/`PUT /contacto`, `trim`, precedencia y máximos | `src/modules/contacto/contacto.service.ts:15-24, 30-47, 91-102` |
| `EMAIL_NO_MODIFICABLE` sólo si llega un email **distinto** | `contacto.service.ts:91` (por eso K2 no lo gatilla) |
| Status 400 de los 8 códigos | `src/infra/errores-http.filter.ts:169-177` |
| CORS deja pasar `PUT` (métodos por defecto de `enableCors`) | `src/main.ts:12-18` |
| El registro deja los 7 en `null` (sólo crea `email`, `passwordHash`, `creadoEn`) | `src/modules/auth/auth.service.ts:182-188` |
| Barra actual y menú de usuario (abre con clic, `aria-expanded`) | `web/src/app/app.html:93-153` |
| Las ocho listas blancas de § 5.1 | `grep testids-pagos scripts/verificar-*.mjs` |
