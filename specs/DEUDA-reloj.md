# DEUDA-reloj · Las fechas de negocio salen del reloj inyectado

> Escrita el **2026-09-10**, antes de tocar código. Cierra la deuda
> abierta el 2026-09-08 y es el **paso 1** del orden de S-10
> (`specs/S-10-catalogo.md` § 5): sin ella, el PDF no puede llevar una fecha controlable.
> Candado: `specs/_CANDADO.md`. **Los casos de § 5 se fijan acá y no se tocan después.**

---

## 0 · Por qué

C2 (perfil SUT) exige cero reloj de pared en el dominio. `RelojService` existe desde S-07 y
las boletas lo usan, pero **cinco columnas de negocio las fecha Postgres** con
`@default(now())`: con el reloj fijado en 2031, una transferencia queda fechada *hoy*. S-13 lo
rodeó sembrando fechas absolutas; el comprobante PDF (S-10, D-b′) no puede rodearlo.

Medido al escribir esta spec (`grep -n "@default(now())" prisma/schema.prisma` → 6):

| Columna | Quién la escribe hoy | ¿Sale en la API? |
|---|---|---|
| `usuario.creado_en` | `auth.service.ts:178` (`usuario.create`) | sí: `creadoEn` del registro |
| `cuenta.creada_en` | `cuentas.service.ts:104,148` · `cuentas-sistema.repository.ts:33` (SQL crudo) | sí: `abiertaEn` |
| `transaccion.creada_en` | `transferencias.service.ts:83`, `cuentas.service.ts:164` | no; la usará el PDF |
| `movimiento.creado_en` | `transferencias.service.ts:86`, `cuentas.service.ts:171` | sí: `fecha` de `/movimientos` |
| `pago.pagado_en` | `pagos.service.ts:122` | sí: `pagadoEn` |
| `clave_idempotencia.creada_en` | `idempotencia.ejecutor.ts:76` | **no** (queda fuera, § 1) |

## 1 · Qué, qué no, y cuándo está hecho

- **Qué:** las cinco primeras columnas se escriben **siempre** con `RelojService.ahora()`, y
  la BD deja de tener un valor por defecto para ellas.
- **No-goals:** `clave_idempotencia.creada_en` (metadato técnico: no se expone ni alimenta
  ningún documento; si algún día vence claves, entra con esa unidad). El reloj del navegador
  (es de S-10). Los PDF (unidad siguiente). No cambia ningún contrato HTTP: sólo **de dónde
  sale** el valor.
- **Hecho:** § 5 en verde, con cada caso visto en rojo por § 6; y la batería de § 7 con los
  mismos números que antes de la unidad.

## 2 · Decisiones técnicas

1. **Se quita el `DEFAULT` de las cinco columnas** (migración). Un default no deja rastro
   cuando alguien lo olvida. Sin él, el cliente Prisma exige el campo (`typecheck` rojo) y
   Postgres rechaza un `INSERT` crudo que no lo trae (`NOT NULL`). El olvido pasa a ser un
   error de compilación, no un dato mal fechado.
2. **`TransferenciasService` inyecta `RelojService`**, y `Peticion` gana `en?: Date`: si no
   viene, se usa `reloj.ahora()`. Ese respaldo **es el reloj inyectado, no el de pared**, así
   que no viola C2.
   - **Un `RelojModule` global nuevo** (`src/infra/reloj.module.ts`, `@Global()`, provee y
     exporta `RelojService`). Lo importan los módulos cuyos servicios inyectan el reloj (Auth,
     Transferencias, Cuentas, Pagos, Boletas), y `CosturasModule` lo importa **en vez de
     proveer su propio `RelojService`**. Por qué: `auth.int.spec` monta `[AuthModule]` y
     `cuentas.int.spec` monta `[AuthModule, CuentasModule, TransferenciasModule]`, ninguno
     con `CosturasModule`, que hoy es el único que provee el reloj. Y tiene que haber **una
     sola instancia**: la que fija `POST /__test__/reloj` es la que leen los servicios. Un
     `providers: [RelojService]` por módulo daría instancias sueltas que la costura no toca
     (F1–F6 rojos).
   - **El constructor lleva un valor por defecto:** `reloj: RelojService = new RelojService()`.
     `test/concurrencia.int.spec.ts:22` construye el servicio a mano con dos argumentos (sin
     Nest). Nest siempre inyecta el tercero, así que el valor por defecto sólo existe para ese
     arnés. Y sigue siendo el reloj inyectable (sin fijar = hora real, igual que en
     producción), no un `new Date()` suelto.
3. **Quien escribe también su propio documento pasa el mismo instante** (`en`). Así el asiento
   y el documento comparten la fecha exacta, también con el reloj real, que corre entre dos
   llamadas: la apertura de cuenta (`abiertaEn`), el pago (`pagadoEn`) y las cuatro
   transiciones de la boleta (`emitidaEn`, y el `ahora` del cobro, el vencimiento y la
   devolución).
