# S-23 · `fondosLiberados` en la boleta y un `seed` con una boleta en cada estado

> Sale de `specs/HU-02-pantalla-boletas.md` (R9, V4, V7, J4, J5, CA1–CA3, § 8). 2026-09-15.
> Rama `s23-boletas-seed`. Candado: `specs/_CANDADO.md`.
> La spec y el arnés van primero, calibrados; el campo y el escenario se implementan en una
> sola tarea, después del ataque a ciegas al arnés.

## Qué hace

1. **Campo `fondosLiberados: boolean` en `BoletaDto`**, en todas las respuestas que lo usan:
   `GET /boletas`, `GET /boletas/:id` y las cuatro `POST` (emitir, cobrar, vencer, devolver).
   Vale `true` si y sólo si la boleta tiene asiento de cierre (`transaccion_cierre_id` no nulo).
   Sirve para que la pantalla distinga una VENCIDA **con fondos por liberar** de una **ya
   liberada** (HU-02 § 6): hoy las dos responden `VENCIDA` igual.
2. **Escenario de `seed` `boletas-en-cada-estado`**: un titular **con credencial que sirve para
   entrar**, una cuenta CORRIENTE con saldo y 5 boletas, una por estado visible. Devuelve los
   ids de todo lo que creó, junto con el email y la contraseña (C1).

## Decisiones

**Del humano:** el usuario del escenario nace con una **contraseña real**, hasheada con el
mismo `AuthService.hashearPassword` de `/auth`, y `seed` la devuelve. Así se cierra la costura
que S-07 dejó abierta a propósito (`specs/S-07-costuras.md:267`, «escenarios con credenciales que
sirven para entrar»), y es lo que hace posible CA8 de HU-02. **Los 4 escenarios anteriores no
cambian**: siguen con `!NO-UTILIZABLE-S07!`.

**Declaradas para que se revisen:**

- **J1 · Nombre final: `fondosLiberados`** (el de HU-02 J4). También es cierto para COBRADA y
  DEVUELTA: en los tres cierres la cuenta de garantía ya no inmoviliza ese monto.
- **J2 · El campo sale del asiento de cierre, no del estado calculado.** `estadoEn(…)` da
  `VENCIDA` antes y después de liberar; derivarlo de ahí reproduce el hueco. La implementación
  puede leer `transaccionCierreId !== null` o el estado **persistido** `!== 'VIGENTE'` (son
  equivalentes: sólo un cierre saca a una boleta de VIGENTE en la base).
- **J3 · Una respuesta idempotente guardada antes de S-23 no trae el campo.** El replay de esa
  clave no puede dar 500 («respuesta corrupta», `src/infra/idempotencia.ejecutor.ts:64`). El guard
  de las respuestas guardadas **no exige** el campo, y `reconstruirBoletaConTransaccion` lo completa
  con `estado !== 'VIGENTE'` cuando falta. Es exacto: una respuesta de POST dice `VIGENTE` sólo
  cuando emite, y los tres cierres responden COBRADA, VENCIDA o DEVUELTA. Una respuesta guardada
  que sí trae el campo se devuelve tal cual.
- **J4 · Las fechas del escenario salen del reloj inyectado, y no son absolutas** (a diferencia de
  `movimientos-buscables`). Una VIGENTE con fecha absoluta vencería sola con el tiempo real, y R1
  no deja un plazo mayor a 365 días. Con el reloj de prueba fijado, dos corridas dan exactamente las
  mismas fechas, así que C2 se cumple igual.
- **J5 · Los asientos del escenario mueven lo mismo que el servicio**: las mismas cuentas de
  sistema (`GARANTIA`, `CAJA` por `obtenerOCrear`), el mismo monto y el mismo signo. Un escenario
  sembrado no es un atajo: expone un estado que el sistema alcanza de verdad (perfil SUT).
  **Enmienda: el concepto es de siembra, no el real** (`SIEMBRA_BOLETA_EMISION`,
  `_COBRO`, `_VENCIMIENTO`, `_DEVOLUCION`), como `SIEMBRA_ARNES` y `SIEMBRA_BUSQUEDA`. Con los
  conceptos reales, I5 exige una `Idempotency-Key` que reclame cada asiento, y un asiento sembrado
  no nace de un POST: con el escenario en la base, I5 dio **8 rojos** (medido).
  `invariantes.sh` siembra ahora el
  escenario y suma los 4 conceptos a su lista versionada, sin clave obligatoria: I5 no se relaja.
