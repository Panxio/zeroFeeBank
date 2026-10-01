# M6 · Demo completa — guion de extremo a extremo

> Cierra la meta **M6**:
> *3 corridas seguidas login → transferencia → boleta desde `reset` sin fallo.*

---

## 1 · Qué hace, qué queda fuera, cuándo está hecho

**Qué hace.** Un guion que maneja el **artefacto entregado** (backend `dist/main.js` en `:3000`
y el build de `web/` servido en `:4200`) y recorre el camino de negocio completo, tres veces
seguidas, cada una desde un `POST /__test__/reset` limpio: **entrar → transferir → emitir una
boleta → cobrarla en la ventanilla pública**. Afirma sobre la pantalla (por `data-testid`) y
**además sobre el API** (saldos exactos en centavos), y deja una captura por hito.

**Qué queda fuera (no-goals).**
- No prueba casos de rechazo ni bordes: eso ya lo cubren `verificar:s17-boletas` (42 brazos) y
  `verificar:s10-t4` (78). M6 mide **que el camino feliz no se cae tres veces seguidas**.
- No toca `src/` ni `web/`. Si el camino necesita una costura o un `data-testid` que no existe,
  **se detiene y se escala** (Regla de Oro): no se agrega nada a la app para que pase el guion.
- No abre cuenta (esa pantalla no existe todavía) ni usa transferencia a otro banco.
- No mide rendimiento ni cuota.

**Cuándo está hecho.**
1. `npm run demo:m6` termina con **`M6: 3/3 corridas · N/N pasos`** y exit 0.
2. Cada defecto de § 6 **que declara un paso** deja el guion en **rojo**, en ese paso (calibración;
   un árbitro que nunca se vio fallar no es un árbitro). K5 es la excepción declarada: es una
   **sonda de ceguera**, su resultado esperado es **verde**, y por eso se registra
   como ceguera conocida en vez de retocar el guion para taparla.
3. Las capturas de la corrida 1 quedan en la carpeta de capturas de referencia y **el humano las aprueba**
   (verificación visual de una persona = respuesta + captura).

---

## 2 · Decisiones de diseño (declaradas, discutibles)

| # | Decisión | Porqué |
|---|---|---|
| J1 | El guion es **automatizado**, no manual | «3 corridas seguidas sin fallo» no es verificable a mano sin ocupar a una persona cada vez, y el objetivo 1 del proyecto es que el camino sea automatizable por cualquier framework |
| J2 | Reusa la costura de arranque de `scripts/verificar-s17-boletas.sh` **verbatim** | Pilar 0, peldaño 4: ya existe, ya aborta si `:3000`/`:4200` están ocupados, ya guarda el log entero |
| J3 | El destino de la transferencia es una cuenta **ajena**, sembrada con un segundo `seed` `dos-cuentas` sobre el mismo `reset` | `boletas-en-cada-estado` siembra **una sola** cuenta del titular: sin una segunda cuenta no hay transferencia posible. `seed` es aditivo (no limpia), y una cuenta de otro usuario es un estado que el sistema alcanza de verdad (C1) |
| J4 | Antes de la ventanilla el guion **cierra sesión** (`salir`) | § 4.6 de `S-17-boletas.md` (J9): con sesión, el fragmento `#ventanilla` se ignora. La ventanilla es del retirador, no del titular: cerrar sesión es el camino real, no un truco |
| J5 | El reloj del backend se fija en `F` con `POST /__test__/reloj` antes de sembrar | C2, determinismo: las fechas de la boleta sembrada y de la emitida dependen del reloj; sin fijarlo la captura cambia cada día |
| J6 | Toda espera es **por condición** con tope, nunca por tiempo | C4 y la compuerta dura del perfil `qa-automation`: un `sleep` esconde un cuelgue |
| J7 | Las aserciones de dinero son **exactas en centavos por API**, no leídas de la pantalla | D1 y C3: un localizador que depende de que el saldo diga «$1.234» se rompe con cualquier cambio de formato |

---

## 3 · Constantes (todas con valor y porqué; ninguna inventada)

