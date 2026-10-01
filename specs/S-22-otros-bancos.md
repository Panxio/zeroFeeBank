# S-22 · Transferencia a otro banco: catálogo, tope diario de 200,00 y consulta de solo lectura

> Sale de `specs/HU-01-tipos-de-transferencia.md` (R5–R11, V5–V6, CA7–CA20, J1–J10, § 7, § 8).
> 2026-09-14. Candado: `specs/_CANDADO.md`.
> Molde: **S-15 Bill Pay** (`src/modules/pagos/`): POST idempotente que mueve plata hacia una
> cuenta de sistema por el motor auditado (`TransferenciasService.transferirEn`), fila de
> documento en la misma transacción, monto derivado del ledger. Lo nuevo es el tope.

## 1 · Qué hace

`POST /transferencias/otros-bancos` debita la cuenta origen del titular del token y acredita la
cuenta de sistema `OTROS_BANCOS` (J10), en una transacción del ledger que suma 0 (CA7), sin
comisión (R8, CA18). Guarda banco, número y tipo de la cuenta de destino como texto histórico
(R5). Rechaza la transferencia **completa** si con ella la cuenta origen pasa de **200,00 USD**
transferidos a otros bancos en el día UTC del reloj inyectado (R9, J1–J3).
`GET /transferencias/otros-bancos/:id` la devuelve, solo lectura, al titular de la cuenta origen;
a cualquier otro, `404` (R7, J8).

## 2 · Constantes (todas con origen; ninguna inventada)

| Constante | Valor | Origen |
|---|---|---|
| `TOPE_DIARIO_OTROS_BANCOS_CENTAVOS` | `20000n` (200,00 USD) | R9 |
| Catálogo de bancos (código) | `ASERCION`, `FIXTURE`, `STUB`, `SANDBOX`, `MOCK` | R10, juego A |
| Nombre visible | Banco Aserción · Banco Fixture · Banco Stub · Banco Sandbox · Banco Mock | ídem; **no viaja en la API de esta spec** (§ 7) |
| Número de cuenta externa | `^[0-9]{1,20}$`, string | J6 |
| Tipo de cuenta externa | `CORRIENTE` \| `AHORRO` | J4 |
| Día del tope | `[00:00:00.000Z, 00:00:00.000Z del día siguiente)` del reloj inyectado | J1 |
| Código de la cuenta de sistema | `OTROS_BANCOS` | J10 → fijado aquí (J11) |
| Concepto del asiento | `TRANSFERENCIA_OTRO_BANCO` | fijado aquí (J11); se versiona en `scripts/invariantes.sh`, en las **dos** listas (es un POST que mueve plata: D5) |
| Endpoint de idempotencia | `POST /transferencias/otros-bancos` | patrón de S-15 |

## 3 · Contrato

### 3.1 · `POST /transferencias/otros-bancos`

Cabeceras: `Authorization: Bearer …`, `Idempotency-Key` (1–200 tras recortar, como S-06).
Cuerpo:

```json
{ "cuentaOrigenId": "<uuid>", "monto": "50.00", "banco": "ASERCION",
  "numeroCuenta": "000123", "tipoCuenta": "AHORRO" }
```

**Precedencia de validación (fijada; con dos fallas gana la primera de la lista):**

| Paso | Falla | Respuesta |
|---|---|---|
| 1 | token ausente, inválido o vencido | `401` (códigos de S-08) |
| 2 | `Idempotency-Key` ausente o vacía · > 200 | `400 IDEMPOTENCY_KEY_AUSENTE` · `400 IDEMPOTENCY_KEY_INVALIDA` |
| 3 | cuerpo que no parsea | `400 CUERPO_INVALIDO` (filtro global) |
| 4 | `monto` no string, no parsea, ≤ 0 o con más de 2 decimales | `400 MONTO_INVALIDO` (D6, CA20) |
| 5 | `cuentaOrigenId` ausente, no string o no UUID | `404 CUENTA_NO_ENCONTRADA`, sin tocar la base (S-15 J4) |
| 6 | `banco` no string o fuera del catálogo, **exacto**: sin `trim`, sin mayúsculas | `400 BANCO_NO_PERMITIDO` |
| 7 | `numeroCuenta` no string o no cumple `^[0-9]{1,20}$` (sin `trim`) | `400 NUMERO_CUENTA_EXTERNA_INVALIDO` |
| 8 | `tipoCuenta` no string o no es `CORRIENTE`/`AHORRO` exacto | `400 TIPO_CUENTA_EXTERNA_INVALIDO` |
| 9 | (idempotencia) misma clave con otra huella | `409 IDEMPOTENCY_KEY_REUSADA`; con la misma huella, **replay**: el `201` guardado + `Idempotency-Replayed: true`, **antes** de mirar el tope |
| 10 | origen inexistente, ajeno, o cuenta `SISTEMA` | `404 CUENTA_NO_ENCONTRADA`, indistinguible entre los tres (S-18 J4) |
| 11 | acumulado del día + monto > 200,00 | `409 TOPE_DIARIO_EXCEDIDO` (J9) |
| 12 | saldo + límite de sobregiro < monto | `409 FONDOS_INSUFICIENTES` (lo lanza el motor) |

