# S-11 · Invariantes I1–I5, con su calibración

> Cierra **M1**, la única meta del perfil financiero que nunca se corrió.
> Árbitro: **el propio comando**.
> Escrita el 2026-09-07, ANTES de escribir una línea del arnés.

---

## Pilar 0 — ¿por qué esto existe?

No lo resuelve nada instalado. `test:domain` vigila la partida doble **en memoria**;
`verify:s04` vigila que la base **rechace** un `UPDATE`. Ninguno de los dos mira **el estado
que quedó escrito**. Un caso de uso puede escribir un asiento descuadrado sin violar ningún
permiso y sin tocar el dominio: la base lo acepta, los tests pasan, y la plata no cuadra.

Peldaño 6. Se escribe lo mínimo: **cinco consultas y una compuerta de población.**

## Pilar 1 — qué hace, y qué queda fuera

**Hace:** `npm run invariantes` levanta la app si hace falta, **siembra una población conocida
por las costuras de S-07**, y corre cinco comprobaciones sobre el estado resultante. Imprime
**un número por invariante** y sale con el número de invariantes en rojo.

**No-goals:**
- No arregla nada. Un invariante en rojo es un defecto que se diagnostica (Pilar 6), no un
  estado que el comando corrija.
- No corre en producción. Usa `/__test__/reset`, que exige `ZFB_COSTURAS_PRUEBA=1`.
- No mide rendimiento ni cobertura.

**Hecho =** los cinco números impresos, los cinco en verde sobre la app sana, y **cada uno
visto rojo al menos una vez por su propia razón**, con el defecto inyectado registrado.

## Constantes, con su porqué

| Constante | Valor | Porqué |
|---|---|---|
| `CONCEPTOS_ESPERADOS` | `SIEMBRA`, `TRANSFERENCIA` | La lista versionada de la población que este arnés se siembra. Si aparece un concepto nuevo (S-15 Bill Pay), la compuerta de población se pone roja y **avisa que I5 no lo cubre**. Un check por ausencia versiona su lista (ARNES.md). |
| `CONCEPTOS_CON_CLAVE` | `TRANSFERENCIA` | Los conceptos que **obligatoriamente** nacen de un POST con `Idempotency-Key`. `SIEMBRA` no: la siembra es una costura, no un movimiento de cliente. |
| Cuentas excluidas de I4 | `tipo = 'SISTEMA'` | Son la contrapartida del mundo exterior: su saldo negativo es lo que hace que I2 cuadre. Excluirlas es la regla, no una excepción cómoda. |
| Monto de la transferencia sembrada | `250,00` (25000 centavos) | Cualquier valor menor al saldo sembrado sirve; se fija uno para que la corrida sea reproducible. |
| Población mínima | ≥1 movimiento, ≥1 cuenta de cliente, ≥1 clave | Una base vacía da cinco ceros **que parecen verde**. Sin esta compuerta el arnés es decoración. |

## Pilar 2 — los cinco invariantes, como consulta

```
P  · POBLACIÓN   compuerta previa: hay algo que auditar, y los conceptos son los esperados
I1 · asiento cuadrado    transacciones con SUM(movimientos) <> 0  O  con menos de 2 movimientos
I2 · cuadre global       SUM(monto_centavos) de TODA la tabla movimiento  <>  0
I3 · saldo derivado      (a) ninguna columna de saldo materializada en `cuenta`
                         (b) el saldo EXPUESTO por /__test__/seed == SUM(movimientos) de esa cuenta
I4 · sin negativos       cuenta de cliente con SUM(movimientos) < -limite_sobregiro_centavos
I5 · idempotencia        (a) clave cuyo transaccionId no existe en `transaccion`
                         (b) transacción de un concepto con clave que NINGUNA clave reclama
```

Cada uno imprime **cuántas filas violan** y, si hay violaciones, **cuáles y por qué**. El
número es el veredicto; el detalle es lo que permite *leer el rojo*.

### I1 tiene dos cláusulas a propósito, y las distingue en el detalle

D2 es una sola regla con dos mitades: *≥2 movimientos* **y** *suman 0*. Un asiento con un solo
movimiento las viola las dos. El número las suma; el detalle imprime `n=` y `suma=` de cada
fila, así que el rojo dice cuál se rompió. En el dominio, la mitad de «≥2 entradas» ya tiene
árbitro nombrado: `assertBalanceada` (`src/domain/ledger/ledger.ts:50`), cubierta por
`test:domain`. I1 la vigila **en el estado escrito**, que es lo que el dominio no puede ver.

### I2 es un COROLARIO de I1, y se declara