| Constante | Valor | De dónde sale |
|---|---|---|
| Viewport | **1280×800** | el de escritorio de S-17 § 3 y de T2–T4 |
| Tope de cada espera por condición | **8000 ms** | el de T1–T4 y S-17 § 3 |
| Corridas | **3** | el umbral de M6 |
| Instante fijo del backend `F` | **`2026-09-15T01:30:00.000Z`** | S-17 § 3, mismo valor, para que las fechas de las capturas sean las ya revisadas |
| Zona del navegador | **`America/Santiago`** | S-17 § 3 |
| Escenario del titular | **`boletas-en-cada-estado`** | es el **único** que devuelve credenciales que sirven para entrar (S-23, J5) |
| Saldo inicial del titular | **`74000`** centavos (US$ 740,00) | lo devuelve el propio `seed`, derivado del ledger; el guion lo **lee**, no lo supone, y sólo comprueba que coincida |
| Escenario del destino | **`dos-cuentas`** | J3 |
| Monto de la transferencia | **`"100.00"`** (10 000 centavos) | cabe en los 740,00 sembrados y deja saldo para la boleta de 250,10; punto decimal como exige P1 de T3 |
| Monto de la boleta | **`"250.10"`** | S-17 § 3: con `Number()` sería `250,1`, así que distingue el borde de D1 |
| Plazo de la boleta | **`"30"`** | S-17 § 3 (feliz; R1 admite 1–365) |
| Beneficiario | **`12345678-5` · Constructora Andes SpA** | S-17 § 3 (los de S-09 y S-23) |
| Retirador | **`9876543-3` · Ana Soto** | S-17 § 3 |
| Glosa | **«Fiel cumplimiento contrato 123»** | S-17 § 3 |
| Saldo final esperado del titular | **`38990`** centavos | `74000 − 10000 − 25010`, calculado por el guion a partir del saldo que devolvió `seed`, no escrito a mano |
| Pasos por corrida | **14** | los de § 4 |
| Invariantes al cierre de cada corrida | **5/5 · I7 sin población** (`INV_SEMBRAR=0`) | I1–I5; es lo que cubre el otro lado de cada asiento (J8). I7 necesita una transferencia interbancaria, que la demo no hace |
| URL de la ventanilla | **`http://localhost:4200/#ventanilla`** | S-17 § 3 (H3) |

> El cobro de la boleta **no** devuelve plata al titular: la emisión ya inmovilizó los fondos en
> la cuenta de garantía (D2). Por eso el saldo final no cambia entre el paso 9 y el 10.

---

## 4 · El guion, paso a paso (una corrida)

Cada paso es un brazo con nombre. Un paso rojo **detiene la corrida** y la corrida cuenta como
fallida: M6 exige tres seguidas sin fallo, así que no tiene sentido seguir midiendo una rota.

