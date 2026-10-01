# S-21 · Transferencia al mismo banco: corriente ↔ ahorro sí, a una cuenta de sistema no

> Sale de `specs/HU-01-tipos-de-transferencia.md` (R3, V2, V4, CA4–CA6, § 8),
> 2026-09-14. Candado: `specs/_CANDADO.md`.
> El cambio de código son unas 10 líneas y auditar una entrega costaría lo mismo que escribirla.

## Qué hace

`POST /transferencias` rechaza un **destino de tipo `SISTEMA`** con `404 CUENTA_NO_ENCONTRADA`,
**sin escribir en el ledger**, igual que si el destino no existiera (V4, CA5). Las transferencias
entre cuentas propias de distinto tipo, corriente → ahorro y ahorro → corriente, responden `201`
(V2, CA4). Los 20 casos que ya tiene el arnés (A1–A8 de S-06, B1–B11 de S-18) siguen verdes, y
ninguna aserción se relaja (CA6).

## Dónde va el chequeo, y por qué ahí

En la **puerta HTTP** (`IdempotenciaService.ejecutar`, junto a la titularidad del origen), **no
en el motor** (`TransferenciasService.transferirEn`). El motor lo usan también la apertura de
cuenta (origen `CAJA`), la emisión, el cobro y la devolución de boletas (`GARANTIA`), los pagos y
el préstamo (`PRESTAMOS`): todos mueven plata desde o hacia cuentas `SISTEMA`, y eso es correcto.
Lo que se cierra es que **un cliente** ordene esa transferencia.

## Decisiones de diseño

- **J1 · Mismo 404 que el destino inexistente, indistinguible** (texto igual, quitados los ids).
  Es la regla de S-18 J4 aplicada al destino: un código propio («destino no permitido») le
  confirmaría a quien barre UUID que dio con una cuenta de sistema real.
- **J2 · Precedencia: el 404 del destino va antes que `FONDOS_INSUFICIENTES`.** Una petición
  hacia una cuenta de sistema se rechaza por lo que es, no por el saldo del momento.
  Después del token (401), la forma (400) y la titularidad del origen (404), como ya ordena S-18.
- **J3 · Sólo se cierra `SISTEMA`.** Un destino `PRESTAMO` (la cuenta que abre un préstamo, S-16)
  sigue respondiendo `201`: S-16 N4 dice que se usa como cualquier cuenta del titular y la HU sólo
  cierra V4. El chequeo es «el destino no es `SISTEMA`», no una lista blanca de tipos.

## No-goals

- La transferencia a otro banco, el tope y el `GET` de solo lectura: **S-22**.
- Tocar el motor (`transferencias.service.ts`), el esquema o las migraciones.
- Cambiar el comportamiento hacia un destino `PRESTAMO` (J3) o de un origen `SISTEMA` (ya da 404:
  una cuenta de sistema no tiene titular, S-18).
- La pantalla (R11).

## Arnés · `test/idempotencia.int.spec.ts`, grupo C nuevo

Autorizado en HU-01 (§ 5 y § 8: «brazos nuevos en el arnés de S-18»). **Sólo añade**: un
grupo C al final y un parámetro opcional `tipo` en `cuentaConSaldo` (por defecto `CORRIENTE`,
así las 42 llamadas existentes siembran exactamente lo mismo que antes).

| Brazo | Qué mide | CA |
|---|---|---|
| C1 | corriente → ahorro propia → 201; saldos −monto / +monto; 1 transacción, 2 movimientos | CA4 |
| C2 | ahorro → corriente propia → 201; saldos −monto / +monto; 1 transacción, 2 movimientos | CA4 |
| C3 | destino `SISTEMA` → 404 `CUENTA_NO_ENCONTRADA`; saldos del origen y del destino intactos; 0 transferencias | CA5 |
| C4 | el 404 del destino `SISTEMA` es indistinguible del de un destino inexistente (J1) | CA5 |
| C5 | destino `SISTEMA` con el origen sin fondos → 404, no 409 (J2) | CA5 |
| C6 | guarda: destino `PRESTAMO` propio → 201 (J3) | — |

Sobre `main` (sin implementar) deben quedar **rojos exactos C3, C4, C5**; C1, C2 y C6 verdes (son
guardas: `main` ya transfiere entre cualquier tipo; los prueban K1–K3).

## Calibración (tabla fijada ANTES de implementar)

`npm run calibrar:s21`. Un defecto por vez, las dos mitades (declarados en rojo, el resto verde).
Los anclas de texto se adaptan al código; el defecto y sus brazos no. Un ancla ausente suma al
total y no al aprobado (`ancla_ausente`, deuda #130).

| # | Defecto inyectado | Rojos exactos |
|---|---|---|
| K0 | sin chequeo del destino (el estado de `main`) | C3 C4 C5 |
| K1 | lista blanca de destino `CORRIENTE` o `AHORRO` en vez de «no `SISTEMA`» | C6 |
| K2 | lista blanca de destino sólo `CORRIENTE` | C1 C6 |
| K3 | el origen tiene que ser `CORRIENTE` | C2 |
| K4 | el chequeo del destino va después del motor (después de fondos) | C5 |
| K5 | mismo código 404 `CUENTA_NO_ENCONTRADA`, pero el mensaje delata la cuenta de sistema | C4 |

**Fuera de la tabla, medido una vez como sonda:** poner el chequeo en el motor en vez de la
puerta. Los brazos C no lo ven (todos pasan por HTTP); lo tiene que ver la batería (boletas, pagos,
apertura). Se anota cuántos rojos da `test:integracion`, sin tabla exacta.

## Hecho

- Sobre `main`: C3, C4, C5 rojos; el resto del archivo (A1–A8, B1–B11, C1, C2, C6) verde.
- Con la implementación: `test:idempotencia` todo verde; `calibrar:s21` 6/6 exacto.
- `calibrar:s18` sigue en su número (el ancla puede moverse: se revisa por grep antes de correrlo).
- Batería: `test:integracion`, `test:domain`, `invariantes` 5/5, `guante` 6/6, `typecheck` 0,
  `build` 0.