`movimiento.transaccion_id` es `NOT NULL` con clave foránea. La suma global es entonces, por
construcción, la suma de las sumas por transacción. **Consecuencia: no existe ningún defecto
que ponga I2 en rojo dejando I1 en verde.** No es un hallazgo, es aritmética, y se escribe acá
para que nadie lo descubra en la calibración y crea que el arnés falla.

Lo que I2 sí aporta, y por lo que se queda: **una forma de consulta distinta**, sin `GROUP BY`.
Si mañana alguien estrecha el alcance de I1 —un `WHERE` de más, un `JOIN` que pierde filas—,
I1 puede quedar verde mirando menos, y I2 sigue viendo el total. Es la defensa contra la forma
#2 del patrón: *el check dejó de mirar y se ve igual de verde*.

Su razón propia, la que se comprueba en la calibración, es **el total impreso**: I1 dice
«2 asientos descuadrados», I2 dice «el sistema tiene −1000 centavos de más». Se ponen rojos
juntos; no dicen lo mismo.

### I3 mide el saldo que el sistema EXPONE, no el que calcula

Hoy el único saldo que sale al exterior es `saldoCentavos` de `/__test__/seed`, y **está
escrito como literal**, no derivado del ledger (`costuras.service.ts`). Es exactamente el
descuadre que D2 previene, en el único lugar donde el sistema hoy puede cometerlo. Cuando
S-12 exponga el resumen de cuentas, I3b gana un brazo más y esta spec se revisa.

I3a es estructural y barato: si algún día aparece una columna `saldo*` en `cuenta`, es un
defecto, no una optimización — así lo dice el propio esquema.

## Pilar 3 — orden de ejecución, y por qué ese orden

1. **La base arriba** y **la app arriba** (se levanta sola si no responde `/health`).
2. **Siembra** (`INV_SEMBRAR=1`, por defecto): `reset` → `seed dos-cuentas` → una transferencia
   real por `POST /transferencias` → **la misma clave otra vez** (replay) → una transferencia
   que debe ser rechazada por fondos. Se usan las puertas públicas, nunca `INSERT` directo:
   un arnés que se fabrica su propia población no mide el camino que la app usa de verdad.
3. **Compuerta P**. Si la población no es la esperada, **se aborta**: los cinco números que
   vendrían después no significarían nada. Es la lección #22 — la siembra que revienta y deja
   el arnés dando un rojo que no es el que vino a buscar.
