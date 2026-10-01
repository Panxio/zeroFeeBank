# S-00 — Esqueleto NestJS + Prisma + Postgres + `/health` real

> Árbitro que cierra esta unidad: **el build levanta y `/health` responde con el estado real
> de la base de datos.** Su árbitro es el build, no el test runner.
> Escrita ANTES de codear. Fecha: 2026-09-06.

---

## Pilar 1 · Qué hace, en prosa

Levanta el esqueleto ejecutable del proyecto: una aplicación NestJS que arranca sobre Node 22
en ESM, se conecta a un PostgreSQL que corre en Docker, y expone **un único endpoint**,
`GET /health`, que **consulta la base de datos en cada llamada** y responde según lo que la BD
conteste. No hay ninguna otra ruta, ningún modelo de datos y ninguna regla de negocio.

Existe para cerrar la costura **C6** del perfil `sut-automatizable`: *"un `/health` que diga la
verdad (incluida la BD), para que la suite espere al arranque en vez de dormir 5 segundos"*.
Todo lo demás del corte 1 se apoya en que esto exista y sea honesto.

## No-goals (explícitos, para que no crezca solo)

- **Modelos de datos y migraciones**: son S-04. Acá el `schema.prisma` declara la conexión y
  nada más. `/health` no necesita una tabla para saber si la BD contesta.
- **Las costuras `/__test__/reset` y `/__test__/seed`**: son S-07.
- Auth, cuentas, transferencias, boleta, frontend: S-05 en adelante.
- Despliegue, CI, healthchecks de orquestador, métricas, logs estructurados.
- Tocar `src/domain/`. El dominio ya está entregado y verde; S-00 no lo toca ni una línea.

## Criterio de "hecho"

1. `docker compose up -d` deja Postgres arriba y aceptando conexiones.
2. `npm run build` compila con exit 0.
3. `npm start` levanta la app y `GET /health` devuelve **200** con `status: "ok"` y `db: "up"`.
4. **Con la BD caída**, el mismo `GET /health` devuelve **503** con `db: "down"`, sin que la
   app se caiga.
5. El arnés de dominio sigue en **78/78** y `npm run typecheck` sigue en exit 0.

---

## Pilar 2 · Invariantes

| # | Invariante | Cómo se comprueba |
|---|---|---|
| H1 | **`/health` nunca responde 200 si la BD no contesta.** Es la razón de existir del endpoint: un health que miente es peor que no tenerlo. | se baja el contenedor de la BD y se vuelve a pedir |
| H2 | `/health` **pregunta cada vez**. Nada de cachear el resultado ni de responder con el estado del arranque. | se baja la BD **sin reiniciar la app** y la respuesta cambia sola |
| H3 | La app **arranca aunque la BD esté caída**, y lo reporta. Si el proceso muere al arrancar, la suite no tiene a quién preguntarle. | se arranca con la BD abajo |
| H4 | **La regla de dependencia se mantiene**: `src/domain/` sigue sin un solo import de Nest, Prisma o Express. | `grep -rnE "from '(@nestjs/\|@prisma/\|express)" src/domain/` → 0 |
| H5 | El arnés existente no se toca ni se degrada: 78/78 y typecheck en 0. | los dos comandos del árbitro |

## Pilar 3 · Orden de ejecución, y por qué ese orden

1. **Postgres primero** (`docker compose up -d`): sin BD viva no se puede distinguir un
   `/health` honesto de uno que siempre dice `ok`.
2. **Prisma después**: el cliente se genera desde el `schema.prisma`, y compilar antes de
   generarlo falla por tipos que aún no existen.
3. **Nest al final**: es el que consume las dos cosas anteriores.
4. **La calibración, después de todo**: primero se ve verde con la BD arriba, y **recién
   entonces** se baja la BD. Al revés no prueba nada — un endpoint que siempre devuelve 503
   también pasaría el brazo rojo.

## Pilar 4 · Casos borde anticipados

- **BD caída al arrancar** → la app levanta igual y `/health` dice `down` (H3).
- **BD que se cae con la app ya arriba** → la siguiente llamada dice `down` (H2).
- **BD que tarda**: una BD colgada no es lo mismo que una BD caída, pero para la suite sí.
  Se acota con un tope de tiempo explícito (ver constantes) y se responde `down`.
- **Puerto ocupado**: 3000 y 5432 verificados libres el 2026-09-06 antes de fijarlos.
- **`schema.prisma` sin ningún modelo**: hay que comprobar que `prisma generate` lo acepta.
  Si no lo aceptara, la salida NO es inventar un modelo de mentira para contentar al
  generador: sería adelantar S-04 a escondidas. Se escala.

## Constantes, con su valor y la frase que la justifica

| Constante | Valor | Por qué |
|---|---|---|
| Puerto de la app | `3000` | verificado libre el 2026-09-06; es el default de Nest y no hay razón para moverlo |
| Puerto de Postgres en el host | `5432` | verificado libre el 2026-09-06 |
| Versión de Postgres | `18-alpine` | se fija la mayor: una imagen `latest` cambia bajo los pies y vuelve irreproducible la corrida |
| Tope de la sonda a la BD | `2000 ms` | `/health` existe para que la suite no duerma; si la BD no contesta en 2 s, para la suite está caída. No es una regla de negocio: es el presupuesto de espera del endpoint |
| Código HTTP con la BD caída | `503` | "no puedo servir ahora", que es exactamente el caso; un 500 diría que el error es del propio health |

> **Sobre las credenciales del contenedor:** usuario `zerofeebank` / clave `zerofeebank_local`
> sobre la base `zerofeebank`. **No son un dato inventado de los que la Regla de Oro prohíbe**
> —no son una tasa, una comisión ni un límite— sino la configuración de un contenedor local
> que este mismo repositorio crea. Van versionadas y a la vista en `docker-compose.yml` y en
> `.env`, a propósito: esconderlas en un `.env.example` no protegería nada (están en el compose
> de al lado) y agregaría un paso manual que rompe el arranque desatendido, que es un objetivo
> declarado del proyecto. **Límite duro: ese `.env` no admite credenciales de ningún entorno
> que no sea este contenedor local.** Cualquier otro entorno las inyecta por variable de
> entorno.

## Contrato del endpoint (C5 · errores con código estable)

```
GET /health
200  { "status": "ok",           "db": "up"   }
503  { "status": "degraded",     "db": "down" }
```

El campo que la suite afirma es `db`, no el texto. No hay mensaje en prosa que pueda cambiar y
romper una prueba.

## Pilar 5 · El arnés de esta unidad

El árbitro de S-00 **no es el test runner**: es el build y el proceso corriendo. Se ejecuta a
mano, a dos brazos, y se registra el resultado:

- **Brazo verde**: BD arriba → `/health` = 200 `db: "up"`.
- **Brazo rojo (calibración obligatoria)**: `docker compose stop db` con la app **ya
  levantada** → `/health` = 503 `db: "down"`, y la app sigue viva.

Un `/health` que nunca se vio en rojo no es una costura: es una afirmación.
