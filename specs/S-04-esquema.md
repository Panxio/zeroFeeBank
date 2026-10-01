# S-04 — Esquema Prisma, migraciones y ledger append-only impuesto por la base

> Unidad de trabajo del backlog. Su árbitro es la migración y la base de
> datos rechazando escrituras, no un runner de dominio.
> Aplica el candado común de `specs/_CANDADO.md`.
> Escrita: 2026-09-06.

---

## Pilar 1 · Qué hace, en prosa

Le da a `prisma/schema.prisma` los modelos que el dominio ya sabe manipular en memoria, y
**una migración SQL que hace del libro mayor una estructura de sólo-anexar a nivel de motor**.

La regla D3 del perfil dice que el ledger es append-only. Hasta hoy eso es una convención: el
código no hace `UPDATE`, pero nada lo impide. Esta unidad la convierte en un hecho verificable
del motor, por **dos mecanismos que cierran riesgos distintos**:

1. **Un rol de aplicación sin privilegio.** La app deja de conectarse como dueña de la base.
   Se conecta con `zerofeebank_app`, que tiene `SELECT, INSERT` sobre `movimiento` y **no
   tiene `UPDATE` ni `DELETE`**. Cierra el riesgo de que la app lo haga, por bug o por
   descuido.
2. **Un trigger que lanza excepción.** `BEFORE UPDATE OR DELETE ON movimiento` aborta siempre,
   incluso para el dueño de la base. Cierra el riesgo de la consola `psql` abierta a mano, la
   migración descuidada.

Un solo mecanismo no basta: revocar el permiso no ata al dueño, y un trigger se puede
desactivar con privilegio suficiente. Los dos juntos exigen dos actos deliberados para
destruir evidencia, y ninguno ocurre por accidente.

## No-goals (explícitos, para que no crezca solo)

- **Ningún caso de uso, ningún endpoint, ningún repositorio.** Sólo esquema, migración y
  permisos. La transferencia es S-05, la idempotencia S-06, auth S-08, boleta S-09.
- **Ninguna consulta de invariantes.** El comando único de I1–I5 es S-11 y no se adelanta.
- **Ningún dato semilla de negocio.** Las cuentas de sistema se crean, pero con saldo cero:
  sembrar escenarios es la costura C1, que es S-07.
- **Nada de particionado, índices de rendimiento ni auditoría de sesión.** No hay una meta de
  rendimiento declarada todavía; optimizar contra una meta que no existe es adorno.

## Criterio de "hecho"

`npm run verify:s04` termina en **exit 0** con **6/6 brazos OK**, sobre la base real de
`docker compose`, y cada brazo se vio **rojo al menos una vez** por la razón correcta.

## Pilar 2 · Invariantes de esta unidad

| # | Invariante |
|---|---|
| E1 | La migración aplica sobre una base **vacía** sin intervención manual, y `prisma migrate status` no reporta desfase. |
| E2 | Ningún monto se guarda en coma flotante: **toda** columna monetaria es `BIGINT` y su tipo en el cliente es `bigint`. |
| E3 | El rol de la aplicación **no posee** `UPDATE` ni `DELETE` sobre `movimiento`. |
| E4 | Un `UPDATE` o `DELETE` sobre `movimiento` **falla también para el dueño de la base**, por el trigger. |
| E5 | Un movimiento no puede existir sin su transacción: la clave foránea es obligatoria y su borrado es `RESTRICT`, nunca `CASCADE`. Un `CASCADE` sería un `DELETE` con otro nombre. |
| E6 | `src/domain/` sigue sin importar Prisma, Nest ni Express (compuerta dura del perfil, se re-comprueba acá). |

## Pilar 3 · Orden de ejecución, y por qué ese orden

1. Modelos en `schema.prisma` → `prisma migrate dev` genera el SQL de las tablas.
2. **Una segunda migración escrita a mano** añade el rol, los `GRANT`/`REVOKE` y los triggers.
   Prisma no modela privilegios; escribirlos en un script suelto que alguien tiene que
   acordarse de correr es exactamente la clase de compuerta que no corre. Va como migración
   —que sí es obligatoria— y separada de la generada para que un `migrate dev` posterior no la
   pise.
3. Recién entonces el arnés, y **la calibración**: se rompe cada mecanismo a propósito.

El orden importa porque el paso 2 es el que se olvida: una vez que `migrate dev` deja la base
funcionando, la tentación es dar la unidad por hecha.

## Pilar 4 · Casos borde anticipados

- **Migración corrida dos veces.** `CREATE ROLE` falla si el rol existe: va dentro de un
  bloque `DO $$ ... $$` que comprueba antes.
- **La app conecta con el rol equivocado.** Si la app siguiera conectando como dueña, E3 sería
  cierto y a la vez inútil. Por eso el brazo 3 del arnés usa **la `DATABASE_URL` que usa la
  app**, no una conexión que el arnés se fabrique.
