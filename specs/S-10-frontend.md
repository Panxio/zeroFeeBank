# S-10 — Frontend: estructura base, acceso, cuentas y transferencia

> Estado: **prototipo funcional v0 CONGELADO** (2026-09-10). Construcción: pendiente.
> Método: lenguaje natural → prototipo → aprobado → congelado → construcción.
> Un cambio en el prototipo o en la lista de testids es un **cambio de especificación**: se versiona aquí.

## 1 · La referencia congelada

| Qué | Valor |
|---|---|
| Prototipo | `specs/S-10-prototipo.html` · **versión 4** |
| Aprobación | el humano: «el login y las demás funcionalidades me parecen correctos» |
| Qué congela | **flujos, estados, códigos de error y `data-testid`**. NO congela lo visual: la dirección visual se decide después (§ 5) |
| API simulado | la «mesa del revisor» del prototipo imita los contratos de S-08, S-12 y S-18; no es parte de la app |

## 2 · Qué hace (aprobado)

- **Acceso:** login (`POST /auth/login` + `GET /auth/yo`) y registro (`POST /auth/registro`). El registro no entrega token (S-08): vuelve al login con el email ya escrito.
- **Estructura base:** navegación, email del usuario, Salir. `TOKEN_EXPIRADO` / `TOKEN_INVALIDO` / `TOKEN_AUSENTE` en cualquier llamada → login con aviso `sesion-aviso`.
- **Resumen de cuentas:** estados `cargando` · `listo` · vacío · `error` con reintento, en `cuentas-region[data-estado]` + `aria-busy` (C4). Orden del API, sin reordenar. Saldo crudo en `data-monto="1000.00"` (C3: nadie ancla en «US$1.000,00»).
- **Transferencia:** origen = selector de cuentas propias; destino = «Mis cuentas» (sin la de origen) u «Otras cuentas» (id pegado; N1 de S-18: sólo se exige que exista). Comprobante con N° de operación.
- **Idempotencia (D5):** una `Idempotency-Key` nueva por envío; «Reintentar» reusa la misma. No se muestra al usuario (decisión del humano).
- **Errores (C5):** todo error lleva `data-codigo` con el código del API; el texto visible es libre.

## 3 · Decisiones de pantalla (aprobadas)

| # | Decisión | Porqué |
|---|---|---|
| P1 | El monto se escribe con **punto** decimal (`1234.56`), igual que el contrato | convertir `1.234,56` con dinero es ambiguo; aceptarlo sería un cambio de spec |
| P2 | `SIN_RESPUESTA` es un **estado del cliente**, no un código del API: vive en `transferir-sin-respuesta`, no en `transferir-error` | no mezclar un fallo de red con un rechazo del banco |
| P3 | «Mis cuentas» **excluye** la cuenta de origen; `MISMA_CUENTA` sólo sale pegando el propio id en «Otras cuentas» | no ofrecer una opción que el banco va a rechazar |
| P4 | El comprobante va **sin fecha y hora** | el 201 de `POST /transferencias` no la trae; mostrar la del navegador sería inventarla (y falsa en un reintento). Pedido abierto: `creadaEn` en el 201, que depende de la deuda del reloj |
| P5 | Etiquetas **Origen / Destino**, opciones «Mis cuentas» / «Otras cuentas» | pedido del humano: convención bancaria |

## 4 · Contrato `data-testid` v0 (45 ids)

- **Acceso:** `login-form` `login-email` `login-password` `login-enviar` `login-error` `sesion-aviso` `ir-registro` `registro-form` `registro-email` `registro-password` `registro-enviar` `registro-error` `registro-exito` `ir-login`
- **Estructura:** `nav-resumen` `nav-transferir` `usuario-email` `salir`
- **Resumen:** `cuentas-region` `cuentas-cargando` `cuentas-tabla` `cuenta-fila` (+ `data-cuenta-id`) `cuenta-id` `cuenta-copiar-id` `cuenta-saldo` (+ `data-monto`) `cuentas-vacio` `cuentas-error` `cuentas-reintentar` `ir-transferir` (retirado en UX-b1, O5: a Transferir se llega por `nav-transferir`)
- **Transferir:** `transferir-form` (+ `data-estado`) `transferir-origen` `transferir-destino-modo-propia` `transferir-destino-modo-otra` `transferir-destino-propia` `transferir-destino-id` `transferir-monto` `transferir-enviar` `transferir-error` (+ `data-codigo`) `transferir-sin-respuesta` `transferir-reintentar` `transferir-exito` `transferir-repetida` `transferir-transaccion-id` `transferir-nueva` `transferir-sin-cuentas`

