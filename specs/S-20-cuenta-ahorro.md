# S-20 · Cuenta de ahorro por `POST /cuentas`

> Sale de `specs/HU-01-tipos-de-transferencia.md` (R1–R2, CA1–CA3, § 8). Cambia
> el contrato de un arnés candado (`test/cuentas.int.spec.ts`, caso B2), autorizado por el
> humano en R2. 2026-09-14.

## Qué hace

`POST /cuentas` acepta `tipo: "AHORRO"` con **las mismas reglas que `CORRIENTE`** (R2): mismo
mínimo de apertura, mismo fondeo (la primera desde LA caja, las siguientes desde otra cuenta
propia), misma idempotencia, sin intereses ni restricciones propias. Una cuenta de ahorro
también sirve de origen para abrir otra. `GET /cuentas` la lista con su tipo y su saldo derivado.

## No-goals

- Transferir entre corriente y ahorro por `POST /transferencias` (CA4): es **S-21**.
- Intereses, comisiones o límites propios de la ahorro (R2, R8).
- La pantalla: el frontend no cambia en esta spec.
- Normalizar el tipo: `"ahorro"` sigue siendo error, como `"corriente"` (S-12 B4, CA2).
- `src/domain/`, `prisma/` y migraciones: `AHORRO` está en el enum desde S-04.

## Contrato

- Tipos aceptados en `POST /cuentas`: exactamente `CORRIENTE` y `AHORRO`. Cualquier otro valor
  (ausente, `SISTEMA`, `PRESTAMO`, minúsculas, con espacios) → `400 TIPO_CUENTA_NO_PERMITIDO` y
  nada escrito.
- La respuesta `201` es la de S-12 con `tipo` igual al pedido.
- El tipo sigue en la huella de idempotencia (S-12 Decisión 3): la misma clave con otro tipo es
  `409 IDEMPOTENCY_KEY_REUSADA`, y el replay de una apertura `AHORRO` devuelve la misma respuesta.

## Arnés

`test/cuentas.int.spec.ts`:
- **B2 cambia** de `400` a `201` (autorizado, HU-01 R2). Es el único cambio a un brazo existente.
- **Brazos nuevos G1–G8:**

| Brazo | Qué mide | CA |
|---|---|---|
| G1 | 201 con contrato completo; `AHORRO` en la respuesta **y en la base**; del titular del token | CA1 |
| G2 | la primera `AHORRO` se fondea desde LA caja: `APERTURA_CUENTA`, 2 movimientos, suma 0 | CA1 |
| G3 | `AHORRO` desde una `CORRIENTE` propia: el dinero se mueve y la nueva es `AHORRO` en la base | CA1 |
| G4 | `CORRIENTE` desde una `AHORRO` propia: la ahorro sirve de origen | CA1 |
| G5 | `PRESTAMO`, `"ahorro"`, `"Ahorro"`, `" AHORRO"` → 400 `TIPO_CUENTA_NO_PERMITIDO`, 0 cuentas | CA2 |
| G6 | `GET /cuentas` lista la ahorro con `tipo: "AHORRO"` y saldo igual al ledger | CA3 |
| G7 | replay de una apertura `AHORRO`: misma respuesta, cabecera de replay, 1 cuenta | D5 |
| G8 | misma clave, primero `CORRIENTE` y después `AHORRO` → 409, 1 cuenta | D5 |

## Calibración (tabla fijada ANTES de implementar)

Un defecto por vez, comprobando las dos mitades (los declarados en rojo, el resto en verde).
`npm run calibrar:s20`. Los anclas de texto se adaptan al código; el defecto y sus brazos no.

| # | Defecto inyectado | Rojos exactos |
|---|---|---|
| K0 | el controlador vuelve a aceptar sólo `CORRIENTE` (el estado de `main`) | B2 G1 G2 G3 G4 G6 G7 G8 |
| K1 | la primera cuenta se guarda `CORRIENTE` aunque se pida `AHORRO` | G1 G6 |
| K2 | la cuenta abierta desde un origen se guarda `CORRIENTE` aunque se pida `AHORRO` | G3 |
| K3 | el controlador acepta además `PRESTAMO` | G5 |
| K4 | el tipo se normaliza (`trim` + mayúsculas) antes de validar | B4 G5 |
| K5 | el replay sigue exigiendo `tipo: "CORRIENTE"` en la respuesta guardada | G7 |
| K6 | el tipo sale de la huella de idempotencia | G8 |
| K7 | `GET /cuentas` lista sólo las `CORRIENTE` | G6 |

## Hecho

- Sobre `main` (sin implementar): B2 y G1–G4, G6–G8 rojos; G5 verde (es guarda de regresión, la
  prueban K3 y K4).
- Con la implementación: `test:cuentas` todo verde, `calibrar:s20` 8/8 exacto.
- Batería: `test:integracion`, `invariantes` 5/5, `guante` 6/6, `typecheck` 0, `test:domain`.
