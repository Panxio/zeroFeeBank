# S-15 · Pago a terceros (Bill Pay)

> Escrita el 2026-09-09: la spec, el arnés y el calibrador van antes de la implementación.


## 7 · Piezas que YA existen y se reusan (no se reimplementan)

| pieza | dónde | para qué |
|---|---|---|
| `TransferenciasService.transferirEn(tx, p)` | `src/modules/transferencias/transferencias.service.js` | **el motor de dinero.** Hace el asiento de 2 movimientos, el bloqueo ordenado por id (D4), la derivación del saldo dentro de la transacción y el `FONDOS_INSUFICIENTES`. Acepta `concepto`: se le pasa `PAGO_SERVICIO`. **Escribir un asiento a mano en vez de llamarlo es un defecto**, no una alternativa |
| `IdempotenciaEjecutor.ejecutar(...)` | `src/infra/idempotencia.ejecutor.js` | D5 entero: clave, huella sha256, respuesta guardada, 409 por huella distinta. Se usa con `huellaDe` incluyendo `titularId` (J6) y con `operacion: async (tx) => ...` para que todo caiga en la misma transacción (J11) |
| `CuentasSistemaRepository.obtenerOCrear(tx, codigo)` | `src/infra/cuentas-sistema.repository.js` | resuelve `CAJA` con `INSERT ... ON CONFLICT DO NOTHING`. **Único lugar del sistema donde se obtiene una cuenta de sistema**: duplicar el mecanismo ya produjo un 500 |
| `CODIGO_CUENTA_CAJA` | `src/modules/cuentas/cuentas.constants.js` | la etiqueta `'CAJA'`. Se importa, no se reescribe |
| `AuthService.yo(authorization)` | `src/modules/auth/auth.service.js` | token → `{ id, email }`. Lanza los tres errores 401 ya mapeados |
| `formatMoney` / el parseo de monto | `src/domain/` | D1: string decimal ↔ `bigint` en centavos. **No se reimplementa con `Number()`** |
| `ErroresHttpFilter` | `src/infra/errores-http.filter.js` | ya traduce **todos** los códigos de esta spec. **No se toca** |
| `UUID_REGEX` | `src/modules/cuentas/cuentas.constants.js` | la forma del uuid, ya usada por S-12, S-13 y S-18 |

---

## 8 · La calibración: qué defecto pone rojo a qué brazo

Los brazos van **codificados** (`A1 · …`, `C3 · …`): el calibrador los identifica por ese
prefijo y sin él no puede declarar nada.

**Los grupos:**

| grupo | qué mide |
|---|---|
| **A** | `POST /pagos` camino feliz y forma de la respuesta |
| **B** | el ledger: partida doble, 2 movimientos exactos, saldos, concepto |
| **C** | validación de los nueve campos y su precedencia |
| **D** | idempotencia (D5): replay, huella distinta, otro titular |
| **E** | auth y aislamiento: token, titular del token, cuenta ajena |
| **F** | `GET /pagos` |
| **G** | **controles que NO dependen de S-15** y deben quedar VERDES sin ella. Son **cinco**: dos nacieron acá (G4 y G5), reclasificados por la propia calibración por ausencia |

**El arnés pasó de 47 a 53 brazos**, por el ataque a ciegas de § 8.2:
A 6 · B 5 · **C 17** · **D 6** · **E 9** · **F 5** · G 5.

El grupo **G** ya es patrón del repo: sin controles, «todo
rojo» no tiene contra qué leerse.

### La mitad cara: `npm run calibrar:s15`, sobre la entrega

Las **anclas** de cada parche se completan sobre el código entregado. Los **brazos**
se fijan **ahora**, antes de implementar:

| # | defecto inyectado | brazos que DEBEN ponerse rojos | y que DEBEN seguir verdes |
|---|---|---|---|
| L1 | el token del POST deja de rechazar: `AuthService.yo(...)` en un `try/catch` que devuelve un titular vacío | **E1, E2, E3, E4** | **G1–G5**, todo A/B/C/D, y **F4** — el parche es del POST, el GET conserva su puerta |
| L2 | el titular sale del cuerpo si viene: `cuerpo.titularId ?? titular.id` (rompe J3) | **E5** | todos los demás |
| L3 | la cuenta ajena responde 403 en vez de 404 (rompe J4) | **E6, E7** | el resto. **E7 va declarado**: compara la ajena con la inexistente, así que un 403 en una de las dos lo rompe por construcción |
| L4 | el asiento acredita una cuenta que **no es la CAJA** | **B2, B4** | **B1 y B3** — la suma sigue siendo 0 y siguen siendo 2 movimientos |
| L5 | **comisión silenciosa**: un tercer movimiento que debita 1 centavo extra al origen y lo acredita a la CAJA (rompe N3, V3) | **B3, B4, A6, D1, F2** (D1 y F2 añadidos tras medir) | **B1 sigue VERDE**: la transacción suma 0 con tres movimientos. Ésta es la razón de existir de B3 |
| L6 | el asiento sólo debita y no acredita (rompe D2) | **B1, B2, B3, B4, C13** (C13 añadido tras medir) | los de validación y auth |
| L7 | `titularId` sale de la huella de idempotencia (rompe J6) | **D4** | D1, D2, D3, D5 |
| L8 | el replay vuelve a ejecutar (rompe J7) | **D1, D5** | D2, D3, D4 — un replay que re-ejecuta deja dos filas Y mueve el saldo dos veces |
| L9 | se quita la validación de `beneficiarioNombre` | **C1, C2, C4, C16, C17, A4** | **C3** — el máximo exacto se acepta con validación y sin ella |
| L10 | la precedencia se invierte: los campos del beneficiario antes que el monto | **C11** | C1–C10 — el monto sigue rechazándose, sólo cambia quién gana |
| L11 | la fila `pago` y el asiento van en transacciones distintas (rompe J11) | ⚠️ **NO INYECTABLE sobre esta entrega — declarado, no aprobado.** Ver abajo | los códigos no cambian, sólo lo que queda escrito. Son los dos que censan la base tras un 4xx |
| L12 | `GET /pagos` no filtra por titular | **F1, F3, F5** | F2, F4. **F1 va declarado**: deja de recibir la lista vacía en cuanto exista un pago ajeno. **F5 también**: su lista esperada la deriva de las filas del titular, así que se rompe en cuanto entren pagos ajenos |
| L13 | el `monto` sólo se valida si el campo viene: `if (cuerpo.monto !== undefined) validar(...)` | **C15**, y sólo C15 | C8, C9, C10, C11 — los cuatro mandan el campo, y su validación no cambia |
| L14 | `cuerpo.cuentaOrigenId ?? primeraCuentaDelTitular` | **E9**, y sólo E9 | E6, E7, E8 — los tres mandan el campo con un valor malo, y ése sigue rechazándose |
| L15 | los campos del beneficiario se validan con `.trim()` **sin comprobar `typeof`** | **C17** | C1–C7, C16 — todos mandan strings, y un `TypeError` sólo lo dispara el no-string |
| L16 | la huella omite los campos del beneficiario: `huellaDe: { titularId, cuentaOrigenId, monto }` | **D6**, y sólo D6 | D1–D5 — **D2 incluido**, que varía el MONTO y sigue chocando; es justo la razón por la que D6 tuvo que existir |
| L17 | `GET /pagos` con `orderBy: { pagadoEn: 'asc' }` | **F5**, y sólo F5 | F1–F4 — ninguno mira el orden |
| L18 | los siete campos del beneficiario se validan en orden INVERSO al de la tabla | **C16** | C1–C7, C11 — con un solo campo malo gana ése, sea cual sea el orden del recorrido |

### La corrida del 2026-09-09, y las seis correcciones que obligó

Las anclas se completaron sobre la entrega. **La primera corrida dio 13/19**, y los
seis fallos se diagnosticaron caso por caso en vez de ajustar el número. **El script es la
versión vigente**; la tabla de arriba es la predicción escrita antes de tener nada que romper.