➡️ **v1 vigente en `specs/S-10-catalogo.md` § 6**: se mantienen estos 45 y se suman 27 (72; 73 con el PDF).

## 5 · Decidido para la construcción (no está en el prototipo v0)

- **Alcance cambiado por el humano:** el frontend deja de ser «mínimo, sin inversión de diseño» y pasa a **diferenciarse de ParaBank**: moderno, y construido desde las **preguntas típicas de una entrevista de QA automation** (iframes, modales, pestañas, Shadow DOM, esperas…). **Regla dura:** cada desafío es un **patrón bancario real y justificado**; un desafío puesto porque sí hace que la app mienta (corolario del perfil SUT).
- **Stack: Angular.** Mismo modelo que NestJS (módulos, DI, decoradores); común en banca empresarial; trae `ViewEncapsulation.ShadowDom` y Angular Elements.
- **Login:** popover en la barra superior, a la derecha, con un **iframe servido por el origen de autenticación**; devuelve el resultado con `postMessage`. Razón real: el script de la página anfitriona no puede leer la contraseña. Costo: dos orígenes en dev y en CI.
- **Portada:** tipo la referencia del humano (imagen a un tono, mensaje al centro, Login a la derecha). Mensaje en la línea «sin comisiones, y no somos humo». **Bruma en canvas procedural**, congelable con `prefers-reduced-motion` y con una opción de prueba (C2: capturas estables).
  - *Referencia:* portada de un banco de terceros, **sólo estructural**; la captura no se versiona (es marca ajena y va en `.gitignore`). Se tomó: foto a un tono → la bruma; mensaje central en serif itálica liviana, tres líneas; marca en mayúsculas espaciadas arriba a la izquierda; Login en píldora arriba a la derecha. Se sacó: su segundo botón («abrir cuenta»: el registro vive en el marco y no está en v1), su flecha a una sección inferior (en S-10 no existe) y su paleta.
  - *Fuentes empaquetadas:* Spectral itálica 300/400 y Jost 400/500/600 van **dentro de la app** (archivos en `assets/`), nunca desde un CDN. Hallado en las capturas del humano: en el visor móvil Google Fonts no cargó y la portada cayó en silencio a Noto Serif y a la sans del sistema. Una fuente remota es una dependencia de red en la captura base de § 4.7 del catálogo (C2).
- **Navegación: barra superior con 5 ítems** — `Cuentas ▾` (Resumen · Movimientos · Abrir cuenta) · Transferir · Pagos · Boletas · menú del usuario (Datos de contacto · Salir). En el teléfono, menú hamburguesa con panel lateral. **Préstamo no aparece** mientras S-16 esté bloqueada.
- **Catálogo de desafíos:** `specs/S-10-catalogo.md`. Cambia el v0 en Transferir (asistente de 3 pasos + modal) y en `transferir-enviar`.
- **Orden:** brainstorming del trío (catálogo de desafíos) → spec del catálogo → dirección visual en UN artifact (sólo la portada + el popover) → construcción en Angular. Lo visual se hace **una sola vez**, al construir, no dos veces en el prototipo.

## 6 · Fuera (no-goals)

- Apertura de cuenta, movimientos, pagos, boletas, contacto: S-17.
- Préstamo: S-16, bloqueada por P1.
- Fecha y hora en el comprobante: ver P4.

## 7 · Criterio de «hecho» de la construcción (fijado antes)

- Cada `data-testid` de la lista vigente presente en el **artefacto renderizado** (no en el código fuente), con su check calibrado: rojo con uno quitado.
- El humano compara la pantalla contra el prototipo: respuesta + captura.
