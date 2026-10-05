// Árbitro de S-17 · Pagos (specs/S-17-pagos.md § 5). Corre contra el ARTEFACTO servido: el
// backend (`node dist/main.js`) en :3000 y el build de pruebas de web/ en :4200. Lo levanta
// scripts/verificar-s17-pagos.sh; este archivo sólo mira. No importa código de la app y no toca
// la base de datos: todo estado entra por `POST /__test__/reset` y por el API público (perfil SUT).
//
// Contiene exactamente los 24 brazos de § 5: N1–N3, C1–C4, P1–P2, B1–B5, E1–E3, D1–D3, I1–I2, A1–A2.
//
// ── Decisiones tomadas al escribir este arnés (F2) ────────────────────
// 1. **Un solo reset por corrida, y un titular NUEVO por brazo.** El reset va antes del primer
//    brazo; después, cada brazo arma su titular por API (§ 4.1) con un correo único. Así ningún
//    brazo hereda el saldo ni los pagos de otro, y el orden de los brazos no cambia un veredicto.
// 2. **El ayudante de pago EXIGE el diálogo (K10).** `pagarUI` pulsa `pagos-enviar` y, si no
//    aparece `confirmar-dialogo` o si el POST sale antes de `confirmar-aceptar`, lanza. J4 es
//    contrato, no cortesía: por eso K10 pone rojos todos los brazos que pagan por la UI (§ 6).
// 3. **Se espera la RESPUESTA del POST antes del estado terminal** de `pagos-form` (la decisión 3
//    de movimientos): en B2/B3 el formulario ya está en `error` por el sub-caso anterior, y
//    esperar `data-estado` a secas casaría con ese terminal viejo. Si la red pierde la respuesta
//    (I1), lo que se espera es el `requestfailed`.
// 4. **El monto de los brazos B y de D/I es el de P1 (`123.45`).** § 4 no fija uno para ellos y
//    sólo tiene que ser válido y ≤ saldo: es implementación, no un dato de negocio. En B1 el saldo
//    pasa de `1000.00` a `876.55`.
// 5. **El titular de dos cuentas (P2) se abre como en movimientos B9:** CORRIENTE de `2000.00`
//    desde la caja y AHORRO de `1000.00` desde ella (el mínimo de apertura es `1000.00`,
//    `cuentas.constants.ts:18`), así que quedan las dos en `1000.00`. Se afirma antes de usarlo.
// 6. **A1 re-entra a la vista para leer su fila y la busca por `data-pago-id`.** Así no depende de
//    que la lista se recargue sola (eso es de P1 y lo rompe K19) ni del orden (P1, K1), y K14 lo
//    pone rojo sólo a él, como declara § 6.
// 7. **El click forzado de C1 es `click({force:true})`**, no `dispatchEvent` (decisión 4 de
//    movimientos): sobre un botón deshabilitado el navegador no dispara nada, y con K12 sí. Si
//    con eso se abre el diálogo, se acepta, porque es lo que haría una persona. El «no hubo
//    segundo POST» se mide esperando 1500 ms por la condición contraria; vencer esa espera es el
//    verde. Es una espera por CONDICIÓN con tope, no un sleep.
// 8. **Montos en centavos `bigint` dentro del arnés (D1).** Los saldos esperados se calculan con
//    `centavos()`/`decimal()`, nunca con `number`.
//
// ── NACE SIN LA PANTALLA (F2, declarado antes de medir) ────────────────────────────────────
// La vista de Pagos todavía no existe (F4 la implementa), así que los 24 brazos nacen en ROJO por
// diseño: el número fijado ANTES de correrlo es **0/24 verdes**. Lo que esta primera corrida
// verifica es otra cosa: que la PREPARACIÓN de § 4.1 funciona contra el artefacto real (reset,
// registro, apertura de 1000.00, pago previo por API, titular sin cuentas, titular de dos cuentas)
// y que cada brazo cae con un motivo propio. Los 19 defectos y la sonda de § 6 se miden en F5.
//
// ── Enmiendas de candado (§ 5.1) ───────────────────────────────────────────────────────────
// Aprobadas en la revisión. NO van en este archivo: son una línea en cada uno de los
// siete candados, se aplican al entregar F4 y se calibran 7/7.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const API = 'http://localhost:3000';
const APP = 'http://localhost:4200';
const HOSTS_PERMITIDOS = new Set(['localhost:3000', 'localhost:4200']);
const ESPERA_MS = 8000;        // § 4: tope de cada espera por CONDICIÓN; un rojo, no un cuelgue
const ESPERA_AUSENCIA_MS = 1500; // decisión 7: cuánto se espera un segundo POST que NO debe salir
const ESCRITORIO = { width: 1280, height: 800 }; // § 4
const BRAZOS_TOTAL = 24; // § 5: N1–N3 · C1–C4 · P1–P2 · B1–B5 · E1–E3 · D1–D3 · I1–I2 · A1–A2

// ── Constantes de § 4 (todas con origen; ninguna se inventa) ───────────────────────────────
const CLAVE = 'Clave-Arnes-2026';   // la de los titulares de arnés de S-17 (transferir, movimientos)
const MONTO_APERTURA = '1000.00';   // cuentas.constants.ts:18, el mínimo; = SALDO_BASE
const SALDO_BASE = '1000.00';       // § 4, afirmado en la preparación
const MONTO_PREVIO = '10.00';       // § 4, pago previo de P1
const BENEF_PREVIO = 'Previo S.A.'; // § 4
const MONTO_P1 = '123.45';          // § 4
const SALDO_TRAS_PREVIO = '990.00'; // 1000.00 − 10.00
const SALDO_FINAL_P1 = '866.55';    // 1000.00 − 10.00 − 123.45, sin comisión (R4)
const MONTO_SOBRE_SALDO = '1000.01'; // § 4 → FONDOS_INSUFICIENTES
const MONTOS_INVALIDOS = ['0', '-5.00', '10,00']; // § 4 → MONTO_INVALIDO
const APERTURA_DOS = '2000.00';     // decisión 5
const AHORRO_DOS = '1000.00';       // decisión 5
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i; // cuentas.constants.ts:32

// § 4 · los siete campos EN ORDEN DE PRECEDENCIA (pagos.controller.ts:32 sobre CAMPOS_BENEFICIARIO,
// pagos.constants.ts:21-29), con su testid, su máximo y su código (pagos.errors.ts:39-90).
const CAMPOS = [
  ['beneficiarioNombre', 'pagos-beneficiario-nombre', 100, 'PAGO_BENEFICIARIO_NOMBRE_INVALIDO'],
  ['beneficiarioDireccion', 'pagos-beneficiario-direccion', 100, 'PAGO_BENEFICIARIO_DIRECCION_INVALIDA'],
  ['beneficiarioCiudad', 'pagos-beneficiario-ciudad', 50, 'PAGO_BENEFICIARIO_CIUDAD_INVALIDA'],
  ['beneficiarioEstado', 'pagos-beneficiario-estado', 50, 'PAGO_BENEFICIARIO_ESTADO_INVALIDO'],
  ['beneficiarioCodigoPostal', 'pagos-beneficiario-codigo-postal', 20, 'PAGO_BENEFICIARIO_CODIGO_POSTAL_INVALIDO'],
  ['beneficiarioTelefono', 'pagos-beneficiario-telefono', 20, 'PAGO_BENEFICIARIO_TELEFONO_INVALIDO'],
  ['cuentaBeneficiario', 'pagos-cuenta-beneficiario', 50, 'PAGO_CUENTA_BENEFICIARIO_INVALIDA'],
];
// § 4 · beneficiario válido de referencia (cada valor bajo su máximo; se afirma abajo).
const BENEF_REF = {
  beneficiarioNombre: 'Luz del Sur',
  beneficiarioDireccion: 'Av. Siempre Viva 742',
  beneficiarioCiudad: 'Santiago',
  beneficiarioEstado: 'RM',
  beneficiarioCodigoPostal: '8320000',
  beneficiarioTelefono: '+56 2 2345 6789',
  cuentaBeneficiario: 'CL-000123',
};
for (const [campo, , max] of CAMPOS) {
  const v = BENEF_REF[campo];
  if (!(v.trim().length >= 1 && v.trim().length <= max)) throw new Error(`BENEF_REF.${campo} fuera de su máximo ${max}`);
}

// E3 · checks por AUSENCIA: lista de términos VERSIONADA junto al resultado (ARNES.md).
const ATRIBUTOS_PROHIBIDOS = ['required', 'pattern', 'min', 'max', 'step', 'minlength', 'maxlength'];
// El nombre del atributo no es el de la propiedad para estos dos (E11 de movimientos).
const PROP_DE_ATRIBUTO = { minlength: 'minLength', maxlength: 'maxLength' };
const CAMPOS_TEXTO = ['pagos-monto', ...CAMPOS.map((c) => c[1])]; // los 8 de JP2