- **J6 · Los montos son potencias de 2 por diez**, para que cualquier suma de un subconjunto de
  boletas sea única. Si un saldo no cuadra, el número dice qué boleta falta o sobra.
- **J7 · La contraseña es aleatoria en cada `seed`** (como los ids) y no una constante del
  repositorio: ninguna credencial fija queda escrita en el código.

## Constantes

`F` = `reloj.ahora()` al sembrar. `d` = `MS_POR_DIA` (86 400 000).

| Constante | Valor | Por qué |
|---|---|---|
| Nombre del escenario | `boletas-en-cada-estado` | dice lo que siembra; entra a `ESCENARIOS_VALIDOS` |
| Fondeo de la cuenta | 1000,00 (`100000` centavos), en `F − 40 d`, desde la cuenta `SISTEMA` propia del escenario (`cuentaSistemaId`), concepto `SIEMBRA` | S-12: el mínimo de apertura son 1000 dólares; 40 días es antes de toda emisión. La contrapartida es la de los otros 4 escenarios y **no** CAJA (enmienda: si no, el delta de CAJA tenía dos respuestas correctas) |
| Usuario, cuenta y fondeo | nacen en `F − 40 d` | la cuenta existe antes que sus movimientos |
| Plazo de las 5 boletas | 30 días | dentro de R1 (1–365); `venceEn = emitidaEn + 30 d`, igual que `emitir` |
| Beneficiario / retirador / glosa | los del arnés de S-09 (`12345678-5` Constructora Andes SpA, `9876543-3` Ana Soto, «Fiel cumplimiento contrato 123») | RUT con dígito verificador válido (R4); ya están en el repositorio |
| Contraseña | 24 caracteres `base64url` de `randomBytes(18)` | cumple el mínimo de 8 de `/auth/registro` y es aleatoria (J7) |

| Etiqueta | Monto | Emitida | Vence | Cierre (asiento y cuándo) | Estado persistido |
|---|---|---|---|---|---|
| `VIGENTE` | 160,00 | `F − 1 d` | `F + 29 d` | — | VIGENTE |
| `VENCIDA_POR_LIBERAR` | 80,00 | `F − 31 d` | `F − 1 d` | — | VIGENTE (vencida al leer) |
| `VENCIDA_LIBERADA` | 40,00 | `F − 32 d` | `F − 2 d` | vencimiento GARANTIA → cuenta, en `F − 1 d` | VENCIDA |
| `COBRADA` | 20,00 | `F − 20 d` | `F + 10 d` | cobro GARANTIA → CAJA, en `F − 10 d` | COBRADA |
| `DEVUELTA` | 10,00 | `F − 15 d` | `F + 15 d` | devolución GARANTIA → cuenta, en `F − 5 d` | DEVUELTA |

Cada cierre ocurre entre la emisión y `F`. El cobro y la devolución, además, antes del vencimiento
(sólo una VIGENTE se cobra o se devuelve); la liberación, después.

**Saldos esperados después de sembrar** (sobre una base recién reseteada):
cuenta = 1000 − 160 − 80 − 40 − 20 − 10 + 40 + 10 = **740,00** · GARANTIA = 160 + 80 = **240,00**
(las dos abiertas: es I6 en miniatura) · CAJA recibe **20,00** del cobro.

## Forma de la respuesta de `seed` (se suma a `SeedRespuesta`, sólo en este escenario)

