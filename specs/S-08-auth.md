# S-08 — Registro, inicio de sesión y el token que prueba quién eres

> Unidad del backlog: **S-08**. Cierra el riesgo **R4** del plan de negocio: hoy *nadie es dueño
> de una cuenta*. Perfil `sut-automatizable`, costura **C5** (errores con código tipado).
> Árbitro: `npm run test:auth` — ya escrito y calibrado. **No se toca.**
> Aplica `specs/_CANDADO.md` completo.

---

## Pilar 1 · Qué hace, en prosa

Tres rutas bajo `/auth`: **registrarse**, **entrar**, y **preguntar quién soy** con el token que
te dieron al entrar. Nada más. Es la pieza sobre la que después se apoya todo lo demás —que una
transferencia salga de *tu* cuenta y no de cualquiera— pero **esta unidad no protege ningún
endpoint existente**: sólo emite y verifica la credencial.

La contraseña **nunca se guarda**, ni cifrada ni de ninguna forma reversible: se guarda una
derivación lenta con sal, y la comparación es en tiempo constante.

## No-goals (explícitos, para que no crezca solo)

- **No se protege `POST /transferencias`.** Ese endpoint sigue abierto al terminar esta unidad.
  Atarlo al dueño de la cuenta es una unidad posterior, con su propio arnés. Meterlo acá
  rompería el arnés de S-06, que hoy transfiere sin token.
- **No hay roles, ni permisos, ni admin.** Es un no-goal declarado del proyecto.
- **No hay recuperación de contraseña, ni cambio de contraseña, ni verificación por correo.**
- **No hay cierre de sesión del lado del servidor.** El token es autocontenido y expira solo;
  «salir» es que el cliente lo bote. Una lista de revocación exige una tabla y una migración, y
  las migraciones no se delegan.
- **No hay idempotencia.** D5 aplica a los `POST` **que mueven plata**; ninguno de éstos la
  mueve. Un registro repetido choca contra el email único y da `409`, que es la respuesta
  correcta y no necesita `Idempotency-Key`.
- **No se toca `src/app.module.ts`.** Ya está escrito y registra tu módulo. Si lo modificas,
  rompes la medición.
- **No se toca el esquema ni se crean migraciones.** La tabla `usuario` ya existe desde S-04, con
  `email` único y `password_hash`. Te sobra.
- **No importes nada de `src/modules/costuras/` ni de `src/infra/reloj.ts`.** Esa unidad viaja en
  paralelo con ésta y todavía no existe. Usa `new Date()` (estás en `src/modules/`, no en
  el dominio: el grep del guante no aplica ahí).

---

## Pilar 2 · Invariantes (qué tiene que ser siempre verdad)

| # | Invariante |
|---|---|
| V1 | La contraseña en claro **no aparece nunca** en la base, ni en una respuesta, ni en un log. |
| V2 | Dos usuarios con la misma contraseña tienen **hashes distintos**. La sal es por usuario y aleatoria. |
| V3 | La comparación de la contraseña es en **tiempo constante** (`crypto.timingSafeEqual`), nunca `===` sobre el hash. |
| V4 | Un email desconocido y una contraseña equivocada dan **exactamente la misma respuesta**: mismo código, mismo estado, mismo mensaje. No se puede averiguar si un email está registrado. |
| V5 | Un token alterado en un solo bit **se rechaza**. La firma cubre el contenido entero. |
| V6 | Un token expirado y un token con firma inválida dan **códigos distintos**. Ver § por qué, abajo. |
| V7 | El email se guarda y se compara **normalizado** (recortado y en minúsculas). `Ana@X.CL ` y `ana@x.cl` son el mismo usuario, y el segundo registro da `409`. |

---

## Pilar 3 · El contrato, literal

### `POST /auth/registro`

```json
{ "email": "ana@ejemplo.cl", "password": "una-clave-larga" }
```

**`201 Created`:**

```json
{ "id": "<uuid>", "email": "ana@ejemplo.cl", "creadoEn": "<ISO-8601>" }
```

El email vuelve **normalizado**. **La respuesta no lleva token**: registrarse e iniciar sesión
son dos actos distintos, y unirlos esconde que el login puede fallar por su cuenta.

### `POST /auth/login`

```json
{ "email": "ana@ejemplo.cl", "password": "una-clave-larga" }
```

**`200 OK`:**

```json
{ "token": "<token>", "tipo": "Bearer", "expiraEn": "<ISO-8601>" }
```

### `GET /auth/yo`

Cabecera `Authorization: Bearer <token>`.

**`200 OK`:** `{ "id": "<uuid>", "email": "ana@ejemplo.cl" }`

> Existe para que el token sirva de algo hoy y para que el arnés pueda afirmar sobre él. Es
> también la pieza que las unidades siguientes van a reutilizar para saber quién pide.

### Las respuestas de error — todas, con su código y su estado