Pasos 10–12 van **dentro** de la operación idempotente, en la misma transacción de BD que el
asiento y la fila.

**Huella de idempotencia:** `titularId`, `cuentaOrigenId`, `monto` (el string original),
`banco`, `numeroCuenta`, `tipoCuenta`.

**Respuesta `201`** (y la del replay, byte a byte), en este orden de claves:

```json
{ "id": "<uuid>", "transaccionId": "<uuid>", "cuentaOrigenId": "<uuid>", "monto": "50.00",
  "banco": "ASERCION", "numeroCuenta": "000123", "tipoCuenta": "AHORRO",
  "realizadaEn": "2026-10-01T12:00:00.000Z" }
```

`monto` es `formatMoney` de los centavos (dos decimales). `realizadaEn` es el instante del reloj
inyectado, el mismo del asiento (`transaccion.creada_en`) al milisegundo.

### 3.2 · `GET /transferencias/otros-bancos/:id`

`401` sin token. `200` con **el mismo cuerpo** que devolvió el `POST` si la cuenta origen es del
titular del token; el `monto` se **deriva del ledger** (débito del origen en la transacción), no
de una columna. Para un `id` inexistente, no UUID, de otro titular, o que sea el id de otra cosa
(una transferencia interna, un pago): `404 TRANSFERENCIA_NO_ENCONTRADA`, indistinguible entre
todos (J8). No hay `PUT`, `PATCH` ni `DELETE` (D3): esas rutas no existen.

## 4 · Datos

Tabla nueva `transferencia_otro_banco` (migración):
`id uuid PK` · `transaccion_id uuid UNIQUE FK → transaccion` · `cuenta_origen_id uuid FK → cuenta`
· `titular_id uuid FK → usuario` (copia de lectura, como `pago`) · `banco text` ·
`numero_cuenta text` · `tipo_cuenta text` · `realizada_en timestamp(3)`, todas `NOT NULL`,
**sin `DEFAULT` en la fecha**. Índices por `titular_id` y `cuenta_origen_id`.
**Sin columna de monto** (D2: vive en el ledger). Sin estado (J7).

`banco` y `tipo_cuenta` son `text` y no enums de Postgres: el catálogo vive en un solo lugar
(el dominio), y un enum en la base sería la segunda copia que se desincroniza.

## 5 · El tope y el bloqueo (D4)

El acumulado se lee **después** del `FOR UPDATE` de la cuenta origen y **antes** de escribir, en
la misma transacción. Leerlo antes deja los tests secuenciales verdes y el tope superado con dos
peticiones simultáneas (CA14), igual que el saldo en S-05.

Para no crear un segundo orden de bloqueo, el motor gana un gancho opcional
`Peticion.trasBloquear?: (tx) => Promise<void>` que corre **después de bloquear las cuentas en
orden de id y antes de derivar el saldo y comprobar fondos**. Por eso el tope precede a
`FONDOS_INSUFICIENTES` (paso 11 antes que el 12) sin código aparte. Ningún llamador actual lo
pasa: su comportamiento no cambia.

Acumulado del día (consulta del ledger, no de la tabla de documentos):
`SUM(-m.monto_centavos)` de los movimientos de la cuenta origen cuyas transacciones tienen
concepto `TRANSFERENCIA_OTRO_BANCO` y `creada_en` en `[desde, hasta)` del día UTC de `ahora`.

