# Architecture: zeroFeeBank

> Simulation for test-automation practice. Not a bank, not a financial service. All data is
> fictional. Do not enter real personal or financial data.

This document explains how the application is organized and why each decision was made. It is
written to be read in ten minutes. (The file keeps its Spanish name, `ARQUITECTURA.md`, because
other documents link to it.)

---

## 1. In one sentence

> zeroFeeBank is a **modular monolith in TypeScript (NestJS + PostgreSQL + Prisma)**, organized
> around the **dependency rule** of Clean Architecture, with money recorded in a **double-entry
> ledger**, and designed from the start to be a **system under test** that any automation
> framework can drive.

---

## 2. The application

### 2.1 Shape: a modular monolith

One deployable unit, divided inside into modules with clear borders. **Not** microservices: a
banking simulator does not have the problem microservices solve (independent teams deploying
separately), and it would pay their whole cost.

```
src/
├── domain/     pure business rules: Money, the ledger, guarantee bonds, loans, national id
│               (RUT) validation, transfer rules
│               no NestJS, no Prisma, no HTTP
├── modules/    use cases + HTTP endpoints + input validation
│               auth, cuentas, transferencias, transferencias-otros-bancos, movimientos,
│               pagos, boletas, prestamos, contacto, comprobantes (PDF), costuras, health
├── infra/      database access, the clock, the error filter, the idempotency executor,
│               everything that talks to the outside world
└── main.ts
web/            Angular frontend (Spanish UI)
prisma/         schema and migrations
test/           integration tests (they do touch the database)
scripts/        verification and calibration scripts
```

### 2.2 The rule that orders everything: the dependency rule

**Dependencies always point inward, never outward.** `domain/` imports nothing from `infra/` or
from NestJS. `infra/` does know `domain/`.

This is the heart of **Clean Architecture** (Robert C. Martin) and also of **Hexagonal
Architecture** (Ports & Adapters, Alistair Cockburn). Both say the same thing: keep business rules
isolated from technology.

**Why it matters for testing:** if the domain does not depend on the database, its rules can be
tested in milliseconds, with nothing running. That is the base of the test pyramid. When the domain
is tangled with the framework, every test becomes a slow integration test, and that is how a suite
nobody wants to run is born.

**Formal hexagonal was not implemented**, with its `ports/in` and `ports/out` folders. That was a
conscious decision: NestJS already provides dependency injection and module borders, so that
scaffolding would have tripled the number of files for the same behavior. **The rule was kept and
the ceremony dropped**, and the rule is checked by an automatic `grep` (gate G1 of
`npm run guante`), which is more honest than a well-named folder.

### 2.3 Five domain patterns, and what each one prevents

This is what is specific to handling money, as opposed to any CRUD.

| Pattern | What it is | What breaks without it |
|---|---|---|
| **Money as integers** | amounts are stored in cents, as integers (`bigint` in the domain, `BIGINT` in the database, decimal strings in JSON). Never floating point. | `0.1 + 0.2` is not `0.3` in floating point. In banking that is an imbalance. |
| **Double-entry bookkeeping** | every operation writes at least two movements, and the movements of a transaction sum to exactly **0**. | A balance can be corrupted without leaving a trace of how. |
| **Append-only ledger** | movements are never edited or deleted; a correction is a **compensating movement**. A balance is a **derived query**, not an editable column. The application's database role cannot `UPDATE` or `DELETE` the ledger. | An `UPDATE` erases the evidence of the error. Goodbye, traceability. |
| **Pessimistic locking** (`SELECT ... FOR UPDATE`) | while money moves, the account rows are locked, and locks are always requested **in the same order** (ascending id). | Double spend: two concurrent withdrawals that both see enough balance. And without the fixed order, deadlock. |
| **Idempotency key** (`Idempotency-Key`) | the client sends a unique key; repeating the request returns **the same result** without executing again. | A double charge from a double click or a network retry. |

A sixth piece of domain design is the **guarantee bond** (*boleta de garantía*), the most
interesting instrument to test because its state depends on time:

```
issued (VIGENTE) ──> COBRADA | VENCIDA | DEVUELTA
```

Issuing a bond **immobilizes** funds (a movement to a guarantee account); collecting, returning or
expiring it moves them again, each transition writing to the ledger under the double-entry rule. An
invalid transition (collecting a bond that was already returned) answers with a typed error and
**writes nothing**. The clock is injected, so expiry can be tested without waiting.

### 2.4 Invariants: the real harness

An **invariant** is something that must be true **always**, whatever operations were executed.
Those of this project run as queries and return a number (`npm run invariantes`):

```
I1  no transaction of the ledger sums to anything other than 0 (and none has fewer than 2 movements)
I2  the sum of all movements in the system is 0
I3  no balance column exists, and every balance shown equals the sum of its movements
I4  no customer account is below its agreed limit
I5  no idempotency key without a transaction, and no key-carrying transaction without a key
I6  the balance of the guarantee account equals the sum of the active guarantee bonds
I7  no (account, UTC day) pair sends more than the daily cap to other banks
```

**And they are calibrated.** See section 3.

---

## 3. How it is verified

### 3.1 Specs first

Each deliverable has a specification in `specs/` with three mandatory parts: **what it does**,
**what is left out** (*non-goals*) and **what "done" means**, in measurable terms. The non-goals are
not filler: they stop the scope from growing on its own halfway through.

