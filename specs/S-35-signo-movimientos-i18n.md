# S-35 · Traducir el signo `DEBITO`/`CREDITO` de movimientos

Origen: hallazgo confirmado por inyección (`h1-adeudo`): **sí se traduce**. Sin esto S35-1 («0 textos en idioma equivocado») no se cumple: en modo EN la columna «Tipo» de Movimientos muestra `DEBITO`/`CREDITO`.

## Qué hace
El **texto visible** de `movimiento-signo` sale del catálogo, con dos claves nuevas:

| clave | ES (visible hoy, **sin cambio**) | EN |
|---|---|---|
| `movimientos.signo.DEBITO` | `DEBITO` | `Debit` |
| `movimientos.signo.CREDITO` | `CREDITO` | `Credit` |

`app.html` (`movimiento-signo`, hoy `{{ obtenerSigno(mov.monto) }}`) pasa a mostrar la clave `movimientos.signo.<signo>` por el pipe/función `t`.

## No-goals
- **`data-signo` NO cambia**: sigue siendo `DEBITO`/`CREDITO` (valor de contrato C3/C5, lo lee `verificar:s17-movimientos` en `scripts/verificar-s17-movimientos.mjs:455`). `obtenerSigno()` sigue devolviendo ese código.
- Ningún `data-testid` nuevo ni renombrado. No se toca `src/`.
- No se acentúa `DEBITO` en ES (la invariancia ES exige que el texto visible no cambie).

## Hecho cuando
1. `cd web && npx tsc --noEmit` y `npm run build` en 0; el tipo `Catalogo` obliga a las dos claves en ES y EN.
2. `npm run verificar:s17-movimientos` **23/23** y **0 diferencias ES** (invariancia del texto en español).
3. Comprobación directa en el navegador: con la pantalla Movimientos en `?lang=en`, cada `movimiento-signo` tiene texto `Debit` o `Credit` y `data-signo` `DEBITO` o `CREDITO`; en `?lang=es` el texto es `DEBITO`/`CREDITO`.
4. `git diff --stat` toca sólo `web/src/app/i18n/catalogo.ts` y `web/src/app/app.html` (y `app.ts` sólo si hace falta un helper).

## Orden y por qué
Va **antes** de A14: el árbitro nuevo debe calibrarse contra un producto que ya cumple S35-1; si no, el control (D0) sale rojo por una razón del producto.
