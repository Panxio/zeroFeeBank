# S-28 · El seed `movimientos-buscables` devuelve una credencial usable

> Costura de prueba (perfil SUT, C1). Unidad corta, backend.
> Origen: **D90-1**, decisión del humano. Nace de un bloqueo real, no de una
> idea: sin ella, la unidad S-17-movimientos no tiene ni un brazo de pantalla posible.
> Candado común: `specs/_CANDADO.md`.

---

## 1 · Por qué existe (el bloqueo medido)

`HU-03 § 5` fija como oráculo de la pantalla de Movimientos el escenario
`movimientos-buscables`. Ese escenario siembra 3 cuentas y 64 pares de movimientos, y
**devuelve sus identificadores**, pero **no devuelve credencial**: su titular nace con
`passwordHash = PASSWORD_HASH_SEMILLA = '!NO-UTILIZABLE-S07!'`
(`src/modules/costuras/costuras.service.ts:72`, `:305`), que no es el hash de ninguna clave.

Consecuencia, verificada en la fuente: **desde la pantalla no se puede
entrar como ese titular**. Todo brazo de interfaz que use ese oráculo nace **IMPOSIBLE** —rojo
sobre una app sana—, que es la forma «arnés imposible» y la
que ninguna calibración caza, porque en rojo se ve igual que un brazo correcto. Es el mismo
defecto que `cuenta-unica` pagó antes.

La salida no es que la suite entre por la puerta de atrás: eso es justo lo que el perfil SUT
prohíbe («la suite no importa código de la app ni toca la BD»). La salida es **darle a la app
la costura**, con spec y a la vista. El precedente exacto ya está en el repositorio:
`boletas-en-cada-estado` hashea una clave real y la devuelve (`costuras.service.ts:669-676`,
`:752`), y S-23 fue la unidad de pantalla que tocó backend por esta misma razón.

## 2 · Qué hace (alcance)

`POST /__test__/seed` con `{"escenario":"movimientos-buscables"}` devuelve, **además** de todo
lo que ya devuelve hoy, el campo `credenciales`:

```json
"credenciales": { "email": "usuario-<uuid>@zerofeebank.local", "password": "<clave en claro>" }
```

- La clave es **aleatoria en cada seed** (`randomBytes(18).toString('base64url')`), nunca una
  constante del repositorio — regla **J7** de S-23, que existe para que una credencial de
  siembra no se vuelva una contraseña conocida del producto.
- Se hashea con `AuthService.hashearPassword`, el **mismo** camino que usa el registro real:
  si el hash se fabricara aparte, el brazo probaría el seed contra sí mismo.
- `credenciales.email` es el email del **titular de las 3 cuentas** que el escenario ya
  devolvía (la buscable, la del tope y la ajena están en `cuentas[]`; la ajena pertenece a
  `usuarioAjenoId`, que **no** cambia).

## 3 · No-goals (lo que esta unidad NO hace)

- **No toca el usuario ajeno.** `usuarioAjenoId` sigue con `PASSWORD_HASH_SEMILLA`: nadie debe
  poder entrar como él, y el 404 de cuenta ajena se sigue probando por la integración del
  backend, no por pantalla (decisión de diseño).
- **No cambia los otros escenarios.** `cuenta-con-historial`, `cuenta-unica` y los demás siguen
  sin credencial y con el hash inutilizable. Ampliar eso sería una unidad propia, con su
  motivo propio.
- **No cambia ni un movimiento, ni un monto, ni una fecha, ni un identificador** del escenario.
  Los datos del oráculo son contrato de `S-13` y de la spec de F1; esta unidad sólo agrega la
  puerta de entrada.
- **No toca la pantalla.** `web/` queda intacto: eso es S-17-movimientos.

## 4 · Invariantes

| # | Invariante |
|---|---|
| **S28-I1** | La credencial devuelta **entra**: `POST /auth/login` con ese email y esa clave responde 200 y da un token. |
| **S28-I2** | Ese token **ve el oráculo**: `GET /movimientos?cuentaId=<la cuenta buscable>` responde 200 con los **10** movimientos que el propio seed declaró en `movimientos[]`. |
| **S28-I3** | La clave es distinta en cada seed, y los emails también (J7). |
| **S28-I4** | El titular ajeno **no** queda abierto: su email con la clave del titular bueno no entra. |
| **S28-I5** | El resto de la respuesta no se movió: mismos 3 identificadores de cuenta, mismos saldos declarados y los mismos 10 movimientos de `movimientos[]` que antes de esta unidad. |

## 5 · Criterio de «hecho»

1. `npm run test:costuras-credencial` en verde, con el número real de casos.
2. El árbitro **calibrado**: se devuelve el hash a `PASSWORD_HASH_SEMILLA` y el brazo de
   S28-I1 se pone **rojo**; se declara qué defecto se inyectó y cuál caso lo cazó.
3. `npm run test:costuras` (el candado de S-07) **sin moverse** y `npm run typecheck` en 0.

## 6 · Archivos en alcance

```
src/modules/costuras/costuras.service.ts     # la costura
test/costuras-credenciales.int.spec.ts       # el árbitro (archivo NUEVO)
package.json                                 # el script del árbitro
specs/S-28-credencial-movimientos.md         # esta spec
```

`test/costuras.int.spec.ts` **no se toca**: es archivo con candado (S-07). Por eso el árbitro
de esta unidad nace en un archivo propio.