```jsonc
{
  "escenario": "boletas-en-cada-estado",
  "usuarioId": "…", "cuentaSistemaId": "…",
  "cuentas": [{ "id": "…", "tipo": "CORRIENTE", "saldoCentavos": "74000" }],
  "credenciales": { "email": "…", "password": "…" },
  "boletas": [
    { "etiqueta": "VIGENTE",             "id": "…", "montoCentavos": "16000" },
    { "etiqueta": "VENCIDA_POR_LIBERAR", "id": "…", "montoCentavos": "8000" },
    { "etiqueta": "VENCIDA_LIBERADA",    "id": "…", "montoCentavos": "4000" },
    { "etiqueta": "COBRADA",             "id": "…", "montoCentavos": "2000" },
    { "etiqueta": "DEVUELTA",            "id": "…", "montoCentavos": "1000" }
  ]
}
```

En ese orden. Los montos van como string decimal (D1). `saldoCentavos` es el saldo derivado del
ledger después de sembrar todo.

## Casos borde (Pilar 4)

1. **Replay de una clave guardada sin el campo** → 200 con el cuerpo original más el campo (J3).
2. **Reloj adelantado 30 días después de sembrar** → la `VIGENTE` pasa a VENCIDA con
   `fondosLiberados: false`, y un `vencer` la deja en `true`. Es el camino de CA6 de HU-02.
3. **`vencer` sobre la `VENCIDA_LIBERADA` sembrada** → `409 TRANSICION_INVALIDA` y el ledger
   intacto: lo sembrado se comporta como lo emitido por la puerta real.
4. **Dos `seed` seguidos del escenario** → dos titulares, dos emails y dos contraseñas distintos,
   con los mismos montos (A7 de S-07).
5. **El email sembrado** debe pasar la validación de `/auth/login`; si el formato actual
   (`usuario-<uuid>@zerofeebank.local`) no la pasa, lo dice el brazo de login.

## No-goals

- Credencial en los 4 escenarios anteriores (no la necesitan; sus arneses forjan el token).
- Cambiar `estado` o `estadoEn`: el campo es aditivo.
- `fechaCierre` u otro dato del cierre en el DTO (la pantalla no lo pide; HU-02 J2).
- Pantalla, ventanilla y catálogo de testids: son de S-17-boletas.
- I6 permanente en `invariantes` (sigue en el backlog; aquí sólo su miniatura en un brazo).

## Arnés · `test/boletas.int.spec.ts`, grupos I y J nuevos

**Sólo añade**: el campo a `CLAVES_DTO` (los brazos A, D y E ya exigen las claves exactas en
orden: `fondosLiberados` va **al final**, después de `venceEn`) y los grupos I y J al final. El
cambio de `CLAVES_DTO` convierte en rojos 4 brazos existentes sobre `main`, que es lo esperado:
miden el contrato nuevo.

| Brazo | Qué mide | CA |
|---|---|---|
| I1 | VIGENTE recién emitida → `false` en la respuesta del POST, en `GET /:id` y en `GET /boletas` | CA1 |
| I2 | reloj adelantado más allá de `venceEn`, sin liberar → `estado: VENCIDA`, `fondosLiberados: false` | CA1 |
| I3 | después de `vencer` → `VENCIDA` y `true`, en el POST y en los dos GET | CA1 |
| I4 | después de `cobrar` → `COBRADA` y `true` (POST y GET) | CA1 |
| I5 | después de `devolver` → `DEVUELTA` y `true` (POST y GET) | CA1 |
| I6 | replay de una clave de emisión cuya respuesta guardada no trae el campo → 200, mismo `id`, `fondosLiberados: false` | J3 |
| I7 | lo mismo con una clave de **devolución** → 200, `DEVUELTA`, `fondosLiberados: true` (la otra rama de J3) | J3 |
| J1 | `seed` responde 201 con la forma de arriba: 5 boletas en orden, montos, un id por boleta que existe en la base con su **estado persistido** y si tiene asiento de cierre | CA3 |
| J2 | con la credencial devuelta, `/auth/login` da 200; con ese token, `GET /boletas` lista las 5 con el `estado` y el `fondosLiberados` de la tabla | CA3 |
| J3 | saldos del ledger: cuenta 74000, GARANTIA 24000; `saldoCentavos` declarado = derivado | CA3, J5 |
| J4 | cada asiento de boleta con su concepto de siembra y **el monto en cada pata**; toda transacción que toca la cuenta (8, fondeo incluido) suma 0; el fondeo es SISTEMA −100000 / cuenta +100000 | D2, J5 |
| J5 | con el reloj fijado, las 5 `emitidaEn` y `venceEn` son exactamente las de la tabla | J4 |
| J6 | reloj + 30 días: la `VIGENTE` sembrada da `VENCIDA`/`false`, y un `vencer` la deja en `true`; un `vencer` sobre la `VENCIDA_LIBERADA` da 409 y el ledger no cambia | bordes 2 y 3 |
| J7 | dos `seed` seguidos: emails, contraseñas y ids distintos; los mismos montos | borde 4 |

