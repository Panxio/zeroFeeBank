> **Simulación para practicar automatización de pruebas. No es un banco ni un servicio financiero. Todos los datos son ficticios. No ingreses datos personales ni financieros reales.**

# zeroFeeBank

*Read in English: [README.md](README.md)*

zeroFeeBank es un simulador bancario construido como **sistema bajo prueba (SUT)**: una aplicación
web realista a la que puedes apuntar Selenium, Playwright o Cypress para practicar automatización
de pruebas. Piensa en [ParaBank](https://parabank.parasoft.com/), pero actual, determinista y
diseñado desde el primer día para ser automatizado.

**Qué no es.** No es un banco ni un servicio financiero. No hay dinero real, cuentas reales, un
banco real ni tasas reales. Cada pantalla lleva una franja de aviso que lo dice (mira «Franja de
aviso de simulación» en [Costuras de prueba](#costuras-de-prueba)). Nunca ingreses datos personales
ni financieros reales.

- **Backend:** NestJS + PostgreSQL + Prisma (TypeScript).
- **Frontend:** Angular 21 (`web/`).
- **La interfaz de usuario es bilingüe** (español por defecto e inglés), se elige con el selector
  de idioma de la cabecera y la elección dura lo que dura la sesión del navegador. La documentación
  está en inglés (y en español en este archivo). Las specs de `specs/` están escritas, por ahora, en
  español.
- **La suite E2E no está en este repositorio, a propósito.** Una suite que vive dentro de la app
  termina apoyándose en su código y deja de ser portable entre frameworks. Mira
  [ARQUITECTURA.md](ARQUITECTURA.md) (en inglés).

## Contenido

1. [Qué puedes automatizar](#qué-puedes-automatizar)
2. [Requisitos](#requisitos)
3. [Inicio rápido, paso a paso](#inicio-rápido-paso-a-paso)
4. [Variables de entorno](#variables-de-entorno)
5. [Costuras de prueba](#costuras-de-prueba)
6. [Cómo correr las comprobaciones](#cómo-correr-las-comprobaciones)
7. [Security notes](#security-notes)
8. [Solución de problemas](#solución-de-problemas)
9. [Limitaciones conocidas](#limitaciones-conocidas)
10. [Estructura del repositorio](#estructura-del-repositorio)
11. [Rigor](#rigor)
12. [Licencia y descargo](#licencia-y-descargo)

## Qué puedes automatizar

| Pantalla / flujo | Qué hace |
|---|---|
| **Login / registro** | Ventana emergente de login (el formulario lo sirve la API como un marco incrustado, un documento de otro origen, buen ejercicio de automatización) con creación de cuenta |
| **Cuentas** | Resumen de cuentas con saldos y apertura de una cuenta nueva (corriente o de ahorro) |
| **Transferencias** | Transferencia en tres pasos (origen, destino, revisión) a una cuenta propia, a otra cuenta por id o a otro banco; las peticiones repetidas se señalan; comprobante en PDF |
| **Movimientos** | Historial de movimientos con búsqueda, por cuenta |
| **Pagos** | Pago a terceros (datos del beneficiario, monto) y lista de pagos hechos |
| **Boletas de garantía** | Emitir, listar y devolver boletas de garantía; el vencimiento depende del tiempo, así que el reloj es controlable (mira más abajo); comprobantes en PDF |
| **Ventanilla** | Pantalla pública donde se cobra una boleta con su id y el RUT de quien retira |
| **Contacto** | Ver y editar los datos de contacto del cliente |

Las historias de usuario por pantalla están en [`specs/`](specs/)
([HU-01](specs/HU-01-tipos-de-transferencia.md),
[HU-02](specs/HU-02-pantalla-boletas.md),
[HU-03](specs/HU-03-pantalla-movimientos.md),
[HU-04](specs/HU-04-pantalla-abrir-cuenta-y-transferir.md),
[HU-05](specs/HU-05-pantalla-pagos.md),
[HU-06](specs/HU-06-pantalla-contacto.md)).

## Requisitos

| Herramienta | Qué se necesita | Por qué / de dónde sale |
|---|---|---|
| **Node.js** | **22.18.0 o superior dentro de la línea 22, o 24.11.0 o superior** | El repositorio **no** fija una versión de Node (no hay campo `engines` ni `.nvmrc`). Este rango es derivado: es la intersección de los `engines` que declaran las dependencias en `package-lock.json` (por ejemplo los paquetes `@babel/*` que trae Stryker: `^22.18.0 \|\| >=24.11.0`; Vitest 5: `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`; Prisma 7.10 y Angular CLI 21.2 en `web/package-lock.json`: `^20.19 \|\| ^22.12 \|\| >=24`). Además el script de arranque usa `node --env-file` y la configuración de Prisma usa `process.loadEnvFile`. Node 25 queda fuera del rango declarado por Vitest. |
| **npm** | El que viene con esas versiones de Node | `web/package.json` declara `packageManager: npm@9.2.0`; el Angular CLI declara npm `>= 8` como mínimo. Los dos lockfiles son `lockfileVersion` 3. |
| **Docker con Compose v2** | `docker` y el subcomando `docker compose` | Levanta PostgreSQL 18 (`postgres:18-alpine`, mira `docker-compose.yml`). Los scripts npm llaman a `docker compose`, no a `docker-compose`. |
| **bash, curl, python3, openssl** | Sólo para los scripts de `scripts/` y la demo | Los scripts son bash; usan `curl`, `python3 -m http.server` (para servir el build web), `openssl` y `base64 -w0` de GNU (`scripts/lib-app.sh`). Se escribieron para Linux; no están verificados en macOS ni en Windows (en Windows, usa WSL o un entorno bash similar). No hacen falta para `npm start`, la app web ni los tests unitarios. |
| **Chromium para Playwright** | Sólo para `npm run demo:m6` y todos los scripts `verificar:*` | Esos scripts manejan un navegador real mediante `playwright-core` (fijado en 1.60.0 en `package.json`), que no trae uno incluido. Instálalo una vez con `npx playwright-core install chromium` (desde la raíz del repositorio, después de `npm ci`). Si luego Chromium no arranca por faltar librerías del sistema en Linux, `npx playwright-core install-deps chromium` las instala (pide sudo). |

**Puertos usados** (todos en `localhost`):

| Puerto | Lo usa | Si está ocupado |
|---|---|---|
| **5432** | PostgreSQL en Docker. Publicado sólo en `127.0.0.1` (`docker-compose.yml`). | Detén lo que lo use, o cambia el lado izquierdo del mapeo `ports` en `docker-compose.yml` **y** el puerto dentro de las dos URLs de base de datos de tu `.env`. |
| **3000** | La API (`PORT`, por defecto 3000). **La app web lleva este puerto escrito en su código** (`web/src/app/app.ts`, `web/src/app/app.html`), así que no cambies `PORT` a menos que edites también esos archivos. | Detén el otro programa. |
| **4200** | El servidor de desarrollo de Angular, y el origen que la API permite por CORS (`ZFB_ORIGEN_APP`, por defecto `http://localhost:4200`). | Detén el otro programa. Si sirves la app web en otro puerto, define `ZFB_ORIGEN_APP` con ese origen exacto en `.env` y reinicia la API. |
| **4201** | Sólo `npm run verificar:s10-t4`, que sirve ahí un build de producción. | El script aborta; libera el puerto. |

## Inicio rápido, paso a paso

Todos los comandos se ejecutan desde la raíz del repositorio, salvo los que empiezan con `cd`. Haz
los pasos en orden.

**1. Revisa tus herramientas.**

```bash
node --version
docker compose version
```

Esperado: una versión de Node dentro del rango de arriba y una línea de versión de Compose v2.
Asegúrate de que el servicio de Docker esté corriendo (Docker Desktop abierto en Windows y macOS).

**2. Clona el repositorio e instala las dependencias del backend.**

```bash
git clone https://github.com/Panxio/zeroFeeBank.git
cd zeroFeeBank
npm ci
```

Esperado: `npm ci` termina con una línea «added N packages» y sin `ERR!`.

**3. Crea tu `.env`.** El archivo `.env` **no** está en el repositorio: git lo ignora (`.gitignore`
ignora `.env` y `.env.*`, y conserva sólo `.env.example`), así que cada persona crea el suyo.
Parte de la plantilla:

```bash
cp .env.example .env
```

En Windows PowerShell usa `Copy-Item .env.example .env`. Luego genera un secreto de firma y pégalo
después de `ZFB_AUTH_SECRET=` en tu `.env`. El secreto **debe medir al menos 32 caracteres**; la
plantilla lo deja vacío a propósito, y la API se niega a arrancar mientras esté vacío.

- Linux o macOS (con `openssl`): `openssl rand -hex 32`
- Cualquier sistema con Node (también Windows): `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`

Los dos imprimen 64 caracteres hexadecimales. Abre `.env` en un editor y deja la línea así, por
ejemplo: `ZFB_AUTH_SECRET=<los 64 caracteres que acabas de generar>`, sin espacios ni comillas.
(El comando de Node se comprobó sólo en Linux.)

<details>
<summary>Alternativa: escribir todo el <code>.env</code> con un solo comando</summary>

Los valores de base de datos son las credenciales públicas del contenedor local (mira
[Security notes](#security-notes)). El bloque de Linux/macOS se ejecutó y imprime `64`; **el bloque
de PowerShell NO ESTÁ PROBADO** (no había PowerShell disponible al escribir este README).

Linux y macOS (bash o zsh, con `openssl`):

```bash
cat > .env <<EOF
DATABASE_URL=postgresql://zerofeebank_app:zerofeebank_app_local@localhost:5432/zerofeebank
DATABASE_URL_MIGRACION=postgresql://zerofeebank:zerofeebank_local@localhost:5432/zerofeebank
PORT=3000
ZFB_AUTH_SECRET=$(openssl rand -hex 32)
ZFB_COSTURAS_PRUEBA=1
ZFB_ORIGEN_APP=http://localhost:4200
EOF

# Comprueba el largo del secreto (debe imprimir 64)
awk -F= '/^ZFB_AUTH_SECRET/{print length($2)}' .env
```

Windows (PowerShell), sin probar:

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

# Comprueba el largo del secreto (debe imprimir 64)
$secret.Length
```

El `-Encoding ascii` importa en Windows PowerShell 5.1, donde la codificación por defecto puede
escribir una marca de orden de bytes que corrompería el nombre de la primera variable.
</details>

**4. Levanta la base de datos.**

```bash
npm run db:up
```

Esperado: la primera vez Docker descarga `postgres:18-alpine` y el comando termina cuando el
contenedor `zerofeebank-db` está sano (`docker compose up -d --wait`). Compruébalo con
`docker ps --filter name=zerofeebank-db`: la columna de estado dice `(healthy)`.

**5. Crea el esquema desde las migraciones.** Esto borra la base de datos local (no importa en una
recién creada).

```bash
npx prisma migrate reset --force
```

Si Prisma se niega a ejecutar `migrate reset` (tiene una guarda que lo rechaza cuando lo lanza un
agente automático de IA), en una base recién creada usa `npx prisma migrate deploy`: aplica las
mismas migraciones sin borrar nada.

Esperado: se aplican las 8 migraciones de `prisma/migrations/`, la última es
`20260914213749_s22_transferencia_otro_banco`. Compruébalo con:

```bash
npx prisma migrate status
```

Esperado: la salida contiene `Database schema is up to date`. La migración `s04_ledger_append_only`
crea además el rol de base de datos sin privilegios `zerofeebank_app` que usa tu `DATABASE_URL`; por
eso las migraciones deben correr antes que la API.

**6. Compila y levanta la API.**

```bash
npm run build
npm start
```

Esperado: la compilación termina sin errores (ejecuta `prisma generate` y `tsc`, y crea
`dist/main.js`); `npm start` imprime `zeroFeeBank escuchando en http://localhost:3000` y se queda
corriendo. Deja esa terminal abierta.

**7. Comprueba la API en una segunda terminal.**

```bash
curl -i http://localhost:3000/health
```

Esperado: `HTTP/1.1 200` y el cuerpo `{"status":"ok","db":"up"}`. Si la base de datos no es
alcanzable responde `503` con `{"status":"degraded","db":"down"}`. Ojo: `"db":"up"` sólo demuestra
que la base responde; no demuestra que las migraciones corrieron (para eso usa
`npx prisma migrate status`).

**8. Instala y levanta la app web, en esa segunda terminal.**

```bash
cd web
npm ci
npm start
```

Esperado: el servidor de desarrollo de Angular (`ng serve`) compila la app y la sirve en
`http://localhost:4200/`.

**9. Abre la app.** Ve a <http://localhost:4200/>. Deberías ver la portada con la franja de aviso de
simulación. No hay usuarios de demo incorporados: abre la ventana emergente de login y crea una
cuenta (la clave necesita al menos 8 caracteres, `src/modules/auth/auth.service.ts`). Para tener un
usuario ya armado y con datos, usa la costura de siembra de más abajo; dos escenarios devuelven
credenciales de acceso que funcionan.

Para detener todo: `Ctrl+C` en cada terminal y luego `npm run db:down` (detiene el contenedor; tus
datos quedan en el volumen de Docker).

> `npm start` dentro de `web/` sirve el build de **desarrollo**, que **no** expone el gancho de
> reloj del navegador (`window.__zfb__`). Para tenerlo usa el build `pruebas` (mira «Reloj
> inyectable» más abajo).

## Variables de entorno

Éstas son las variables que lee el código. Sus valores van en tu propio `.env` (copiado de
`.env.example`), que nunca se versiona.

| Variable | Obligatoria | Por defecto | Para qué sirve y de dónde sale |
|---|---|---|---|
| `DATABASE_URL` | **Sí** | ninguno | Conexión que usa la app, con el rol sin privilegios `zerofeebank_app`, que no puede hacer `UPDATE` ni `DELETE` sobre el libro mayor. La app se niega a arrancar sin ella (`src/infra/prisma.service.ts`). |
| `DATABASE_URL_MIGRACION` | **Sí** | ninguno | Conexión que usan las migraciones, con el dueño de la base `zerofeebank`. Todo comando de Prisma (`prisma.config.ts`) falla sin ella, y también la API cuando las costuras de prueba están encendidas (`src/modules/costuras/`). |
| `ZFB_AUTH_SECRET` | **Sí** | ninguno (vacía en `.env.example`) | Secreto de firma del token. La API se niega a arrancar si falta o mide menos de 32 caracteres (`src/modules/auth/auth.service.ts`). |
| `PORT` | No | `3000` | Puerto de la API (`src/main.ts`). La app web espera el 3000. |
| `ZFB_COSTURAS_PRUEBA` | No | apagado | Enciende las costuras de prueba sólo si vale exactamente `1`; cualquier otro valor, o ninguno, es apagado. `.env.example` la deja en `1`. La demo y los scripts `verificar:*`, `invariantes` y `sonda:*` la necesitan encendida. |
| `ZFB_ORIGEN_APP` | No | `http://localhost:4200` | Origen web que la API permite por CORS. Debe ser un origen exacto: sin barra final ni ruta (`src/infra/origen-app.ts`). |

Sólo para scripts: `ZFB_LOG` define dónde escriben su log la demo y los scripts `verificar:*` (cada
script trae su propio valor por defecto).

## Costuras de prueba

La app expone los ganchos que necesita una suite de automatización, de modo que nunca tenga que
tocar la base de datos ni parchear el reloj por dentro. Son rutas bajo `/__test__/` más algunas
convenciones.

**Cómo encenderlas.** Pon `ZFB_COSTURAS_PRUEBA=1` en `.env` y reinicia la API. **Cómo mantenerlas
apagadas:** borra la línea, o usa cualquier valor distinto de `1`. Con el flag apagado las rutas no
están montadas, así que responden 404, no 403. Puedes comprobarlo:

```bash
curl -i -X POST http://localhost:3000/__test__/reset
```

Esperado con el flag **apagado**: `HTTP/1.1 404`. Esperado con el flag **encendido**: `HTTP/1.1 200`
y el cuerpo `{"ok":true,"tablasVaciadas":[...]}`, **y la base de datos acaba de quedar vacía**. No lo
ejecutes sobre datos que quieras conservar.

- **Sembrado y reseteo por API, detrás del flag.**
  - `POST /__test__/reset` vacía las tablas (usuarios, cuentas, movimientos, boletas, claves de
    idempotencia) y libera el reloj fijado (HTTP 200).
  - `POST /__test__/seed` con `{"escenario": "<nombre>"}` crea un escenario nombrado y **devuelve
    los ids que creó** (HTTP 201). Escenarios: `cuenta-unica`, `dos-cuentas`,
    `cuenta-con-historial`, `movimientos-buscables`, `boletas-en-cada-estado`. Sólo los dos últimos
    devuelven un objeto `credenciales` (`email`, `password`) que sirve para entrar desde la interfaz;
    los otros escenarios crean un usuario con el que nadie puede entrar. Un escenario desconocido
    falla con ruido y devuelve `ESCENARIO_DESCONOCIDO`.
  - `POST /__test__/reloj` mueve el reloj del servidor: `{"instante": "<fecha ISO>"}` lo fija,
    `{"instante": null}` lo libera y `{"avanzarMs": <n>}` adelanta un reloj fijado.

  ```bash
  curl -s -X POST http://localhost:3000/__test__/seed \
    -H 'Content-Type: application/json' \
    -d '{"escenario":"boletas-en-cada-estado"}'
  ```

  Esperado: HTTP 201 y un cuerpo JSON con `usuarioId`, `cuentas`, `boletas` y `credenciales`. Entra en
  <http://localhost:4200/> con ese email y esa clave.
- **Reloj inyectable.** El tiempo nunca sale del reloj de pared dentro del dominio, así que el
  vencimiento de una boleta se prueba sin esperar meses. El reloj del servidor se mueve con
  `POST /__test__/reloj`. Para el navegador, compila la app web con la configuración `pruebas`, que
  expone `window.__zfb__.reloj` (`fijar`, `avanzar`, `desfijar`, en milisegundos), y sírvela en el
  4200 como hacen los scripts:

  ```bash
  cd web
  npx ng build --configuration pruebas
  python3 -m http.server 4200 --directory dist/web/browser
  ```

  Esperado: la compilación termina sin errores y la app queda servida en <http://localhost:4200/>.
  Usa esto en vez de `npm start` en `web/` (no corras los dos: usan el mismo puerto).
- **Códigos de error tipados.** Todo error de negocio devuelve `{ "codigo":
  "FONDOS_INSUFICIENTES", "mensaje": "..." }`. Afirma sobre el código; el mensaje legible puede
  cambiar. El catálogo está en [AGENTS.md](AGENTS.md) (en inglés).
- **`data-testid` como contrato versionado.** Todo elemento con el que interactúa un flujo de
  negocio lleva un `data-testid` estable. Las listas están versionadas en `specs/`
  (`S-10-testids-T1.txt` a `T4.txt`, `S-17-testids-*.txt` y la lista del selector de idioma). Renombrar
  uno rompe todas las suites a la vez, así que un cambio es un cambio de contrato, no un detalle de
  implementación. Los estados de carga, vacío y error tienen sus propios test ids (por ejemplo
  `cuentas-cargando`, `cuentas-error`, `boletas-cargando`). No ancles los localizadores en texto
  visible ni en montos formateados.
- **Selector de idioma y `?lang=`.** El selector es un `<select data-testid="idioma-selector">`
  con las opciones `es` y `en`; su nombre accesible (`aria-label`) sigue el idioma activo.
  `?lang=en` o `?lang=es` en la URL fija el idioma al arrancar, para que una suite entre a cada
  ruta en un idioma conocido sin pulsar el selector. Prioridad al arrancar: parámetro `?lang=`
  primero, luego la clave `zfb.idioma` de `sessionStorage`, luego `es`. `<html lang>` sigue al
  idioma activo. Los errores de negocio se muestran por su código tipado (por ejemplo
  `FONDOS_INSUFICIENTES`): una suite debe afirmar sobre el código y no sobre el texto visible, que
  cambia con el idioma. El campo `mensaje` de las respuestas de la API sigue en español: el front lo
  reemplaza por el texto de su catálogo según el `codigo`.
- **Idempotencia.** Todo `POST` que mueve dinero exige un header `Idempotency-Key`; una repetición
  devuelve la misma respuesta y el header `Idempotency-Replayed: true`.
- **Franja de aviso de simulación.** La app web tiene dos regiones `<main>` (la portada, que también
  aloja las pantallas con sesión iniciada, y la ventanilla pública). Cada una lleva una franja que
  dice que es una simulación, que no es un banco ni un servicio financiero y que todos los datos
  son ficticios; la franja sigue el idioma elegido (en español dice «No es un banco…» y en inglés
  «Not a bank…»). Es un `<p role="note" data-testid="aviso-simulacion">`, exactamente uno por
  `<main>`, sin posición `fixed` ni `sticky`, así que no tapa un control.

## Cómo correr las comprobaciones

Córrelas desde la raíz del repositorio, después de los pasos 2 a 6 del inicio rápido (y con un
`.env`). El paso 6 compila y genera el cliente de Prisma: sin él `typecheck` falla con errores
TS2339 y los archivos de `test:integracion` fallan con `Cannot find module '.prisma/client/default'`.

| Comando | Qué mide | Necesita |
|---|---|---|
| `npm run typecheck` | Chequeo de tipos de TypeScript (`tsc --noEmit`). | Nada corriendo. |
| `npm run test:domain` | Tests unitarios del dominio puro en `src/domain/` (reglas de dinero, libro mayor, boleta, transferencia). Sin base de datos ni red. | Nada corriendo. |
| `npm run guante` | El «guante de restricciones»: seis comprobaciones por ausencia (el dominio no importa framework ni base de datos, sin reloj de pared ni azar en el dominio, sin coma flotante para dinero, sin update ni delete del libro mayor en el código, sin reloj de pared en el módulo de boletas, toda columna monetaria es `BIGINT`). Cada compuerta imprime los términos que buscó. Termina con `Guante: 6/6 compuertas OK` cuando está en verde. | Nada corriendo. |
| `npm run test:mutation` | Pruebas de mutación (Stryker) sólo sobre `src/domain/`; falla bajo 70 % (`stryker.config.json`). Corre los tests del dominio una vez por mutante. | Nada corriendo. |
| `npm run test:integracion` | Todos los tests de integración de `test/*.int.spec.ts`, un archivo a la vez, contra la base de datos real. Suites sueltas: `test:auth`, `test:cuentas`, `test:boletas`, `test:movimientos`, `test:contacto`, `test:billpay`, `test:prestamos`, `test:reloj`, `test:pdf`, `test:otros-bancos`, `test:concurrencia`, `test:idempotencia`, `test:costuras`, `test:costuras-credencial`. | Base de datos arriba y migrada, `.env`. **Algunas suites resetean la base.** |
| `npm run invariantes` | Los invariantes del libro mayor I1 a I7 (cada transacción suma 0, todo el libro suma 0, los saldos se derivan y no se guardan, ninguna cuenta bajo su límite, las claves de idempotencia calzan con las transacciones, el tope diario a otros bancos, la cuenta de garantía iguala las boletas vigentes). Compila y levanta la API por su cuenta si nada responde en el puerto 3000. Con `INV_SEMBRAR=0` audita lo que ya hay en la base sin resetear. La spec fija una meta de menos de 60 segundos (`specs/S-11-invariantes.md`). | Base de datos arriba y migrada, costuras encendidas. Resetea la base salvo con `INV_SEMBRAR=0`. |
| `npm run invariantes:calibrar` | Calibración de los invariantes: inyecta un defecto por invariante a propósito y comprueba que se pone roja exactamente la comprobación correcta y las demás siguen verdes. Resetea la base al terminar. | Igual que el anterior. |
| `npm run verify:s00` | Chequeo de salud en dos sentidos: `/health` da 200 con la base arriba y 503 con la base abajo, y la app sigue viva. **Detiene y reinicia el contenedor de la base.** | Docker; nada más escuchando en el puerto 3000. |
| `npm run verify:s04` | La propia base rechaza lo que prohíbe la regla de sólo-agregar. Ejecuta antes `prisma migrate reset --force`, así que **borra** la base local. | Base de datos arriba. |
| `npm run sonda:caja`, `npm run sonda:garantia` | Sondas probabilísticas de carrera: las primeras operaciones simultáneas cuando una cuenta de sistema todavía no existe (`RONDAS` y `APERTURAS` fijan el tamaño; que pasen no demuestra que la carrera no exista). | Base de datos arriba, costuras encendidas. |
| `npm run demo:m6` | Demo completa en un navegador real, desde el reset: login, transferencia, boleta. Compila el backend y el build web `pruebas`, los sirve en el 3000 y el 4200 y maneja Chromium. | Chromium instalado, `python3`, puertos 3000 y 4200 libres, costuras encendidas. Resetea la base. |
| `npm run verificar:s10-t1` a `t4`, `verificar:s17-boletas`, `-abrir-cuenta`, `-transferir`, `-movimientos`, `-pagos`, `-contacto`, `verificar:ux-a`, `ux-b1`, `ux-b2` | Una comprobación con navegador por pantalla o funcionalidad, cada una con el nombre de su spec en `specs/`. Mismo arranque que la demo (`verificar:s10-t4` sirve además un build de producción en el 4201). Cada una imprime una línea por comprobación y un resumen `N/M`; sale con código 0 sólo si pasan todas. | Igual que `demo:m6`. |

Antes de correr `demo:m6` o cualquier script `verificar:*`, **detén tu propio `npm start` y tu
servidor web de desarrollo**: los scripts levantan sus propias copias y abortan con `ABORTA: el
puerto N ya está ocupado` si un puerto está tomado. Los scripts `invariantes` y `sonda:*` hacen lo
contrario: si ya hay una API respondiendo en el 3000, la usan y la dejan corriendo.

Tiempos: aparte de la meta de los invariantes y de un comentario en el código que dice que el build
del backend tarda unos 15 segundos, este repositorio no registra cuánto tardan estos comandos, así
que aquí no se promete ninguno. Los scripts `calibrar:*` distintos de `invariantes:calibrar` no
están incluidos en este repositorio.

## Security notes

*(El título se deja en inglés a propósito, igual que en el README en inglés.)*

- **La clave de la base de datos es pública.** El contenedor que crea `docker-compose.yml` usa la
  clave `zerofeebank_local` (y el rol de la app `zerofeebank_app` usa `zerofeebank_app_local`,
  creado por una migración). Están escritas en este repositorio a propósito y sólo valen para ese
  contenedor local. Por eso `docker-compose.yml` publica el puerto 5432 **sólo en `127.0.0.1`**:
  nada fuera de tu equipo puede llegar a la base de datos. No cambies ese mapeo a `5432:5432` y
  nunca reutilices estas claves, ni nada parecido, en otro lugar.
- **Las costuras de prueba no tienen autenticación.** Cualquiera que pueda llegar a la API puede
  llamar a `POST /__test__/reset` y vaciar la base de datos. Enciéndelas (`ZFB_COSTURAS_PRUEBA=1`)
  sólo en tu propio equipo. Déjalas apagadas en cualquier computador, servidor o red compartidos.
- **No expongas el backend a internet ni a tu red.** La API no restringe la interfaz de red en la
  que escucha (`app.listen(puerto)` en `src/main.ts`); en una red compartida usa tu cortafuegos para
  que el puerto 3000 quede sólo local. Este proyecto es una simulación, no software endurecido.
- **No uses datos reales.** Ni nombres, ni RUT, ni cuentas, ni tarjetas, ni claves reales. Todo lo
  de aquí es ficticio por diseño.
- **El `.env` nunca se sube.** Git lo ignora; sólo se versiona `.env.example` (que no guarda ningún
  secreto). Genera tu propio `ZFB_AUTH_SECRET`; no lo compartas ni lo pegues en issues públicos.

## Solución de problemas

Cada entrada dice: síntoma, causa, solución.

- **`npm run db:up` falla con un error de «address already in use» o «port is already allocated» en
  el 5432.** Otro PostgreSQL (u otro contenedor) ya usa el puerto 5432, y el compose publica un
  puerto fijo. Detenlo, o cambia el lado izquierdo del mapeo `ports` en `docker-compose.yml` y el
  puerto en las dos URLs de base de datos de `.env`.
- **`db:up` falla porque el nombre de contenedor `zerofeebank-db` ya está en uso.** El compose fija
  `container_name: zerofeebank-db`, así que un contenedor con ese nombre de otra copia del
  repositorio (o de una corrida anterior) lo bloquea. Míralo con
  `docker ps -a --filter name=zerofeebank-db`. Si es el mismo proyecto, `npm run db:up` simplemente
  lo inicia. Si quedó viejo y no lo necesitas, `docker rm -f zerofeebank-db` y vuelve a ejecutar
  `npm run db:up`.
- **«Cannot connect to the Docker daemon» o parecido.** Docker no está corriendo. Inicia Docker
  (abre Docker Desktop, o inicia el servicio) y repite el comando.
- **`npm ci` muestra avisos `EBADENGINE`, o la cadena de herramientas falla de forma rara.** Tu Node
  está fuera de los `engines` de alguna dependencia (mira [Requisitos](#requisitos)). Instala Node
  22.18.0 o superior (o 24.11.0 o superior) y vuelve a ejecutar `npm ci`.
- **`npm start` se detiene con `node: .env: not found`.** No hay un `.env` en la raíz del
  repositorio. Haz el paso 3 del inicio rápido.
- **`npx prisma ...` o `npm run build` fallan con `Failed to load config file` y
  `DATABASE_URL_MIGRACION no está definida`.** `prisma.config.ts` necesita esa variable; tu `.env`
  no existe o no la tiene. Copia de nuevo `.env.example`, o agrega la línea.
- **La API se detiene al arrancar con `ZFB_AUTH_SECRET no está definida o mide menos de 32
  caracteres`.** El secreto está vacío o es muy corto. `.env.example` lo deja vacío a propósito:
  genera uno (paso 3) y reinicia.
- **La API se detiene con `DATABASE_URL no está definida`, o con `DATABASE_URL_MIGRACION no está
  definida`.** Falta la variable en `.env` (la segunda es obligatoria cuando
  `ZFB_COSTURAS_PRUEBA=1`).
- **La API se detiene con `ZFB_ORIGEN_APP inválido`.** El valor no es un origen exacto. Usa
  `http://localhost:4200`, sin barra final ni ruta.
- **`/health` responde `503` y `"db":"down"`.** La API no alcanza la base de datos: el contenedor no
  está corriendo, o la URL de `.env` tiene el puerto equivocado. Ejecuta `npm run db:up` y revisa
  `docker ps`.
- **`/health` está bien pero las peticiones fallan, o no se puede iniciar sesión («password
  authentication failed for user zerofeebank_app», o un error de tabla inexistente).** El esquema no
  está migrado: la migración crea el rol y las tablas. Ejecuta `npx prisma migrate reset --force` y
  comprueba con `npx prisma migrate status`.
- **La página web carga pero el login o los datos fallan, y la consola del navegador muestra errores
  de CORS, o el marco de login está en blanco.** La app web habla con `http://localhost:3000` (fijo
  en su código) y la API sólo permite el origen de `ZFB_ORIGEN_APP`. Asegúrate de que la API corra
  en el 3000 y de abrir la app web en el origen definido en `ZFB_ORIGEN_APP` (por defecto
  `http://localhost:4200`).
- **Una ruta `__test__` responde 404.** Las costuras están apagadas. Pon `ZFB_COSTURAS_PRUEBA=1` en
  `.env` y reinicia la API.
- **`window.__zfb__` es undefined en el navegador.** Estás en el build de desarrollo (`npm start` en
  `web/`). Compila con `--configuration pruebas` (mira «Reloj inyectable»).
- **`demo:m6` o un script `verificar:*` imprime `ABORTA: el puerto 3000 ya está ocupado`** (o 4200
  o 4201). Algo ya está escuchando ahí, a menudo tu propio `npm start` o `ng serve`. Deténlo y corre
  el script de nuevo.
- **Un script con navegador falla diciendo que no existe el ejecutable de Chromium.** El navegador de
  Playwright no está instalado. Ejecuta `npx playwright-core install chromium`.
- **`npx playwright-core install chromium` dice «Playwright does not support chromium on
  ubuntu26.04-x64» (o en otra versión de Ubuntu más nueva que las que Playwright conoce).**
  Playwright no reconoce tu distribución. Indícale una soportada: `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64
  npx playwright-core install chromium` (probado en Ubuntu 26.04: sin la variable falla, con ella
  descarga el navegador).
- **`npm ci` termina con avisos del tipo «N vulnerabilities».** Es la salida informativa de
  `npm audit` sobre las dependencias. Este repositorio es un simulador local que no debe
  desplegarse (ver «Security notes»). No ejecutes `npm audit fix --force` a ciegas: puede cambiar
  versiones fijadas a propósito, como `playwright-core` 1.60.0.
- **Un script dice `ROJO: la BD no levanta` o `ROJO: build del backend`.** El primero significa que
  `docker compose up -d --wait` falló (Docker apagado, conflicto de puerto o de nombre, mira arriba);
  el segundo, que `npm run build` falló (por ejemplo, falta el `.env`, mira arriba). Lee el archivo de
  log que nombra el script (`ZFB_LOG`).

## Limitaciones conocidas

Estas son decisiones de alcance tomadas a propósito (el backend y el dominio no se tocaron para
traducir), no defectos que se hayan escondido.

- El marco de login (el iframe que sirve el backend, `src/modules/auth/marco.pagina.ts`) sigue en
  español en los dos idiomas.
- Los PDF (comprobantes y boletas, `src/modules/comprobantes/plantillas/pdf.ts`) salen en español en
  los dos idiomas.
- El `mensaje` de las respuestas de la API está en español; el front usa el catálogo según el
  `codigo`. Si pruebas la API, afirma sobre `codigo`.
- No se traducen los datos del usuario (nombres, glosas) ni se cambia el formato de monedas y
  fechas.
- Sólo hay dos idiomas (`es`, `en`). No hay idioma por ruta de URL ni por SEO; sólo `?lang=`.
- Las specs de `specs/` están en español.
- El campo **Monto** de Pagos es un campo de texto simple y no filtra lo que escribes. Es por
  diseño: la validación le corresponde al servidor. Un monto mal formado (por ejemplo `ujhuhjku`)
  se rechaza con `400 MONTO_INVALIDO`, la pantalla muestra el error en el idioma activo y no se
  mueve dinero.

## Estructura del repositorio

```
.
├── src/                 backend (NestJS): domain/ (reglas puras), modules/ (casos de uso), infra/
├── prisma/              esquema y migraciones SQL
├── web/                 frontend Angular
├── test/                tests de integración (*.int.spec.ts)
├── scripts/             guante, invariantes, demo y las comprobaciones con navegador por pantalla
├── specs/               specs, historias de usuario (HU-*) y listas de data-testid
├── docker-compose.yml   PostgreSQL 18 para uso local
├── .env.example         plantilla para tu propio .env
├── AGENTS.md            reglas del dominio, invariantes, códigos de error, contrato de costuras
├── ARQUITECTURA.md      arquitectura y las razones detrás
└── LICENSE              MIT
```

## Rigor

El dinero es el único dominio donde un error de redondeo no se ve: la interfaz se ve bien, los
tests pasan y la plata no cuadra. Por eso este proyecto pone sus comprobaciones en invariantes de
datos, y las calibra rompiendo el sistema a propósito para confirmar que la comprobación se pone
roja. Cada fila de abajo nombra el comando que la reproduce; la única excepción se anota bajo la
tabla.

| Medida | Resultado | Medido el | Verificado el día de publicar |
|---|---|---|---|
| Mutación sobre `src/domain/` (`npm run test:mutation`, Stryker; umbral 70 %) | 83,20 % | 2026-10-05 | hecho |
| Tests unitarios del dominio (`npm run test:domain`) | 144/144 | 2026-10-05 | hecho |
| Tests de integración (`npm run test:integracion`) | 446/446 | 2026-10-05 | hecho |
| Invariantes del libro mayor I1 a I7 (`npm run invariantes`) | 7/7 | 2026-10-05 | hecho |
| Calibración de los invariantes (`npm run invariantes:calibrar`, defectos inyectados a propósito) | 21/21 | 2026-10-05 | hecho |
| Demo completa (`npm run demo:m6`, login a transferencia a boleta, desde el reset) | 3/3 corridas, 42/42 pasos | 2026-10-05 | hecho |
| Verificación de la pantalla de boletas (`npm run verificar:s17-boletas`) | 43/43 | 2026-10-05 | hecho |
| Calibración de esa verificación (`npm run calibrar:s17-boletas`, defectos inyectados a propósito) | 39/54 (13 defectos nunca inyectados, 2 defectos inyectados sin cazar) | 2026-10-05 | hecho |
| Guante de restricciones (`npm run guante`) | 6/6 | 2026-10-05 | hecho |

Nota: el script que está detrás de `calibrar:s17-boletas` no se incluye en este repositorio, así que
esa fila no se puede reproducir desde aquí; las demás sí. Su caída desde 52/54 no es un hallazgo
sobre la verificación de la pantalla: la calibración planta cada defecto buscando texto literal en
las plantillas de Angular, y el front bilingüe reemplazó ese texto por claves de traducción, así que
13 de las 54 anclas ya no existen y esos defectos nunca se inyectaron. Cuentan como no medidos, no
como cazados. Los 2 defectos inyectados sin cazar son los mismos dos de antes.

Una verificación «ciega» es la que no podía ponerse roja ante el defecto que debía cazar.
Encontrarlas y corregirlas es justamente el sentido de calibrar. Los números de arriba no afirman
que el sistema no tenga defectos: una suite en verde sólo demuestra que la suite no encontró nada.

## Licencia y descargo

[MIT](LICENSE). El software se entrega **tal cual**, sin garantía de
ningún tipo. Nada de esto es asesoría legal, financiera ni de seguridad. Es una simulación: no hay
dinero real, cuentas reales ni un banco real, y no debe desplegarse como si lo fuera.