| situación | código | HTTP |
|---|---|---|
| `email` ausente, no string, o sin forma de email | `EMAIL_INVALIDO` | 400 |
| `password` ausente, no string, o de menos de **8** caracteres | `PASSWORD_DEBIL` | 400 |
| el email ya está registrado | `EMAIL_YA_REGISTRADO` | 409 |
| email desconocido **o** contraseña equivocada | `CREDENCIALES_INVALIDAS` | 401 |
| falta la cabecera `Authorization`, o no empieza con `Bearer ` | `TOKEN_AUSENTE` | 401 |
| el token está malformado o su firma no cuadra | `TOKEN_INVALIDO` | 401 |
| el token está bien firmado pero venció | `TOKEN_EXPIRADO` | 401 |
| el token es válido pero su usuario ya no existe | `TOKEN_INVALIDO` | 401 |
| el cuerpo de la petición no es JSON válido | `CUERPO_INVALIDO` | 400 |

> **Por qué `TOKEN_EXPIRADO` y `TOKEN_INVALIDO` son códigos distintos, y no es un detalle.**
> Es una forma típica en que un arnés nace ciego:
> *dos mecanismos, un solo síntoma*. Si la firma y el vencimiento fallaran con el mismo código,
> **la verificación del vencimiento podría desaparecer entera** —o no haberse escrito nunca— y
> el arnés seguiría verde, porque el token expirado también tendría la firma vieja. Con dos
> códigos, cada brazo afirma sobre el mecanismo que le toca. Ya nos costó una vez con `42501`.

### El orden de validación — fijo, y el arnés lo comprueba

1. **Forma del cuerpo** (`EMAIL_INVALIDO`, luego `PASSWORD_DEBIL`) — email primero.
2. **Unicidad** (`EMAIL_YA_REGISTRADO`).
3. Recién entonces se escribe.

En `login`: forma del cuerpo → búsqueda → verificación. Y **si el email no existe, se verifica
igual contra un hash de descarte** antes de responder, para que el tiempo de respuesta no delate
qué emails están registrados. V4 no se cumple sólo devolviendo el mismo texto.

---

## Pilar 3b · El mecanismo, fijado (no es decisión de implementación)

Cuatro decisiones tomadas. **No las sustituyas por una librería que "también funciona"**: cada
una está elegida contra el Pilar 0, y ninguna añade una dependencia al `package.json` — que
además está fuera de tu alcance de archivos.

### Decisión 1 · El hash es `crypto.scrypt`, de la librería estándar de Node

Peldaño 3 del Pilar 0: **hay una función nativa de la plataforma**. `scrypt` es una derivación
de clave lenta y con costo de memoria, hecha exactamente para esto. No se instala `bcrypt` ni
`argon2`.

Parámetros, **fijados acá**:

| parámetro | valor | por qué |
|---|---|---|
| `N` (costo) | `16384` (2^14) | el valor por defecto de Node y el mínimo recomendado por la nota de OWASP para scrypt |
| `r` | `8` | idem |
| `p` | `1` | idem |
| longitud de la sal | `16` bytes de `crypto.randomBytes` | 128 bits: colisión de sales descartada |
| longitud del hash | `64` bytes | el largo que usa la propia documentación de Node |

`scrypt` con `N=16384` necesita más memoria que la que Node da por defecto a la operación: hay
que pasar `maxmem` explícito o el llamado falla. **Es una trampa conocida**, y si te topas con
un `Error: Invalid scrypt params`, ése es el motivo — no bajes el `N`.

**Formato de lo que se guarda en `password_hash`**, literal, con `$` de separador:

```
scrypt$16384$8$1$<sal en base64>$<hash en base64>
```

Los parámetros van **dentro** del propio campo. Así, el día que suban, los hashes viejos se
siguen pudiendo verificar: la verificación lee los parámetros de la fila, no de una constante.

### Decisión 2 · El token es HMAC-SHA256, firmado con el secreto del entorno

```
<carga en base64url>.<firma en base64url>
```

- **carga** = `JSON.stringify({ sub: "<uuid del usuario>", exp: <epoch en SEGUNDOS> })`, en
  base64url **sin relleno**.
- **firma** = `HMAC-SHA256(secreto, "<carga en base64url>")`, en base64url sin relleno.

Verificación, en este orden: *hay exactamente un punto* → *recalcular la firma y compararla con
`crypto.timingSafeEqual`* → *si no cuadra, `TOKEN_INVALIDO`* → *parsear la carga* → *si `exp` ya
pasó, `TOKEN_EXPIRADO`* → *buscar el usuario*.

> **La firma se comprueba antes que el vencimiento, siempre.** Al revés, un token con carga
> falsificada podría llegar a decidir sobre `exp` antes de que nadie compruebe que lo escribimos
> nosotros.

