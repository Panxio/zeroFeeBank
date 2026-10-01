# AGENTS.md: rules for contributors

> Simulation for test-automation practice. Not a bank, not a financial service. All data is
> fictional. Do not enter real personal or financial data.

This file lists the hard rules of the domain, the invariants the project verifies, the typed error
codes, and the test-seam contract. If you change code that touches money, these are the rules your
change must keep true. For the design rationale see [ARQUITECTURA.md](ARQUITECTURA.md).

Two ground rules cover everything else:

- **Do not invent business rules.** No rate, fee, limit, term or error code that is not in a spec
  or already in the code. If a value is missing, ask.
- **An amount that does not balance is never adjusted until it balances.** Not by rounding, not
  with a difference entry, not by loosening an invariant. A mismatch is a defect: find the cause.

## 1. Hard domain rules

| # | Rule | Risk it closes |
|---|---|---|
| D1 | **Money is an integer in the smallest unit (cents).** In TypeScript: `bigint` in the domain and `BIGINT` in the database. At the JSON edge it travels as a **decimal string**, never as `number`. No `float`, `double`, or JS `number` for amounts. | `0.1 + 0.2 !== 0.3`. Also `JSON.stringify` throws on a `bigint`, so the edge has to be written on purpose. |
| D2 | **Double entry.** Every money operation writes at least two movements to the ledger, and **the movements of a transaction sum to exactly 0**. An account balance is a query derived from the ledger, not an editable column. | Silent imbalance. A mutable balance can be corrupted without a trace. |
| D3 | **The ledger is append-only.** No `UPDATE` or `DELETE` on movements. A correction is a **compensating movement** that references the original. | Loss of traceability. An `UPDATE` erases the evidence of the bug. |
| D4 | **Every balance mutation happens inside a database transaction with locking** (`SELECT ... FOR UPDATE` on the accounts involved, in stable ascending id order). | Double spend on concurrent withdrawals. Crossed transfers A to B and B to A that lock in order of appearance deadlock. |
| D5 | **Idempotency on every `POST` that moves money.** `Idempotency-Key` header; the key is stored with its result, and a retry with the same key returns **the same response** without executing again (marked with the header `Idempotency-Replayed: true`). | Duplicate charges from a network retry or a double click. |
| D6 | **No negative amount enters the domain.** The sign comes from the movement type (debit or credit), never from user input. Validate at the edge. | A transfer of -1000 that "deposits" into the source account. |

### Structural rules checked by `npm run guante`

`npm run guante` runs the hard gates that are checked by absence. Each gate prints the search terms
it used; a gate that narrows its list in silence would go green without anyone noticing.

| Gate | Checks |
|---|---|
| G1 | `src/domain/` imports nothing from `@nestjs/`, `@prisma/`, `express` or `pg` (dependency rule) |
| G2 | `src/domain/` has no `Date.now(`, `new Date()` without arguments, `Math.random(` or `Reflect.construct(Date`; the clock and randomness are injected |
| G3 | no `parseFloat`, `toFixed`, `Number(monto` or `Number(centavos`, and no money field typed `number`, anywhere in `src/` |
| G4 | no `movimiento.update`, `.delete`, `.updateMany` or `.deleteMany` in `src/` |
| G5 | every monetary column in the migrations is `BIGINT` |
| G6 | `src/modules/boletas/` does not read the wall clock; it asks the injected clock service |

## 2. Invariants

These are queries that run and return a number. `npm run invariantes` executes them against a
running database and app; `npm run invariantes:calibrar` breaks the system on purpose (for example a
transfer that debits but does not credit) and checks that the right invariant turns red. An
invariant that was never seen failing is only a claim.

```
P   population gate: there is something to audit (no invariant reports green on an empty base)
I1  balanced entry:     no transaction sums to anything other than 0, and none has fewer than 2 movements
I2  global balance:     the sum of ALL movements in the system is 0 (against system accounts)
I3  derived balance:    no materialized balance column, and the balance exposed by GET /cuentas
                        equals the sum of the account's movements
I4  no improper debt:   no customer account is below its agreed limit (system accounts excluded)
I5  idempotency:        no idempotency key without a transaction, no key-carrying transaction without a key
I6  guarantee account:  the balance of the GARANTIA account equals the sum of the VIGENTE guarantee bonds
I7  other-bank cap:     no (account, UTC day) pair sends more than 200.00 in total to other banks
```

When a new transaction concept is added, the population gate goes red and names it, because I5
would not know whether that concept must carry an idempotency key.

## 3. Typed error codes (C5)

Every business error answers `{ "codigo": "<CODE>", "mensaje": "<text>" }`. Assert on `codigo`; the
text may change or be translated without breaking a test. The map lives in
`src/infra/errores-http.filter.ts`; **a code that is not in that map comes out as 500**, on purpose,
so an invented code shows up red instead of slipping through as a reasonable 400. An unexpected
error answers 500 `ERROR_INTERNO` with a `correlacionId` that also appears in the server log.