| # | Paso | Qué hace | Qué afirma |
|---|---|---|---|
| P1 | `reset` | `POST /__test__/reset`. En las corridas **2 y 3**, además: `POST /auth/login` con las credenciales de la corrida anterior | `200` en el reset; y el login viejo devuelve **`401`** — si el usuario anterior sigue vivo, el `reset` no borró (cierra el hueco de K6) |
| P2 | `reloj` | `POST /__test__/reloj` fijando `F` | `200` |
| P3 | `seed-titular` | `POST /__test__/seed` `boletas-en-cada-estado` | `200`; trae `credenciales`, una cuenta `CORRIENTE` y su `saldoCentavos`; **el saldo es `74000`** |
| P4 | `seed-destino` | `POST /__test__/seed` `dos-cuentas` | `200`; trae al menos una cuenta con `id` |
| P5 | `portada` | abre `http://localhost:4200/` | `portada` visible |
| P6 | `login` | `login-abrir` → `login-popover` → dentro del marco `login-marco`: `login-email`, `login-password`, `login-enviar` | `usuario-email` muestra el email sembrado |
| P7 | `resumen` | espera el estado terminal de la carga de cuentas | `cuentas-tabla` con exactamente **una** `cuenta-fila`, y su `cuenta-id` es la sembrada |
| P8 | `transferir` | `nav-transferir` → paso Origen: elegir la cuenta sembrada y **`transferir-origen-siguiente`** → paso Destino: **`transferir-destino-modo-otra`**, `transferir-destino-id` = la cuenta ajena de P4, `transferir-monto` = `"100.00"` y **`transferir-destino-siguiente`** → paso Revisar: `transferir-enviar` → `confirmar-aceptar` (shadow root) | `transferir-exito` visible con `transferir-transaccion-id` no vacío; **y por API la cuenta origen bajó exactamente 10 000 centavos** |
| P9 | `emitir` | `nav-boletas` → `emitir-form` con los datos de § 3 → `emitir-enviar` | `emitir-exito` con `emitir-boleta-id`; aparece `boleta-fila[data-boleta-id=<ese id>][data-estado="VIGENTE"]`; **y por API la cuenta bajó exactamente 25 010 centavos más** |
| P10 | `salir` | **`nav-usuario`** (abre el menú: `salir` vive en `.nav-usuario-menu`, que es `display:none` mientras `nav-usuario` no tenga `aria-expanded="true"`) → `salir` | vuelve la `portada` y `usuario-email` ya no está |
| P11 | `ventanilla` | **en una página nueva** (contexto limpio, no la misma pestaña): `http://localhost:4200/#ventanilla` → `ventanilla-boleta-id` = el id de P9, `ventanilla-rut` = `9876543-3` → `ventanilla-cobrar` | `ventanilla-exito[data-estado="COBRADA"]`, y `ventanilla-monto[data-monto]` = **`"250.10"`**, la constante de negocio — **no** lo que haya devuelto la respuesta |
| P12 | `cuadre` | por API, con el token del titular | saldo = **38 990** centavos; la boleta emitida quedó `COBRADA` |
| P13 | `invariantes` | `INV_SEMBRAR=0 npm run invariantes` sobre el estado que dejó la corrida | exit 0 y el resumen **`S-11: 5/5 invariantes en verde (I1–I5) · I7 SIN POBLACIÓN`**. Es lo que afirma sobre el **otro lado** de cada asiento: el destino de la transferencia y la cuenta de garantía (J8). I7 no se audita porque la demo no hace transferencias interbancarias, y el árbitro lo **dice** en vez de darlo por verde (enmienda § 4.2) |
| P14 | `reloj-libre` | `POST /__test__/reloj` desfijando, **siempre**, incluso si la corrida murió antes | `200` |

**Capturas** (1280×800, PNG) en `$ZFB_CAPTURAS/corrida-<n>/` (defecto: un directorio `m6-ultima/` ignorado por git; `specs/M6-capturas-fuera-del-arbol.md`; la referencia aprobada sigue en su carpeta de capturas de referencia): `p5-portada.png`,
`p7-resumen.png`, `p8-transferencia.png`, `p9-boleta.png`, `p11-ventanilla.png`. Se toman en las
tres corridas; ante un rojo, además `rojo-<paso>.png`.

**Entre corridas no queda nada:** la corrida siguiente empieza por su propio `reset` (P1), y P1
lo **comprueba** en vez de confiar.

---

## 4.1 · Enmienda previa a la entrega (ataque a ciegas)

Diez hallazgos, los diez verificados contra el código antes de aceptarlos. Ninguna
aserción se debilitó: la enmienda sólo agrega.

| # | Clase | Qué decía la spec | Qué dice ahora |
|---|---|---|---|
| 1 | ciego | nadie afirmaba sobre la cuenta **destino**: K1 (debita y no acredita) daba verde | **P13**, invariantes: I1 exige que cada transacción sume 0 (J8) |
| 2 | ciego | K6 (`reset` que no borra) daba verde: el `seed` crea ids nuevos y `GET /cuentas` filtra por titular | **P1** reintenta el login de la corrida anterior y exige `401` |
| 3 | ciego | el cobro en ventanilla no tenía ninguna aserción de dinero | **P13** (el asiento del cobro entra en I1/I2) |
| 4 | ciego | la emisión no afirmaba sobre el crédito a la cuenta de **garantía** | **P13**, ídem |
| 5 | ciego | P11 comparaba `data-monto` contra la respuesta HTTP: el árbitro se comparaba consigo mismo | **P11** compara contra la constante `"250.10"` |
| 6 | imposible | P8 saltaba el asistente; en una app **correcta** `transferir-destino-id` está oculto | **P8** pulsa `transferir-origen-siguiente` y `transferir-destino-siguiente` |
| 7 | imposible | P10 pulsaba `salir`, que vive en un menú con `display:none` | **P10** abre `nav-usuario` primero |
| 8 | imposible | § 1 exigía rojo para los 6 defectos y la nota de K5 decía que sería verde: contradicción de la spec | § 1 criterio 2 y § 6 reclasifican K5 como **sonda de ceguera**, esperada en verde |
| 9 | frágil | `exitoVentanilla` nunca se limpia (`app.ts:126,471`): la corrida 2 podía ver el éxito de la 1 | **P11** corre en una página nueva |
| 10 | frágil | el reloj quedaba fijado en `F` al terminar | **P14**, y corre pase lo que pase |