**Dominio puro** (`src/domain/transferencia/otros-bancos.ts`, delegable): catálogo, `esBanco`,
`esNumeroCuentaExterna`, `esTipoCuentaExterna`, `diaUtcDe(instante) → {desde, hasta}` (sin
`new Date()` vacío ni `Date.now()`: G2 del guante), y `assertDentroDelTope(acumulado, monto,
tope)` que lanza `TopeDiarioExcedidoError` (`codigo = 'TOPE_DIARIO_EXCEDIDO'`) si
`acumulado + monto > tope`. Todo en `bigint`.

## 6 · Decisiones de diseño

- **J11 · Nombres del contrato:** ruta `/transferencias/otros-bancos`, cuenta `OTROS_BANCOS`,
  concepto `TRANSFERENCIA_OTRO_BANCO`, códigos `BANCO_NO_PERMITIDO`,
  `NUMERO_CUENTA_EXTERNA_INVALIDO`, `TIPO_CUENTA_EXTERNA_INVALIDO`, `TRANSFERENCIA_NO_ENCONTRADA`.
- **J12 · El tope va antes que los fondos** (paso 11 antes que el 12): el tope es una regla de la
  operación, el saldo es el estado del momento. Es el mismo criterio de S-21 J2.
- **J13 · El replay va antes que el tope** (paso 9): un reintento de una transferencia que ya
  llenó el tope devuelve su `201`, no un `409`. Es D5: la misma respuesta, sin ejecutar de nuevo.
- **J14 · Validación exacta, sin normalizar** banco, número ni tipo: `"asercion"`, `" ASERCION"`
  y `"12 34"` son `400`. Es la regla de S-12 B4 con el tipo de cuenta.
- **J15 · El origen puede ser cualquier cuenta de cliente del titular** (`CORRIENTE`, `AHORRO`,
  `PRESTAMO`), igual que en `POST /transferencias` (R3, S-16 N4). Una `SISTEMA` no tiene titular
  y da `404` por la titularidad.
- **J16 · El GET sólo encuentra transferencias a otros bancos**, por el `id` de la fila (el que
  devolvió el POST), no por el `transaccionId`.

## 7 · No-goals

- Listar las transferencias a otros bancos (`GET` de colección): la HU pide consultar una (CA19).
- `GET /bancos` o el nombre visible en la respuesta: lo decide la unidad de la pantalla (R11).
- Tope en el mismo banco, por titular o global (R9); comisión (R8); rechazo del otro banco (J7).
- Cambiar `POST /transferencias`, `POST /pagos` o cualquier llamador actual del motor.

## 8 · Arnés — `test/otros-bancos.int.spec.ts`

Reglas del archivo (heredadas de `test/billpay.int.spec.ts` y `test/idempotencia.int.spec.ts`):
monta `AppModule` (el módulo nuevo no existe todavía); habla por HTTP y lee la base con Prisma
como oráculo independiente; **todo brazo que compare un antes con un después exige que el acto
del medio haya tenido el código esperado exacto** (el éxito pasa por un `transferirOk` que exige
`201`; un rechazo exige su `4xx` y su código, nunca «no 201»).

**A0 · Base y reloj conocidos (C1, C2).** `beforeAll` hace `POST /__test__/reset` (sin él, una `OTROS_BANCOS` de otra corrida vuelve verdes C4 y A3 bajo K13). `beforeEach` fija el reloj en
`2026-10-01T12:00:00.000Z` por `POST /__test__/reloj`; `afterAll` lo libera (`instante: null`).
Sin esto, una corrida cerca de medianoche UTC parte el día del tope y los brazos D salen
intermitentes. Los tokens nacen a la hora del reloj fijado (forjados con `exp` relativa a ese
instante, o por login tras fijarlo); tras mover el reloj, se renuevan. Cada brazo
usa titulares y cuentas propios, así el acumulado de uno no contamina a otro. **Las cuentas se
siembran por Prisma con un asiento `SIEMBRA_ARNES` contra una `SISTEMA` propia** (el patrón de
`cuentaConSaldo` de `test/idempotencia.int.spec.ts`), nunca fondeadas desde otra cuenta de
cliente: así ninguna cuenta nace con una salida que el acumulado pudiera contar. En el grupo A
ningún monto pasa de `50.00` ni una cuenta suma más de `100.00`.