| HTTP code | Error codes |
|---|---|
| **400** | `CUERPO_INVALIDO` · `IDEMPOTENCY_KEY_AUSENTE` · `IDEMPOTENCY_KEY_INVALIDA` · `MONTO_INVALIDO` · `MISMA_CUENTA` · `EMAIL_INVALIDO` · `PASSWORD_DEBIL` · `TIPO_CUENTA_NO_PERMITIDO` · `MONTO_APERTURA_INSUFICIENTE` · `CUENTA_ORIGEN_REQUERIDA` · `PLAZO_INVALIDO` · `RUT_INVALIDO` · `NOMBRE_INVALIDO` · `GLOSA_INVALIDA` · `CUENTA_ID_REQUERIDO` · `CUENTA_ID_INVALIDO` · `TRANSACCION_ID_INVALIDO` · `FECHA_INVALIDA` · `RANGO_INVALIDO` · `EMAIL_NO_MODIFICABLE` · `CONTACTO_NOMBRE_INVALIDO` · `CONTACTO_APELLIDO_INVALIDO` · `CONTACTO_DIRECCION_INVALIDA` · `CONTACTO_CIUDAD_INVALIDA` · `CONTACTO_ESTADO_INVALIDO` · `CONTACTO_CODIGO_POSTAL_INVALIDO` · `CONTACTO_TELEFONO_INVALIDO` · `PAGO_BENEFICIARIO_NOMBRE_INVALIDO` · `PAGO_BENEFICIARIO_DIRECCION_INVALIDA` · `PAGO_BENEFICIARIO_CIUDAD_INVALIDA` · `PAGO_BENEFICIARIO_ESTADO_INVALIDO` · `PAGO_BENEFICIARIO_CODIGO_POSTAL_INVALIDO` · `PAGO_BENEFICIARIO_TELEFONO_INVALIDO` · `PAGO_CUENTA_BENEFICIARIO_INVALIDA` · `PRESTAMO_PIE_INVALIDO` · `BANCO_NO_PERMITIDO` · `NUMERO_CUENTA_EXTERNA_INVALIDO` · `TIPO_CUENTA_EXTERNA_INVALIDO` · `ESCENARIO_DESCONOCIDO` · `RELOJ_PETICION_INVALIDA` · `RELOJ_INSTANTE_INVALIDO` · `RELOJ_AVANCE_INVALIDO` · `RELOJ_NO_FIJADO` |
| **401** | `CREDENCIALES_INVALIDAS` · `TOKEN_AUSENTE` · `TOKEN_INVALIDO` · `TOKEN_EXPIRADO` |
| **403** | `RETIRADOR_NO_AUTORIZADO` (the collector is not the named beneficiary of the bond) |
| **404** | `CUENTA_NO_ENCONTRADA` · `BOLETA_NO_ENCONTRADA` · `TRANSFERENCIA_NO_ENCONTRADA` (a resource that belongs to someone else answers exactly like a missing one) |
| **409** | `FONDOS_INSUFICIENTES` · `IDEMPOTENCY_KEY_REUSADA` · `EMAIL_YA_REGISTRADO` · `TRANSICION_INVALIDA` · `BOLETA_NO_VENCIDA` · `BOLETA_NO_CERRADA` · `PRESTAMO_PIE_SUPERA_FONDOS` · `PRESTAMO_FONDOS_INSUFICIENTES` · `TOPE_DIARIO_EXCEDIDO` |
| **500** | `ERROR_INTERNO` |

An invalid guarantee-bond transition (for example collecting a bond that was already returned)
answers `TRANSICION_INVALIDA` and writes nothing to the ledger.

## 4. Test-seam contract

The app is designed to be automated by any framework without the suite touching the code.

- **Seed and reset by API, behind an explicit environment flag.** `ZFB_COSTURAS_PRUEBA` must be
  exactly `1`. Without it the `/__test__/` routes are not mounted: they answer 404, not 403.
  - `POST /__test__/reset` returns the system to a known base state (HTTP 200).
  - `POST /__test__/seed` with `{"escenario": "<name>"}` creates a named scenario and **returns
    the ids it created** (HTTP 201). Scenarios: `cuenta-unica`, `dos-cuentas`,
    `cuenta-con-historial`, `movimientos-buscables`, `boletas-en-cada-estado`. An unknown name
    fails with `ESCENARIO_DESCONOCIDO`, never with an empty 200.
  - `POST /__test__/reloj` with `{"instante": "<ISO>"}`, `{"instante": null}` or
    `{"avanzarMs": <n>}` fixes, releases or advances the server clock.
- **Determinism.** No wall clock or randomness inside the domain; the clock and identifier
  generation are injected. Seeded data is stable between runs. No test may depend on the order of
  other tests: each scenario starts from `reset` plus `seed`.
- **`data-testid` is a versioned contract, not an implementation detail.** Every element a business
  flow interacts with has a stable `data-testid` and a correct accessible name (role plus label).
  The contract lists are `specs/S-10-testids-T1.txt` to `T4.txt` and `specs/S-17-testids-*.txt`;
  each carries a change log. Renaming or removing an id is a change to the contract and must be
  recorded there. Identifiers are never anchored on visible text or on formatted amounts.
- **Explicit loading states.** The UI declares when it is busy and when it has finished (loading,
  empty and error elements with their own test ids), so a suite never needs a fixed wait.
- **`/health` tells the truth**, including the database: 200 with `"db":"up"`, or 503 with
  `"db":"down"`.
- **The E2E suite lives in a separate repository.** It must not import application code or touch
  the database.

## 5. Before you open a change

- `npm run typecheck` exits 0 and `npm run test:domain` passes.
- `npm run guante` is 6/6.
- If you touched money code: run `npm run invariantes` and report the real number for each
  invariant. If you changed what an invariant looks at, calibrate it: inject a defect on purpose and
  confirm that the check turns red.
- If you touched the interface: update the `data-testid` lists and their change log.
- Never change a test so that it passes. If a test fails, the problem is in the code.