> Y una consecuencia dura que salió de verificar el hallazgo 1: **el titular no puede abrir una
> segunda cuenta**. `POST /cuentas` exige `cuentaOrigenId` y fondea con 100 000 centavos, y la
> cuenta sembrada tiene 74 000. Por eso el destino sigue siendo ajeno (J3) y el otro lado se
> cubre con los invariantes (J8), no con un saldo leído.

---

## 5 · Salida y número real

```
corrida 1 · 14/14 pasos · 41 s
corrida 2 · 14/14 pasos · 38 s
corrida 3 · 14/14 pasos · 39 s
M6: 3/3 corridas · 42/42 pasos
```

Exit 0 sólo con `3/3`. Cualquier otra cosa: exit 1, con el nombre de los pasos rojos primero y
el detalle después. La salida entera va a `$ZFB_LOG` (un rojo que no se guarda no existió).

---

## 6 · Defectos de calibración (fijados ANTES de medir; no se tocan después)

La predicción se fijó antes de correr nada. **Lo medido no se retocó para que calzara**: donde
la predicción falló, se dice que falló.

| # | Defecto inyectado | Dónde | Predicción | **Medido** |
|---|---|---|---|---|
| K1 | La transferencia debita el origen y **no acredita** el destino (rompe D2) | `transferencias.service.ts` | rojo en P13 | **rojo en P11** · predicción equivocada |
| K2 | La transferencia descuenta **10 001** centavos en vez de 10 000 | ídem | rojo en P8 | **rojo en P8** ✔ `saldo origen tras transferencia fue 63999, esperado 64000` |
| K3 | `emitir-enviar` queda deshabilitado siempre | `app.html` | rojo en P9 | **rojo en P9** ✔ `emitir-enviar está deshabilitado` |
| K4 | `nav-boletas` renombrado a `nav-boletas-v2` | ídem | rojo en P9 | **rojo en P9** ✔ |
| K5 | La ventanilla acepta **cualquier** RUT de retirador | `boletas.service.ts` | **verde** (sonda de ceguera) | **verde** ✔ `3/3 corridas · 42/42` |
| K6 | `POST /__test__/reset` no borra nada | `costuras.service.ts` | rojo en P1 | **rojo en P1, corrida 2** ✔ `login viejo respondió 200, esperado 401` |
| K7 | La emisión debita al titular y **no acredita** la garantía | `transferencias.service.ts`, acotado a `EMISION_BOLETA` | rojo en P13 | **rojo en P11** · predicción equivocada |
| K8 | El menú de usuario siempre visible (sin `display:none`) | `styles.css` | **verde** (sonda de ceguera) | **verde** ✔ |
| K9 | El crédito al destino llega **1 centavo corto** | `transferencias.service.ts` | rojo en P13 | **rojo en P13** ✔ `invariantes falló (2 invariantes en rojo)` |

**Número real: 9 defectos medidos · 7 debían ponerse rojos y los 7 se pusieron · 2 sondas de
ceguera dieron verde, como estaba escrito antes de medir · 2 predicciones de paso equivocadas.**

### Lo que la calibración enseñó, sin maquillar

- **K1 y K7 se cazan, pero no donde se predijo.** Los dos rompen el asiento de una manera que
  hace fallar el **cobro en la ventanilla** (P11), y la corrida muere ahí: P13 nunca llega a
  correr. La predicción estaba mal; se deja escrita como estaba. Lo que sí queda probado es que un asiento roto **no pasa** la demo.
- **P13 habría quedado sin calibrar** si sólo se hubieran corrido los 8 defectos de la lista
  original: K1 y K7, los dos que decían probarlo, mueren antes de llegar. Por eso se agregó
  **K9** —un centavo que falta en el otro lado, invisible para la UI y para el saldo del
  titular— que es el único defecto que llega a P13 y lo pone rojo. Un paso que nunca se vio
  fallar no es un paso: es una afirmación.
