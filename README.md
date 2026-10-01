> **Simulation for test-automation practice. Not a bank, not a financial service. All data is fictional. Do not enter real personal or financial data.**

# zeroFeeBank

*Leer en español: [README.es.md](README.es.md)*

zeroFeeBank is a banking simulator built as a **system under test (SUT)**: a realistic
web application you can point Selenium, Playwright or Cypress at to practice test automation.
Think of [ParaBank](https://parabank.parasoft.com/), but current, deterministic and designed from
day one to be automated.

**What it is not.** It is not a bank and not a financial service. No real money, no real accounts,
no real bank and no real rates are involved. Every screen carries a notice strip saying so (see
"Simulation notice" under [Test seams](#test-seams)). Never enter real personal or financial data.

- **Backend:** NestJS + PostgreSQL + Prisma (TypeScript).
- **Frontend:** Angular 21 (`web/`).
- **The user interface is in Spanish.** The documentation is in English (and Spanish in
  [README.es.md](README.es.md)). The specs in `specs/` are currently written in Spanish.
- **The E2E suite is deliberately not in this repository.** A suite that lives inside the app ends
  up leaning on its code and stops being portable across frameworks. See
  [ARQUITECTURA.md](ARQUITECTURA.md).

## Contents

1. [What you can automate](#what-you-can-automate)
2. [Requirements](#requirements)
3. [Quick start, step by step](#quick-start-step-by-step)
4. [Environment variables](#environment-variables)
5. [Test seams](#test-seams)
6. [Running the checks](#running-the-checks)
7. [Security notes](#security-notes)
8. [Troubleshooting](#troubleshooting)
9. [Repository layout](#repository-layout)
10. [Rigor](#rigor)
11. [License and disclaimer](#license-and-disclaimer)

## What you can automate

| Screen / flow | What it does |
|---|---|
| **Login / sign up** | Login popover (the form is served from the API as an embedded frame, a cross-origin document, which is a good automation exercise) with account creation |
| **Accounts** | Account summary with balances, and opening a new account (checking or savings) |
| **Transfers** | Three-step transfer (source, destination, review) to one of your own accounts, to another account by id, or to another bank; replayed requests are flagged; PDF receipt |
| **Movements** | Searchable transaction history per account |
| **Payments** | Pay a third party (payee details, amount) and list past payments |
| **Guarantee bonds** (*boletas de garantía*) | Issue, list and return guarantee bonds; expiry depends on time, so the clock is controllable (see below); PDF receipts |
| **Teller window** (*ventanilla*) | Public screen where a bond is collected by id and the collector's national id number (RUT) |
| **Contact** | View and edit customer contact data |

The per-screen user stories live in [`specs/`](specs/)
([HU-01](specs/HU-01-tipos-de-transferencia.md),
[HU-02](specs/HU-02-pantalla-boletas.md),
[HU-03](specs/HU-03-pantalla-movimientos.md),
[HU-04](specs/HU-04-pantalla-abrir-cuenta-y-transferir.md),
[HU-05](specs/HU-05-pantalla-pagos.md),
[HU-06](specs/HU-06-pantalla-contacto.md)).

## Requirements

| Tool | What is needed | Why / where it comes from |
|---|---|---|
| **Node.js** | **22.18.0 or newer in the 22 line, or 24.11.0 or newer** | The repository does **not** pin a Node version (there is no `engines` field and no `.nvmrc`). This range is derived: it is the intersection of the `engines` declared by the dependencies in `package-lock.json` (for example the `@babel/*` packages that Stryker pulls in: `^22.18.0 \|\| >=24.11.0`; Vitest 5: `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`; Prisma 7.10 and Angular CLI 21.2 in `web/package-lock.json`: `^20.19 \|\| ^22.12 \|\| >=24`). The start script also uses `node --env-file`, and the Prisma config uses `process.loadEnvFile`. Node 25 is outside Vitest's declared range. |
| **npm** | The one that ships with those Node versions | `web/package.json` declares `packageManager: npm@9.2.0`; the Angular CLI declares npm `>= 8` as its minimum. Both lockfiles are `lockfileVersion` 3. |
| **Docker with Compose v2** | `docker` and the `docker compose` subcommand | Runs PostgreSQL 18 (`postgres:18-alpine`, see `docker-compose.yml`). The npm scripts call `docker compose`, not `docker-compose`. |
| **bash, curl, python3, openssl** | Only for the `scripts/` checks and the demo | The scripts are bash; they use `curl`, `python3 -m http.server` (to serve the web build), `openssl` and GNU `base64 -w0` (`scripts/lib-app.sh`). They were written for Linux; they are not verified on macOS or Windows (on Windows, use WSL or a similar bash environment). Not needed for `npm start`, the web app or the unit tests. |
| **Chromium for Playwright** | Only for `npm run demo:m6` and every `verificar:*` script | These scripts drive a real browser through `playwright-core` (pinned to 1.60.0 in `package.json`), which does not bundle one. Install it once with `npx playwright-core install chromium` (run from the repository root, after `npm ci`). If Chromium then fails to start because of missing system libraries on Linux, `npx playwright-core install-deps chromium` installs them (it asks for sudo). |

**Ports in use** (all on `localhost`):

| Port | Used by | If it is taken |
|---|---|---|
| **5432** | PostgreSQL in Docker. Published only on `127.0.0.1` (`docker-compose.yml`). | Stop whatever uses it, or change the left side of the `ports` mapping in `docker-compose.yml` **and** the port inside both database URLs in your `.env`. |
| **3000** | The API (`PORT`, default 3000). **The web app has this port written into its source** (`web/src/app/app.ts`, `web/src/app/app.html`), so do not change `PORT` unless you also edit those files. | Stop the other program. |
| **4200** | The Angular dev server, and the origin the API allows for CORS (`ZFB_ORIGEN_APP`, default `http://localhost:4200`). | Stop the other program. If you serve the web app on another port, set `ZFB_ORIGEN_APP` to that exact origin in `.env` and restart the API. |
| **4201** | Only `npm run verificar:s10-t4`, which serves a production build there. | The script aborts; free the port. |

## Quick start, step by step

Every command is run from the repository root unless it starts with `cd`. Do the steps in order.

**1. Check your tools.**

```bash
node --version
docker compose version
```

Expected: a Node version inside the range above, and a Compose v2 version line. Make sure the Docker
daemon is running (Docker Desktop open on Windows and macOS).

**2. Clone the repository and install the backend dependencies.**

```bash
git clone https://github.com/Panxio/zeroFeeBank.git
cd zeroFeeBank
npm ci
```

Expected: `npm ci` ends with an "added N packages" line and no `ERR!`.

**3. Create your `.env`.** The file `.env` is **not** in the repository: git ignores it
(`.gitignore` ignores `.env` and `.env.*`, and keeps only `.env.example`), so every person creates
their own. Start from the template:

```bash
cp .env.example .env
```

On Windows PowerShell use `Copy-Item .env.example .env`. Then generate a signing secret and paste it
after `ZFB_AUTH_SECRET=` in your `.env`. The secret **must be at least 32 characters**; the template
leaves it empty on purpose, and the API refuses to start while it is empty.

- Linux or macOS (with `openssl`): `openssl rand -hex 32`
- Any system with Node (also Windows): `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`

Both print 64 hexadecimal characters. Open `.env` in an editor and make the line read, for example,
`ZFB_AUTH_SECRET=<the 64 characters you just generated>`, with no spaces and no quotes.
(The Node one-liner was checked on Linux only.)

<details>
<summary>Alternative: write the whole <code>.env</code> in one command</summary>

The database values are the public credentials of the local container (see
[Security notes](#security-notes)). The Linux/macOS block was run and prints `64`; **the PowerShell
block is NOT TESTED** (no PowerShell was available when this README was written).

Linux and macOS (bash or zsh, with `openssl`):

```bash
cat > .env <<EOF
DATABASE_URL=postgresql://zerofeebank_app:zerofeebank_app_local@localhost:5432/zerofeebank
DATABASE_URL_MIGRACION=postgresql://zerofeebank:zerofeebank_local@localhost:5432/zerofeebank
PORT=3000
ZFB_AUTH_SECRET=$(openssl rand -hex 32)
ZFB_COSTURAS_PRUEBA=1
ZFB_ORIGEN_APP=http://localhost:4200
EOF

# Check the secret length (must print 64)
awk -F= '/^ZFB_AUTH_SECRET/{print length($2)}' .env
```

Windows (PowerShell), untested:

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$secret = -join ($bytes | ForEach-Object { $_.ToString('x2') })

@"
DATABASE_URL=postgresql://zerofeebank_app:zerofeebank_app_local@localhost:5432/zerofeebank
DATABASE_URL_MIGRACION=postgresql://zerofeebank:zerofeebank_local@localhost:5432/zerofeebank
PORT=3000
ZFB_AUTH_SECRET=$secret
ZFB_COSTURAS_PRUEBA=1
ZFB_ORIGEN_APP=http://localhost:4200
"@ | Set-Content -Path .env -Encoding ascii

# Check the secret length (must print 64)
$secret.Length
```

The `-Encoding ascii` matters on Windows PowerShell 5.1, where the default encoding can write a
byte-order mark that would corrupt the name of the first variable.
</details>

**4. Start the database.**

```bash
npm run db:up
```

Expected: Docker pulls `postgres:18-alpine` the first time and the command returns once the
container `zerofeebank-db` is healthy (`docker compose up -d --wait`). Check with
`docker ps --filter name=zerofeebank-db`: the status column says `(healthy)`.

**5. Create the schema from the migrations.** This wipes the local database (fine on a fresh one).

```bash
npx prisma migrate reset --force
```

If Prisma refuses to run `migrate reset` (it has a guard that rejects it when an automated AI
agent launches it), on a freshly created database use `npx prisma migrate deploy`: it applies the
same migrations and deletes nothing.

Expected: the 8 migrations in `prisma/migrations/` are applied, the last one being
`20260914213749_s22_transferencia_otro_banco`. Check with:

```bash
npx prisma migrate status
```

Expected: the output contains `Database schema is up to date`. The migration `s04_ledger_append_only`
also creates the unprivileged database role `zerofeebank_app` that your `DATABASE_URL` uses; that is
why migrations must run before the API.

**6. Build and start the API.**

```bash
npm run build
npm start
```

Expected: the build ends without errors (it runs `prisma generate` and `tsc`, and creates
`dist/main.js`); `npm start` prints `zeroFeeBank escuchando en http://localhost:3000` and keeps
running. Leave this terminal open.

**7. Check the API in a second terminal.**

```bash
curl -i http://localhost:3000/health
```

Expected: `HTTP/1.1 200` and the body `{"status":"ok","db":"up"}`. If the database is unreachable it
answers `503` with `{"status":"degraded","db":"down"}`. Note that `"db":"up"` only proves the database
answers; it does not prove the migrations ran (use `npx prisma migrate status` for that).

**8. Install and start the web app, in that second terminal.**

```bash
cd web
npm ci
npm start
```

Expected: Angular's dev server (`ng serve`) builds the app and serves it at `http://localhost:4200/`.

**9. Open the app.** Go to <http://localhost:4200/>. You should see the landing page with the
simulation notice strip. There are no built-in demo users: open the login popover and create an
account (the password needs at least 8 characters, `src/modules/auth/auth.service.ts`). To get a
ready-made user with data, use the seed seam below; two scenarios return working login credentials.

To stop everything: `Ctrl+C` in each terminal, then `npm run db:down` (stops the container; your data
stays in the Docker volume).

> `npm start` inside `web/` serves the **development** build, which does **not** expose the browser
> clock hook (`window.__zfb__`). To get it, use the `pruebas` build (see "Injectable clock" below).

## Environment variables

These are the variables the code reads. Their values go in your own `.env` (copied from
`.env.example`), which is never committed.

| Variable | Required | Default | Purpose and source |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | none | Connection used by the app, as the unprivileged role `zerofeebank_app`, which cannot `UPDATE` or `DELETE` the ledger. The app refuses to start without it (`src/infra/prisma.service.ts`). |
| `DATABASE_URL_MIGRACION` | **Yes** | none | Connection used by migrations, as the database owner `zerofeebank`. Every Prisma command (`prisma.config.ts`) fails without it, and so does the API when the test seams are on (`src/modules/costuras/`). |
| `ZFB_AUTH_SECRET` | **Yes** | none (empty in `.env.example`) | Token signing secret. The API refuses to start if it is missing or shorter than 32 characters (`src/modules/auth/auth.service.ts`). |
| `PORT` | No | `3000` | API port (`src/main.ts`). The web app expects 3000. |
| `ZFB_COSTURAS_PRUEBA` | No | off | Turns the test seams on only when it is exactly `1`; any other value or no value means off. `.env.example` sets it to `1`. The demo and the `verificar:*`, `invariantes` and `sonda:*` scripts need it on. |
| `ZFB_ORIGEN_APP` | No | `http://localhost:4200` | Web origin the API allows for CORS. It must be an exact origin: no trailing slash and no path (`src/infra/origen-app.ts`). |

Script-only: `ZFB_LOG` sets where the demo and `verificar:*` scripts write their log (each script has
its own default).

## Test seams

The app exposes the hooks an automation suite needs, so it never has to touch the database or
patch the clock from inside. They are routes under `/__test__/` plus a few conventions.

**How to turn them on.** Put `ZFB_COSTURAS_PRUEBA=1` in `.env` and restart the API. **How to keep
them off:** remove the line, or set anything other than `1`. With the flag off the routes are not
mounted at all, so they answer 404, not 403. You can confirm it:

```bash
curl -i -X POST http://localhost:3000/__test__/reset
```

Expected with the flag **off**: `HTTP/1.1 404`. Expected with the flag **on**: `HTTP/1.1 200` and the
body `{"ok":true,"tablasVaciadas":[...]}`, **and the database has just been emptied**. Do not run it
on data you want to keep.

- **Reset and seed by API, behind the flag.**
  - `POST /__test__/reset` empties the tables (users, accounts, movements, bonds, idempotency keys)
    and un-fixes the clock (HTTP 200).
  - `POST /__test__/seed` with `{"escenario": "<name>"}` creates a named scenario and **returns the
    ids it created** (HTTP 201). Scenarios: `cuenta-unica`, `dos-cuentas`, `cuenta-con-historial`,
    `movimientos-buscables`, `boletas-en-cada-estado`. Only the last two return a `credenciales`
    object (`email`, `password`) that works to log in from the UI; the other scenarios create a user
    nobody can log in as. An unknown scenario fails loudly with `ESCENARIO_DESCONOCIDO`.
  - `POST /__test__/reloj` moves the server clock: `{"instante": "<ISO date>"}` fixes it,
    `{"instante": null}` releases it, `{"avanzarMs": <n>}` advances a fixed clock.

  ```bash
  curl -s -X POST http://localhost:3000/__test__/seed \
    -H 'Content-Type: application/json' \
    -d '{"escenario":"boletas-en-cada-estado"}'
  ```

  Expected: HTTP 201 and a JSON body with `usuarioId`, `cuentas`, `boletas` and `credenciales`. Log in
  at <http://localhost:4200/> with that email and password.
- **Injectable clock.** Time never comes from the wall clock inside the domain, so a bond expiry
  can be tested without waiting months. The server clock is moved with `POST /__test__/reloj`. For
  the browser, build the web app with the `pruebas` configuration, which exposes
  `window.__zfb__.reloj` (`fijar`, `avanzar`, `desfijar`, in milliseconds), and serve it on 4200 as the
  scripts do:

  ```bash
  cd web
  npx ng build --configuration pruebas
  python3 -m http.server 4200 --directory dist/web/browser
  ```

  Expected: the build ends without errors and the app is served at <http://localhost:4200/>. Use
  this instead of `npm start` in `web/` (do not run both: they use the same port).
- **Typed error codes.** Every business error returns `{ "codigo": "FONDOS_INSUFICIENTES",
  "mensaje": "..." }`. Assert on the code; the human-readable message may change. The catalogue
  is in [AGENTS.md](AGENTS.md).
- **`data-testid` as a versioned contract.** Every element a business flow interacts with carries
  a stable `data-testid`. The lists are versioned in `specs/` (`S-10-testids-T1.txt` to
  `T4.txt`, and `S-17-testids-*.txt`). Renaming one breaks every suite at once, so a change is a
  change to the contract, not an implementation detail. Loading, empty and error states have their
  own test ids (for example `cuentas-cargando`, `cuentas-error`, `boletas-cargando`). Do not anchor
  locators on visible text or on formatted amounts.
- **Idempotency.** Every `POST` that moves money requires an `Idempotency-Key` header; a replay
  returns the same response and the header `Idempotency-Replayed: true`.
- **Simulation notice.** The web app has two `<main>` regions (the landing page, which also hosts
  the signed-in screens, and the public ventanilla). Each carries a strip stating that this is a
  simulation, not a bank or a financial service, and that all data is fictitious (the UI text is
  in Spanish). It is a `<p role="note" data-testid="aviso-simulacion">`, exactly one per `<main>`,
  with no `fixed` or `sticky` positioning, so it does not cover a control.

## Running the checks

Run them from the repository root, after steps 2 to 6 of the quick start (and with a `.env`). Step 6 builds the code and generates the Prisma client: without it `typecheck` fails with TS2339 errors and the `test:integracion` files fail with `Cannot find module '.prisma/client/default'`.

| Command | What it measures | Needs |
|---|---|---|
| `npm run typecheck` | TypeScript type check (`tsc --noEmit`). | Nothing running. |
| `npm run test:domain` | Unit tests of the pure domain in `src/domain/` (money, ledger, bond, transfer rules). No database, no network. | Nothing running. |
| `npm run guante` | The "restriction gate": six checks by absence (domain imports no framework or database, no wall clock or randomness in the domain, no floating point for money, no ledger update or delete in the code, no wall clock in the bonds module, every monetary column is `BIGINT`). Each gate prints the terms it searched for. Ends with `Guante: 6/6 compuertas OK` when green. | Nothing running. |
| `npm run test:mutation` | Mutation testing (Stryker) of `src/domain/` only; fails below 70 % (`stryker.config.json`). It runs the domain tests once per mutant. | Nothing running. |
| `npm run test:integracion` | All integration tests in `test/*.int.spec.ts`, one file at a time, against the real database. Individual suites: `test:auth`, `test:cuentas`, `test:boletas`, `test:movimientos`, `test:contacto`, `test:billpay`, `test:prestamos`, `test:reloj`, `test:pdf`, `test:otros-bancos`, `test:concurrencia`, `test:idempotencia`, `test:costuras`, `test:costuras-credencial`. | Database up and migrated, `.env`. **Some suites reset the database.** |
| `npm run invariantes` | The ledger invariants I1 to I7 (every transaction sums to 0, the whole ledger sums to 0, balances are derived and not stored, no account below its limit, idempotency keys match transactions, the daily limit to other banks, the guarantee account equals the open bonds). It builds and starts the API itself if nothing answers on port 3000. `INV_SEMBRAR=0` audits what is already in the database without resetting. The spec sets a goal of under 60 seconds (`specs/S-11-invariantes.md`). | Database up and migrated, seams on. Resets the database unless `INV_SEMBRAR=0`. |
| `npm run invariantes:calibrar` | Calibration of the invariants: it injects one defect per invariant on purpose and checks that exactly the right invariant turns red and the others stay green. It resets the database when it ends. | Same as above. |
| `npm run verify:s00` | Health check in two directions: `/health` is 200 with the database up, and 503 with it down while the app stays alive. **It stops and restarts the database container.** | Docker; nothing else listening on port 3000. |
| `npm run verify:s04` | The database itself rejects what the append-only rule forbids. It runs `prisma migrate reset --force` first, so it **wipes** the local database. | Database up. |
| `npm run sonda:caja`, `npm run sonda:garantia` | Probabilistic race checks: the first concurrent operations when a system account does not exist yet (`RONDAS` and `APERTURAS` set the size; a pass does not prove absence of the race). | Database up, seams on. |
| `npm run demo:m6` | Full demo in a real browser, from reset: login, transfer, bond. Builds the backend and the `pruebas` web build, serves them on 3000 and 4200, drives Chromium. | Chromium installed, `python3`, ports 3000 and 4200 free, seams on. Resets the database. |
| `npm run verificar:s10-t1` to `t4`, `verificar:s17-boletas`, `-abrir-cuenta`, `-transferir`, `-movimientos`, `-pagos`, `-contacto`, `verificar:ux-a`, `ux-b1`, `ux-b2` | One browser-driven check per screen or feature, each named after its spec in `specs/`. Same startup as the demo (`verificar:s10-t4` also serves a production build on 4201). Each prints one line per check and a `N/M` summary; exit code 0 only when all pass. | Same as `demo:m6`. |

Before running `demo:m6` or any `verificar:*` script, **stop your own `npm start` and web dev
server**: the scripts start their own copies and abort with `ABORTA: el puerto N ya está ocupado` if a
port is taken. The `invariantes` and `sonda:*` scripts do the opposite: if an API already answers on
3000 they use it and leave it running.

Times: apart from the invariants goal above and a code comment saying the backend build takes about
15 seconds, this repository does not record how long these commands take, so none are promised here.
The `calibrar:*` scripts other than `invariantes:calibrar` are not included in this repository.

## Security notes

- **The database password is public.** The container created by `docker-compose.yml` uses the password
  `zerofeebank_local` (and the app role `zerofeebank_app` uses `zerofeebank_app_local`, created by a
  migration). They are written in this repository on purpose and are valid only for that local
  container. That is why `docker-compose.yml` publishes port 5432 **only on `127.0.0.1`**: nothing
  outside your machine can reach the database. Do not change that mapping to `5432:5432`, and never
  reuse these passwords, or anything like them, anywhere else.
- **The test seams have no authentication.** Anyone who can reach the API can call
  `POST /__test__/reset` and wipe the database. Turn them on (`ZFB_COSTURAS_PRUEBA=1`) only on your
  own machine. Leave them off on any shared computer, server or network.
- **Do not expose the backend to the internet or to your network.** The API does not restrict the
  network interface it listens on (`app.listen(port)` in `src/main.ts`); on a shared network use your
  firewall so port 3000 stays local. This project is a simulation, not hardened software.
- **Do not use real data.** No real names, ids (RUT), accounts, cards or passwords. Everything here is
  fictional by design.
- **`.env` is never uploaded.** It is git-ignored; only `.env.example` (which holds no secret) is
  versioned. Generate your own `ZFB_AUTH_SECRET`; do not share it or paste it in public issues.

## Troubleshooting

Each entry reads: symptom, cause, fix.

- **`npm run db:up` fails with an "address already in use" or "port is already allocated" error on 5432.**
  Another PostgreSQL (or another container) already uses port 5432, and the compose file publishes
  a fixed port. Stop it, or change the left side of the `ports` mapping in `docker-compose.yml` and the
  port in both database URLs in `.env`.
- **`db:up` fails because the container name `zerofeebank-db` is already in use.** The compose file
  fixes `container_name: zerofeebank-db`, so a container with that name from another checkout (or an
  older run) blocks it. Look with `docker ps -a --filter name=zerofeebank-db`. If it is the same
  project, `npm run db:up` just starts it. If it is stale and you do not need it,
  `docker rm -f zerofeebank-db`, then `npm run db:up` again.
- **"Cannot connect to the Docker daemon" or similar.** Docker is not running. Start Docker (open
  Docker Desktop, or start the service) and repeat the command.
- **`npm ci` prints `EBADENGINE` warnings, or the toolchain fails strangely.** Your Node is outside the
  `engines` of some dependencies (see [Requirements](#requirements)). Install Node 22.18.0 or newer
  (or 24.11.0 or newer) and run `npm ci` again.
- **`npm start` stops with `node: .env: not found`.** There is no `.env` in the repository root. Do
  step 3 of the quick start.
- **`npx prisma ...` or `npm run build` fail with `Failed to load config file` and
  `DATABASE_URL_MIGRACION no está definida`.** `prisma.config.ts` needs that variable; your `.env` is
  missing or lacks it. Copy `.env.example` again, or add the line.
- **The API stops at startup with `ZFB_AUTH_SECRET no está definida o mide menos de 32 caracteres`.**
  The secret is empty or too short. `.env.example` leaves it empty on purpose: generate one (step 3)
  and restart.
- **The API stops with `DATABASE_URL no está definida`, or with `DATABASE_URL_MIGRACION no está definida`.**
  The variable is missing in `.env` (the second one is required when `ZFB_COSTURAS_PRUEBA=1`).
- **The API stops with `ZFB_ORIGEN_APP inválido`.** The value is not an exact origin. Use
  `http://localhost:4200`, without a trailing slash or path.
- **`/health` says `503` and `"db":"down"`.** The API cannot reach the database: the container is not
  running, or the URL in `.env` has the wrong port. Run `npm run db:up` and check `docker ps`.
- **`/health` is fine but requests fail, or the app cannot log in ("password authentication failed
  for user zerofeebank_app", or a missing-table error).** The schema is not migrated: the migration
  creates the role and the tables. Run `npx prisma migrate reset --force`, and check with
  `npx prisma migrate status`.
- **The web page loads but login or data fail, and the browser console shows CORS errors, or the login
  frame is blank.** The web app talks to `http://localhost:3000` (fixed in its source) and the API only
  allows the origin in `ZFB_ORIGEN_APP`. Make sure the API runs on 3000 and that you open the web app
  on the origin set in `ZFB_ORIGEN_APP` (default `http://localhost:4200`).
- **Any `__test__` route answers 404.** The seams are off. Set `ZFB_COSTURAS_PRUEBA=1` in `.env` and
  restart the API.
- **`window.__zfb__` is undefined in the browser.** You are on the development build (`npm start`
  in `web/`). Build with `--configuration pruebas` (see "Injectable clock").
- **`demo:m6` or a `verificar:*` script prints `ABORTA: el puerto 3000 ya está ocupado`** (or 4200 or
  4201). Something is already listening there, often your own `npm start` or `ng serve`. Stop it and
  run the script again.
- **A browser script fails saying the Chromium executable does not exist.** Playwright's browser
  is not installed. Run `npx playwright-core install chromium`.
- **`npx playwright-core install chromium` says "Playwright does not support chromium on
  ubuntu26.04-x64" (or on another Ubuntu newer than the ones Playwright knows).** Playwright does
  not recognise your distribution. Point it at a supported one: `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64
  npx playwright-core install chromium` (tested on Ubuntu 26.04: it fails without the variable and
  downloads the browser with it).
- **`npm ci` ends with "N vulnerabilities" warnings.** That is the informational output of
  `npm audit` about the dependencies. This repository is a local simulator that must not be
  deployed (see "Security notes"). Do not run `npm audit fix --force` blindly: it can change
  versions that are pinned on purpose, such as `playwright-core` 1.60.0.
- **A script says `ROJO: la BD no levanta` or `ROJO: build del backend`.** The first means
  `docker compose up -d --wait` failed (Docker off, port or name conflict, see above); the second means
  `npm run build` failed (for example a missing `.env`, see above). Read the log file the script names
  (`ZFB_LOG`).

## Repository layout

```
.
├── src/                 backend (NestJS): domain/ (pure rules), modules/ (use cases), infra/
├── prisma/              schema and the SQL migrations
├── web/                 Angular frontend
├── test/                integration tests (*.int.spec.ts)
├── scripts/             guante, invariants, demo and the per-screen browser checks
├── specs/               specs, user stories (HU-*) and the data-testid lists
├── docker-compose.yml   PostgreSQL 18 for local use
├── .env.example         template for your own .env
├── AGENTS.md            domain rules, invariants, error codes, seam contract
├── ARQUITECTURA.md      architecture and the reasons behind it
└── LICENSE              MIT
```

## Rigor

Money is the one domain where a rounding error is invisible: the UI looks fine, the tests pass, and
the books do not balance. So this project puts its checks on data invariants, and it calibrates
them by breaking the system on purpose to confirm the check turns red. Every row below names the
command that reproduces it; the one exception is noted under the table.

| Measure | Result | Measured on | Checked on publish day |
|---|---|---|---|
| Mutation score on `src/domain/` (`npm run test:mutation`, Stryker; threshold 70 %) | 82.93 % | 2026-10-01 | done |
| Domain unit tests (`npm run test:domain`) | 140/140 | 2026-10-01 | done |
| Integration tests (`npm run test:integracion`) | 446/446 | 2026-10-01 | done |
| Ledger invariants I1 to I7 (`npm run invariantes`) | 7/7 | 2026-10-01 | done |
| Invariant calibration (`npm run invariantes:calibrar`, defects injected on purpose) | 21/21 | 2026-10-01 | done |
| Full demo (`npm run demo:m6`, login to transfer to bond, from reset) | 3/3 runs, 42/42 steps | 2026-10-01 | done |
| Boletas screen check (`npm run verificar:s17-boletas`) | 43/43 | 2026-10-01 | done |
| Boletas screen check calibration (`npm run calibrar:s17-boletas`, defects injected on purpose) | 52/54 (2 injected defects not caught) | 2026-10-01 | done |
| Restriction gate (`npm run guante`) | 6/6 | 2026-10-01 | done |

Note: the script behind `calibrar:s17-boletas` is not included in this repository, so that one row
cannot be reproduced from here; the other rows can.

A "blind" verification is one that could not turn red on the defect it was meant to catch. Finding
those, and fixing them, is the point of calibrating. The numbers above are not a claim that the
system has no defects: a green suite only shows that the suite found nothing.

## License and disclaimer

[MIT](LICENSE). The software is provided **as is**, without warranty of
any kind. Nothing here is legal, financial or security advice. This is a simulation: no real money,
no real accounts and no real bank are involved, and it must not be deployed as if it were one.