| Brazo | Qué mide | CA / J |
|---|---|---|
| **A · éxito y ledger** | | |
| A1 | válida → `201`; cuerpo con las 8 claves en orden; `id`/`transaccionId` UUID; eco de banco, número y tipo; `monto` `"50.00"`; `realizadaEn` = reloj fijado | CA7 |
| A2 | exactamente 1 transacción nueva de concepto `TRANSFERENCIA_OTRO_BANCO` con 2 movimientos: −monto en el origen y +monto en la cuenta de `codigo = 'OTROS_BANCOS'`, `tipo = 'SISTEMA'`, `titular_id` nulo; suma 0; `creada_en` = `realizadaEn` | CA7, J10 |
| A3 | sin comisión: el saldo del origen baja exactamente el monto y ninguna otra cuenta del titular cambia; tras transferir a dos bancos distintos, hay **una sola** cuenta `OTROS_BANCOS` | CA18, J10 |
| A4 | fila `transferencia_otro_banco`: banco, número, tipo, origen, titular y `transaccionId` iguales a lo pedido; `"000123"` se guarda con sus ceros | J6 |
| A5 | los 5 bancos del catálogo → `201` cada uno, `10.00` cada uno | R10 |
| A6 | `tipoCuenta` `CORRIENTE` y `AHORRO` → `201` | J4 |
| A7 | `numeroCuenta` de 1 dígito y de 20 dígitos → `201` (bordes de J6) | J6 |
| A8 | origen `AHORRO` y origen `PRESTAMO` del titular → `201` | J15 |
| **B · validación (cada rechazo: su código exacto, ledger y saldo intactos)** | | |
| B1 | banco `"BANCO_REAL"`, `""`, `"asercion"`, `" ASERCION"`, `"ASERCION "`, `"ZEROFEEBANK"`, ausente, `1`, `null` → `400 BANCO_NO_PERMITIDO` | CA8, J5, J14 |
| B2 | número `""`, `"abc"`, `"12-34"`, `"12 34"`, 21 dígitos, `" 123"`, `"123\n"`, `12345` (número JSON), ausente → `400 NUMERO_CUENTA_EXTERNA_INVALIDO` | CA9, J6 |
| B3 | tipo `"SISTEMA"`, `"PRESTAMO"`, `"ahorro"`, `""`, ausente → `400 TIPO_CUENTA_EXTERNA_INVALIDO` | CA10, J4 |
| B4 | monto `"0"`, `"0.00"`, `"-10.00"`, `"abc"`, `"10.001"`, `10` (número JSON), ausente → `400 MONTO_INVALIDO` | CA20 |
| B5 | precedencia por pares: monto malo + banco malo → `MONTO_INVALIDO` · origen no UUID + banco malo → `404` · banco malo + número malo → `BANCO_NO_PERMITIDO` · número malo + tipo malo → `NUMERO_…` · tipo malo + origen ajeno → `TIPO_…` | § 3.1 |
| B6 | sin token → `401` (también sin clave: el token va primero) · sin clave → `400 IDEMPOTENCY_KEY_AUSENTE` · clave de 201 caracteres → `400 IDEMPOTENCY_KEY_INVALIDA` | § 3.1 |
| **C · origen** | | |
| C1 | origen UUID inexistente → `404 CUENTA_NO_ENCONTRADA`; ledger intacto | CA17 |
| C2 | origen de otro titular → `404`, indistinguible de C1 (cuerpos iguales quitados los ids); saldo del ajeno intacto | CA17 |
| C3 | origen `"no-es-uuid"` → `404` (no `500`) | CA17 |
| C4 | origen = la cuenta `OTROS_BANCOS`, leída de la base tras una transferencia `201` → `404` | J15 |
| C5 | guarda de S-21: `POST /transferencias` con destino `OTROS_BANCOS` (obtenida o creada por Prisma, **sin depender** del endpoint nuevo) → `404 CUENTA_NO_ENCONTRADA` (si no, se salta el tope, HU § 6) | HU § 6 |
| **D · tope** | | |
| D1 | `200.00` en una → `201`; luego `0.01` → `409 TOPE_DIARIO_EXCEDIDO`, ledger y saldo intactos | CA11, J2 |
| D2 | `50.00` + `50.00` + `100.00` → tres `201`; luego `0.01` → `409` | CA11 |
| D3 | `199.99` → `201`; `0.02` → `409`; `0.01` → `201` (el rechazo no sumó; el acumulado queda en 200,00 exacto) | J2, J3 |
| D4 | `200.01` en una → `409`; ledger intacto (no se transfiere una parte) | J2 |
| D5 | reinicio: reloj en día D `12:00Z`, `150.00` → `201`; reloj en D `23:59:59.999Z`, `50.01` → `409` y `50.00` → `201`; reloj en D+1 `00:00:00.000Z`, `200.00` → `201` y `0.01` → `409` | CA12, J1 |
| D6 | por cuenta: cuenta A del titular `200.00` → `201`; cuenta B del **mismo** titular `200.00` → `201`; A `0.01` → `409` y B `0.01` → `409` | CA13 |
| D7 | el primero llena su tope (`200.00` → `201`, `0.01` → `409`); otro titular con su cuenta `200.00` → `201` | R9 |
| D8 | sólo otros bancos cuentan: con una transferencia interna de `150.00` y un pago de `100.00` desde A el mismo día, externa `200.00` → `201`; y tras llenar el tope, una interna de `300.00` desde A → `201` | R9 |
| D9 | precedencia: acumulado `150.00` y saldo `50.00`; `60.00` (rompe tope **y** fondos) → `409 TOPE_DIARIO_EXCEDIDO` | J12 |
| D10 | fondos dentro del tope: saldo `50.00`, acumulado 0, `60.00` → `409 FONDOS_INSUFICIENTES`, ledger intacto; luego `50.00` → `201` | CA16, J3 |
| **E · idempotencia** | | |
| E1 | misma clave dos veces (`150.00`) → `201` y replay `201` + `Idempotency-Replayed: true`, cuerpo idéntico; 1 transacción; luego `50.00` con otra clave → `201` (el tope contó una vez) | CA15 |
| E2 | misma clave, cambia **uno** de `numeroCuenta`, `banco`, `tipoCuenta`, `monto` (4 subcasos) → `409 IDEMPOTENCY_KEY_REUSADA`, nada escrito | CA15 |
| E3 | misma clave y mismo cuerpo desde **otro** titular → `409 IDEMPOTENCY_KEY_REUSADA`, no la respuesta del primero | CA15 |
| E4 | `200.00` con clave K → `201`; replay de K → `201` idéntico, **no** `409` de tope | J13 |
| **F · concurrencia (D4)** | | |
| F1 | 3 ráfagas, cada una sobre un **titular** y una cuenta nuevos con fondos 1000,00: 10 simultáneas de `50.00` → **exactamente** 4 `201` y 6 `409 TOPE_DIARIO_EXCEDIDO`; acumulado en el ledger = 200,00; saldo = 800,00 | CA14 |
| F2 | titulares distintos: 4 externas de `10.00` desde A y 4 desde B, en paralelo con 4 internas A→B y 4 B→A de `1.00` → las 16 `201` (ningún `500`: sin deadlock) | D4 |
| **G · consulta** | | |
| G1 | `GET` del titular → `200`, cuerpo **igual** al del `POST` (monto derivado del ledger) | CA19 |
| G2 | `GET` de otro titular → `404 TRANSFERENCIA_NO_ENCONTRADA`, indistinguible de un id inexistente | CA19, J8 |
| G3 | id UUID inexistente y id `"no-es-uuid"` → `404 TRANSFERENCIA_NO_ENCONTRADA` (no `500`) | J8 |
| G4 | sin token → `401` | — |
| G5 | el `transaccionId` de la transferencia y el `transaccionId` de una transferencia interna → `404` (J16) | J16 |
| G6 | `PUT`, `PATCH`, `DELETE` sobre `/transferencias/otros-bancos/:id` → `404`, ledger y fila intactos | D3 |