> **No se instala una librería de JWT.** Esto no es criptografía casera: es un HMAC de la
> librería estándar sobre una cadena, que es la operación para la que el HMAC existe. Lo que sí
> está prohibido es improvisar el formato: está escrito arriba y el arnés lo construye a mano
> para probar el vencimiento, así que **cualquier desviación se ve roja**.

**El secreto:**

```
ZFB_AUTH_SECRET      # ya está en .env; mínimo 32 caracteres
```

**Si falta, o mide menos de 32 caracteres, la aplicación falla al arrancar** nombrando la
variable. **Jamás un valor por defecto.** Un secreto de respaldo en el código es un secreto
público, y ésta es la línea roja de seguridad del núcleo: la pereza no recorta ahí.

### Decisión 3 · La vigencia del token es de **60 minutos**

Constante `VIGENCIA_TOKEN_MINUTOS = 60`.

**Por qué 60 y no otro número, que es lo que el Pilar 1 exige justificar:** tiene que ser más
largo que la corrida completa del guion de demostración (M6: login → transferencia → boleta, tres
veces seguidas desde `reset`), para que una sesión no se caiga a la mitad de una demo; y lo más
corto posible dentro de eso, porque no hay revocación del lado del servidor. Una hora cumple las
dos cosas con holgura.

`expiraEn` en la respuesta es ese mismo instante en ISO-8601, y **tiene que cuadrar exactamente**
con el `exp` de la carga del token. El arnés lo compara: dos fuentes para el mismo dato que se
contradicen es un defecto, no una diferencia de formato.

### Decisión 4 · La forma del email se valida con una regla mínima y explícita

Algo antes de una `@`, algo después, un punto después de la `@`, y sin espacios. **No se importa
un validador ni se copia una expresión regular de internet**: la regla está escrita, es la que
se aplica, y el arnés afirma sobre ella. Largo máximo del email: **254** caracteres (el límite de
la ruta de correo en el RFC 5321); por encima, `EMAIL_INVALIDO`.

Normalización antes de validar, guardar y comparar: `trim()` y `toLowerCase()`.

---

## Pilar 4 · Casos borde que ya están anticipados

1. **Registrar `Ana@Ejemplo.CL ` cuando ya existe `ana@ejemplo.cl`** → `409`, no dos usuarios.
2. **Login con el email en otra caja** → entra. Es el mismo usuario (V7).
3. **Contraseña de exactamente 8 caracteres** → válida. El límite es *menos de* 8.
4. **Contraseña con espacios, emoji o acentos** → válida, y se compara byte a byte tal cual llegó.
   **La contraseña no se normaliza nunca**; sólo el email. Recortar una contraseña le quita
   entropía sin avisarle a nadie.
5. **Token con la carga cambiada y la firma vieja** → `TOKEN_INVALIDO`.
6. **Token bien firmado de un usuario que ya no está en la base** → `TOKEN_INVALIDO`, no un 500.
7. **`Authorization: Basic …`** o `Bearer` sin nada detrás → `TOKEN_AUSENTE`.
8. **Cuerpo que no es JSON** → `400` con código **`CUERPO_INVALIDO`**, nunca un 500 ni un
   400 sin código. ⚠️ **Este borde no se arregla en esta unidad:** el fallo lo lanza
   el body-parser antes de llegar a tu controlador, y traducirlo toca `src/infra/`, que está
   fuera de tu alcance de archivos. Quedó cerrado el 2026-09-07 en el filtro global,
   con el brazo **B5** del arnés.
9. **Carrera de dos registros del mismo email a la vez** → uno entra, el otro recibe `409`. Lo
   garantiza el índice único de la base; **atrápalo y tradúcelo**, no lo dejes salir como 500.

---

## Pilar 5 · El arnés (ya escrito y calibrado — NO SE TOCA)

```bash
npm run test:auth
```

`test/auth.int.spec.ts`. Habla **por HTTP**, contra Postgres de verdad, con la app levantada de
verdad.

El brazo del vencimiento **construye un token a mano** con el formato de la Decisión 2 y un `exp`
en el pasado. Es a propósito: el arnés no puede pedirle a la app un token vencido sin esperar una
hora, y una reimplementación independiente del formato **no comparte los errores de la tuya**.

---


## Pilar 7 · La meta numérica, fijada antes de codear

| # | Meta | Cómo se mide |
|---|---|---|
| — | `npm run test:auth` en verde, **todos** los casos | salida del runner |
| — | `npm run test:domain` sigue en **87/87** | no tocaste el dominio |
| — | `npm run typecheck` **exit 0** | `tsc --noEmit` |
| — | `npm run guante` sigue en **5/5** | las compuertas duras por ausencia |
| — | `npm run test:idempotencia` sigue en **9/9** | no rompiste el endpoint que ya movía plata |

Reporta el número real de cada uno, incluidos los fallos. "Funciona" no es una métrica.