Sobre la rama sin implementar deben quedar **rojos exactos** los 4 brazos de `CLAVES_DTO` (A1,
D1, D3, E1: los que comparan `Object.keys`), I1–I6, I7 y J1–J7. Todo lo demás del archivo, verde.

## Calibración (tabla fijada ANTES de implementar) · `npm run calibrar:s23`

Un defecto por vez sobre la implementación. Los anclas de texto se adaptan al código; el defecto y
sus brazos no. Un ancla ausente suma al total y no al aprobado (`ancla_ausente`, #130).
**Enmienda:** la columna de abajo es el **mínimo** que cada defecto debe poner rojo. Los
rojos EXACTOS dependen de cómo quede escrito el código (p. ej. si el campo lee `transaccionCierreId`
o el estado persistido, K4 pinta J2 o no), así que se fijan leyendo la entrega y **antes de
correr** el calibrador. Se hallaron rojos de más que la tabla
no declaraba: K10 también I6/I7, K4 también J1 y J5, K9 también J4, J5 y J6.

| # | Defecto inyectado | Debe cazarlo |
|---|---|---|
| K1 | `fondosLiberados` siempre `false` | I3 I4 I5 J2 J6 |
| K2 | `fondosLiberados` = `estadoCalculado !== 'VIGENTE'` (el error plausible, J2) | I2 J2 J6 |
| K3 | el guard de replay exige el campo | I6 |
| K4 | el escenario marca `VENCIDA_LIBERADA` como VENCIDA sin escribir su asiento | J2 J3 J4 |
| K5 | el cobro sembrado va de GARANTIA a la cuenta del titular en vez de a CAJA | J3 J4 |
| K6 | la `VENCIDA_POR_LIBERAR` se siembra con `venceEn` en el futuro | J2 J5 |
| K7 | la contraseña que devuelve `seed` no es la hasheada | J2 |
| K8 | las fechas del escenario salen de `new Date()` y no del reloj | J5 |
| K9 | `seed` devuelve las etiquetas `VIGENTE` y `DEVUELTA` intercambiadas | J1 J2 |
| K10 | los POST no traen el campo (sólo los GET) | I1 I3 I4 I5 |

## Hecho

- Sobre la rama sin implementar: los rojos exactos de § Arnés, y el resto del archivo verde.
- Con la implementación: `test:boletas` todo verde; `calibrar:s23` exacto y `calibrar:anclas` con
  el nuevo calibrador en su lista.
- `test:costuras` y `test:pdf` sin cambios de número (CA2); ninguna aserción anterior se relaja.
- Batería: `test:integracion`, `test:domain`, `invariantes` 6/6 **después de sembrar el escenario**,
  `guante` 6/6, `typecheck` 0, `build` 0.
- Las casuísticas nuevas documentadas (credencial sembrada, replay de J3,
  reloj + 30 días sobre la VIGENTE sembrada).

## Archivos que se pueden tocar

`src/modules/boletas/boletas.dto.ts`, `src/modules/boletas/boletas.service.ts` (sólo si hace falta
para pasar `transaccionCierreId` al DTO), `src/modules/costuras/costuras.service.ts`,
`src/modules/costuras/costuras.escenarios.ts`, `src/modules/costuras/costuras.module.ts` (para
importar `AuthModule`). Ningún `*.spec.ts`.