**Cinco eran predicciones INCOMPLETAS**, y en los cinco el rojo no declarado dependía
legítimamente de lo roto — la pregunta que manda es *«¿ese brazo depende de verdad de lo que
rompí?»*, y la respuesta fue sí las cinco veces:

| defecto | rojo no declarado | por qué depende de verdad |
|---|---|---|
| **L5** comisión de 1 centavo | `D1`, `F2` | `D1` afirma el saldo **exacto** tras el replay, y sobra un centavo. `F2` compara el monto del listado, que se **deriva del ledger**: con un movimiento de más en la misma cuenta, la derivación cambia |
| **L6** sólo debita | `C13` | el parche saltea `transferirEn`, y **el `FONDOS_INSUFICIENTES` lo lanza ese motor**: sin él, el pago que excede el saldo responde 201 |
| **L9** sin validación del nombre | `A4` | `A4` exige que los siete campos se guarden **trimmeados**, y un campo sin validar tampoco se recorta |
| **L12** el listado no filtra | `F2` | `F2` afirma `pagos.length === 2`, y sin filtro entran los pagos de los demás titulares |
| **L15** `.trim()` sin `typeof` | `C1`, `C5` | los dos mandan campos **ausentes**: `undefined.trim()` revienta igual que un número, y el 400 se vuelve 500 |

**Y el sexto no es una predicción incompleta: es un defecto que NO SE PUEDE INYECTAR**, y se
declara en vez de sustituirlo por otro que calce.

> **L11 · la fila `pago` y el asiento en transacciones distintas.** El intento obvio
> —`this.prisma.pago.create` en vez de `tx.pago.create`— puso rojos **23 de 53** brazos y dejó
> `C12` y `C13` **verdes**, que es el peor resultado posible: la FK `pago → transaccion` apunta
> a una fila que vive en la transacción sin commitear, la conexión de fuera no la ve, y **todo
> pago falla**. Eso no es «perdió la atomicidad», es «la app dejó de funcionar» — la deuda
> abierta de `D8` en `calibrar-s13.sh`, repetida.
>
> **Y hay una razón de fondo, que es el hallazgo:** en esta entrega los dos rechazos que `C12`
> y `C13` miden ocurren **antes** de que se escriba la fila `pago`. El 400 lo lanza el
> controlador sin tocar la base; el `FONDOS_INSUFICIENTES` lo lanza `transferirEn`, que corre
> **antes** de `pago.create`. Con ese orden **ninguna separación de transacciones es observable
> por esos dos brazos**. No es que el arnés esté ciego: es que la entrega hace **imposible el
> estado** que el defecto quería producir.
>
> **Queda abierto y se dice:** `C12` y `C13` siguen **sin un defecto que los pruebe**. Siguen
> siendo buena guardia de regresión, pero *un brazo sin un defecto que lo pruebe no es un
> brazo*, y darlos por buenos sería justo lo que esta tabla existe para impedir.
>
> Para esto nació `declarar_no_inyectable` en `scripts/lib/calibrador.sh`: **suma al total y no
> al aprobado**, así que el número que sale al final sigue siendo el número real.

**Resultado tras las correcciones: `calibrar:s15` → 18/19, con L11 declarado.**

> **Seis defectos nuevos (L13–L18) para los seis brazos nuevos.** La regla del
> repo es *un brazo sin un defecto que lo pruebe no es un brazo*: un brazo que llega
> por un ataque a ciegas no está exento. Y son **estrechos a propósito**, uno o dos brazos cada
> uno: la deuda abierta de `D8` en `calibrar-s13.sh` —29 rojos de 57— es la prueba de que un
> defecto que tumba medio arnés no demuestra que ningún brazo mida nada en particular.

### 8.2 · El ataque a ciegas, y los dos brazos que eran IMPOSIBLES de pasar

Un ataque a ciegas sobre el arnés entregó **8 hallazgos de 13 mirados** y un **bloqueo**. Se
verificaron uno por uno: **8 de 8 ciertos**, y el bloqueo traía **dos contradicciones reales**.

**Las dos del bloqueo son la razón por la que esto se corre ANTES de implementar**, porque las dos
eran brazos que **ninguna entrega correcta podía poner en verde**:

| # | qué decía el arnés | qué dice el resto del repo | qué se hizo |
|---|---|---|---|
| **B1** | `C13` exigía **422** `FONDOS_INSUFICIENTES` | `errores-http.filter.ts:97` lo traduce a **409** desde S-05, y `cuentas` C7 y `test/idempotencia.int.spec.ts` ya lo exigen así. El filtro está **fuera del alcance** de la entrega | **dato corregido a 409** en la spec y en el brazo. No es una relajación: es el número correcto, y estaba mal en la spec |
| **B2** | `D4` exigía **201** al segundo titular con la misma clave | `clave` es única en todo el sistema y el ejecutor devuelve **409** en cuanto la huella difiere. `cuentas` D3 y `boletas` C5 lo fijan así | **D4 reescrito**, y ver abajo |

**Y verificando B2 apareció lo peor, que el ataque no vio: `D4` era CIEGO a `L7`, el
defecto que decía cazar.** Le daba a cada titular **su propia cuenta**, así que los cuerpos ya
diferían y la huella ya era distinta **sin** `titularId`: el brazo respondía 409 en los dos
mundos. Es **exactamente** el defecto que S-18 se comió y corrigió en su `B10` —que nació ciego y
se corrigió antes de implementar— reproducido tal cual.
El D4 nuevo usa el **mismo cuerpo** para los dos titulares, que es lo único que distingue una
huella con `titularId` de una sin él.

**Los ocho hallazgos, todos aplicados:**

| # | el hueco | qué se hizo |
|---|---|---|
| H1 | `F2` comprobaba las **claves** del objeto con `Object.keys` y nunca el **valor** de `monto` — y `monto` es el único campo que **no existe** en la tabla `pago`: hay que derivarlo del ledger. Un `{ ...fila, monto: '0.00' }` pasaba en verde | `F2` **endurecido**: casa cada id con su monto |
| H2 | `D2` medía la colisión de huella variando el **monto**: una huella sin los campos del beneficiario pasaba, y un reintento con otro destinatario devolvía 201 con el pago anterior | **`D6` nuevo** + **`J12`**, que declara qué compone la huella |
| H3 | `cuentaOrigenId` **ausente** está en la tabla de errores y ningún brazo quitaba el campo | **`E9` nuevo** |
| H4 | `monto` **ausente**, ídem | **`C15` nuevo** |
| H5 | `E1`–`E4` miraban sólo el 401 y **ninguno censaba la base**, que es la mitad de `V1` | los **cuatro endurecidos** con censo |
| H6 | la precedencia **entre campos del beneficiario** (paso 5) no la medía nadie: `C11` enfrentaba el monto contra el nombre | **`C16` nuevo**, y recorre la lista entera por pares adyacentes desde `CAMPOS` |
| H7 | el orden del `GET` está en el contrato y `F2` usaba `toContain`, que lo ignora | **`F5` nuevo**, con el orden **derivado** de las filas crudas para no ser intermitente |
| H8 | `C2` probaba `'   '` **sólo** en `beneficiarioNombre`, y la spec dice «un campo del beneficiario» | `C2` **endurecido** a los siete |

**Y uno más, de la misma familia**, mirando lo que el ataque descartó como observación menor:
ningún brazo mandaba un **no-string** en los campos del beneficiario, aunque la tabla de errores
dice «ausente, **no-string**, vacío tras trim, o > máximo». Es literalmente el hallazgo H2 de
S-14. **`C17` nuevo**, los siete campos. Y `D3` pasó a probar también la
`Idempotency-Key` **vacía**, que la tabla lista y el brazo no cubría.

> **Tres de las nueve son la misma forma** (*el caso se probó en UNA instancia y se
> creyó probado en todas*): H6, H8 y C17. Sigue siendo la forma más abundante de la serie.