### 3.2 A harness must be calibrated

> **A check that does not look at something does not say "I don't know". It says GREEN.**

A green suite does not prove the system works. It proves the suite found nothing, which is
different, and which is also what happens when the suite is not looking.

So **before trusting a verification, it is broken on purpose**: the defect it should detect is
introduced, and the check must turn **red**. If it stays green, the check was decorative. A concrete
example from this project: a transfer is modified so it **only debits and never credits**, and
invariant I1 has to fail. If it does not, I1 was checking nothing (`npm run invariantes:calibrar`).

- The formal name for doing this systematically is **mutation testing**: a tool makes small changes
  to the code (flips a condition, swaps a `+` for a `-`) and asks whether **any test noticed**. A
  surviving mutant is a line that no test is really looking at. Mutation is measured with Stryker
  on `src/domain/` only (`npm run test:mutation`, threshold 70 %), because the domain is the only
  code where a surviving mutant means money counted wrong.
- **Coverage does not replace this.** Coverage measures which lines were *executed*; mutation
  measures which lines are *verified*. A test with no assertions gives 100 % coverage.

### 3.3 The restriction gate

Instead of reviewing code line by line, it is **surrounded by automatic gates** it has to pass
through. A **hard** gate means: if it fails, the change does not pass. Examples in this project:

| Gate | How it is checked |
|---|---|
| the domain knows neither the framework nor the database | `grep` over `src/domain/` (G1) |
| no floating point for money | `grep` over `src/` (G3) and every monetary column must be `BIGINT` in the migrations (G5) |
| the ledger is not edited or deleted | `grep` (G4) plus database permissions |
| no wall clock or randomness in the domain | `grep` over `src/domain/` (G2) |
| balance mutation runs under a transaction with locking | concurrency test (`npm run test:concurrencia`) |
| idempotency on `POST`s that move money | test: same key twice, one movement (`npm run test:idempotencia`) |
| the ledger invariants I1 to I7 | `npm run invariantes`, calibrated (section 3.2) |

An important caveat: *the gate is blind to whatever is not code.* All those gates look at logic. A
whole suite can be green while the product looks broken on screen, because the defect is in the
rendered artifact and not in the logic. That is why, on top of the gate, there is a layer of
verification of the **rendered artifact** (the `verificar:*` scripts drive the real interface in a
browser).

---

## 4. Designed to be automatable

An unusual decision, and the one that matters most for a system under test: **the app exposes seams
so that any automation framework can test it**: Playwright, Selenium, Cypress, anything. It depends
on none of them.

- **Seedable, resettable state through an API**, behind an environment flag (`ZFB_COSTURAS_PRUEBA=1`).
  Without the flag the routes do not exist (404). Without this there is no determinism, and without
  determinism every suite generates flaky tests.
- **Injectable clock.** Without it, testing the expiry of a guarantee bond means waiting months or
  lying to the database. `POST /__test__/reloj` moves the server clock, and the `pruebas` build of
  the web app exposes `window.__zfb__.reloj` for the browser side.
- **`data-testid` treated as a versioned contract**, not as an implementation detail: renaming one
  breaks every suite at once.
- **Explicit loading, empty and error states**, each with its own test id. This is what makes it
  possible to forbid fixed waits (`waitForTimeout`): the app declares when it is done, instead of
  the test guessing.
- **Typed error codes** (`FONDOS_INSUFICIENTES`), not only a prose message. The visible text can
  change or be translated without breaking a single test.
- **A truthful `/health`** that includes the database.

**And the E2E suite lives in a separate repository, on purpose.** If it lived inside the app it
would end up leaning on its code (an imported type, an internal helper, direct database access) and
would stop being replicable with another framework. The separation is what makes the word
"agnostic" true.

> The short version: *most flaky tests are not a defect of the suite; they are the suite
> compensating for a seam the application never exposed.*

---

## 5. What was decided not to do

Knowing what was discarded is worth as much as knowing what was chosen.

| Discarded | Why |
|---|---|
| **Microservices** | there are no independent teams deploying separately; it would be cost without benefit |
| **Formal hexagonal (ports/adapters)** | NestJS already gives dependency injection and module borders; the dependency rule is kept, not the scaffolding (section 2.2) |
| **BDD / Gherkin inside the application** | Given-When-Then belongs to the E2E suite, which lives in another repository. Here it would be a translation layer with no reader |
| **Editable balance column** | it is the "obvious" choice and the source of silent imbalance. The balance is derived from the ledger (section 2.3) |
| **A public deployment** | this is a simulation; a bank look-alike served to the public is exactly what it must not become |

---

## 6. Minimal glossary

- **Dependency rule:** dependencies point toward the business rules, never the other way.
- **Double entry:** every movement of money has a counterpart; the transaction sums to zero.
- **Append-only ledger:** a record that only grows; corrected with compensating movements.
- **Idempotency:** repeating an operation gives the same result as executing it once.
- **Pessimistic locking:** locking the data before touching it, assuming there will be conflict.
- **Invariant:** a statement that must always be true, checkable as a query.
- **Mutation testing:** breaking the code on purpose to check that the tests detect it.
- **Coverage:** which lines were executed. **Not** the same as which lines are verified.
- **System under test (SUT):** the application a suite tests, seen from the outside.
- **Test seam:** a point the app exposes on purpose so it can be automated.
- **Flaky test:** an intermittent test; almost always missing determinism, not bad luck.