Script `npm run test:otros-bancos`. **Sobre `main` sin implementar:** todo brazo que exige un
`201` o un código nuevo queda rojo; queda **verde sólo C5** (guarda de S-21). G6 era verde hasta
la enmienda § 8.1: ahora prepara una transferencia `201` y queda rojo por esa preparación.
Cualquier otro verde sobre `main` es un brazo ciego: se corrige antes de implementar.

### 8.1 · Enmienda (tras el ataque a ciegas)

Sólo **agrega** exigencias: ninguna aserción existente se debilita. Brazos nuevos: A9, C6, E5
(44 en total).

| # | Brazo | Cambio | Hallazgo |
|---|---|---|---|
| 1 | A3 | además: las dos transacciones acreditan **la misma** cuenta, leída del movimiento positivo de cada una, y esa cuenta tiene `codigo = 'OTROS_BANCOS'` (no depende de que C5 no haya corrido antes) | — |
| 2 | **A9** (nuevo) | monto `"10.0"` → `201` con `monto` `"10.00"`; monto `"10"` → `201` con `"10.00"` (paso 4: sólo se rechazan **más** de 2 decimales) | — |
| 3 | B2 · B3 · B4 | subcaso `null` en los tres; en B3 además `1` (número JSON) | — |
| 4 | B5 | tras cada par: ledger (`contarTransaccionesOtrosBancos`) y saldo del origen intactos; en el par 5, además el saldo de la cuenta ajena | — |
| 5 | B6 | los dos `401` exigen `codigo = 'TOKEN_AUSENTE'`; par nuevo: con token, **sin clave** y `monto: "abc"` → `400 IDEMPOTENCY_KEY_AUSENTE` (paso 2 antes que el 4) | — |
| 6 | C2 · G2 | la indistinguibilidad compara los textos reemplazando **sólo los ids que el propio brazo envió** (no toda cadena con forma de UUID) | — |
| 7 | C4 | la cuenta `OTROS_BANCOS` se lee del movimiento positivo de **su propia** transacción `201` (por `transaccionId`), y se exige `codigo = 'OTROS_BANCOS'` antes de usarla como origen | — |
| 8 | **C6** (nuevo) | origen ajeno con el tope del ajeno lleno: el ajeno transfiere `200.00` → `201` y `0.01` → `409 TOPE_DIARIO_EXCEDIDO` (premisa); luego el titular del token usa esa cuenta, `10.00` → `404 CUENTA_NO_ENCONTRADA` (paso 10 antes que el 11); saldo del ajeno intacto | — |
| 9 | D8 | tras la externa de `200.00`, una externa de `0.01` desde A → `409 TOPE_DIARIO_EXCEDIDO` (la premisa «tope lleno» se exige, no se supone) | — |
| 10 | D9 | tras el `409`: ledger y saldo (`50.00`) intactos | — |
| 11 | E2 | dos subcasos más: cambia `cuentaOrigenId` por otra cuenta con saldo del **mismo** titular; y `monto` `"10.00"` → `"10.0"` (mismos centavos, otro string: la huella usa el string original, § 3.1) | — |
| 12 | **E5** (nuevo) | clave K con cuerpo válido → `201`; misma K con `banco: "BANCO_REAL"` → `400 BANCO_NO_PERMITIDO`, no replay ni `409` (pasos 4–8 antes que el 9); ledger intacto | — |
| 13 | F2 | 3 ráfagas, cada una con titulares y cuentas nuevos; en cada una, además, saldo final de A y de B = `460.00` (500 − 40 − 4 + 4) | — |
| 14 | G1 | compara el **texto** del `GET` con el texto del `POST` (el orden de claves cuenta, como en E1) | — |
| 15 | G4 | exige `codigo = 'TOKEN_AUSENTE'` | — |
| 16 | G6 | usa el `id` de una transferencia `201` real; tras `PUT`/`PATCH`/`DELETE` → `404` los tres, la fila sigue con los mismos campos y el ledger intacto | — |
| 17 | dominio | el catálogo se compara como conjunto (ordenado en el test), largo 5, sin `ZEROFEEBANK`: la spec no fija un orden | — |