4. `CuentasSistemaRepository.obtenerOCrear(db, codigo, en)`: la cuenta de sistema también
   nace con fecha del reloj. Sus tres llamadores ya tienen el instante.

## 3 · Invariantes

- **R1:** con el reloj fijado en T, **toda** fila de esas cinco tablas que escribe una
  operación lleva exactamente T, **al milisegundo**.
- **R2:** `@default(now())` aparece en `prisma/schema.prisma` **una sola vez**, en
  `clave_idempotencia.creada_en`. Es un chequeo por ausencia, así que la lista de términos
  se versiona en el propio test (ARNÉS).

## 4 · Casos borde

- Un instante con milisegundos ≠ 0 (`T = 2031-03-14T15:09:26.535Z`) caza que alguien lo
  trunque a segundos.
- T está en el futuro y lejos de hoy: un `now()` de Postgres no puede coincidir con él por
  azar.
- La cuenta de sistema se crea en la primera operación después de `reset`: R1 se comprueba
  sobre ella en ese momento.
- En una transición de boleta, el reloj avanza a T2 ≠ T **antes** de la llamada: el asiento de
  cierre debe llevar T2, no la fecha de emisión.

## 5 · Arnés: `test/reloj-fechas.int.spec.ts` (`npm run test:reloj`)

Todos parten de `reset` y fijan el reloj en T con `POST /__test__/reloj`. Leen la BD
directamente, igual que `idempotencia.int.spec.ts`: la suite interna de la app sí puede
hacerlo; la E2E agnóstica, no.

| # | Operación | Afirma |
|---|---|---|
| F1 | `POST /auth/registro` | respuesta `creadoEn == T` y `usuario.creado_en == T` |
| F2 | `POST /cuentas` (apertura fondeada) | `abiertaEn == T`; su `transaccion.creada_en` y sus 2 `movimiento.creado_en` `== T` |
| F3 | `POST /transferencias` | su `transaccion.creada_en` y sus 2 movimientos `== T`; `GET /movimientos` → `fecha == T` |
| F4 | `POST /pagos` | `pagadoEn == T`; su transacción y sus 2 movimientos `== T` |
| F5 | `POST /boletas` y luego, con el reloj en T2, `cobrar` / `vencer` / `devolver` (una boleta cada una) | el asiento de emisión en T; cada asiento de cierre y sus movimientos en T2 |
| F6 | la primera operación después de `reset` que crea `CAJA` y `GARANTIA` | `cuenta.creada_en == T` de las dos cuentas de sistema |
| F7 | lectura de `prisma/schema.prisma` | R2: exactamente 1 `@default(now())`, en `ClaveIdempotencia` |

## 6 · Calibración (con `scripts/lib/calibrador.sh`)

Cada defecto se inyecta solo, y se declara qué casos deben ponerse rojos. Un defecto que no
pone rojo lo declarado, o que pone rojo algo no declarado, es un hallazgo sobre el arnés.

| Defecto | Inyección | Rojo esperado |
|---|---|---|
| K1 | `transferirEn` usa `new Date()` en vez de `en ?? reloj.ahora()` | F2, F3, F4, F5 |
| K2 | `pago.create` con `pagadoEn: new Date()` | F4 |
| K3 | apertura: `cuenta.create` con `creadaEn: new Date()` | F2 |
| K4 | registro: `usuario.create` con `creadoEn: new Date()` | F1 |
| K5 | cobro de boleta: pasa `en: new Date()` al asiento | F5 |
| K6 | `obtenerOCrear` escribe `now()` en el SQL | F6 |
| K7 | el esquema recupera `@default(now())` en `Movimiento.creadoEn` | F7 |

## 7 · Batería que no debe moverse (números antes de la unidad)

`typecheck` 0 · `build` 0 · `test:domain` 100/100 · `test:integracion` 294/294 ·
`invariantes` 5/5 · `invariantes:calibrar` 11/11 · `guante` 6/6 · `verify:s04` 6/6 ·
`sonda:caja` 15/15 · `sonda:garantia` 18/18 · `calibrar:s15` 18/19 · `calibrar:s18` 5/5.
Si un número cambia, se diagnostica (Pilar 6); no se ajusta.

Con la migración y el arnés ya puestos, y **antes** de la implementación, se midió
el 2026-09-11: `typecheck` exit 2, con 8 errores y todos en los escritores de § 0;
`test:integracion` **91 pasan / 210 fallan de 301** (294 + 7 de F). Sin `DEFAULT`, cada
escritura sin fecha revienta, que es justo la compuerta de § 2.1.

## 8 · Arneses que hubo que tocar

Quitar el `DEFAULT` obligó a dar fecha a las filas que **siembran** `test/concurrencia.int.spec.ts`
y `test/idempotencia.int.spec.ts` (usuario, cuenta, transacción y movimientos creados con
Prisma): 14 líneas que agregan `creadoEn`/`creadaEn: new Date()`. Ninguna aserción, caso ni
nombre cambió. La hora de pared en una siembra es legítima: C2 rige el dominio, no la
preparación del arnés.