4. **I1 → I5**, en orden, todos, sin cortar al primer rojo. Un solo rojo que aborta la corrida
   esconde los otros cuatro números (lección #23: un caso reúne todos sus testigos).

`INV_SEMBRAR=0` salta el paso 2 y audita **lo que ya esté en la base**. Es el modo para correr
detrás de la batería de integración, y el que usa el calibrador.

## Pilar 4 — casos borde, y QUÉ BRAZO CUBRE CADA UNO

> La lección de la fila #33: *un caso escrito en la spec no es un caso cubierto.* Esta tabla
> es la que se recorre al terminar el arnés, marcando la columna de la derecha.

| # | Caso borde | Brazo que lo cubre |
|---|---|---|
| B1 | Base vacía: cinco ceros con apariencia de verde | **P** (población mínima) |
| B2 | Cuenta sin ningún movimiento (saldo 0 legítimo) | I4 con `LEFT JOIN` + `COALESCE` — sin eso desaparece de la consulta |
| B3 | `transaccion` sin ningún movimiento (asiento huérfano) | I1, cláusula `n < 2`, vía `LEFT JOIN` desde `transaccion` |
| B4 | Transacción con **un solo** movimiento | I1, las dos cláusulas |
| B5 | Cuenta de SISTEMA en negativo (es su trabajo) | I4 la excluye por `tipo` — verde correcto, no falso verde |
| B6 | Cuenta de cliente con `limite_sobregiro_centavos > 0` | I4 compara contra la columna, no contra 0 |
| B7 | Clave de idempotencia que apunta a una transacción inexistente | I5a |
| B8 | La misma transferencia ejecutada dos veces (clave no persistida) | I5b, transacción `TRANSFERENCIA` sin clave que la reclame |
| B9 | Aparece una columna de saldo materializada en `cuenta` | I3a |
| B10 | El saldo expuesto por `seed` deja de coincidir con el ledger | I3b — defecto **A2** |
| B11 | Un concepto de dinero nuevo (S-15) que I5 **no** cubre | **P** (lista de conceptos versionada) — se pone roja y lo nombra |
| B12 | Suma global ≠ 0 con todos los asientos cuadrados | **IMPOSIBLE** por el FK `NOT NULL`. Sin brazo, y declarado arriba: es aritmética, no un agujero |
| B13 | Movimiento de monto 0 dentro de un asiento que suma 0 | **SIN BRAZO en I1.** Árbitro nombrado: `assertBalanceada` lo rechaza en el dominio (`ledger.ts:53`), cubierto por `test:domain`. Agujero conocido en el estado escrito, no olvido |

## Pilar 5 — calibración: qué defecto pone rojo a cuál

Obligatoria antes de confiar en los números. Un defecto **por brazo**, para que no haya dos
rojos con el mismo síntoma (la trampa que este repo ya pagó tres veces con `42501`).

> Los de la compuerta se llaman **G1/G2** y no P1/P2 a propósito: ya se usa P1–P3
> para los **datos de negocio que faltan**, y dos numeraciones iguales en el mismo repo se
> confunden la primera vez que alguien las lee de corrido.

**Once defectos de estado**, en `scripts/calibrar-invariantes.sh` (`npm run invariantes:calibrar`),
inyectados como **dueño de la base**: los invariantes son afirmaciones sobre el estado escrito,
y el estado se puede escribir. **Dos defectos de código**, inyectados a mano en la app, con
reconstrucción y reinicio: son la prueba de que el arnés caza un defecto recorriendo el camino
real, no un `INSERT` de laboratorio.

| id | Defecto inyectado | Resultado declarado `I1 I2 I3 I4 I5` | Borde |
|---|---|---|---|
| **E1** | dos asientos descuadrados que se **compensan** entre sí | `2 0 0 0 0` | B4 |
| **E2** | un movimiento solitario, sin contrapartida | `1 1 0 0 0` | B4 |
| **E3** | una `transaccion` sin ningún movimiento | `1 0 0 0 0` | B3 |
| **E4** | `ALTER TABLE cuenta ADD COLUMN saldo_centavos` | `0 0 1 0 0` | B9 |
| **E5** | asiento cuadrado que deja una cuenta de cliente bajo su límite | `0 0 0 1 0` | B6 |
| **E6** | **control negativo:** cuenta en −3000 con límite pactado 5000 | `0 0 0 0 0` | B6 |
| **E7** | transacción `TRANSFERENCIA` que ninguna clave reclama | `0 0 0 0 1` | B8 |
| **E8** | clave cuyo `transaccionId` no existe | `0 0 0 0 1` | B7 |
| **E9** | **control negativo:** cuenta de cliente sin ningún movimiento | `0 0 0 0 0` | B2 |
| **G1** | una transacción con concepto `BILL_PAY`, fuera de la lista versionada | **P aborta y lo nombra** | B11 |
| **G2** | ninguna clave de idempotencia que auditar | **P aborta y lo nombra** | B1 |
| **A1** | *(código)* la transferencia **sólo debita**: se escribe una entrada de las dos | `1 1 0 0 0` | — |
| **A2** | *(código)* el `saldoCentavos` que `seed` expone deja de coincidir con el ledger | `0 0 1 0 0` | B10 |

Cada corrida comprueba **las dos mitades**: que el brazo que le toca se pone rojo, **y que los
demás siguen verdes**. Un defecto que enrojece de más es tan malo como uno que no enrojece:
hace indistinguibles a dos invariantes.

**E1 es el defecto que separa I1 de I2**, y por eso existe: sin él los dos serían el mismo
chequeo con dos nombres. **E6 y E9 son controles negativos con dientes**: E6 tiene la misma
forma que E5 y el veredicto cambia sólo porque el límite pactado cambió —lo que prueba que I4
lee la columna y no un `0` escrito a mano—, y E9 quedaría fuera de la consulta si I4 usara un
`JOIN` en vez de un `LEFT JOIN`. Su testigo es la línea `examinado`, que tiene que **subir**:
un verde sobre una fila que nadie miró se ve igual que un verde correcto.

> El ledger es append-only incluso para el dueño (S-04), así que un defecto inyectado **no se
> puede deshacer**: entre defecto y defecto el calibrador vuelve a `/__test__/reset`, que es la
> única puerta que sabe quitar el trigger y reponerlo.

## Pilar 7 — meta numérica

- **5/5 invariantes en verde** sobre la app sana, con la población sembrada.
- **13/13 defectos inyectados** con el resultado exacto que esta spec declara — cada uno rojo
  en el brazo que le toca y **verde en los otros cuatro** (salvo el par I1+I2, corolario).
- El comando corre en **< 60 s** de pared, arranque de la app incluido.
