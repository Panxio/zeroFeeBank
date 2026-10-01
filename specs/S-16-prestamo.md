# S-16 · Solicitud de préstamo (ParaBank: *Request Loan*)

> Escrita el 2026-09-11. Desbloqueada ese día: **P1 se respondió desde el
> código de ParaBank** y el humano eligió cada decisión de negocio (§ 2). Nada de esta spec es un
> umbral «sacado de la manga»: cada constante trae su fuente.


## 7 · Piezas que YA existen y se reusan

| pieza | para qué |
|---|---|
| `PrestamosMotor.otorgarEn(tx, p)` (`prestamos.motor.ts`) | **todo el dinero**: bloqueo, fondos, regla, cuenta nueva, asiento. Escribir el asiento a mano es un defecto |
| `IdempotenciaEjecutor.ejecutar(...)` | D5 entero, con `operacion: async (tx) => …` (misma transacción) |
| `AuthService.yo(authorization)` | token → titular; lanza los tres 401 |
| `parseMoney` / `formatMoney` (`src/domain/money/`) | D1: string decimal ↔ `bigint` |
| `UUID_REGEX` (`cuentas.constants.ts`) | forma del uuid |
| `ErroresHttpFilter` | ya traduce todos los códigos de § 3 |
| `src/modules/pagos/` | **el patrón a copiar** para controller, validación y servicio idempotente |

## 8 · Calibración

Brazos codificados por grupo: **A** feliz y forma · **B** ledger · **C** validación y
precedencia · **R** regla de aprobación · **D** idempotencia · **E** auth y aislamiento ·
**K** concurrencia · **G** controles que deben quedar verdes SIN la unidad.

**8.1 · Por ausencia, ANTES de implementar:** con el módulo HTTP sin escribir, todo lo que toca
`/prestamos` debe dar rojo y **sólo G** verde. Cualquier otro verde es un brazo que se aprueba solo.

**8.2 · Por defectos, sobre la entrega** (`npm run calibrar:s16`). **Fijada
ANTES de ver la entrega** (el commit de esta tabla precede a la auditoría).
Cada fila: el defecto, y el conjunto EXACTO de brazos que debe ponerse rojo; el resto, verde
(las dos mitades, `scripts/lib/calibrador.sh`). Los anclas de H se adaptan al código que llegue;
si un ancla no existe, el defecto suma al total y no al aprobado (`ancla_ausente`).

| # | defecto inyectado | dónde | rojos esperados |
|---|---|---|---|
| H1 | huella sin `titularId` | entrega | D3 |
| H2 | `monto`/`pie` de la respuesta sin normalizar (el string tal como llegó) | entrega | A2 |
| H3 | `otorgadoEn` con `new Date()` en vez del instante del reloj pasado al motor | entrega | A4 |
| H4 | el titular sale del cuerpo si viene (`cuerpo.titularId ?? token`) | entrega | E8 |
| H5 | el controlador no exige `pie < monto` (lo sigue exigiendo el motor) | entrega | C17 |
| H6 | la forma de `cuentaOrigenId` se valida ANTES que el pie | entrega | C15 C17 |
| H7 | `monto` se coerciona con `String()` (un number JSON pasa) | entrega | C2 |
| M1 | el motor sin `FOR UPDATE` | motor | K1 |
| M2 | los fondos suman también las cuentas `PRESTAMO` | motor | R7 K1 |
| M3 | el motor sin R1 (`assertFondosSuficientes` del pie) | motor | R8 |
| M4 | la contrapartida es `CAJA` en vez de `PRESTAMOS` | motor | B2 B5 |
| M5 | el motor bloquea sin `sort()` (orden de `findMany`, la contrapartida al final) — **enmienda** | motor | K3 |

