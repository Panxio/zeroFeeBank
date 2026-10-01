# S-05 — Transferencia con transacción de BD y bloqueo ordenado

> Unidad de trabajo del backlog. **Parte delicada: el bloqueo**, cuyo árbitro es un test de
> concurrencia real, no un runner de dominio; la lógica del caso de uso es regla pura.
> Aplica el candado común de `specs/_CANDADO.md`.
> Escrita: 2026-09-07.

---

## Pilar 1 · Qué hace, en prosa

Mueve dinero de una cuenta a otra escribiendo **dos movimientos que suman exactamente cero**
(D2) dentro de **una** transacción de base de datos, tras **bloquear las dos cuentas en orden
estable de id ascendente** (D4).

El saldo no se lee de una columna: se **deriva** sumando los movimientos de la cuenta, y esa
suma se hace **después** de tomar el bloqueo. Ese orden es todo el asunto. Si el saldo se lee
antes de bloquear, dos retiros simultáneos leen el mismo saldo, los dos se creen buenos, y la
cuenta queda en descubierto sin que ninguna prueba secuencial lo note.

El bloqueo se pide **siempre por id ascendente**, nunca en el orden en que las cuentas
aparecen en la petición. Dos transferencias cruzadas A→B y B→A que bloqueen en orden de
aparición se abrazan en un deadlock; es el segundo bug de concurrencia más común y no es
teoría.

## No-goals (explícitos, para que no crezca solo)

- **Ningún endpoint HTTP.** A propósito, y no por pereza: **D5 exige idempotencia en todo POST
  que mueva plata**, y la idempotencia es S-06. Publicar hoy un `POST /transferencias` sin
  `Idempotency-Key` sería entregar, durante toda una unidad de trabajo, exactamente el cobro
  duplicado que D5 previene. El caso de uso queda listo y S-06 le pone la puerta.
- **Ninguna validación de propiedad de la cuenta.** No hay usuario autenticado todavía (S-08).
  Quien llame al caso de uso declara las cuentas; comprobar que el titular es quien dice ser
  es de S-08, y se anota como límite conocido, no como algo resuelto.
- **Ninguna comisión.** No es un dato inventado ni omitido: los no-goals del proyecto excluyen
  tasas y cobros, y el nombre del producto es `zeroFeeBank`. Una transferencia mueve el monto
  exacto, ni un centavo más.
- **Ningún reintento automático ante deadlock.** El bloqueo ordenado los previene; añadir
  reintentos encima escondería un orden mal implementado en vez de exponerlo.

## Criterio de "hecho"

`npm run test:concurrencia` termina en **exit 0** contra la base real, con la meta **M2**
cumplida: **20 retiros simultáneos** sobre un saldo que alcanza para uno → **exactamente 1
éxito y 19 rechazos**. Y el test se vio **rojo** al quitar el `FOR UPDATE`.

## Pilar 2 · Invariantes

| # | Invariante |
|---|---|
| T1 | Toda transferencia escribe exactamente **2 movimientos** cuya suma es **0** (D2). |
| T2 | Ninguna cuenta queda por debajo de `-limite_sobregiro_centavos` (I4 del perfil). |
| T3 | Si la transferencia se rechaza, **no se escribe nada** en el ledger. Ni un movimiento suelto, ni una transacción huérfana. |
| T4 | Las cuentas se bloquean **por id ascendente**, sin importar cuál es origen y cuál destino. |
| T5 | El saldo se calcula **después** del bloqueo, dentro de la misma transacción de BD. |
| T6 | El monto que entra al dominio es siempre positivo: el signo lo pone el asiento, no el input (D6). |

## Pilar 3 · Orden de ejecución, y por qué ese orden

Dentro de una única transacción de BD:

1. **Validar el monto** (`> 0`) y que origen ≠ destino. Antes de tocar la base: rechazar barato
   lo que no necesita la base para ser rechazado.
2. **Bloquear las dos cuentas** con `SELECT ... FOR UPDATE`, en **dos consultas separadas**,
   ordenadas por id ascendente. Separadas a propósito: un `IN (...) ORDER BY id FOR UPDATE`
   deja el orden real en manos del plan de ejecución, y el plan no es un contrato.
3. **Derivar el saldo** de la cuenta origen sumando sus movimientos.
4. **Comprobar fondos** contra el límite de sobregiro pactado. Si no alcanzan, `throw` → la
   transacción entera revierte y T3 se cumple sola, sin código de limpieza.
5. **Insertar** la transacción y sus dos movimientos.