**F2 no tiene defecto que lo pruebe** (ninguna K lo pone rojo): es humo de deadlock, no un brazo
calibrado. Queda como deuda declarada, no como verde que prueba algo.

**Arnés del dominio** — `src/domain/transferencia/otros-bancos.spec.ts` (misma autoría que el de
integración): catálogo exacto (5 códigos, sin `ZEROFEEBANK`); `esNumeroCuentaExterna` en los
bordes de B2 y A7; `diaUtcDe` para `12:00Z`, `00:00:00.000Z`, `23:59:59.999Z` y el cambio de mes
y de año (`2026-12-31T23:59:59.999Z` → desde `2026-12-31`, hasta `2027-01-01`);
`assertDentroDelTope` con `acumulado + monto` = 19999, 20000 (pasa) y 20001 (lanza), montos
cerca de `2^53` (sin pérdida: `bigint`), y el código del error.

**Invariante nuevo I7** (`scripts/invariantes.sh`): número de pares (cuenta, día UTC) cuya
suma de transferencias a otros bancos supera 20000 centavos → **0**. Compuerta de población: la
siembra de `invariantes.sh` hace al menos una transferencia a otro banco, o I7 sale verde
mirando nada. **Calibración** (`invariantes:calibrar`): se inserta a mano un par cuenta-día que
suma 20001 y se exige I7 rojo; y otro que suma 20000 exacto y se exige verde.