- **`prisma migrate reset` borra el rol.** El rol es del clúster, no de la base; sobrevive al
  reset y `CREATE ROLE` lo encontraría existiendo. Cubierto por el bloque `DO`.
- **`updatedAt` en `movimiento`.** No lo lleva: una columna que se actualiza sola en una tabla
  que no se actualiza nunca es una contradicción escrita en el esquema.
- **Transacción sin entradas, o con una sola.** El esquema no puede impedirlo (la fila padre
  se inserta antes que las hijas); lo impide el dominio con `assertBalanceada`, y lo detectará
  I1 en S-11. Se anota como límite conocido de esta unidad, no como algo resuelto.

## Constantes, con su valor y la frase que la justifica

| Constante | Valor | Por qué |
|---|---|---|
| Rol de la aplicación | `zerofeebank_app` | nombre distinto del dueño (`zerofeebank`) para que la diferencia de privilegio sea legible de un vistazo en `\du`. |
| Contraseña del rol de app | `zerofeebank_app_local` | credencial **de este contenedor local y de ningún otro entorno**, igual que las de `docker-compose.yml`; los demás entornos la inyectan por variable. |
| `limite_sobregiro_centavos` por defecto | `0` | **no es una regla de negocio inventada: es su ausencia.** Ninguna cuenta puede quedar bajo cero mientras nadie pacte lo contrario. El día que exista un producto con sobregiro, su límite es un dato que trae la spec de ese producto. |
| Estados de boleta | `VIGENTE · COBRADA · VENCIDA · DEVUELTA` | copiados textuales del tipo `Estado` de `src/domain/boleta/boleta.ts`; el esquema no inventa un quinto estado ni renombra uno. |
| Tipos de cuenta | `CORRIENTE · AHORRO · SISTEMA` | `SISTEMA` es la contrapartida que exige I2: sin ella, un depósito externo deja la suma global distinta de cero. |
| `ON DELETE` de toda FK del ledger | `RESTRICT` | ver E5. |

## Pilar 5 · El arnés de esta unidad — `npm run verify:s04`

Seis brazos, cada uno con su número:

| # | Brazo | Verde es |
|---|---|---|
| 1 | `prisma migrate reset --force` sobre la base de docker | exit 0, migración aplicada desde cero |
| 2 | `prisma migrate status` | sin desfase |
| 3 | Como **rol de app**: `INSERT` de una transacción con dos movimientos que suman 0 | exit 0 |
| 4 | Como **rol de app**: `UPDATE` y `DELETE` sobre `movimiento`, más los privilegios en el catálogo | rechazados **con SQLSTATE 42501**, y el rol tiene exactamente `INSERT,SELECT` |
| 5 | Como **dueño de la base**: `UPDATE`, `DELETE` y `TRUNCATE` sobre `movimiento` | rechazados **con SQLSTATE ZFB01**, y el ledger queda con el mismo número de filas |
| 6 | `grep` de la regla de dependencia sobre `src/domain/` | 0 coincidencias |

### Calibración obligatoria (ARNES.md R1)

Un arnés que no se vio fallar es decoración. Antes de dar la unidad por hecha se inyecta,
**uno a uno**, y se registra qué brazo se puso rojo:

| Defecto inyectado | Debe ponerse rojo | Resultado (2026-09-07) |
|---|---|---|
| Se quita el `REVOKE` (muere la defensa por permiso) | brazo 4 | ✅ 4a, 4b y 4c |
| Se quitan los triggers (muere la defensa del dueño) | brazo 5 | ✅ 5a–5d |
| El trigger vuelve al `ERRCODE` ambiguo `42501` | brazo 5 | ✅ 5a–5c |
| Se olvida el trigger de `TRUNCATE` | brazo 5 | ✅ 5c y 5d |
| Un `import` de Prisma en `src/domain/` | brazo 6 | ✅ |

**Dos brazos nacieron ciegos y se arreglaron durante esta calibración, no después:**

1. El brazo 4 daba **verde con el `REVOKE` entero borrado**, porque el trigger rechazaba igual
   y el brazo sólo miraba que la sentencia fuera rechazada, no **quién** la rechazaba. Una de
   las dos defensas podía desaparecer en silencio. Arreglado exigiendo el SQLSTATE del
   mecanismo que cada brazo mide, y añadiendo `4c`, que lee los privilegios del catálogo.
2. Por lo mismo, **el trigger dejó de usar `42501`**: es el mismo código del permiso denegado,
   y con él las dos defensas eran indistinguibles. Ahora usa `ZFB01`, propio y estable.

Si un brazo sigue verde con el defecto puesto, el brazo está mal escrito y se arregla **antes**
de reportar ningún número.