Los pasos 2 y 3 en ese orden son la unidad: invertirlos deja el código funcionando, los tests
secuenciales verdes, y el saldo mal.

## Pilar 4 · Casos borde anticipados

- **Origen = destino:** rechazado por el dominio (`MismaCuentaError`) antes de bloquear.
  Además, bloquear dos veces la misma fila sería una llamada al vacío.
- **Monto cero o negativo:** rechazado en el borde (D6).
- **Cuenta inexistente:** el bloqueo no devuelve fila → error tipado `CUENTA_NO_ENCONTRADA`,
  no una excepción de la base filtrándose hacia arriba.
- **Saldo exactamente igual al monto:** debe **pasar**. El límite es `saldo - monto >= -limite`,
  con `>=`, no `>`. Un `>` deja plata muerta en la cuenta y es el típico error de un carácter.
- **Cuenta con sobregiro pactado:** puede quedar negativa hasta su límite, y ni un centavo más.
- **Transferencias cruzadas A→B y B→A a la vez:** cubierto por T4; sin orden estable, deadlock.

## Constantes, con su valor y la frase que la justifica

| Constante | Valor | Por qué |
|---|---|---|
| Retiros simultáneos del test M2 | `20` | fijado en la meta M2 desde antes de codear; no se baja para que el test pase. |
| Éxitos esperados en M2 | exactamente `1` | el saldo alcanza para uno. Ni 0 (sería un bloqueo que mata todo) ni 2 (sería doble gasto). |
| Aislamiento de la transacción | `Read Committed` (el de Postgres) | con `SELECT ... FOR UPDATE` alcanza y no obliga a reintentos por serialización. Si un día hiciera falta `SERIALIZABLE`, viene con su política de reintento, y eso es otra unidad. |
| Comisión por transferencia | `0` | ver no-goals: no es un dato ausente, es una decisión del producto. |

## Códigos de error (C5 · contrato estable)

La suite afirma sobre el **código**; la persona lee el mensaje. El texto puede cambiar sin
romper una prueba.

| Código | Cuándo |
|---|---|
| `MONTO_INVALIDO` | monto ≤ 0 |
| `MISMA_CUENTA` | origen = destino |
| `CUENTA_NO_ENCONTRADA` | alguna de las dos no existe |
| `FONDOS_INSUFICIENTES` | el saldo, menos el monto, cae bajo el límite pactado |

## Pilar 5 · El arnés de esta unidad

Dos capas, porque miden cosas distintas:

1. **Dominio, sin base de datos** (`src/domain/transferencia/*.spec.ts`): la regla de fondos
   suficientes, incluidos el borde `>=` y el sobregiro pactado. Rápido, corre en cada ciclo.
2. **Concurrencia, contra Postgres** (`npm run test:concurrencia`): la meta M2. **Un test
   secuencial no sirve acá**: da verde con el `FOR UPDATE` borrado, y es justamente el árbitro
   que no mira.

### Calibración obligatoria

| Defecto inyectado | Debe ponerse rojo | Resultado (2026-09-07) |
|---|---|---|
| Se quita el `FOR UPDATE` | el test M2: más de 1 éxito | ✅ **10 éxitos** de 20 |
| Se lee el saldo **antes** de bloquear | el test M2, por lo mismo | ✅ **8 éxitos** de 20 |
| El límite pasa de `>=` a `>` | el borde del saldo exacto | ✅ 2 casos en rojo (dominio e integración) |
| Se invierte el orden de bloqueo (por aparición) | el test cruzado | ✅ **18 de 20 muertas por deadlock** |

### El test nació ciego, y hubo que ensancharle la ventana

La primera versión del test de M2 daba **4/4 en verde con el `FOR UPDATE` borrado**. No era el
pool ni el framework: se midió y las transacciones interactivas sí se solapan (10 transacciones
con `pg_sleep(0.3)` tardaron 392 ms de pared, no 3 s). La causa era la **ventana**: sobre una
cuenta recién creada el `SUM` del saldo tarda microsegundos, y la carrera entre leer y escribir
casi nunca llega a manifestarse.

La corrección **no fue relajar el test ni repetirlo hasta que fallara**: fue darle a la cuenta
origen un historial de 20.000 transacciones que suman cero. El `SUM` pasa a tardar
milisegundos, la ventana se abre, y el test distingue un bloqueo real de un comentario que dice
"bloquea". Es además el escenario realista: una cuenta con movimientos es el caso normal.

**La lección, para el resto del proyecto:** un test de concurrencia que pasa no prueba nada
hasta que se le ve fallar sin el bloqueo. Si no falla, lo que hay que arreglar es el test.