### 8.2 · Enmienda (tras la primera implementación)

- **B6 era IMPOSIBLE** (error de la spec): `transferir(auth, cuerpo,
  undefined)` activa el valor por defecto de la clave, así que los subcasos «sin clave» 2, 3 y 5
  sí la mandaban. El 3 y el 5 no los pasaba ninguna implementación; el 2 era ciego (verde sólo
  por el token). Sobre la rama sin implementar no se vio: B6 caía antes, por la ruta inexistente.
  Arreglo: los tres llaman a `pedir` sin `clave`. No se debilita ninguna aserción.
  Calibrado: sano → verde; sin chequeo de clave → rojo en el 3; K23 → rojo en el 5
  (`IDEMPOTENCY_KEY_AUSENTE` esperado, `MONTO_INVALIDO` recibido).
- **§ 5 contra G2 del guante:** § 5 permitía `new Date(<algo>)` en `diaUtcDe`, pero G2 prohibía
  todo `new Date(` en el dominio. Una implementación lo esquivó con `Reflect.construct(Date, …)`, que G2 no veía
  (tampoco un `Reflect.construct(Date, [])`, que sí lee el reloj). G2 pasa a
  `(Date\.now\(|new Date\(\s*\)|Math\.random\(|Reflect\.construct\(\s*Date)`, y `diaUtcDe` usa
  `new Date(Date.UTC(…))`. Calibrado con 8 sondas: el G2 viejo daba verde con
  `Reflect.construct(Date, [])` y rojo con `new Date(ms)`; el nuevo da rojo con las 5 formas
  prohibidas y verde con las 2 legítimas.

## 9 · Calibración del endpoint (tabla fijada ANTES de implementar)