const leerLista = (archivo) => readFileSync(new URL(`../specs/${archivo}`, import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const LISTA_S17P = leerLista('S-17-testids-pagos.txt');
const UNION = new Set([
  ...leerLista('S-10-testids-T4.txt'),
  ...leerLista('S-17-testids-boletas.txt'),
  ...leerLista('S-17-testids-abrir-cuenta.txt'),
  ...leerLista('S-17-testids-transferir.txt'),
  ...leerLista('S-17-testids-movimientos.txt'),
  ...LISTA_S17P,
  ...leerLista('S-17-testids-contacto.txt'), // enmienda § 5.1 de S-17-contacto
  ...leerLista('S-35-testids-idioma.txt'),   // enmienda C3 de S-35
]);
// Los que se repiten legítimamente: la fila de pagos y sus cinco campos (N3), y los del Resumen
// (T4), que se recorren al entrar.
const DE_FILA = new Set([
  'pago-fila', 'pago-fecha', 'pago-origen', 'pago-beneficiario', 'pago-cuenta-beneficiario', 'pago-monto',
  'cuenta-fila', 'cuenta-id', 'cuenta-copiar-id', 'cuenta-saldo', 'cuenta-tipo',
]);

const JSON_H = { 'content-type': 'application/json' };
const resultados = [];
function brazo(id, ok, motivo = '') {
  resultados.push({ id, ok });
  console.log(`  ${id} ${ok ? 'OK' : `ROJO: ${motivo}`}`);
}

// Cierre de contextos por brazo (BITÁCORA #184: la fuga de contextos cegó BV1 en T4)
const contextosAbiertos = new Set();
// D114-1: antes de cerrar, se sueltan las rutas sin esperar a sus manejadores. Un manejador
// que quedó dentro de `route.fetch()` (I1 con K10b: el POST de más) lanzaba TargetClosedError al
// cerrarse el contexto, sin nadie que lo capturara, y mataba Node: los brazos siguientes no corrían.
async function cerrarContextos() {
  for (const c of contextosAbiertos) {
    for (const p of c.pages()) await p.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    await c.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    await c.close().catch(() => {});
  }
  contextosAbiertos.clear();
}

// Filtro de diagnóstico: ZFB_BRAZOS=B1,B4 corre sólo esos brazos. NO puede producir un verde de
// la unidad: el `process.exit` exige `resultados.length === BRAZOS_TOTAL`.
const SOLO = (process.env.ZFB_BRAZOS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

async function correr(id, fn) {
  if (SOLO.length > 0 && !SOLO.includes(id)) return;
  try {
    await fn();
  } catch (e) {
    const texto = String(e?.stack ?? e?.message ?? e);
    const pista = texto.split('\n').find((l) => /waiting for|locator\(|getByTestId/.test(l))?.trim();
    brazo(id, false, `excepción: ${texto.split('\n')[0]}${pista ? ` ← ${pista}` : ''}`);
  } finally {
    await cerrarContextos();
  }
}

// ── Dinero en centavos (D1) ────────────────────────────────────────────────────────────────
function centavos(s) {
  const m = /^(-?)(\d+)\.(\d{2})$/.exec(String(s));
  if (!m) throw new Error(`monto con forma inesperada: «${s}»`);
  const v = BigInt(m[2]) * 100n + BigInt(m[3]);
  return m[1] ? -v : v;
}
function decimal(c) {
  const a = c < 0n ? -c : c;
  return `${c < 0n ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
}

// ── HTTP crudo, con reintento ante error de red ─────────────────────────────────
function pedirUnaVez(metodo, ruta, cabeceras = {}, cuerpo) {
  return new Promise((ok, mal) => {
    const req = http.request(`${API}${ruta}`, { method: metodo, headers: cabeceras }, (res) => {
      const trozos = [];
      res.on('data', (c) => trozos.push(c));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: Buffer.concat(trozos).toString('utf8') }));
    });
    req.on('error', mal);
    if (cuerpo) req.end(JSON.stringify(cuerpo)); else req.end();
  });
}
async function pedir(metodo, ruta, cabeceras = {}, cuerpo) {
  try {
    return await pedirUnaVez(metodo, ruta, cabeceras, cuerpo);
  } catch (e) {
    if (!['ECONNRESET', 'ECONNREFUSED', 'EPIPE'].includes(e?.code)) throw e;
    return await pedirUnaVez(metodo, ruta, cabeceras, cuerpo);
  }
}
const codigoDe = (body) => { try { return JSON.parse(body)?.codigo ?? null; } catch { return null; } };
const auth = (token) => ({ authorization: `Bearer ${token}` });

async function registrar(email) {
  const r = await pedir('POST', '/auth/registro', JSON_H, { email, password: CLAVE });
  if (r.status !== 201) throw new Error(`preparación: registro → ${r.status} ${r.body}`);
}
async function tokenDe(email) {
  const r = await pedir('POST', '/auth/login', JSON_H, { email, password: CLAVE });
  if (r.status !== 200) throw new Error(`preparación: login → ${r.status} ${r.body}`);
  return JSON.parse(r.body).token;
}
async function abrirCuentaApi(token, cuerpo) {
  const r = await pedir('POST', '/cuentas', { ...JSON_H, ...auth(token), 'idempotency-key': randomUUID() }, cuerpo);
  if (r.status !== 201) throw new Error(`preparación: POST /cuentas → ${r.status} ${codigoDe(r.body) ?? r.body}`);
  return JSON.parse(r.body);
}
async function cuentasApi(token) {
  const r = await pedir('GET', '/cuentas', auth(token));
  if (r.status !== 200) throw new Error(`GET /cuentas → ${r.status} ${r.body}`);
  return JSON.parse(r.body).cuentas;
}
async function pagosApi(token) {
  const r = await pedir('GET', '/pagos', auth(token));
  if (r.status !== 200) throw new Error(`GET /pagos → ${r.status} ${r.body}`);
  return JSON.parse(r.body).pagos;
}
const saldoDe = async (token, id) => (await cuentasApi(token)).find((c) => c.id === id)?.saldo ?? null;
const emailNuevo = (p) => `s17p-${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@arnes.local`;

/** Espera por CONDICIÓN (no es un sleep): false al vencer el tope, nunca un cuelgue. */
async function esperarHasta(cond, motivo, ms = ESPERA_MS, silencioso = false) {
  const hasta = Date.now() + ms;
  while (Date.now() < hasta) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!silencioso) console.log(`    ⏱ espera vencida (${ms} ms): ${motivo}`);
  return false;
}

// ── Preparación con los límites del propio contrato AFIRMADOS (§ 4.1) ──────────────────────
// Si algo de acá falla, el brazo cae con «preparación: …»: un arnés que no pudo armar el dato,
// no un veredicto sobre la pantalla. La corrida de F2 existe para ver esto en verde.

/** Registro + CORRIENTE de 1000.00. Afirma 1 cuenta CORRIENTE en SALDO_BASE y 0 pagos. */
async function titularBase(p) {
  const email = emailNuevo(p);
  await registrar(email);
  const token = await tokenDe(email);
  const c = await abrirCuentaApi(token, { tipo: 'CORRIENTE', monto: MONTO_APERTURA });
  const cuentas = await cuentasApi(token);
  if (cuentas.length !== 1 || cuentas[0].tipo !== 'CORRIENTE' || cuentas[0].saldo !== SALDO_BASE) {
    throw new Error(`preparación: se esperaba 1 CORRIENTE en ${SALDO_BASE}; hay ${JSON.stringify(cuentas.map((x) => [x.tipo, x.saldo]))}`);
  }
  const pagos = await pagosApi(token);
  if (pagos.length !== 0) throw new Error(`preparación: el titular nuevo ya trae ${pagos.length} pagos`);
  return { email, token, cuentaId: c.id };
}

/** Lo anterior + un pago de 10.00 por API. Afirma 201, 1 pago y saldo 990.00 (nota de F0). */
async function titularConPagoPrevio(p) {
  const u = await titularBase(p);
  const r = await pedir('POST', '/pagos', { ...JSON_H, ...auth(u.token), 'idempotency-key': randomUUID() },
    { cuentaOrigenId: u.cuentaId, monto: MONTO_PREVIO, ...BENEF_REF, beneficiarioNombre: BENEF_PREVIO });
  if (r.status !== 201) throw new Error(`preparación: pago previo → ${r.status} ${codigoDe(r.body) ?? r.body}`);
  const pagos = await pagosApi(u.token);
  if (pagos.length !== 1) throw new Error(`preparación: tras el pago previo GET /pagos trae ${pagos.length}`);
  const saldo = await saldoDe(u.token, u.cuentaId);
  if (saldo !== SALDO_TRAS_PREVIO) throw new Error(`preparación: saldo tras el pago previo ${saldo}, se esperaba ${SALDO_TRAS_PREVIO}`);
  return { ...u, pagoPrevioId: JSON.parse(r.body).id };
}

/** Sólo registro y login. Afirma 0 cuentas. */
async function titularSinCuentas(p) {
  const email = emailNuevo(p);
  await registrar(email);
  const token = await tokenDe(email);
  const cuentas = await cuentasApi(token);
  if (cuentas.length !== 0) throw new Error(`preparación: el titular sin cuentas trae ${cuentas.length}`);
  return { email, token };
}

/** Decisión 5: CORRIENTE 2000.00 + AHORRO 1000.00 desde ella. Afirma 2 cuentas en 1000.00. */
async function titularDosCuentas(p) {
  const email = emailNuevo(p);
  await registrar(email);
  const token = await tokenDe(email);
  const c = await abrirCuentaApi(token, { tipo: 'CORRIENTE', monto: APERTURA_DOS });
  await abrirCuentaApi(token, { tipo: 'AHORRO', monto: AHORRO_DOS, cuentaOrigenId: c.id });
  const cuentas = await cuentasApi(token);
  if (cuentas.length !== 2 || cuentas.some((x) => x.saldo !== '1000.00')) {
    throw new Error(`preparación: se esperaban 2 cuentas en 1000.00; hay ${JSON.stringify(cuentas.map((x) => [x.tipo, x.saldo]))}`);
  }
  return { email, token, cuentas };
}

/** Cadenas de borde: afirman su largo antes de escribirse. */
function cadena(n, c = 'a') {
  const s = c.repeat(n);
  if (s.length !== n) throw new Error(`preparación: cadena de ${n} salió de ${s.length}`);
  return s;
}
const SOLO_ESPACIOS = '   ';
if (SOLO_ESPACIOS.length !== 3 || SOLO_ESPACIOS.trim() !== '') throw new Error('preparación: «sólo espacios» mal armada');

// ── Navegador y ayudantes de UI ────────────────────────────────────────────────────────────
const navegador = await chromium.launch({ headless: true });
const fuera = [];
const vistos = new Set();
const repetidos = new Set();
const sel = (t) => `[data-testid="${t}"]`;
const esPagos = (req) => { try { return new URL(req.url()).pathname === '/pagos'; } catch { return false; } };
const esCuentas = (req) => { try { return new URL(req.url()).pathname === '/cuentas'; } catch { return false; } };
// E3: `page.route` por origen y pathname, no por glob literal; una query o una barra final
// no deben dejar pasar el POST sin interceptar.
const rutaPagos = (u) => u.host === 'localhost:3000' && u.pathname === '/pagos';
const rutaCuentas = (u) => u.host === 'localhost:3000' && u.pathname === '/cuentas';
const postsDe = new WeakMap(); // page → los POST /pagos que salieron del navegador (con su clave)
const getsDe = new WeakMap();  // page → los GET que salieron, en orden: ['/cuentas', '/pagos', …]

async function paginaNueva() {
  const ctx = await navegador.newContext({ viewport: ESCRITORIO });
  contextosAbiertos.add(ctx);
  const page = await ctx.newPage();
  postsDe.set(page, []);
  getsDe.set(page, []);
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (!['data:', 'blob:'].includes(u.protocol) && !HOSTS_PERMITIDOS.has(u.host)) fuera.push(req.url());
    if (u.host !== 'localhost:3000') return;
    if (req.method() === 'POST' && u.pathname === '/pagos') {
      let cuerpo = null;
      try { cuerpo = req.postDataJSON(); } catch { /* un cuerpo que no es JSON queda en null */ }
      postsDe.get(page).push({ clave: req.headers()['idempotency-key'] ?? null, cuerpo });
    }
    if (req.method() === 'GET') getsDe.get(page).push(u.pathname);
  });
  page.setDefaultTimeout(ESPERA_MS);
  await page.goto(APP, { waitUntil: 'load' });
  await page.waitForSelector(sel('portada'), { state: 'attached', timeout: ESPERA_MS });
  return page;
}

async function marcoDe(page) {
  const h = await page.waitForSelector(sel('login-marco'), { state: 'attached', timeout: ESPERA_MS });
  const f = await h.contentFrame();
  if (!f) throw new Error('login-marco sin documento');
  await f.waitForSelector(sel('login-form'), { state: 'attached', timeout: ESPERA_MS });
  return f;
}

async function entrarUI(page, email) {
  await page.click(sel('login-abrir'));
  await page.waitForSelector(`${sel('login-popover')}[data-estado="listo"]`, { state: 'attached', timeout: ESPERA_MS });
  const f = await marcoDe(page);
  await f.fill(sel('login-email'), email);
  await f.fill(sel('login-password'), CLAVE);
  await f.click(sel('login-enviar'));
  await page.waitForSelector(sel('cuentas-region'), { state: 'attached', timeout: ESPERA_MS });
  await page.waitForSelector(['listo', 'vacio', 'error'].map((e) => `${sel('cuentas-region')}[data-estado="${e}"]`).join(', '),
    { state: 'attached', timeout: ESPERA_MS });
}

const TERMINAL_LISTA = ['listo', 'vacio', 'error'];
async function estadoLista(page) {
  const h = await page.waitForSelector(TERMINAL_LISTA.map((e) => `${sel('pagos-lista')}[data-estado="${e}"]`).join(', '),
    { state: 'attached', timeout: ESPERA_MS });
  return h.getAttribute('data-estado');
}
const estadoForm = (page) => page.$eval(sel('pagos-form'), (e) => e.getAttribute('data-estado')).catch(() => null);
const visible = (page, t) => page.isVisible(sel(t)).catch(() => false);

/** Pulsa `nav-pagos` y espera la región. No espera la lista: C2 y C3 la miran a medio cargar. */
async function irAPagos(page) {
  if (!(await page.$(sel('nav-pagos')))) throw new Error('nav-pagos no existe en el DOM renderizado');
  await page.click(sel('nav-pagos'));
  await page.waitForSelector(sel('pagos-region'), { state: 'visible', timeout: ESPERA_MS });
}

/** Sesión abierta, en Pagos, con la lista en un estado terminal y el formulario montado. */
async function entrarYPagos(page, email) {
  await entrarUI(page, email);
  await irAPagos(page);
  await estadoLista(page);
  await page.waitForSelector(sel('pagos-form'), { state: 'visible', timeout: ESPERA_MS });
}

/** Sale a Transferir y vuelve: la vista se monta de nuevo y pide la lista otra vez (JP1). */
async function reentrarAPagos(page) {
  await page.click(sel('nav-transferir'));
  await page.waitForSelector(sel('pagos-region'), { state: 'detached', timeout: ESPERA_MS });
  await irAPagos(page);
  await estadoLista(page);
}

/** El POST /pagos que viene: su respuesta, `{fallo:true}` si la red la perdió, o null si no salió. */
function esperarPost(page, ms = ESPERA_MS) {
  const respuesta = page.waitForResponse((r) => r.request().method() === 'POST' && esPagos(r.request()), { timeout: ms })
    .then(async (r) => ({ status: r.status(), body: await r.text().catch(() => ''), headers: r.headers() }))
    .catch(() => null);
  const fallo = page.waitForEvent('requestfailed', { predicate: (q) => q.method() === 'POST' && esPagos(q), timeout: ms })
    .then(() => ({ fallo: true }))
    .catch(() => null);
  return Promise.race([
    respuesta.then((x) => x ?? fallo),
    fallo.then((x) => x ?? respuesta),
  ]);
}

const TERMINAL_FORM = ['exito', 'error', 'sin-respuesta'];
async function esperarTerminalForm(page) {
  const h = await page.waitForSelector(TERMINAL_FORM.map((e) => `${sel('pagos-form')}[data-estado="${e}"]`).join(', '),
    { state: 'attached', timeout: ESPERA_MS }).catch(() => null);
  return h ? h.getAttribute('data-estado') : null;
}

/** Escribe monto y los 7 campos tal como vienen (JP4: sin trim; un "" se escribe como vacío). */
async function llenar(page, { monto = MONTO_P1, benef = BENEF_REF } = {}) {
  await page.fill(sel('pagos-monto'), monto);
  for (const [campo, testid] of CAMPOS) await page.fill(sel(testid), benef[campo]);
}

/** D97-2 / JP3: el `value` de cada `<option>` es el id de la cuenta. */
async function elegirOrigen(page, cuentaId) {
  try {
    await page.selectOption(sel('pagos-origen'), cuentaId, { timeout: ESPERA_MS });
  } catch {
    const values = await page.$$eval(`${sel('pagos-origen')} option`, (os) => os.map((o) => o.value)).catch(() => []);
    throw new Error(`pagos-origen no tiene una opción con value=«${cuentaId}» (JP3/D97-2); hay [${values.join(', ')}]`);
  }
}

/**
 * Paga por la UI (decisión 2): llena, pulsa `pagos-enviar`, EXIGE el diálogo y que no haya salido
 * POST todavía, acepta, y espera la respuesta y el estado terminal. Devuelve lo que salió.
 */
async function pagarUI(page, datos = {}) {
  await llenar(page, datos);
  const posts = postsDe.get(page);
  const antes = posts.length;
  await page.click(sel('pagos-enviar'));
  const dlg = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!dlg) throw new Error(`J4: pagos-enviar no abrió confirmar-dialogo${posts.length > antes ? ' (y el POST salió directo)' : ''}`);
  // E2: el evento `request` puede llegar después de que el diálogo es visible; se espera la
  // AUSENCIA del POST antes de aceptar, para que un pagos-enviar que postea y además abre el diálogo
  // (K10b) no se escape.
  if (await esperarHasta(() => posts.length > antes, 'POST con el diálogo abierto', ESPERA_AUSENCIA_MS, true)) {
    throw new Error('J4: el POST salió antes de confirmar-aceptar');
  }
  await vigilarEstadosForm(page);
  const r = esperarPost(page);
  await page.click(sel('confirmar-aceptar'));
  const resp = await r;
  const estado = await esperarTerminalForm(page);
  const estados = await estadosVistosForm(page);
  return { resp, estado, estados, posts: posts.slice(antes) };
}

/**
 * E1: registra CADA valor que tomó `data-estado` de `pagos-form` desde ahora, con un
 * MutationObserver (oldValue incluido), para que JP7 —`enviando` en cada envío— se pueda afirmar
 * aunque el estado terminal anterior sea el mismo que el nuevo (sub-casos 2+ de un brazo de rechazo).
 */
function vigilarEstadosForm(page) {
  return page.evaluate(() => {
    window.__zfbEstadosForm?.obs.disconnect();
    const vistos = [];
    const q = '[data-testid="pagos-form"]';
    const obs = new MutationObserver((recs) => recs.forEach((r) => {
      if (r.type === 'attributes' && r.target.matches?.(q)) vistos.push(r.oldValue);
      if (r.type === 'childList') r.addedNodes.forEach((n) => {
        const f = n.nodeType === 1 ? (n.matches(q) ? n : n.querySelector(q)) : null;
        if (f) vistos.push(f.getAttribute('data-estado'));
      });
    }));
    obs.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-estado'], attributeOldValue: true });
    window.__zfbEstadosForm = { obs, vistos };
  });
}
function estadosVistosForm(page) {
  return page.evaluate(() => {
    const v = window.__zfbEstadosForm;
    if (!v) return [];
    v.obs.disconnect();
    const actual = document.querySelector('[data-testid="pagos-form"]')?.getAttribute('data-estado') ?? null;
    return [...v.vistos, actual];
  }).catch(() => []);
}

/** Las filas pintadas, con los atributos de JP10 leídos del nodo que lleva cada testid. */
function filasDe(page) {
  return page.$$eval(sel('pago-fila'), (filas) => filas.map((f) => {
    const q = (t) => f.querySelector(`[data-testid="${t}"]`);
    return {
      id: f.getAttribute('data-pago-id'),
      transaccionId: f.getAttribute('data-transaccion-id'),
      fecha: q('pago-fecha')?.getAttribute('data-fecha') ?? null,
      fechaTexto: (q('pago-fecha')?.textContent ?? '').trim(),
      cuentaOrigenId: q('pago-origen')?.getAttribute('data-cuenta-id') ?? null,
      monto: q('pago-monto')?.getAttribute('data-monto') ?? null,
      beneficiarioNombre: (q('pago-beneficiario')?.textContent ?? '').trim(),
      cuentaBeneficiario: (q('pago-cuenta-beneficiario')?.textContent ?? '').trim(),
    };
  })).catch(() => []);
}

async function recolectar(page) {
  for (const f of page.frames()) {
    const ids = await f.evaluate(() => {
      const out = [];
      const pasar = (raiz) => raiz.querySelectorAll('*').forEach((e) => {
        if (e.hasAttribute('data-testid')) out.push(e.getAttribute('data-testid'));
        if (e.shadowRoot) pasar(e.shadowRoot);
      });
      pasar(document);
      return out;
    }).catch(() => []);
    const cuenta = new Map();
    ids.forEach((i) => { vistos.add(i); cuenta.set(i, (cuenta.get(i) ?? 0) + 1); });
    for (const [i, n] of cuenta) if (n > 1 && !DE_FILA.has(i)) repetidos.add(i);
  }
}

/**
 * Las afirmaciones de rechazo de § 5 (B): el POST salió (intención, D80-3), `data-codigo` y
 * `pagos-codigo-error` con el código, `pagos-form` en `error`, saldo por API intacto y ninguna
 * `pago-fila` nueva (ni en pantalla ni en `GET /pagos`).
 */
async function afirmarRechazo(page, u, pago, codigo, antes) {
  const fallas = [];
  if (pago.posts.length !== 1) fallas.push(`salieron ${pago.posts.length} POST (se esperaba 1)`);
  const api = pago.resp?.status ? `${pago.resp.status} ${codigoDe(pago.resp.body)}` : 'sin respuesta';
  const dataCodigo = await page.$eval(sel('pagos-error'), (e) => e.getAttribute('data-codigo')).catch(() => null);
  const textoCodigo = await page.$eval(sel('pagos-codigo-error'), (e) => (e.textContent ?? '').trim()).catch(() => null);
  if (dataCodigo !== codigo) fallas.push(`data-codigo=«${dataCodigo}» (API: ${api})`);
  if (textoCodigo !== codigo) fallas.push(`pagos-codigo-error=«${textoCodigo}»`);
  if (pago.estado !== 'error') fallas.push(`pagos-form en «${pago.estado}»`);
  if (!pago.estados?.includes('enviando')) fallas.push(`pagos-form no pasó por «enviando» (JP7; vistos: [${(pago.estados ?? []).join(', ')}])`);
  const saldo = await saldoDe(u.token, u.cuentaId);
  if (saldo !== antes.saldo) fallas.push(`saldo API ${saldo}, debía seguir en ${antes.saldo}`);
  const filas = (await filasDe(page)).length;
  if (filas !== antes.filas) fallas.push(`pago-fila pasó de ${antes.filas} a ${filas}`);
  const nApi = (await pagosApi(u.token)).length;
  if (nApi !== antes.pagosApi) fallas.push(`GET /pagos pasó de ${antes.pagosApi} a ${nApi}`);
  return fallas;
}
const fotoAntes = async (page, u) => ({
  saldo: await saldoDe(u.token, u.cuentaId),
  filas: (await filasDe(page)).length,
  pagosApi: (await pagosApi(u.token)).length,
});

/** Un brazo de rechazo con sub-casos: un titular, una página, un pago malo por sub-caso. */
async function brazoDeRechazos(id, casos) {
  const u = await titularBase(id.toLowerCase());
  const page = await paginaNueva();
  await entrarYPagos(page, u.email);
  const fallas = [];
  for (const { nombre, datos, codigo } of casos) {
    const antes = await fotoAntes(page, u);
    const pago = await pagarUI(page, datos);
    await recolectar(page);
    const f = await afirmarRechazo(page, u, pago, codigo, antes);
    if (f.length) fallas.push(`[${nombre}] ${f.join(', ')}`);
  }
  brazo(id, fallas.length === 0, fallas.join(' · '));
}
/** Beneficiario de referencia con UN campo cambiado. */
const conCampo = (campo, valor) => ({ ...BENEF_REF, [campo]: valor });

console.log(`verificar:s17-pagos · ${BRAZOS_TOTAL} brazos (specs/S-17-pagos.md § 5)\n`);

// El reset va ANTES del primer brazo y FUERA de `correr`: si la costura no está, el arnés muere
// diciendo cuál. Un arnés que no pudo medir no es 24 brazos rojos (§ 4.1).
try {
  const r = await pedir('POST', '/__test__/reset');
  if (r.status !== 200) throw new Error(`costura /__test__/reset → ${r.status} ${r.body}`);
  const u = await titularConPagoPrevio('humo');
  console.log(`  preparación OK · reset · titular de humo ${u.email} con pago previo ${u.pagoPrevioId.slice(0, 8)} y saldo ${SALDO_TRAS_PREVIO}\n`);
} catch (e) {
  console.log(`\nPREPARACIÓN ROTA: ${String(e?.message ?? e)}`);
  console.log('El arnés NO pudo medir. Esto no es un veredicto sobre la pantalla.');
  await navegador.close().catch(() => {});
  process.exit(2);
}

try {
  // ── N · Navegación y contrato ────────────────────────────────────────────────────────────

  // N1 · Entrada de PRIMER NIVEL (JP1), leída del DOM renderizado con `closest`. Una vista a la
  // vez, y al entrar salen GET /cuentas y GET /pagos.
  await correr('N1', async () => {
    const u = await titularBase('n1');
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    const visibleSinHover = await visible(page, 'nav-pagos');
    const pos = await page.$eval(sel('nav-pagos'), (e) => ({
      enPanel: e.closest('[data-testid="nav-panel"]') !== null,
      enSubmenu: e.closest('[data-testid="nav-cuentas-menu"]') !== null,
      hermanoDeTransferir: e.parentElement === document.querySelector('[data-testid="nav-transferir"]')?.parentElement,
    })).catch(() => null);
    if (!pos) { brazo('N1', false, 'nav-pagos no existe en el DOM renderizado'); return; }
    const gets = getsDe.get(page);
    const desde = gets.length;
    await page.click(sel('nav-pagos'));
    const region = await page.waitForSelector(sel('pagos-region'), { state: 'visible', timeout: ESPERA_MS }).then(() => true, () => false);
    const pidio = await esperarHasta(() => gets.slice(desde).includes('/cuentas') && gets.slice(desde).includes('/pagos'),
      'GET /cuentas y GET /pagos al entrar');
    const resumenMontado = await page.$(sel('cuentas-tabla'));
    await recolectar(page);
    const fallas = [];
    if (!visibleSinHover) fallas.push('no está visible sin hover ni despliegue previo');
    if (!pos.enPanel) fallas.push('no cuelga de nav-panel');
    if (pos.enSubmenu) fallas.push('está DENTRO de nav-cuentas-menu (contra JP1)');
    if (!pos.hermanoDeTransferir) fallas.push('no es hermano de nav-transferir');
    if (!region) fallas.push('al pulsarlo no se montó pagos-region');
    if (resumenMontado) fallas.push('cuentas-tabla SIGUE montada (JP1: una vista a la vez)');
    if (!pidio) fallas.push(`al entrar salieron [${gets.slice(desde).join(', ')}], se esperaban /cuentas y /pagos`);
    brazo('N1', fallas.length === 0, fallas.join(' · '));
  });

  // N2 · Alcanzable por teclado (en las dos direcciones: el orden de la barra no es contrato) y
  // con rol + nombre accesible. No se despliega el submenú de Cuentas.
  await correr('N2', async () => {
    const u = await titularBase('n2');
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    const item = await page.waitForSelector(sel('nav-pagos'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null);
    if (!item) { brazo('N2', false, 'nav-pagos no está visible en la barra'); return; }
    const info = await item.evaluate((e) => ({
      rol: e.getAttribute('role') ?? e.tagName.toLowerCase(),
      nombre: (e.getAttribute('aria-label') ?? e.textContent ?? '').trim(),
      tabindex: e.tabIndex,
    }));
    const llegaPorTeclado = async (tecla) => {
      await page.focus(sel('nav-cuentas'));
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press(tecla);
        if (await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'nav-pagos')) return true;
      }
      return false;
    };
    const enfocado = (await llegaPorTeclado('Tab')) || (await llegaPorTeclado('Shift+Tab'));
    const rolValido = ['link', 'a', 'menuitem', 'button'].includes(info.rol);
    await recolectar(page);
    brazo('N2', info.nombre.length > 0 && rolValido && enfocado,
      `rol=${info.rol} (válido=${rolValido}) · nombre="${info.nombre}" · tabIndex=${info.tabindex} · el foco llegó por teclado=${enfocado}`);
  });

  // ── C · Carga y estados (CA7) ─────────────────────────────────────────────────────────────

  // C1 · POST retenido en el navegador: estado `enviando`, aria-busy, `pagos-enviando`,
  // `pagos-enviar` deshabilitado, y un click forzado no produce un segundo POST (decisión 7).
  await correr('C1', async () => {
    const u = await titularBase('c1');
    const page = await paginaNueva();
    let soltar;
    const retenido = new Promise((r) => { soltar = r; });
    await page.route(rutaPagos, async (route) => {
      if (route.request().method() === 'POST') { await retenido; return route.continue(); }
      return route.continue();
    });
    await entrarYPagos(page, u.email);
    await llenar(page);
    const posts = postsDe.get(page);
    await page.click(sel('pagos-enviar'));
    const dlg = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS }).then(() => true, () => false);
    if (!dlg) { soltar(); brazo('C1', false, `J4: pagos-enviar no abrió confirmar-dialogo (POST salidos: ${posts.length})`); return; }
    await page.click(sel('confirmar-aceptar'));
    const fallas = [];
    const enviando = await page.waitForSelector(`${sel('pagos-form')}[data-estado="enviando"]`, { state: 'attached', timeout: ESPERA_MS }).then(() => true, () => false);
    if (!enviando) fallas.push(`pagos-form en «${await estadoForm(page)}», no en enviando`);
    const busy = await page.$eval(sel('pagos-form'), (e) => e.getAttribute('aria-busy')).catch(() => null);
    if (busy !== 'true') fallas.push(`aria-busy=«${busy}»`);
    if (!(await page.$(sel('pagos-enviando')))) fallas.push('pagos-enviando no está');
    const deshabilitado = await page.$eval(sel('pagos-enviar'), (e) => e.disabled).catch(() => null);
    if (deshabilitado !== true) fallas.push(`pagos-enviar disabled=${deshabilitado}`);
    await recolectar(page);
    await page.click(sel('pagos-enviar'), { force: true, timeout: ESPERA_MS }).catch(() => {});
    const reabrio = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_AUSENCIA_MS }).then(() => true, () => false);
    if (reabrio) await page.click(sel('confirmar-aceptar'), { timeout: ESPERA_MS }).catch(() => {});
    const segundo = await esperarHasta(() => posts.length > 1, 'segundo POST', ESPERA_AUSENCIA_MS, true);
    if (segundo) fallas.push(`el click forzado durante el envío produjo ${posts.length} POST`);
    soltar();
    const fin = await esperarTerminalForm(page);
    if (fin !== 'exito') fallas.push(`al soltar, pagos-form quedó en «${fin}»`);
    brazo('C1', fallas.length === 0, fallas.join(' · '));
  });

  // C2 · GET /pagos retenido: `cargando` + aria-busy + `pagos-lista-cargando`; al soltarlo, con un
  // titular SIN pagos, `vacio` + `pagos-vacio` y 0 filas.
  await correr('C2', async () => {
    const u = await titularBase('c2');
    const page = await paginaNueva();
    let soltar;
    const retenido = new Promise((r) => { soltar = r; });
    await page.route(rutaPagos, async (route) => {
      if (route.request().method() === 'GET') await retenido;
      return route.continue();
    });
    await entrarUI(page, u.email);
    await irAPagos(page);
    const fallas = [];
    const cargando = await page.waitForSelector(`${sel('pagos-lista')}[data-estado="cargando"]`, { state: 'attached', timeout: ESPERA_MS }).then(() => true, () => false);
    if (!cargando) fallas.push(`pagos-lista en «${await page.$eval(sel('pagos-lista'), (e) => e.getAttribute('data-estado')).catch(() => null)}», no en cargando`);
    const busy = await page.$eval(sel('pagos-lista'), (e) => e.getAttribute('aria-busy')).catch(() => null);
    if (busy !== 'true') fallas.push(`aria-busy=«${busy}»`);
    if (!(await page.$(sel('pagos-lista-cargando')))) fallas.push('pagos-lista-cargando no está');
    await recolectar(page);
    soltar();
    const fin = await estadoLista(page).catch(() => null);
    if (fin !== 'vacio') fallas.push(`al soltar, pagos-lista quedó en «${fin}»`);
    if (!(await page.$(sel('pagos-vacio')))) fallas.push('pagos-vacio no está');
    const filas = (await filasDe(page)).length;
    if (filas !== 0) fallas.push(`${filas} pago-fila con un titular sin pagos`);
    await recolectar(page);
    brazo('C2', fallas.length === 0, fallas.join(' · '));
  });

  // C3 · GET /cuentas a 500 (una vez, en el navegador) → error propio y reintento que llena el
  // selector. En otra carga, GET /pagos a 500 → `pagos-lista-error` sin `pagos-vacio`.
  await correr('C3', async () => {
    const u = await titularBase('c3');
    const fallas = [];
    {
      const page = await paginaNueva();
      await entrarUI(page, u.email);
      let fallar = true;
      await page.route(rutaCuentas, async (route) => {
        if (route.request().method() === 'GET' && fallar) {
          fallar = false;
          return route.fulfill({ status: 500, contentType: 'application/json', body: '{"codigo":"ERROR_INTERNO"}' });
        }
        return route.continue();
      });
      await irAPagos(page);
      const err = await page.waitForSelector(sel('pagos-cuentas-error'), { state: 'visible', timeout: ESPERA_MS }).then(() => true, () => false);
      if (!err) fallas.push('GET /cuentas 500 → pagos-cuentas-error no visible');
      if (await visible(page, 'pagos-sin-cuentas')) fallas.push('el fallo de GET /cuentas se pinta como pagos-sin-cuentas');
      const reintentar = await visible(page, 'pagos-cuentas-reintentar');
      if (!reintentar) fallas.push('pagos-cuentas-reintentar no visible');
      await recolectar(page);
      if (reintentar) {
        await page.click(sel('pagos-cuentas-reintentar'));
        const lleno = await esperarHasta(async () => {
          const vs = await page.$$eval(`${sel('pagos-origen')} option`, (os) => os.map((o) => o.value)).catch(() => []);
          return vs.length === 1 && vs[0] === u.cuentaId;
        }, 'el reintento llena pagos-origen');
        if (!lleno) fallas.push('el reintento no llenó pagos-origen con la cuenta del titular');
      }
    }
    {
      const page = await paginaNueva();
      await entrarUI(page, u.email);
      await page.route(rutaPagos, async (route) => {
        if (route.request().method() === 'GET') {
          return route.fulfill({ status: 500, contentType: 'application/json', body: '{"codigo":"ERROR_INTERNO"}' });
        }
        return route.continue();
      });
      await irAPagos(page);
      const err = await page.waitForSelector(sel('pagos-lista-error'), { state: 'visible', timeout: ESPERA_MS }).then(() => true, () => false);
      if (!err) fallas.push('GET /pagos 500 → pagos-lista-error no visible');
      const est = await page.$eval(sel('pagos-lista'), (e) => e.getAttribute('data-estado')).catch(() => null);
      if (est !== 'error') fallas.push(`pagos-lista en «${est}», no en error`);
      if (await page.$(sel('pagos-vacio'))) fallas.push('pagos-vacio presente junto al error');
      await recolectar(page);
    }
    brazo('C3', fallas.length === 0, fallas.join(' · '));
  });

  // C4 · Titular sin cuentas → `pagos-sin-cuentas` y ningún `pagos-form`.
  await correr('C4', async () => {
    const u = await titularSinCuentas('c4');
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    await irAPagos(page);
    const sinCuentas = await page.waitForSelector(sel('pagos-sin-cuentas'), { state: 'visible', timeout: ESPERA_MS }).then(() => true, () => false);
    const form = await page.$(sel('pagos-form'));
    await recolectar(page);
    const fallas = [];
    if (!sinCuentas) fallas.push('pagos-sin-cuentas no visible');
    if (form) fallas.push('pagos-form está montado sin cuentas');
    brazo('C4', fallas.length === 0, fallas.join(' · '));
  });

  // ── P · Pago feliz (CA1) ───────────────────────────────────────────────────────────────────

  // P1 · Pantalla contra API, campo por campo. El pago nuevo aparece PRIMERO sin salir de la
  // vista (JP8), sobre una lista que ya tenía un pago (§ 4.1).
  await correr('P1', async () => {
    const u = await titularConPagoPrevio('p1');
    const page = await paginaNueva();
    await entrarYPagos(page, u.email);
    const pago = await pagarUI(page, { monto: MONTO_P1 });
    await recolectar(page);
    const fallas = [];
    if (pago.posts.length !== 1) fallas.push(`salieron ${pago.posts.length} POST`);
    if (pago.resp?.status !== 201) { brazo('P1', false, `POST → ${pago.resp?.status ?? 'sin respuesta'} ${codigoDe(pago.resp?.body ?? '')}`); return; }
    const nuevo = JSON.parse(pago.resp.body);
    if (pago.estado !== 'exito') fallas.push(`pagos-form en «${pago.estado}»`);
    const idPintado = await page.$eval(sel('pagos-pago-id'), (e) => (e.textContent ?? '').trim()).catch(() => null);
    if (idPintado !== nuevo.id) fallas.push(`pagos-pago-id=«${idPintado}», el API dio «${nuevo.id}»`);
    const saldo = await saldoDe(u.token, u.cuentaId);
    if (saldo !== SALDO_FINAL_P1) fallas.push(`saldo API ${saldo}, se esperaba ${SALDO_FINAL_P1}`);
    const llegaron = await esperarHasta(async () => (await filasDe(page)).length === 2, 'la lista con 2 pago-fila sin salir de la vista');
    const filas = await filasDe(page);
    const api = await pagosApi(u.token);
    if (!llegaron) fallas.push(`hay ${filas.length} pago-fila, se esperaban 2 (JP8: la lista se vuelve a pedir)`);
    if (filas[0]?.id !== nuevo.id) fallas.push(`la primera fila es «${filas[0]?.id}», no el pago nuevo «${nuevo.id}»`);
    if (filas.length !== api.length) fallas.push(`devueltos ${api.length} ≠ pintados ${filas.length}`);
    api.forEach((p, i) => {
      const f = filas[i] ?? {};
      for (const [k, v] of [['id', p.id], ['transaccionId', p.transaccionId], ['fecha', p.pagadoEn], ['cuentaOrigenId', p.cuentaOrigenId],
        ['monto', p.monto], ['beneficiarioNombre', p.beneficiarioNombre], ['cuentaBeneficiario', p.cuentaBeneficiario]]) {
        if (f[k] !== v) fallas.push(`fila ${i + 1}.${k}=«${f[k]}», API «${v}»`);
      }
    });
    brazo('P1', fallas.length === 0, `${fallas.slice(0, 8).join(' · ')}${fallas.length > 8 ? ` (+${fallas.length - 8} más)` : ''}`);
  });

  // P2 · Las `<option>` son los ids de GET /cuentas en su orden, nace elegida la primera, y pagar
  // desde la segunda debita ESA cuenta.
  await correr('P2', async () => {
    const u = await titularDosCuentas('p2');
    const page = await paginaNueva();
    await entrarYPagos(page, u.email);
    const fallas = [];
    const opciones = await page.$$eval(`${sel('pagos-origen')} option`, (os) => os.map((o) => o.value)).catch(() => []);
    const ids = u.cuentas.map((c) => c.id);
    if (JSON.stringify(opciones) !== JSON.stringify(ids)) fallas.push(`opciones [${opciones.map((x) => x.slice(0, 8))}] ≠ GET /cuentas [${ids.map((x) => x.slice(0, 8))}]`);
    const elegida = await page.$eval(sel('pagos-origen'), (e) => e.value).catch(() => null);
    if (elegida !== ids[0]) fallas.push(`al entrar está elegida «${elegida}», no la primera`);
    const [primera, segunda] = u.cuentas;
    await elegirOrigen(page, segunda.id);
    const pago = await pagarUI(page, { monto: MONTO_P1 });
    await recolectar(page);
    if (pago.resp?.status !== 201) fallas.push(`POST → ${pago.resp?.status ?? 'sin respuesta'}`);
    const cuerpo = pago.posts[0]?.cuerpo;
    if (cuerpo?.cuentaOrigenId !== segunda.id) fallas.push(`el POST llevó cuentaOrigenId=«${cuerpo?.cuentaOrigenId}»`);
    const fin = await cuentasApi(u.token);
    const s1 = fin.find((c) => c.id === primera.id)?.saldo;
    const s2 = fin.find((c) => c.id === segunda.id)?.saldo;
    const esperado2 = decimal(centavos(segunda.saldo) - centavos(MONTO_P1));
    if (s1 !== primera.saldo) fallas.push(`la primera cuenta pasó de ${primera.saldo} a ${s1}`);
    if (s2 !== esperado2) fallas.push(`la segunda cuenta quedó en ${s2}, se esperaba ${esperado2}`);
    brazo('P2', fallas.length === 0, fallas.join(' · '));
  });

  // ── B · Beneficiario (CA2), con el borde exacto ───────────────────────────────────────────

  // B1 · Los 7 campos en su máximo exacto → 201 y el saldo baja el monto. No mira la lista (K19).
  await correr('B1', async () => {
    const u = await titularBase('b1');
    const page = await paginaNueva();
    await entrarYPagos(page, u.email);
    const benef = Object.fromEntries(CAMPOS.map(([campo, , max]) => [campo, cadena(max)]));
    const pago = await pagarUI(page, { monto: MONTO_P1, benef });
    await recolectar(page);
    const fallas = [];
    if (pago.posts.length !== 1) fallas.push(`salieron ${pago.posts.length} POST`);
    if (pago.resp?.status !== 201) fallas.push(`POST → ${pago.resp?.status ?? 'sin respuesta'} ${codigoDe(pago.resp?.body ?? '')}`);
    const esperado = decimal(centavos(SALDO_BASE) - centavos(MONTO_P1));
    const saldo = await saldoDe(u.token, u.cuentaId);
    if (saldo !== esperado) fallas.push(`saldo API ${saldo}, se esperaba ${esperado}`);
    brazo('B1', fallas.length === 0, fallas.join(' · '));
  });

  // B2 · Cada campo en máximo + 1, los otros 6 válidos → su código (7 sub-casos).
  await correr('B2', () => brazoDeRechazos('B2', CAMPOS.map(([campo, , max, codigo]) =>
    ({ nombre: `${campo}=max+1`, datos: { benef: conCampo(campo, cadena(max + 1)) }, codigo }))));

  // B3 · Cada campo vacío (""), los otros 6 válidos → su código (7 sub-casos).
  await correr('B3', () => brazoDeRechazos('B3', CAMPOS.map(([campo, , , codigo]) =>
    ({ nombre: `${campo}=""`, datos: { benef: conCampo(campo, '') }, codigo }))));

  // B4 · Nombre de sólo espacios.
  await correr('B4', () => brazoDeRechazos('B4', [
    { nombre: 'nombre=«   »', datos: { benef: conCampo('beneficiarioNombre', SOLO_ESPACIOS) }, codigo: 'PAGO_BENEFICIARIO_NOMBRE_INVALIDO' },
  ]));

  // B5 · Precedencia: dirección vacía y teléfono en máximo + 1 → gana la dirección.
  await correr('B5', () => brazoDeRechazos('B5', [
    {
      nombre: 'direccion="" + telefono=max+1',
      datos: { benef: { ...BENEF_REF, beneficiarioDireccion: '', beneficiarioTelefono: cadena(20 + 1) } },
      codigo: 'PAGO_BENEFICIARIO_DIRECCION_INVALIDA',
    },
  ]));

  // ── E · Monto y errores (CA3, CA6) ────────────────────────────────────────────────────────

  await correr('E1', () => brazoDeRechazos('E1', MONTOS_INVALIDOS.map((m) =>
    ({ nombre: `monto=«${m}»`, datos: { monto: m }, codigo: 'MONTO_INVALIDO' }))));

  await correr('E2', () => brazoDeRechazos('E2', [
    { nombre: `monto=${MONTO_SOBRE_SALDO} sobre ${SALDO_BASE}`, datos: { monto: MONTO_SOBRE_SALDO }, codigo: 'FONDOS_INSUFICIENTES' },
  ]));

  // E3 · JP2 sobre el DOM renderizado: `novalidate`, ningún atributo (ni propiedad) de validación
  // en los 8 campos, y el ATRIBUTO `type="text"` literal en los 8 (D97-3).
  await correr('E3', async () => {
    const u = await titularBase('e3');
    const page = await paginaNueva();
    await entrarYPagos(page, u.email);
    await recolectar(page);
    const fallas = [];
    const novalidate = await page.$eval(sel('pagos-form'), (e) => e.hasAttribute('novalidate')).catch(() => null);
    if (novalidate !== true) fallas.push('pagos-form sin novalidate');
    for (const t of CAMPOS_TEXTO) {
      const info = await page.$eval(sel(t), (e, [attrs, props]) => ({
        tipo: e.getAttribute('type'),
        attrs: attrs.filter((a) => e.hasAttribute(a)),
        props: attrs.filter((a) => {
          const p = props[a] ?? a;
          if (p === 'required') return e.required === true;
          if (p === 'minLength' || p === 'maxLength') return e[p] >= 0;
          return false;
        }),
      }), [ATRIBUTOS_PROHIBIDOS, PROP_DE_ATRIBUTO]).catch(() => null);
      if (!info) { fallas.push(`${t} no existe`); continue; }
      if (info.tipo !== 'text') fallas.push(`${t} type=«${info.tipo}»`);
      if (info.attrs.length) fallas.push(`${t} con [${info.attrs.join(', ')}]`);
      if (info.props.length) fallas.push(`${t} con propiedad [${info.props.join(', ')}]`);
    }
    brazo('E3', fallas.length === 0, `${fallas.join(' · ')} (lista versionada: ${ATRIBUTOS_PROHIBIDOS.join('|')})`);
  });

  // ── D · Diálogo (CA4, CA5, J4) ───────────────────────────────────────────────────────────

  // D1 · Cancelar y Escape cierran sin POST y sin mover el saldo (CA5).
  await correr('D1', async () => {
    const u = await titularBase('d1');
    const page = await paginaNueva();
    await entrarYPagos(page, u.email);
    const posts = postsDe.get(page);
    const fallas = [];
    for (const gesto of ['confirmar-cancelar', 'Escape']) {
      await llenar(page);
      const antes = posts.length;
      await page.click(sel('pagos-enviar'));
      const dlg = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS }).then(() => true, () => false);
      if (!dlg) { fallas.push(`[${gesto}] el diálogo no se abrió (POST salidos: ${posts.length - antes})`); continue; }
      await recolectar(page);
      if (gesto === 'Escape') await page.keyboard.press('Escape'); else await page.click(sel('confirmar-cancelar'));
      const cerro = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'hidden', timeout: ESPERA_MS }).then(() => true, () => false);
      if (!cerro) fallas.push(`[${gesto}] el diálogo sigue abierto`);
      const salio = await esperarHasta(() => posts.length > antes, 'POST tras cancelar', ESPERA_AUSENCIA_MS, true);
      if (salio) fallas.push(`[${gesto}] salieron ${posts.length - antes} POST`);
    }
    const saldo = await saldoDe(u.token, u.cuentaId);
    if (saldo !== SALDO_BASE) fallas.push(`saldo API ${saldo}, debía seguir en ${SALDO_BASE}`);
    brazo('D1', fallas.length === 0, fallas.join(' · '));
  });

  // D2 · Doble click() sincrónico dentro del shadow root de `confirmar-aceptar` (técnica de
  // verificar-s10-t4.mjs:1598-1625): una sola clave, un solo pago, el saldo baja una vez (CA4).
  await correr('D2', async () => {
    const u = await titularBase('d2');
    const page = await paginaNueva();
    await entrarYPagos(page, u.email);
    await llenar(page);
    const posts = postsDe.get(page);
    await page.click(sel('pagos-enviar'));
    const dlg = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS }).then(() => true, () => false);
    if (!dlg) { brazo('D2', false, `J4: el diálogo no se abrió (POST salidos: ${posts.length})`); return; }
    if (posts.length > 0) { brazo('D2', false, 'J4: el POST salió antes de confirmar-aceptar'); return; }
    const r = esperarPost(page);
    await page.evaluate(() => {
      const buscar = (raiz, s) => {
        const e = raiz.querySelector(s);
        if (e) return e;
        for (const h of raiz.querySelectorAll('*')) if (h.shadowRoot) { const x = buscar(h.shadowRoot, s); if (x) return x; }
        return null;
      };
      const btn = buscar(document, '[data-testid="confirmar-aceptar"]');
      if (!btn) throw new Error('confirmar-aceptar no encontrado para el doble clic');
      btn.click();
      btn.click();
    });
    await r;
    const estado = await esperarTerminalForm(page);
    await recolectar(page);
    const fallas = [];
    if (estado !== 'exito') fallas.push(`pagos-form en «${estado}»`);
    const claves = new Set(posts.map((p) => p.clave));
    if (claves.size !== 1) fallas.push(`el doble clic produjo ${claves.size} claves en ${posts.length} POST`);
    const n = (await pagosApi(u.token)).length;
    if (n !== 1) fallas.push(`GET /pagos creció en ${n}, no en 1`);
    const esperado = decimal(centavos(SALDO_BASE) - centavos(MONTO_P1));
    const saldo = await saldoDe(u.token, u.cuentaId);
    if (saldo !== esperado) fallas.push(`saldo API ${saldo}, se esperaba ${esperado} (baja una sola vez)`);
    brazo('D2', fallas.length === 0, fallas.join(' · '));
  });

  // D3 · J4: pulsar `pagos-enviar` abre el diálogo y NO hace POST hasta aceptar.
  await correr('D3', async () => {
    const u = await titularBase('d3');
    const page = await paginaNueva();
    await entrarYPagos(page, u.email);
    await llenar(page);
    const posts = postsDe.get(page);
    await page.click(sel('pagos-enviar'));
    const dlg = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS }).then(() => true, () => false);
    const fallas = [];
    if (!dlg) fallas.push('pagos-enviar no abrió confirmar-dialogo');
    const salioAntes = await esperarHasta(() => posts.length > 0, 'POST con el diálogo abierto', ESPERA_AUSENCIA_MS, true);
    if (salioAntes) fallas.push(`salieron ${posts.length} POST antes de aceptar`);
    if (dlg && !salioAntes) {
      const r = esperarPost(page);
      await page.click(sel('confirmar-aceptar'));
      const resp = await r;
      if (posts.length !== 1) fallas.push(`al aceptar salieron ${posts.length} POST, no 1`);
      if (resp?.status !== 201) fallas.push(`POST → ${resp?.status ?? 'sin respuesta'}`);
    }
    await recolectar(page);
    brazo('D3', fallas.length === 0, fallas.join(' · '));
  });

  // ── I · Idempotencia (J3, JP6) ────────────────────────────────────────────────────────────

  // I1 · El POST llega al backend y su respuesta se pierde (T6 de S-10 T3). `pagos-sin-respuesta`
  // sin código; `pagos-reintentar` reenvía SIN diálogo con la MISMA clave; `pagos-repetido`; el
  // saldo baja una sola vez.
  await correr('I1', async () => {
    const u = await titularBase('i1');
    const page = await paginaNueva();
    let intentos = 0;
    await page.route(rutaPagos, async (route) => {
      if (route.request().method() === 'POST' && ++intentos === 1) {
        await route.fetch();                 // el backend recibe y ejecuta
        return route.abort('failed');        // el navegador pierde la respuesta
      }
      return route.continue();
    });
    await entrarYPagos(page, u.email);
    const pago = await pagarUI(page, { monto: MONTO_P1 });
    await recolectar(page);
    const fallas = [];
    if (!pago.resp?.fallo) fallas.push(`la primera respuesta no se perdió (${pago.resp?.status ?? 'sin POST'})`);
    if (pago.estado !== 'sin-respuesta') fallas.push(`pagos-form en «${pago.estado}», no en sin-respuesta`);
    if (!(await visible(page, 'pagos-sin-respuesta'))) fallas.push('pagos-sin-respuesta no visible');
    if (await page.$(sel('pagos-error'))) fallas.push('pagos-error presente sin respuesta de red');
    if (await page.$(`${sel('pagos-region')} [data-codigo]`)) fallas.push('hay un data-codigo sin respuesta de red');
    const posts = postsDe.get(page);
    if (!(await visible(page, 'pagos-reintentar'))) {
      fallas.push('pagos-reintentar no visible');
    } else {
      const r = esperarPost(page);
      await page.click(sel('pagos-reintentar'));
      const dlg = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_AUSENCIA_MS }).then(() => true, () => false);
      if (dlg) fallas.push('reintentar abrió el diálogo (JP6: reenvía directo)');
      const resp = await r;
      const fin = await esperarTerminalForm(page);
      await recolectar(page);
      if (resp?.status !== 201) fallas.push(`el reintento → ${resp?.status ?? 'sin respuesta'}`);
      if (resp?.headers?.['idempotency-replayed'] !== 'true') fallas.push('el reintento no volvió como Idempotency-Replayed');
      if (fin !== 'exito') fallas.push(`tras reintentar, pagos-form en «${fin}»`);
      if (!(await visible(page, 'pagos-exito'))) fallas.push('pagos-exito no visible');
      if (!(await visible(page, 'pagos-repetido'))) fallas.push('pagos-repetido no visible');
      if (posts.length !== 2 || posts[0].clave !== posts[1].clave) fallas.push(`claves [${posts.map((p) => p.clave).join(', ')}] (se esperaban 2 iguales)`);
    }
    const esperado = decimal(centavos(SALDO_BASE) - centavos(MONTO_P1));
    const saldo = await saldoDe(u.token, u.cuentaId);
    if (saldo !== esperado) fallas.push(`saldo API ${saldo}, se esperaba ${esperado} (baja una sola vez)`);
    brazo('I1', fallas.length === 0, fallas.join(' · '));
  });

  // I2 · Dos pagos seguidos de la misma sesión: claves distintas, las dos con forma de UUID.
  await correr('I2', async () => {
    const u = await titularBase('i2');
    const page = await paginaNueva();
    await entrarYPagos(page, u.email);
    const a = await pagarUI(page, { monto: MONTO_P1 });
    const b = await pagarUI(page, { monto: MONTO_P1 });
    await recolectar(page);
    const claves = [...a.posts, ...b.posts].map((p) => p.clave);
    const fallas = [];
    if (a.resp?.status !== 201 || b.resp?.status !== 201) fallas.push(`POST → ${a.resp?.status ?? '—'} y ${b.resp?.status ?? '—'}`);
    if (claves.length !== 2) fallas.push(`salieron ${claves.length} POST, no 2`);
    if (claves[0] === claves[1]) fallas.push('las dos claves son iguales');
    const noUuid = claves.filter((c) => !UUID_RE.test(c ?? ''));
    if (noUuid.length) fallas.push(`sin forma de UUID: [${noUuid.join(', ')}]`);
    brazo('I2', fallas.length === 0, fallas.join(' · '));
  });

  // ── A · Formato y accesibilidad (CA8) ──────────────────────────────────────────────────────

  // A1 · La fila del pago de P1 (decisión 6): `data-fecha` = `pagadoEn`, y el texto visible es
  // `AAAA-MM-DD HH:MM UTC` calculado desde el ISO. Ancla de texto DELIBERADA (R8).
  await correr('A1', async () => {
    const u = await titularConPagoPrevio('a1');
    const page = await paginaNueva();
    await entrarYPagos(page, u.email);
    const pago = await pagarUI(page, { monto: MONTO_P1 });
    if (pago.resp?.status !== 201) { brazo('A1', false, `POST → ${pago.resp?.status ?? 'sin respuesta'}`); return; }
    const nuevoId = JSON.parse(pago.resp.body).id;
    await reentrarAPagos(page);
    await recolectar(page);
    const api = (await pagosApi(u.token)).find((p) => p.id === nuevoId);
    const fila = (await filasDe(page)).find((f) => f.id === nuevoId);
    const fallas = [];
    if (!api) fallas.push('el pago no está en GET /pagos');
    if (!fila) fallas.push(`no hay pago-fila con data-pago-id=${nuevoId}`);
    if (api && fila) {
      const esperado = `${api.pagadoEn.slice(0, 10)} ${api.pagadoEn.slice(11, 16)} UTC`;
      if (fila.fecha !== api.pagadoEn) fallas.push(`data-fecha=«${fila.fecha}», API «${api.pagadoEn}»`);
      if (fila.fechaTexto !== esperado) fallas.push(`texto=«${fila.fechaTexto}», se esperaba «${esperado}»`);
    }
    brazo('A1', fallas.length === 0, fallas.join(' · '));
  });

  // A2 · `<caption>` no vacío, `scope="col"` en todos los `<th>`, `<label for>` a un id que existe
  // en los 8 campos, `role="alert"` en `pagos-error` y `role="status"` en `pagos-exito`.
  await correr('A2', async () => {
    const u = await titularConPagoPrevio('a2');
    const page = await paginaNueva();
    await entrarYPagos(page, u.email);
    const fallas = [];
    const tabla = await page.$eval(sel('pagos-tabla'), (t) => ({
      caption: (t.querySelector('caption')?.textContent ?? '').trim(),
      th: [...t.querySelectorAll('th')].map((h) => h.getAttribute('scope')),
    })).catch(() => null);
    if (!tabla) fallas.push('pagos-tabla no está');
    else {
      if (!tabla.caption) fallas.push('pagos-tabla sin <caption> o vacío');
      if (tabla.th.length === 0 || tabla.th.some((s) => s !== 'col')) fallas.push(`scope de los <th>: [${tabla.th.join(', ')}]`);
    }
    for (const t of CAMPOS_TEXTO) {
      const ok = await page.$eval(sel(t), (e) => !!e.id && document.getElementById(e.id) === e
        && !!document.querySelector(`label[for="${CSS.escape(e.id)}"]`)).catch(() => false);
      if (!ok) fallas.push(`${t} sin <label for> a un id que existe`);
    }
    const malo = await pagarUI(page, { monto: MONTOS_INVALIDOS[0] });
    await recolectar(page);
    const rolError = await page.$eval(sel('pagos-error'), (e) => e.getAttribute('role')).catch(() => null);
    if (malo.estado !== 'error' || rolError !== 'alert') fallas.push(`pagos-error role=«${rolError}» (form en «${malo.estado}»)`);
    const bueno = await pagarUI(page, { monto: MONTO_P1 });
    await recolectar(page);
    const rolExito = await page.$eval(sel('pagos-exito'), (e) => e.getAttribute('role')).catch(() => null);
    if (bueno.estado !== 'exito' || rolExito !== 'status') fallas.push(`pagos-exito role=«${rolExito}» (form en «${bueno.estado}»)`);
    brazo('A2', fallas.length === 0, fallas.join(' · '));
  });

  // ── N3 · Contrato de testids sobre el ARTEFACTO RENDERIZADO ──────────────────────────────
  // Va al final: mide lo que se recolectó en los 23 recorridos de arriba (RESTRICCIONES § 2).
  await correr('N3', async () => {
    const faltan = LISTA_S17P.filter((t) => !vistos.has(t));
    const sobran = [...vistos].filter((t) => !UNION.has(t));
    const rojosPrevios = resultados.filter((r) => !r.ok).map((r) => r.id);
    const arrastre = rojosPrevios.length > 0 ? ` · ⚠ CAUSA POSIBLEMENTE ARRASTRADA: ya venían rojos [${rojosPrevios.join(' ')}]` : '';
    brazo('N3', faltan.length === 0 && sobran.length === 0 && repetidos.size === 0 && fuera.length === 0,
      `faltan [${faltan.join(', ')}] · sobran [${sobran.join(', ')}] · repetidos [${[...repetidos].join(', ')}] · fuera [${[...new Set(fuera)].slice(0, 3).join(', ')}] (lista de ${LISTA_S17P.length})${arrastre}`);
  });
} finally {
  await navegador.close().catch(() => {});
}

const verdes = resultados.filter((r) => r.ok).length;
const rojos = resultados.filter((r) => !r.ok).map((r) => r.id);
console.log(`\nverificar:s17-pagos → ${verdes}/${resultados.length} brazos verdes${rojos.length ? ` · rojos: ${rojos.join(' ')}` : ''}`);
if (SOLO.length > 0) console.log(`⚠ CORRIDA PARCIAL (ZFB_BRAZOS=${SOLO.join(',')}): ${resultados.length} de ${BRAZOS_TOTAL} brazos. NO sirve para declarar el número de la unidad.`);
process.exit(rojos.length === 0 && resultados.length === BRAZOS_TOTAL ? 0 : 1);