- **K7 no se puede inyectar en `boletas.service.ts`:** la emisión escribe su asiento llamando a
  `transferencias.transferirEn`, así que el defecto vive en transferencias y hubo que acotarlo
  al concepto `EMISION_BOLETA` para no convertirlo en K1.
- **Dos inyecciones no entraron** en la primera pasada (K5 y K7, por anclas mal escritas). La
  calibración lo **dijo** —`INYECCIÓN NO ENTRÓ`, sin medir— en vez de leer el verde como
  resultado. Un defecto que no entró y nadie ve produce un verde falso.

> **K5 y K8 son sondas de ceguera, no fallos tolerados.** Su resultado esperado (verde) estaba
> escrito antes de medir, con su árbitro nombrado: el rechazo por RUT ajeno lo cubre un brazo de
> `verificar:s17-boletas`, y el `display:none` del menú lo cubre `verificar:s10-t4`. Se
> registran con «nació ciego = sí».

---

## 7 · Batería que no debe moverse

`npm run typecheck` 0 · `npm run build` 0 · `npm run guante` 6/6 · `npm run test:domain` 140/140 ·
`npm run test:integracion` 440/440 · `npm run invariantes` 6/6 (en su modo normal, que sí siembra
una transferencia interbancaria) · `npm run invariantes:calibrar` **16/16**. M6 no toca `src/` ni
`web/`: si alguno se mueve, es un defecto de esta unidad.

---

## 4.2 · Enmienda por bloqueo de la implementación (decisión del humano)

La implementación se detuvo y escaló en vez de falsear: P13 era **imposible** tal como estaba escrito.
`scripts/invariantes.sh` tenía una compuerta de población que exigía ≥1 `TRANSFERENCIA_OTRO_BANCO`
y abortaba si no la había — y § 1 declara que la demo no hace transferencias interbancarias. La
base que deja M6 está cuadrada (26 movimientos, suma 0), pero el árbitro no llegaba a mirarla.

**Decisión del humano:** la compuerta pasa a ser **por invariante, y sólo en modo auditoría**.

- Con `INV_SEMBRAR=1` **no cambia nada**: la siembra crea esa transferencia, así que un cero
  significa que la siembra se rompió, y sigue siendo aborto duro.
- Con `INV_SEMBRAR=0` y cero población, I7 se declara **`SIN POBLACIÓN`**, no se cuenta como
  auditado, y el resumen lo nombra: `5/5 invariantes en verde (I1–I5) · I7 SIN POBLACIÓN`.
  Un invariante que nadie miró no dice «no sé»: diría VERDE. Por eso se dice en voz alta.

**Calibrado antes de confiar** (`invariantes:calibrar`, 14 → **16/16**):

| Caso | Qué prueba | Medido |
|---|---|---|
| G3 | una base legítima sin otros bancos ya no aborta | `exit 0` · `5/5 … I7 SIN POBLACIÓN` |
| G4 | **y esa misma base, con un descuadre, sigue en rojo** | `exit 2` · `2 de 5 invariantes en ROJO` |

> Sin G4, G3 sólo probaría que el arnés aprendió a callarse. Y la inyección de las dos no borra
> el asiento interbancario: lo **reetiqueta**, porque el ledger es append-only y un trigger de la
> BD rechaza el `DELETE` sobre `movimiento` (D3) — medido al escribir la calibración.

De yapa, esto cierra una deuda: «la auditoría no corre en CI
(`INV_SEMBRAR=0 npm run invariantes`)». Era la compuerta lo que se lo impedía.

---

## 8 · Alcance de archivos (declarado antes de implementar)

Se crean o tocan **sólo** estos:

```
scripts/demo-m6.mjs        # el guion (playwright-core), nuevo
scripts/demo-m6.sh         # arranque del artefacto, calcado de verificar-s17-boletas.sh
package.json               # una línea: "demo:m6"
specs/M6-demo-completa.md  # este archivo
(carpeta de capturas)      # capturas y salidas
```

**Prohibido** tocar `src/`, `web/`, `prisma/` y cualquier otro árbitro. Si el guion necesitara un
cambio ahí, se detiene y se escala.