`npm run calibrar:s22`. Un defecto por vez; las dos mitades (declarados en rojo, el resto en
verde). Las anclas se adaptan al código; el defecto y sus brazos no. Un ancla ausente suma al
total y no al aprobado (`ancla_ausente`, deuda #130).

| # | Defecto inyectado | Rojos exactos |
|---|---|---|
| K1 | sin tope (nunca lanza `TOPE_DIARIO_EXCEDIDO`) | C6 D1 D2 D3 D4 D5 D6 D7 D8 D9 F1 |
| K2 | borde exclusivo: rechaza con `acumulado + monto >= tope` | C6 D1 D2 D3 D5 D6 D7 D8 E1 E4 F1 |
| K3 | tope por titular (suma todas sus cuentas) | D6 |
| K4 | el acumulado suma **todo débito** de la cuenta en el día (`monto_centavos < 0`), sin filtrar por concepto | D8 |
| K5 | el acumulado no filtra por día | D5 |
| K6 | ventana con `desde` exclusivo (`creada_en > desde`) | D5 |
| K7 | el acumulado se lee antes del bloqueo (fuera del gancho `trasBloquear`) | F1 |
| K8 | fondos antes que tope | D9 |
| K9 | el tope se evalúa en el controller, antes de la idempotencia | C6 E1 E4 F1 |
| K10 | `banco` normalizado (`trim` + mayúsculas) | B1 |
| K11 | `numeroCuenta` acepta hasta 21 dígitos | B2 |
| K12 | `tipoCuenta` acepta cualquier `TipoCuenta` del esquema | B3 B5 (enmienda de § 8.2) |
| K13 | contrapartida `CAJA` en vez de `OTROS_BANCOS` | A2 A3 C4 |
| K14 | huella sin `numeroCuenta` | E2 |
| K15 | huella sin `titularId` | E3 |
| K16 | `GET` sin comprobar el titular | G2 |
| K17 | `ahora` del reloj de pared (asiento, fila y ventana del día) | A1 D5 |
| K18 | huella sin `cuentaOrigenId` | E2 |
| K19 | huella con los centavos del monto en vez del string original | E2 |
| K20 | `monto` exige exactamente 2 decimales | A9 E2 |
| K21 | la clave guardada se consulta antes de validar banco, número y tipo | E5 |
| K22 | el tope se evalúa antes de la titularidad, dentro de la operación idempotente | C6 |
| K23 | el cuerpo se valida antes que la `Idempotency-Key` | B6 |
| K24 | el `GET` arma el cuerpo con otro orden de claves | G1 |
| K25 | existe `DELETE /transferencias/otros-bancos/:id` y borra la fila | G6 |

**Enmienda de la tabla (antes de implementar; § 8.1):** K4 estaba mal predicho: D9 y D10 siembran el saldo directo, sin una interna de 800, así que K4 no los
tocaba; y el defecto literal «quitar el filtro de concepto de `SUM(-monto)`» dejaba **verde** D8,
porque el haber de la siembra del mismo día cancela las salidas, y ponía rojos casi todos los D
fuera de su fila. Por eso K4 se redefine como «todo débito» y queda con D8 sola. K1, K2 y K9
suman C6, y K1 suma D8, por las premisas nuevas de § 8.1. Hay 8 defectos nuevos (K18–K25), uno
por hallazgo que no tenía defecto. El denominador pasa de 17 a 25.

Notas de la predicción (para auditar la tabla, no para ablandarla): K4 pone rojo D8 (la interna,
el pago y la externa suman 450 de débitos). K2 no
toca D4 (200,01 se rechaza igual) ni D9, y sí E1 (150 + 50 = 200). K9 pone rojo E1 porque el
replay de 150 ve acumulado 150 fuera de la operación idempotente. K13 pone rojos A3 y C4
porque desde la enmienda de § 8.1 los dos leen la contrapartida de **su propia** transacción y exigen
`codigo = 'OTROS_BANCOS'`: ya no dependen de que C5 (que la crea) corra después. K17 no toca A2 (asiento y `realizadaEn` salen
del mismo reloj equivocado y coinciden) y sí D5 (el día del acumulado es el de pared). **K7 es probabilístico**; por eso F1 son tres ráfagas.
Un rojo que no esté en su fila es un hallazgo (del arnés o de la predicción) y se escribe como tal.

**Enmienda de la tabla (tras la calibración):** K12 predecía sólo B3,
pero el par 5 de B5 usa `tipoCuenta: 'PRESTAMO'` con origen ajeno: con K12 el tipo pasa y la
petición llega a la titularidad (`404`) en vez de dar `400 TIPO_CUENTA_EXTERNA_INVALIDO`. El brazo
es correcto; la predicción no lo vio. Medido: **24/25 contra la tabla fijada** (en tres corridas), K12 → B3 B5 enmendada. Ningún brazo se tocó.

## 10 · Reparto

| Qué | Quién |
|---|---|
| Esta spec, migración, esquema, gancho `trasBloquear`, conceptos en `invariantes.sh`, I7 | — |
| `test/otros-bancos.int.spec.ts` + `src/domain/transferencia/otros-bancos.spec.ts` desde § 8 (M9) | — |
| Ataque a ciegas a los dos arneses | — |
| Dominio (`otros-bancos.ts`) + módulo (controller, service, DTO, errores, registro en `app.module.ts`) + los 5 códigos nuevos en `src/infra/errores-http.filter.ts` (sin ellos el filtro responde `500`) | — |
| Anclas de `calibrar:s22` · `ancla_ausente` a `scripts/lib/calibrador.sh` | — |

Toda corrida desatendida va en segundo plano, y se anota si
avisó bien.

## 11 · Hecho

- Sobre `main`: rojos todos los brazos salvo C5 (43 rojos de 44, tras § 8.1).
- Con la implementación: `test:otros-bancos` todo verde; `test:domain` verde; `calibrar:s22`
  25/25 exacto (o enmendada con su porqué, sin tocar brazos).
- `invariantes` 6/6 (I1–I7 sin I6, que sigue pendiente) e `invariantes:calibrar` con los dos
  casos nuevos de I7.
- Batería: `test:integracion`, `guante` 6/6, `typecheck` 0, `build` 0.