**Notas de la fijación:**
- **C17 nace aquí.** Al predecir H5 se vio que ningún brazo lo cazaba: C15 usa pie negativo y el
  motor vuelve a exigir `pie < monto`, así que un controlador sin ese tope responde lo mismo en
  C9/C10. La cláusula de precedencia de § 3 (el pie, tope incluido, antes que la forma de la
  cuenta) no tenía brazo. El arnés pasa a **56 brazos** (C17).
- **M1 y H3 son probabilísticos**: M1 depende de que dos de diez peticiones se crucen; H3, de que
  el reloj real avance al menos 1 ms entre el motor y la respuesta. Si fallan, se reporta así.
- **Resultado sobre la entrega: 10/11 → 11/11.** M1 salió verde en la primera corrida: con
  una sola ráfaga, K1 cazaba el motor sin `FOR UPDATE` en **4 de 5** corridas aisladas (aprobaba
  4–6 préstamos de 10). Decisión del humano: **endurecer K1 a 3 ráfagas independientes** (más
  estricto, no más laxo; cambio posterior a ver la entrega, declarado acá) → **5/5** corridas
  aisladas en rojo con M1 y `calibrar:s16` **11/11**. Escape estimado de una ráfaga ~20 %; de
  tres, ~1 %, suponiendo ráfagas independientes.
- **M4 supone que la cuenta `PRESTAMOS` ya existe** (la creó la corrida base): con la BD vacía,
  E9 también se pondría rojo.
- **Defectos que el arnés NO ve, declarados y no inyectados:** (a) quitar la validación de forma
  de `cuentaOrigenId`: el motor busca el id entre las cuentas del titular y responde el mismo 404
  sin llegar a Prisma con un no-uuid — mutante equivalente por HTTP. (b) **El orden del bloqueo
  (J6) sin `sort()`**: K2 usa una cuenta por titular y ninguna transferencia toca `PRESTAMOS`, así
  que no hay ciclo posible en el arnés. Un deadlock real necesita un titular con dos cuentas cuyo
  orden de lectura difiera del de id, y una transferencia entre ellas en paralelo. **Queda como
  hueco abierto de D4**, no como defecto aprobado.
- **Enmienda · el hueco (b) se cierra con K3 y M5**, fijados acá ANTES de medir. K3: un
  titular con dos cuentas `X` (la primera) e `Y` con `id(Y) < id(X)`; el arnés abre cuentas
  hasta obtenerla (se ve en los ids de la respuesta, sin tocar la BD) y, si no la obtiene, K3
  muere rojo en la preparación, nunca verde. Luego préstamos con origen `X` en paralelo con
  transferencias `X↔Y`, en 3 ráfagas como K1. Con el `sort()`, todos bloquean `Y` antes que `X`
  y no hay ciclo: todo 201. Sin él, el préstamo bloquea en el orden de `findMany` (el de
  creación: `X` antes que `Y`), la transferencia al revés, y Postgres aborta a una de las dos
  (40P01 → 500). **M5 es probabilístico como M1**: depende de que las dos se crucen y de que
  `findMany` devuelva el orden de creación (orden de heap, no un contrato). Se mide la tasa de
  captura en corridas aisladas y se reporta tal cual. K3 no toca K2: con una cuenta por titular
  el ciclo sigue siendo imposible, así que M5 sólo debe poner rojo a K3.
  *Corrección de la preparación, antes de inyectar M5:* la primera versión buscaba `Y` sólo contra
  la primera cuenta, con 12 intentos, y murió roja sobre el código intacto (`X = 1f03e99b…`: con
  un `X` bajo, no hallar un id menor pasa ~21 %). K3 busca ahora **la primera inversión
  cualquiera** (una cuenta nueva con id menor que el mayor de las anteriores) en hasta 8 cuentas
  (fallo 1/8! = 1/40320). No cambia el rojo esperado.

## 9 · Cómo se corre el árbitro

```
npm run test:domain       # incluye src/domain/prestamo/
npm run test:prestamos    # S-16 por HTTP
npm run invariantes       # I1–I5, parte del árbitro
npm run guante            # 6 compuertas duras
npm run typecheck
```