> **Esta tabla es una PREDICCIÓN, y la segunda mitad de la biblioteca es lo que la
> pone a prueba.** La lección se pagó migrando
> `calibrar-s13.sh`: su tabla se escribió bajo un `probar` que sólo miraba una mitad, nunca
> necesitó ser exhaustiva, y con el contrato estricto dio **5/8** — tres defectos con rojos
> legítimos sin declarar. Por eso acá se declaran también los rojos «de segundo orden» (E7 en
> L3, A6 en L5, F1 en L12, D1 en L8) en vez de nombrar sólo el brazo más obvio.

**L5 es el brazo que justifica la pregunta N3.** Sin B3 —«la transacción tiene exactamente 2
movimientos»— una comisión silenciosa pasaría en verde: la suma seguiría siendo 0 y I1 no diría
nada. Es la diferencia entre «decidimos que no hay comisión» y «podemos demostrar que no la hay».

### 8.1 · La calibración por ausencia — se corre ANTES de implementar

**Se corre apenas el arnés compile, no al final.** Es un hallazgo de método: en
S-14 cazó dos brazos que se aprobaban solos en tres segundos, antes de gastar una implementación.

**Lectura esperada:** todo lo que toca `/pagos` en rojo por el 404 de Nest; **G1 y G2 verdes**.
**Cualquier otro verde es un brazo que se aprueba solo**, y en S-15 la familia peligrosa es la
ya advertida: **casi todos los brazos del grupo B comparan el ledger antes y
después de un pago.** Si no exigen que el pago haya devuelto **201**, miden la ausencia de
acción y no la ausencia de efecto, y en verde esas dos cosas se ven idénticas.

**Resultado medido el 2026-09-09, y leído caso por caso: 42 rojos / 5 verdes de 47.**
Los cinco verdes son **exactamente G1, G2, G3, G4 y G5**.

**Pero la primera corrida dio 41 rojos / 6 verdes, y los tres verdes de más fueron el hallazgo**
—la tercera vez consecutiva que esta mitad barata paga antes de gastar una implementación—:

| brazo | qué decía medir | por qué pasaba con el módulo sin escribir | qué se hizo |
|---|---|---|---|
| **E7** | que la cuenta ajena y la inexistente responden **exactamente lo mismo** (J4) | exigía 404 en las dos y que los cuerpos fueran iguales. Con la ruta ausente, las dos recibían el **404 de enrutado de Nest**, eran idénticas, y el brazo se aprobaba solo. **Misma familia que el hallazgo de S-14**: comparaba dos cosas sin exigir que ninguna fuera la correcta | **ENDURECIDO**: ahora exige `CUENTA_NO_ENCONTRADA` en las dos antes de compararlas |
| **B5** | que el saldo inicial es el que S-12 fondea | **nunca pagaba nada.** Honesto, pero no depende de S-15: estaba en el grupo del ledger ensuciando la lectura de «todo rojo salvo G» | **MOVIDO a G4.** Sigue siendo valioso —fija el punto de partida que A6, D1 y D5 dan por sentado— pero es un control |
| **C11** | que un JSON no parseable da `400 CUERPO_INVALIDO` | el **parser de cuerpo y el filtro global responden ANTES de enrutar**, así que no mide a S-15 sino a la infraestructura | **MOVIDO a G5.** Se queda porque una entrega que registrara su propio parseo y se tragara el `SyntaxError` lo pondría rojo — que es lo que hace un control. **Un brazo que no puede fallar por culpa de la unidad no es un brazo de la unidad** |

> El mismo defecto de C11 apareció **a la vez** en el arnés de S-14 (su C10, nacido del
> hallazgo H1 del ataque a ciegas): también verde sin el módulo, por la misma razón, y también
> movido a su grupo G. Es una familia, no un descuido suelto: **todo brazo que dependa de una
> respuesta que la infraestructura ya garantiza es un control, aunque la spec lo liste.**

---

## 9 · Cómo se corre el árbitro

```
npm run test:billpay      # S-15 por HTTP
npm run calibrar:s15      # los 12 defectos L1–L12 (exit 1 mientras no exista el módulo)
npm run invariantes       # I1–I5 · PARTE DEL ÁRBITRO DE ESTA UNIDAD, no un extra
npm run guante            # las 6 compuertas duras
npm run typecheck         # exit 0
```
