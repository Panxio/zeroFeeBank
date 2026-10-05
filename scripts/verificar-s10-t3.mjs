// Árbitro de S-10 · T3 (specs/S-10-T3-transferir.md § 5). Corre contra el ARTEFACTO servido:
// el backend (`node dist/main.js`) en :3000 y el build de producción de web/ en :4200.
// Lo levanta scripts/verificar-s10-t3.sh; este archivo sólo mira. No importa código de la app.
// Contiene los brazos de T1, T2 y los 25 nuevos de T3 (B3, V1–V4, A1–A6, D1–D3, T1–T9, P1–P2).
//
// Salida: una línea por brazo (OK | ROJO: motivo) y un resumen «N/M». Exit 0 sólo con todo verde.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { extractText, getDocumentProxy } from 'unpdf';

const API = 'http://localhost:3000';
const APP = 'http://localhost:4200';
const HOSTS_PERMITIDOS = new Set(['localhost:3000', 'localhost:4200']);
const ESPERA_MS = 8000; // tope de cada espera por CONDICIÓN (no es un sleep): un rojo, no un cuelgue
const CLAVE = 'Clave-Arnes-2026';
const ESCRITORIO = { width: 1280, height: 800 }; // § 3
const TELEFONO = { width: 390, height: 844 };    // § 3
const CIERRE_MIN_MS = 280;  // § 2: ventana aceptada para el cierre diferido de 300 ms
const CIERRE_MAX_MS = 1500;
// BRAZOS_TOTAL pasa a 56 al agregar el brazo T9 (§ 5.1)
const BRAZOS_TOTAL = 56;    // 31 de T2 + 25 de T3
const MONTO_FELIZ = '250.10'; // § 3: con Number() se volvería 250.1
const MONTO_COMA = '12,50';   // § 3: coma decimal
const MONTO_EXCEDE = '5000.00'; // § 3: excede los 1000.00 de la cuenta fondeada
const ID_INEXISTENTE = '00000000-0000-4000-8000-000000000000'; // § 3: UUID v4 bien formado inexistente

const LISTA = readFileSync(new URL('../specs/S-10-testids-T3.txt', import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
// `cuenta-tipo` entra por enmienda: es la casuística DE_FILA que T4 y boletas
// ya contemplan en su propio DE_FILA. Se pinta
// una vez por fila de cuenta, así que verlo repetido es lo correcto, no un defecto.
const DE_FILA = new Set(['cuenta-fila', 'cuenta-id', 'cuenta-copiar-id', 'cuenta-saldo', 'cuenta-tipo']);
// Enmienda E2 de specs/S-17-movimientos.md § 5.1.
// OJO: T3 usa UNA sola LISTA para `faltan` y para `sobran`, así que sumarle acá los testids de las
// unidades posteriores le exigiría montar pantallas que T3 no visita nunca y la dejaría roja para
// siempre. Por eso van listas APARTE que eximen SÓLO a `sobran` — que es exactamente lo que
// verificar-s10-t4.mjs:3284 ya hacía con sus cinco listas y T2/T3 nunca recibieron.
// Lo que FALTA se sigue midiendo contra LISTA, y un testid que no esté en NINGUNA lista sigue
// poniendo R1 rojo: no se relaja ninguna aserción, se actualiza el contrato versionado (C3).
const leerLista = (n) => readFileSync(new URL(`../specs/${n}`, import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const UNION_POSTERIORES = new Set([
  'S-10-testids-T4.txt',           // inactividad-*
  'S-17-testids-boletas.txt',      // ir-ventanilla, nav-boletas
  'S-17-testids-abrir-cuenta.txt', // nav-abrir-cuenta, abrir-primera-cuenta, cuenta-tipo
  'S-17-testids-transferir.txt',   // transferir-destino-modo-banco
  'S-17-testids-movimientos.txt',  // los 22 de la enmienda E2
  'S-17-testids-pagos.txt',        // enmienda § 5.1 de S-17-pagos
  'S-17-testids-contacto.txt',     // enmienda § 5.1 de S-17-contacto
  'S-35-testids-idioma.txt',       // enmienda C3 de S-35
].flatMap((n) => leerLista(n)));

const resultados = [];
function brazo(id, ok, motivo = '') {
  resultados.push({ id, ok });
  console.log(`  ${id} ${ok ? 'OK' : `ROJO: ${motivo}`}`);
}
async function correr(id, fn) {
  try { await fn(); } catch (e) { brazo(id, false, `excepción: ${String(e?.message ?? e).split('\n')[0]}`); }
}

// ── HTTP crudo: fetch no deja fijar Origin de forma fiable ─────────────────────────────
// El fallo de red se reintenta UNA sola vez; si el segundo intento también falla, la
// excepción se propaga tal cual como excepción del brazo que la esperaba.
function pedirUnaVez(metodo, ruta, cabeceras = {}, cuerpo) {
  return new Promise((ok, mal) => {
    const req = http.request(`${API}${ruta}`, { method: metodo, headers: cabeceras }, (res) => {
      const trozos = [];
      res.on('data', (c) => trozos.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(trozos);
        ok({ status: res.statusCode, headers: res.headers, body: buf.toString('utf8'), buf });
      });
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
const JSON_H = { 'content-type': 'application/json' };
async function registrar(email) {
  const r = await pedir('POST', '/auth/registro', JSON_H, { email, password: CLAVE });
  if (r.status !== 201) throw new Error(`registro por API → ${r.status} ${r.body}`);
}
async function tokenDe(email) {
  const r = await pedir('POST', '/auth/login', JSON_H, { email, password: CLAVE });
  if (r.status !== 200) throw new Error(`login por API → ${r.status} ${r.body}`);
  return JSON.parse(r.body);
}
const emailNuevo = (p) => `s10t3-${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@arnes.local`;

// Cuentas por la API real (S-12). La primera sale de CAJA; las siguientes, de `origenId`.
async function abrirCuenta(token, origenId) {
  const cuerpo = origenId ? { tipo: 'CORRIENTE', cuentaOrigenId: origenId } : { tipo: 'CORRIENTE' };
  const r = await pedir('POST', '/cuentas',
    { ...JSON_H, authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() }, cuerpo);
  if (r.status !== 201) throw new Error(`POST /cuentas → ${r.status} ${r.body}`);
  return JSON.parse(r.body);
}
async function cuentasApi(token) {
  const r = await pedir('GET', '/cuentas', { authorization: `Bearer ${token}` });
  if (r.status !== 200) throw new Error(`GET /cuentas → ${r.status} ${r.body}`);
  return JSON.parse(r.body).cuentas;
}
// Usuario nuevo con `n` cuentas (0, 1 o 2). Con 2: la segunda se fondea con los 1000.00 de la
// primera, así que quedan con saldos DISTINTOS ("0.00" y "1000.00"): E3 distingue monto cruzado.
async function usuarioCon(n, prefijo) {
  const email = emailNuevo(prefijo);
  await registrar(email);
  const { token } = await tokenDe(email);
  const ids = [];
  for (let i = 0; i < n; i++) ids.push((await abrirCuenta(token, ids[ids.length - 1])).id);
  return { email, token, ids };
}

// Afirma que las cuentas tienen exactamente los saldos esperados ("0.00" y "1000.00")
// antes de usarse (§ 3): defensa contra el brazo imposible por datos mal armados.
async function usuarioConSaldosAfirmados(prefijo) {
  const u = await usuarioCon(2, prefijo);
  const cuentas = await cuentasApi(u.token);
  const c0 = cuentas.find((c) => c.id === u.ids[0]);
  const c1 = cuentas.find((c) => c.id === u.ids[1]);
  if (!c0 || !c1) throw new Error('preparación: cuentas no encontradas');
  if (c0.saldo !== '0.00' || c1.saldo !== '1000.00') {
    throw new Error(`preparación: saldos esperados 0.00 y 1000.00, pero son c0=${c0.saldo} c1=${c1.saldo}`);
  }
  return { ...u, origenId: u.ids[1], destinoId: u.ids[0], cuentas };
}

// ── B1 · cabeceras del marco ───────────────────────────────────────────────────────────
await correr('B1', async () => {
  const r = await pedir('GET', '/auth/marco');
  const csp = String(r.headers['content-security-policy'] ?? '');
  const fa = csp.split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0] === 'frame-ancestors');
  const faluera = fa ? fa.slice(1).join(' ') : '(sin frame-ancestors)';
  const estrella = /postMessage\s*\([^;]*?,\s*["'`]\*["'`]/.test(r.body);
  const fallas = [];
  if (r.status !== 200) fallas.push(`status ${r.status}`);
  if (!String(r.headers['content-type'] ?? '').includes('text/html')) fallas.push(`content-type ${r.headers['content-type']}`);
  if (faluera !== 'http://localhost:4200') fallas.push(`frame-ancestors = ${faluera}`);
  if (estrella) fallas.push('postMessage con targetOrigin "*" en el HTML servido');
  brazo('B1', fallas.length === 0, fallas.join(' · '));
});

// ── B2 · CORS ──────────────────────────────────────────────────────────────────────────
await correr('B2', async () => {
  const pre = (origen) => pedir('OPTIONS', '/auth/yo', {
    Origin: origen, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization',
  });
  const bueno = await pre(APP);
  const malo = await pre('http://evil.test');
  const fallas = [];
  if (bueno.headers['access-control-allow-origin'] !== APP) fallas.push(`ACAO app = ${bueno.headers['access-control-allow-origin']}`);
  if (!/authorization/i.test(String(bueno.headers['access-control-allow-headers'] ?? ''))) fallas.push('Authorization no permitido');
  if (malo.headers['access-control-allow-origin'] !== undefined) fallas.push(`ACAO ajeno = ${malo.headers['access-control-allow-origin']}`);
  brazo('B2', fallas.length === 0, fallas.join(' · '));
});

// ── B3 · CORS expone la cabecera (H1) ──────────────────────────────────────────────────
await correr('B3', async () => {
  const u = await usuarioConSaldosAfirmados('b3');
  const clave = randomUUID();
  const cuerpo = { origenId: u.origenId, destinoId: u.destinoId, monto: MONTO_FELIZ };
  const h = {
    ...JSON_H,
    origin: APP,
    authorization: `Bearer ${u.token}`,
    'idempotency-key': clave,
  };
  const r1 = await pedir('POST', '/transferencias', h, cuerpo);
  const r2 = await pedir('POST', '/transferencias', h, cuerpo);
  const fallas = [];
  if (r1.status !== 201) fallas.push(`primer POST status=${r1.status}`);
  if (r2.status !== 201) fallas.push(`segundo POST status=${r2.status}`);
  if (!r2.headers['idempotency-replayed']) fallas.push('falta cabecera Idempotency-Replayed en respuesta repetida');
  const exp = String(r2.headers['access-control-expose-headers'] ?? '');
  if (!/idempotency-replayed/i.test(exp)) {
    fallas.push(`Access-Control-Expose-Headers no expone Idempotency-Replayed (expuesto: «${exp}»)`);
  }
  brazo('B3', fallas.length === 0, fallas.join(' · '));
});

// ── F2 · rutas de fuente cerradas ──────────────────────────────────────────────────────
await correr('F2', async () => {
  const fallas = [];
  for (const peso of ['400', '500']) {
    const r = await pedir('GET', `/auth/marco/fuentes/jost-${peso}.woff2`);
    if (r.status !== 200) fallas.push(`jost-${peso} → ${r.status}`);
    else {
      if (!String(r.headers['content-type'] ?? '').startsWith('font/woff2')) fallas.push(`jost-${peso} content-type ${r.headers['content-type']}`);
      if (r.buf.subarray(0, 4).toString('latin1') !== 'wOF2') fallas.push(`jost-${peso} no es un woff2`);
    }
  }
  for (const ruta of ['/auth/marco/fuentes/jost-700.woff2', '/auth/marco/fuentes/..%2F..%2Fpackage.json']) {
    const r = await pedir('GET', ruta);
    if (r.status !== 404) fallas.push(`${ruta} → ${r.status}`);
    if (/"(scripts|dependencies)"\s*:/.test(r.body)) fallas.push(`${ruta} filtró un package.json`);
  }
  brazo('F2', fallas.length === 0, fallas.join(' · '));
});

// ── Navegador ──────────────────────────────────────────────────────────────────────────
const navegador = await chromium.launch({ headless: true });
const fuera = []; // peticiones a hosts no permitidos (R11), de TODAS las páginas
const sel = (t) => `[data-testid="${t}"]`;
// UX-b1 § 4, D130-4
const abreviar = (id) => (id.length > 6 ? `…${id.slice(-6)}` : id);

// `vigilar = false` sólo para R6, que navega él mismo a 127.0.0.1:3000: esa petición es del
// arnés, no de la app, y no debe contar en R11.
async function paginaNueva(opciones = {}, vigilar = true) {
  const ctx = await navegador.newContext({ viewport: ESCRITORIO, ...opciones });
  const page = await ctx.newPage();
  if (vigilar) page.on('request', (req) => {
    const u = new URL(req.url());
    if (!['data:', 'blob:'].includes(u.protocol) && !HOSTS_PERMITIDOS.has(u.host)) fuera.push(req.url());
  });
  page.setDefaultTimeout(ESPERA_MS);
  await page.goto(APP, { waitUntil: 'load' });
  await page.waitForSelector(sel('portada'), { state: 'attached' }); // Angular arranca después de `load`
  return page;
}
async function marcoDe(page) {
  const h = await page.waitForSelector(sel('login-marco'), { state: 'attached', timeout: ESPERA_MS });
  const f = await h.contentFrame();
  if (!f) throw new Error('login-marco sin documento');
  await f.waitForSelector(sel('login-form'), { state: 'attached', timeout: ESPERA_MS });
  return f;
}
async function abrirPopover(page) {
  await page.click(sel('login-abrir'));
  await page.waitForSelector(`${sel('login-popover')}[data-estado="listo"]`, { state: 'attached', timeout: ESPERA_MS });
  return marcoDe(page);
}
const popoverAbierto = (page) => page.$eval(sel('login-popover'), (e) => e.matches(':popover-open'));
async function esperarPopoverCerrado(page) {
  await page.waitForFunction((s) => !document.querySelector(s)?.matches(':popover-open'), sel('login-popover'), { timeout: ESPERA_MS });
}
const focoEn = (page) => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName);
// El foco puede llegar un cuadro después del cambio de estado: se espera la CONDICIÓN y, si no
// llega, el rojo dice dónde quedó.
async function focoLlegaA(page, testid) {
  const ok = await page.waitForFunction((t) => document.activeElement?.getAttribute('data-testid') === t, testid, { timeout: ESPERA_MS })
    .then(() => true, () => false);
  return { ok, foco: ok ? testid : await focoEn(page) };
}

// Todos los testids del DOM de cada documento (y de sus shadow roots abiertos). Además, en cada
// foto, los testids que no son de fila y aparecen más de una vez (R1, § 3: un solo marcado).
const vistos = new Set();
const repetidos = new Set();
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

// Login por la UI, con un usuario que ya existe; devuelve cuando la vista de sesión está montada.
// `montada = false` sólo en S1/S2 (enmienda § 5.1): con un 401 inmediato la sesión se cierra en el
// mismo ciclo y la vista puede no montarse nunca de forma observable; esos brazos se sincronizan
// con la respuesta 401 de GET /cuentas.
async function entrarUI(page, email, montada = true) {
  const f = await abrirPopover(page);
  await f.fill(sel('login-email'), email);
  await f.fill(sel('login-password'), CLAVE);
  await f.click(sel('login-enviar'));
  if (montada) await page.waitForSelector(sel('cuentas-region'), { state: 'attached', timeout: ESPERA_MS });
}
const TERMINAL = ['listo', 'vacio', 'error'];
async function estadoTerminal(page) {
  const h = await page.waitForSelector(TERMINAL.map((e) => `${sel('cuentas-region')}[data-estado="${e}"]`).join(', '),
    { state: 'attached', timeout: ESPERA_MS });
  return h.getAttribute('data-estado');
}
// `cidAttr`/`corto`/`largo` acompañan a E3 (UX-b1 § 5); `id`, `texto` y `monto` son los de
// siempre: añadir campos no relaja ninguna aserción de los brazos que ya usaban `filas`.
const filas = (page) => page.$$eval(sel('cuenta-fila'), (rs) => rs.map((r) => {
  const cid = r.querySelector('[data-testid="cuenta-id"]');
  return {
    id: r.getAttribute('data-cuenta-id'),
    texto: cid?.textContent?.trim() ?? null,
    cidAttr: cid?.getAttribute('data-cuenta-id') ?? null,
    corto: cid?.querySelector('[aria-hidden="true"]')?.textContent?.trim() ?? null,
    largo: cid?.querySelector('.sr-only')?.textContent?.trim() ?? null,
    monto: r.querySelector('[data-testid="cuenta-saldo"]')?.getAttribute('data-monto') ?? null,
  };
}));
const nFilasLlegaA = (page, n) => page.waitForFunction(([s, k]) => document.querySelectorAll(s).length === k,
  [sel('cuenta-fila'), n], { timeout: ESPERA_MS }).then(() => true, () => false);
const visible = (page, t) => page.isVisible(sel(t));
const expandido = (page, t) => page.getAttribute(sel(t), 'aria-expanded');
const esperarExpandido = (page, t, v) => page.waitForSelector(`${sel(t)}[aria-expanded="${v}"]`, { state: 'attached', timeout: ESPERA_MS })
  .then(() => true, () => false);
const esGet = (req) => req.method() === 'GET' && req.url() === `${API}/cuentas`;

// ── Recorrido principal (T1): R3 → R4 → R2 → R10 ───────────────────────────────────────
const emailUI = emailNuevo('ui');
await correr('R3', async () => {
  const page = await paginaNueva();
  globalThis.__pagina = page;
  await recolectar(page);
  const f = await abrirPopover(page);
  await recolectar(page);
  await f.click(sel('ir-registro'));
  await f.fill(sel('registro-email'), emailUI);
  await f.fill(sel('registro-password'), CLAVE);
  await f.click(sel('registro-enviar'));
  await f.waitForSelector(sel('registro-exito'), { state: 'visible', timeout: ESPERA_MS });
  await recolectar(page);
  const escrito = await f.inputValue(sel('login-email'));
  brazo('R3', escrito === emailUI, `login-email = «${escrito}», esperado «${emailUI}»`);
});

await correr('R4', async () => {
  const page = globalThis.__pagina;
  const f = await marcoDe(page);
  await f.fill(sel('login-email'), emailUI);
  await f.fill(sel('login-password'), 'no-es-la-clave');
  await f.click(sel('login-enviar'));
  await f.waitForSelector(`${sel('login-error')}[data-codigo="CREDENCIALES_INVALIDAS"]`, { state: 'visible', timeout: ESPERA_MS });
  await recolectar(page);
  brazo('R4', true);
});

await correr('R2', async () => {
  const page = globalThis.__pagina;
  const f = await marcoDe(page);
  await f.fill(sel('login-email'), emailUI);
  await f.fill(sel('login-password'), CLAVE);
  await f.click(sel('login-enviar'));
  await page.waitForSelector(sel('usuario-email'), { state: 'visible', timeout: ESPERA_MS });
  await recolectar(page);
  const texto = (await page.textContent(sel('usuario-email')))?.trim();
  const abierto = await popoverAbierto(page);
  brazo('R2', texto === emailUI && !abierto, `usuario-email = «${texto}» · popover abierto = ${abierto}`);
});

await correr('R10', async () => {
  const page = globalThis.__pagina;
  await page.click(sel('nav-usuario'));
  await page.click(sel('salir'));
  await page.waitForSelector(sel('usuario-email'), { state: 'detached', timeout: ESPERA_MS });
  await page.waitForSelector(sel('login-abrir'), { state: 'visible', timeout: ESPERA_MS });
  const { ok, foco } = await focoLlegaA(page, 'login-abrir');
  brazo('R10', ok, `foco en ${foco}`);
});

// ── R5 · Esc dentro del marco ──────────────────────────────────────────────────────────
await correr('R5', async () => {
  const page = await paginaNueva();
  const f = await abrirPopover(page);
  await f.click(sel('login-email'));
  await page.keyboard.press('Escape');
  await esperarPopoverCerrado(page);
  const foco = await focoEn(page);
  brazo('R5', foco === 'login-abrir', `popover cerrado, pero el foco quedó en ${foco}`);
});

// ── R6–R8 · mensajes ajenos con un token VÁLIDO ─────────────────────────────────────────
const emailApi = emailNuevo('api');
await registrar(emailApi).catch((e) => console.log(`  (preparación R6–R8 falló: ${e.message})`));

async function mensajeAjeno(id, enviar) {
  await correr(id, async () => {
    const { token, expiraEn } = await tokenDe(emailApi);
    const page = await paginaNueva({}, id !== 'R6');
    const yo = [];
    page.on('request', (r) => { if (r.url().includes('/auth/yo')) yo.push(r.url()); });
    const f = await abrirPopover(page);
    await enviar(page, f, { v: 1, tipo: 'zfb.auth.sesion', token, expiraEn });
    await (await marcoDe(page)).click(sel('login-email'));
    await page.keyboard.press('Escape');
    await esperarPopoverCerrado(page);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    const sesion = await page.$(sel('usuario-email'));
    brazo(id, yo.length === 0 && !sesion, `aceptó el mensaje: GET /auth/yo × ${yo.length}, usuario-email ${sesion ? 'presente' : 'ausente'}`);
  });
}
await mensajeAjeno('R6', async (page, _f, msg) => {
  const navegar = (u) => page.evaluate((url) => new Promise((ok) => {
    const i = document.querySelector('[data-testid="login-marco"]');
    i.addEventListener('load', () => ok(null), { once: true });
    i.src = url;
  }), u);
  await navegar('http://127.0.0.1:3000/health');
  const ajeno = page.frames().find((fr) => fr.url().startsWith('http://127.0.0.1:3000/health'));
  if (!ajeno) throw new Error('login-marco no navegó a 127.0.0.1:3000');
  await ajeno.evaluate((m) => parent.postMessage(m, 'http://localhost:4200'), msg);
  await navegar(`${API}/auth/marco`);
});
await mensajeAjeno('R7', async (page, _f, msg) => {
  await page.evaluate((u) => new Promise((ok) => {
    const i = document.createElement('iframe');
    i.src = u; i.id = 'arnes-intruso'; i.onload = () => ok(null);
    document.body.appendChild(i);
  }), `${API}/health`);
  const intruso = page.frames().find((fr) => fr.url().startsWith(`${API}/health`));
  if (!intruso) throw new Error('no cargó el iframe intruso');
  await intruso.evaluate((m) => parent.postMessage(m, 'http://localhost:4200'), msg);
});
await mensajeAjeno('R8', async (_page, f, msg) => {
  await f.evaluate((m) => parent.postMessage({ ...m, v: 2 }, 'http://localhost:4200'), msg);
});

// ── R9 · bruma congelable ──────────────────────────────────────────────────────────────
await correr('R9', async () => {
  const quieta = await paginaNueva({ reducedMotion: 'reduce' });
  const viva = await paginaNueva({ reducedMotion: 'no-preference' });
  const estado = async (p) => (await p.waitForSelector(`${sel('portada-bruma')}[data-estado]`, { state: 'attached' }))
    .getAttribute('data-estado');
  const [a, b] = [await estado(quieta), await estado(viva)];
  brazo('R9', a === 'congelado' && b === 'animando', `reduce → ${a} · sin preferencia → ${b}`);
});

// ── R11 · fuentes empaquetadas (anfitriona) ────────────────────────────────────────────
await correr('R11', async () => {
  const page = await paginaNueva();
  const cargada = (fam, estilo, peso) => page.waitForFunction(([fa, es, pe]) => [...document.fonts].some((f) =>
    f.family.replace(/["']/g, '') === fa && f.style === es && String(f.weight) === pe && f.status === 'loaded'),
  [fam, estilo, peso]).then(() => true, () => false);
  const caras = { spectral: await cargada('Spectral', 'italic', '300'), jost: await cargada('Jost', 'normal', '400') };
  const fallas = [];
  if (fuera.length) fallas.push(`peticiones fuera: ${[...new Set(fuera)].slice(0, 3).join(', ')}`);
  if (!caras.spectral) fallas.push('Spectral itálica 300 no cargada');
  if (!caras.jost) fallas.push('Jost 400 no cargada');
  brazo('R11', fallas.length === 0, fallas.join(' · '));
});

// ── F1 · fuentes del marco, mirando el documento DEL MARCO ─────────────────────────────
await correr('F1', async () => {
  const page = await paginaNueva();
  const delMarco = [];
  page.on('request', (req) => { if (req.frame().url().startsWith(`${API}/auth/marco`)) delMarco.push(req.url()); });
  const f = await abrirPopover(page);
  const cargada = (peso) => f.waitForFunction((pe) => [...document.fonts].some((x) =>
    x.family.replace(/["']/g, '') === 'Jost' && x.style === 'normal' && String(x.weight) === pe && x.status === 'loaded'),
  peso, { timeout: ESPERA_MS }).then(() => true, () => false);
  const [c400, c500] = [await cargada('400'), await cargada('500')];
  const ajenas = delMarco.filter((u) => !u.startsWith(`${API}/`) && !u.startsWith('data:'));
  const fallas = [];
  if (!c400) fallas.push('Jost 400 no cargada en el marco');
  if (!c500) fallas.push('Jost 500 no cargada en el marco');
  if (ajenas.length) fallas.push(`el marco pidió fuera de :3000: ${ajenas.slice(0, 3).join(', ')}`);
  brazo('F1', fallas.length === 0, fallas.join(' · '));
});

// ── E1 · cargando, con GET /cuentas retenido en la red ─────────────────────────────────
await correr('E1', async () => {
  const u = await usuarioCon(2, 'e1');
  const page = await paginaNueva();
  let soltar; const liberada = new Promise((r) => { soltar = r; });
  let retenida = false;
  await page.route(`${API}/cuentas`, async (route) => {
    if (esGet(route.request()) && !retenida) { retenida = true; await liberada; }
    await route.continue();
  });
  await entrarUI(page, u.email);
  const fallas = [];
  const cargando = await page.waitForSelector(`${sel('cuentas-region')}[data-estado="cargando"]`, { state: 'attached' })
    .then(() => true, () => false);
  if (!cargando) fallas.push('nunca declaró data-estado="cargando"');
  else {
    const busy = await page.getAttribute(sel('cuentas-region'), 'aria-busy');
    if (busy !== 'true') fallas.push(`cargando con aria-busy=${busy}`);
    if (!(await visible(page, 'cuentas-cargando'))) fallas.push('cuentas-cargando no visible');
    await recolectar(page);
  }
  soltar();
  const fin = await estadoTerminal(page);
  const busyFin = await page.getAttribute(sel('cuentas-region'), 'aria-busy');
  if (fin !== 'listo') fallas.push(`terminó en ${fin}`);
  if (busyFin !== 'false') fallas.push(`listo con aria-busy=${busyFin}`);
  if (await visible(page, 'cuentas-cargando')) fallas.push('cuentas-cargando sigue visible');
  brazo('E1', fallas.length === 0, fallas.join(' · '));
});

// ── E2 · vacío ─────────────────────────────────────────────────────────────────────────
await correr('E2', async () => {
  const u = await usuarioCon(0, 'e2');
  const page = await paginaNueva();
  await entrarUI(page, u.email);
  const fin = await estadoTerminal(page);
  await recolectar(page);
  const fallas = [];
  if (fin !== 'vacio') fallas.push(`data-estado=${fin}`);
  if (!(await visible(page, 'cuentas-vacio'))) fallas.push('cuentas-vacio no visible');
  if (await page.$(sel('cuentas-tabla'))) fallas.push('hay cuentas-tabla');
  brazo('E2', fallas.length === 0, fallas.join(' · '));
});

// ── E3 · listo, orden y monto ── E4 · copiar (misma página) ────────────────────────────
await correr('E3', async () => {
  const u = await usuarioCon(2, 'e3');
  const api = await cuentasApi(u.token);
  const saldos = api.map((c) => c.saldo).sort().join(',');
  if (saldos !== '0.00,1000.00') throw new Error(`preparación: saldos ${saldos}, se esperaban 0.00 y 1000.00`);
  const page = await paginaNueva({ permissions: ['clipboard-read', 'clipboard-write'] });
  globalThis.__e3 = page;
  await entrarUI(page, u.email);
  const fin = await estadoTerminal(page);
  await recolectar(page);
  const vistas = await filas(page);
  const fallas = [];
  if (fin !== 'listo') fallas.push(`data-estado=${fin}`);
  const orden = vistas.map((v) => v.id).join(' ');
  const ordenApi = api.map((c) => c.id).join(' ');
  if (orden !== ordenApi) fallas.push(`orden UI [${orden}] ≠ API [${ordenApi}]`);
  for (const c of api) {
    const v = vistas.find((x) => x.id === c.id);
    if (!v) continue;
    if (v.monto !== c.saldo) fallas.push(`data-monto «${v.monto}» ≠ saldo «${c.saldo}»`);
    // enmendado en F4a de UX-b1 (D130-1|O5)
    const corto = abreviar(c.id);
    if (v.cidAttr !== c.id) fallas.push(`cuenta-id data-cuenta-id «${v.cidAttr}» ≠ ${c.id}`);
    if (v.corto === null) fallas.push(`cuenta-id sin hijo aria-hidden (esperado «${corto}»)`);
    else if (v.corto !== corto) fallas.push(`cuenta-id aria-hidden «${v.corto}» ≠ «${corto}»`);
    if (v.largo === null) fallas.push(`cuenta-id sin hijo .sr-only (esperado «${c.id}»)`);
    else if (v.largo !== c.id) fallas.push(`cuenta-id .sr-only «${v.largo}» ≠ ${c.id}`);
  }
  brazo('E3', fallas.length === 0, fallas.join(' · '));
});

await correr('E4', async () => {
  const page = globalThis.__e3;
  if (!page) throw new Error('E3 no dejó página');
  const botones = await page.$$(sel('cuenta-copiar-id'));
  const ids = await page.$$eval(sel('cuenta-fila'), (rs) => rs.map((r) => r.getAttribute('data-cuenta-id')));
  if (botones.length < 2 || ids.length < 2) throw new Error(`hay ${botones.length} botones y ${ids.length} filas`);
  await page.evaluate(() => navigator.clipboard.writeText('arnes-vacio'));
  await botones[1].click();
  const limite = Date.now() + ESPERA_MS;
  let leido = '';
  while (Date.now() < limite) {
    leido = await page.evaluate(() => navigator.clipboard.readText());
    if (leido !== 'arnes-vacio') break;
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  }
  brazo('E4', leido === ids[1], `portapapeles «${leido}», esperado el id de la 2.ª fila ${ids[1]}`);
});

// ── E5 · error con código ── E6 · sin respuesta ────────────────────────────────────────
async function falloUnaVez(id, provocar, verificar) {
  await correr(id, async () => {
    const u = await usuarioCon(1, id.toLowerCase());
    const page = await paginaNueva();
    let hecho = false;
    await page.route(`${API}/cuentas`, async (route) => {
      if (esGet(route.request()) && !hecho) { hecho = true; return provocar(route); }
      return route.continue();
    });
    await entrarUI(page, u.email);
    const fin = await estadoTerminal(page);
    await recolectar(page);
    const fallas = [];
    if (fin !== 'error') fallas.push(`data-estado=${fin}`);
    else {
      const h = await page.$(sel('cuentas-error'));
      if (!h || !(await h.isVisible())) fallas.push('cuentas-error no visible');
      else fallas.push(...(await verificar(h)));
      await page.click(sel('cuentas-reintentar'));
      const ok = await page.waitForSelector(`${sel('cuentas-region')}[data-estado="listo"]`, { state: 'attached' })
        .then(() => true, () => false);
      if (!ok) fallas.push('cuentas-reintentar no llevó a "listo"');
    }
    brazo(id, fallas.length === 0, fallas.join(' · '));
  });
}
await falloUnaVez('E5', async (route) => {
  const real = await route.fetch();
  await route.fulfill({ response: real, status: 500, contentType: 'application/json',
    body: JSON.stringify({ codigo: 'ERROR_INTERNO', mensaje: 'Error interno del servidor', correlacionId: randomUUID() }) });
}, async (h) => {
  const c = await h.getAttribute('data-codigo');
  return c === 'ERROR_INTERNO' ? [] : [`data-codigo=${c}`];
});
await falloUnaVez('E6', (route) => route.abort('failed'), async (h) => {
  const [m, c] = [await h.getAttribute('data-motivo'), await h.getAttribute('data-codigo')];
  const f = [];
  if (m !== 'SIN_RESPUESTA') f.push(`data-motivo=${m}`);
  if (c !== null) f.push(`tiene data-codigo=${c}`);
  return f;
});

// ── S1 · token inválido ── S2 · token ausente ── S3 · el aviso se va ───────────────────
async function cierrePorToken(id, codigo, cabeceras) {
  let pagina = null;
  await correr(id, async () => {
    const u = await usuarioCon(1, id.toLowerCase());
    const page = await paginaNueva();
    let hecho = false;
    await page.route(`${API}/cuentas`, async (route) => {
      const req = route.request();
      if (esGet(req) && !hecho) { hecho = true; return route.continue({ headers: cabeceras(req.headers()) }); }
      return route.continue();
    });
    const respuesta = page.waitForResponse((r) => esGet(r.request()), { timeout: ESPERA_MS }).catch((e) => e);
    await entrarUI(page, u.email, false);
    const r = await respuesta;
    if (r instanceof Error) throw new Error(`GET /cuentas nunca respondió: ${r.message.split('\n')[0]}`);
    const cuerpo = await r.json().catch(() => ({}));
    const fallas = [];
    if (r.status() !== 401 || cuerpo.codigo !== codigo) fallas.push(`el backend respondió ${r.status()} ${cuerpo.codigo}: la preparación no provocó ${codigo}`);
    const aviso = await page.waitForSelector(sel('sesion-aviso'), { state: 'visible' }).then((h) => h, () => null);
    await recolectar(page);
    if (!aviso) fallas.push('sesion-aviso no visible');
    else {
      const [m, c] = [await aviso.getAttribute('data-motivo'), await aviso.getAttribute('data-codigo')];
      if (m !== 'token') fallas.push(`data-motivo=${m}`);
      if (c !== codigo) fallas.push(`data-codigo=${c}`);
    }
    if (await page.$(sel('usuario-email'))) fallas.push('usuario-email sigue presente');
    const { ok, foco } = await focoLlegaA(page, 'login-abrir');
    if (!ok) fallas.push(`foco en ${foco}`);
    brazo(id, fallas.length === 0, fallas.join(' · '));
    pagina = { page, email: u.email };
  });
  return pagina;
}
const trasS1 = await cierrePorToken('S1', 'TOKEN_INVALIDO', (h) => ({ ...h, authorization: 'Bearer no.es-un-token' }));
await cierrePorToken('S2', 'TOKEN_AUSENTE', (h) => { const { authorization: _a, ...resto } = h; return resto; });

await correr('S3', async () => {
  if (!trasS1) throw new Error('S1 no dejó página');
  const { page, email } = trasS1;
  await entrarUI(page, email);
  await estadoTerminal(page);
  const sigue = await visible(page, 'sesion-aviso');
  brazo('S3', !sigue, 'sesion-aviso sigue visible tras un login válido');
});

// ── N1–N5 · barra en escritorio ────────────────────────────────────────────────────────
const NEUTRO = { x: 640, y: 700 }; // dentro de la página, lejos de la barra
let escritorio = null;
await correr('N1', async () => {
  const u = await usuarioCon(1, 'n');
  const page = await paginaNueva();
  await entrarUI(page, u.email);
  await estadoTerminal(page);
  escritorio = { page, ...u };
  const fallas = [];
  if (await visible(page, 'nav-hamburguesa')) fallas.push('nav-hamburguesa visible en escritorio');
  await page.hover(sel('nav-cuentas'));
  if (!(await esperarExpandido(page, 'nav-cuentas', 'true'))) fallas.push(`aria-expanded=${await expandido(page, 'nav-cuentas')}`);
  if (!(await visible(page, 'nav-cuentas-menu'))) fallas.push('nav-cuentas-menu no visible');
  if (!(await visible(page, 'nav-resumen'))) fallas.push('nav-resumen no visible');
  await recolectar(page);
  brazo('N1', fallas.length === 0, fallas.join(' · '));
});

await correr('N2', async () => {
  if (!escritorio) throw new Error('N1 no dejó página');
  const { page } = escritorio;
  await page.hover(sel('nav-cuentas'));
  if (!(await esperarExpandido(page, 'nav-cuentas', 'true'))) throw new Error('el submenú no abrió con hover');
  await page.evaluate(([s, m]) => {
    const el = document.querySelector(s);
    const menu = document.querySelector(m);
    const w = /** @type {any} */ (window);
    w.__n2 = { ini: 0, fin: 0 };
    document.addEventListener('mouseover', (e) => {
      const t = /** @type {Node} */ (e.target);
      if (!w.__n2.ini && !el.contains(t) && !menu?.contains(t)) w.__n2.ini = performance.now();
    }, { capture: true });
    new MutationObserver(() => {
      if (el.getAttribute('aria-expanded') === 'false' && !w.__n2.fin) w.__n2.fin = performance.now();
    }).observe(el, { attributes: true, attributeFilter: ['aria-expanded'] });
  }, [sel('nav-cuentas'), sel('nav-cuentas-menu')]);
  await page.mouse.move(NEUTRO.x, NEUTRO.y);
  const cerro = await esperarExpandido(page, 'nav-cuentas', 'false');
  if (!cerro) { brazo('N2', false, 'el submenú no cerró al salir el puntero'); return; }
  const { ini, fin } = await page.evaluate(() => /** @type {any} */ (window).__n2);
  if (!ini) { brazo('N2', false, 'el navegador no despachó un mouseover fuera del menú'); return; }
  const lapso = Math.round(fin - ini);
  const oculto = !(await visible(page, 'nav-cuentas-menu'));
  brazo('N2', lapso >= CIERRE_MIN_MS && lapso <= CIERRE_MAX_MS && oculto,
    `cerró en ${lapso} ms (ventana ${CIERRE_MIN_MS}–${CIERRE_MAX_MS}) · menú oculto=${oculto}`);
});

// N3 endurecido por T3 § 5: parte desde la vista Transferir
await correr('N3', async () => {
  if (!escritorio) throw new Error('N1 no dejó página');
  const { page, token, ids } = escritorio;
  if (!(await visible(page, 'nav-transferir'))) {
    brazo('N3', false, 'nav-transferir no aparece');
    return;
  }
  await page.click(sel('nav-transferir'));
  const enTransferir = await page.waitForSelector(sel('transferir-pasos'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!enTransferir) {
    brazo('N3', false, 'transferir-pasos no visible tras clic en nav-transferir');
    return;
  }
  // k se cuenta por el API antes de abrir la nueva cuenta porque en Transferir no hay filas (§ 5.1)
  const k = (await cuentasApi(token)).length;
  const rol = await page.$eval(sel('nav-cuentas'), (e) => e.getAttribute('role') ?? (e.tagName === 'A' && e.hasAttribute('href') ? 'link' : e.tagName));
  ids.push((await abrirCuenta(token, ids[ids.length - 1])).id);
  await page.click(sel('nav-cuentas'));
  const llego = await nFilasLlegaA(page, k + 1);
  const sesion = !!(await page.$(sel('usuario-email')));
  const sinPasos = !(await visible(page, 'transferir-pasos'));
  const fallas = [];
  if (rol !== 'link') fallas.push(`nav-cuentas con rol ${rol}`);
  if (!llego) fallas.push(`las filas no pasaron de ${k} a ${k + 1} (hay ${(await filas(page)).length})`);
  if (!sesion) fallas.push('se perdió la sesión (recarga del documento)');
  if (!sinPasos) fallas.push('transferir-pasos sigue visible en Resumen');
  brazo('N3', fallas.length === 0, fallas.join(' · '));
});

await correr('N4', async () => {
  if (!escritorio) throw new Error('N1 no dejó página');
  const { page } = escritorio;
  await page.mouse.move(NEUTRO.x, NEUTRO.y);
  if (!(await esperarExpandido(page, 'nav-cuentas', 'false'))) throw new Error('el submenú no quedó cerrado antes de empezar');
  await page.focus(sel('nav-cuentas'));
  await page.keyboard.press('ArrowDown');
  const fallas = [];
  if (!(await esperarExpandido(page, 'nav-cuentas', 'true'))) fallas.push('↓ no puso aria-expanded="true"');
  if (!(await visible(page, 'nav-cuentas-menu'))) fallas.push('↓ no mostró el submenú');
  const a = await focoLlegaA(page, 'nav-resumen');
  if (!a.ok) fallas.push(`tras ↓ el foco quedó en ${a.foco}`);
  await page.keyboard.press('Escape');
  if (!(await esperarExpandido(page, 'nav-cuentas', 'false'))) fallas.push('Escape no puso aria-expanded="false"');
  if (await visible(page, 'nav-cuentas-menu')) fallas.push('Escape no ocultó el submenú');
  const b = await focoLlegaA(page, 'nav-cuentas');
  if (!b.ok) fallas.push(`tras Escape el foco quedó en ${b.foco}`);
  brazo('N4', fallas.length === 0, fallas.join(' · '));
});

await correr('N5', async () => {
  if (!escritorio) throw new Error('N1 no dejó página');
  const { page } = escritorio;
  await page.click(sel('nav-usuario'));
  const fallas = [];
  if (!(await esperarExpandido(page, 'nav-usuario', 'true'))) fallas.push(`aria-expanded=${await expandido(page, 'nav-usuario')}`);
  if (!(await visible(page, 'nav-usuario-menu'))) fallas.push('nav-usuario-menu no visible');
  if (!(await visible(page, 'salir'))) fallas.push('salir no visible');
  await recolectar(page);
  await page.keyboard.press('Escape');
  const oculto = await page.waitForSelector(sel('nav-usuario-menu'), { state: 'hidden' }).then(() => true, () => false);
  if (!oculto) fallas.push('Escape no cerró nav-usuario-menu');
  const f = await focoLlegaA(page, 'nav-usuario');
  if (!f.ok) fallas.push(`tras Escape el foco quedó en ${f.foco}`);
  brazo('N5', fallas.length === 0, fallas.join(' · '));
});

// ── N6–N7 · teléfono ───────────────────────────────────────────────────────────────────
let telefono = null;
await correr('N6', async () => {
  const u = await usuarioCon(1, 'tel');
  const page = await paginaNueva({ viewport: TELEFONO });
  await entrarUI(page, u.email);
  await estadoTerminal(page);
  telefono = { page, ...u };
  await recolectar(page);
  const fallas = [];
  if (await visible(page, 'nav-panel')) fallas.push('nav-panel visible antes de abrir');
  if (await visible(page, 'nav-cuentas')) fallas.push('nav-cuentas visible antes de abrir');
  if (!(await visible(page, 'nav-hamburguesa'))) fallas.push('nav-hamburguesa no visible');
  await page.click(sel('nav-hamburguesa'));
  if (!(await esperarExpandido(page, 'nav-hamburguesa', 'true'))) fallas.push(`aria-expanded=${await expandido(page, 'nav-hamburguesa')}`);
  for (const t of ['nav-resumen', 'usuario-email', 'salir']) {
    const v = await page.waitForSelector(sel(t), { state: 'visible' }).then(() => true, () => false);
    if (!v) fallas.push(`${t} no visible en el panel`);
  }
  await recolectar(page);
  await page.keyboard.press('Escape');
  const oculto = await page.waitForSelector(sel('nav-panel'), { state: 'hidden' }).then(() => true, () => false);
  if (!oculto) fallas.push('Escape no cerró nav-panel');
  const f = await focoLlegaA(page, 'nav-hamburguesa');
  if (!f.ok) fallas.push(`tras Escape el foco quedó en ${f.foco}`);
  brazo('N6', fallas.length === 0, fallas.join(' · '));
});

await correr('N7', async () => {
  if (!telefono) throw new Error('N6 no dejó página');
  const { page, token, ids } = telefono;
  const k = (await filas(page)).length;
  ids.push((await abrirCuenta(token, ids[ids.length - 1])).id);
  await page.click(sel('nav-hamburguesa'));
  await page.waitForSelector(sel('nav-resumen'), { state: 'visible' });
  await page.click(sel('nav-resumen'));
  const fallas = [];
  const oculto = await page.waitForSelector(sel('nav-panel'), { state: 'hidden' }).then(() => true, () => false);
  if (!oculto) fallas.push('nav-panel sigue visible tras navegar');
  if (!(await nFilasLlegaA(page, k + 1))) fallas.push(`las filas no pasaron de ${k} a ${k + 1}`);
  brazo('N7', fallas.length === 0, fallas.join(' · '));
});

// ── Helpers para brazos de T3 ──────────────────────────────────────────────────────────
async function irATransferir(page) {
  if (!(await visible(page, 'nav-transferir'))) return { ok: false, motivo: 'nav-transferir no aparece' };
  await page.click(sel('nav-transferir'));
  const pasos = await page.waitForSelector(sel('transferir-pasos'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!pasos) return { ok: false, motivo: 'transferir-pasos no visible' };
  return { ok: true, motivo: '' };
}

async function elegirOrigen(page, cuentaId) {
  // Select nativo (J8) con selectOption y espera por condición que lanza en preparación (§ 5.1)
  const vis = await page.waitForSelector(sel('transferir-origen'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!vis) throw new Error('preparación: transferir-origen no visible');
  await page.selectOption(sel('transferir-origen'), cuentaId);
}

async function elegirDestinoPropia(page, cuentaId) {
  // Select nativo (J8) con selectOption; tras cambiar de modo espera control por condición y lanza si no llega (§ 5.1)
  const modoVis = await page.waitForSelector(sel('transferir-destino-modo-propia'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!modoVis) throw new Error('preparación: transferir-destino-modo-propia no visible');
  await page.check(sel('transferir-destino-modo-propia')).catch(() => page.click(sel('transferir-destino-modo-propia')));
  const vis = await page.waitForSelector(sel('transferir-destino-propia'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!vis) throw new Error('preparación: transferir-destino-propia no visible');
  await page.selectOption(sel('transferir-destino-propia'), cuentaId);
}

async function escribirDestinoOtra(page, cuentaId) {
  // Tras cambiar de modo espera control por condición y lanza si no llega (§ 5.1)
  const modoVis = await page.waitForSelector(sel('transferir-destino-modo-otra'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!modoVis) throw new Error('preparación: transferir-destino-modo-otra no visible');
  await page.check(sel('transferir-destino-modo-otra')).catch(() => page.click(sel('transferir-destino-modo-otra')));
  const vis = await page.waitForSelector(sel('transferir-destino-id'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!vis) throw new Error('preparación: transferir-destino-id no visible');
  await page.fill(sel('transferir-destino-id'), cuentaId);
}

async function llenarAsistenteYRevisar(page, origenId, destinoId, monto = MONTO_FELIZ, modo = 'propia') {
  const nav = await irATransferir(page);
  if (!nav.ok) return nav;
  if (origenId) await elegirOrigen(page, origenId);
  if (!(await visible(page, 'transferir-origen-siguiente'))) {
    return { ok: false, motivo: 'transferir-origen-siguiente no visible' };
  }
  await page.click(sel('transferir-origen-siguiente'));
  const enDestino = await page.waitForSelector(`${sel('transferir-paso-destino')}[aria-selected="true"]`, { timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!enDestino) return { ok: false, motivo: 'no pasó a Destino' };

  if (modo === 'propia') {
    await elegirDestinoPropia(page, destinoId);
  } else {
    await escribirDestinoOtra(page, destinoId);
  }
  await page.fill(sel('transferir-monto'), monto);
  if (!(await visible(page, 'transferir-destino-siguiente'))) {
    return { ok: false, motivo: 'transferir-destino-siguiente no visible' };
  }
  await page.click(sel('transferir-destino-siguiente'));
  const enRevisar = await page.waitForSelector(`${sel('transferir-paso-revisar')}[aria-selected="true"]`, { timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!enRevisar) return { ok: false, motivo: 'no pasó a Revisar' };
  return { ok: true, motivo: '' };
}

async function focoProfundo(page) {
  return page.evaluate(() => {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    if (!el) return { testid: null, tag: null, enDialogo: false };
    const testid = el.getAttribute('data-testid') ?? null;
    const tag = el.tagName.toLowerCase();
    let curr = el;
    let enDialogo = false;
    while (curr) {
      if (curr.getAttribute && curr.getAttribute('data-testid') === 'confirmar-dialogo') {
        enDialogo = true;
        break;
      }
      curr = curr.parentElement || curr.parentNode;
      if (curr && curr.nodeType === Node.DOCUMENT_FRAGMENT_NODE && curr.host) {
        curr = curr.host;
      }
    }
    return { testid, tag, enDialogo };
  });
}

// ── V1 · nav-transferir ────────────────────────────────────────────────────────────────
await correr('V1', async () => {
  const u = await usuarioConSaldosAfirmados('v1');
  const page = await paginaNueva();
  let pidioCuentas = false;
  page.on('request', (req) => { if (esGet(req)) pidioCuentas = true; });
  await entrarUI(page, u.email);
  await estadoTerminal(page);
  if (!(await visible(page, 'nav-transferir'))) {
    brazo('V1', false, 'nav-transferir no aparece');
    return;
  }
  const rol = await page.$eval(sel('nav-transferir'), (e) => e.getAttribute('role') ?? (e.tagName === 'A' && e.hasAttribute('href') ? 'link' : e.tagName));
  const fallas = [];
  if (rol !== 'link') fallas.push(`nav-transferir con rol ${rol}`);
  pidioCuentas = false;
  await page.click(sel('nav-transferir'));
  const pasos = await page.waitForSelector(sel('transferir-pasos'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!pasos) fallas.push('transferir-pasos no visible tras clic');
  else {
    await recolectar(page);
    if (!pidioCuentas) fallas.push('no se pidió GET /cuentas al entrar a Transferir');
    if (await visible(page, 'cuentas-region')) fallas.push('cuentas-region sigue visible');
  }
  brazo('V1', fallas.length === 0, fallas.join(' · '));
});

// ── V2 · sin ir-transferir en Resumen listo; nav-transferir lleva a Transferir ──────────
await correr('V2', async () => {
  const u = await usuarioConSaldosAfirmados('v2');
  const page = await paginaNueva();
  await entrarUI(page, u.email);
  const fin = await estadoTerminal(page);
  if (fin !== 'listo') throw new Error(`preparación: data-estado=${fin}, esperado listo`);
  const fallas = [];
  // enmendado en F4a de UX-b1 (D130-1|O5)
  const ir = await page.$$(sel('ir-transferir'));
  if (ir.length !== 0) fallas.push(`hay ${ir.length} elementos ir-transferir en Resumen listo`);
  await page.click(sel('nav-transferir'));
  const pasos = await page.waitForSelector(sel('transferir-pasos'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!pasos) fallas.push('transferir-pasos no visible tras clic en nav-transferir');
  else {
    await recolectar(page);
    if (await visible(page, 'cuentas-region')) fallas.push('cuentas-region sigue visible');
  }
  brazo('V2', fallas.length === 0, fallas.join(' · '));
});

// ── V3 · panel de teléfono ─────────────────────────────────────────────────────────────
await correr('V3', async () => {
  const u = await usuarioConSaldosAfirmados('v3');
  const page = await paginaNueva({ viewport: TELEFONO });
  await entrarUI(page, u.email);
  await estadoTerminal(page);
  if (!(await visible(page, 'nav-hamburguesa'))) {
    brazo('V3', false, 'nav-hamburguesa no aparece');
    return;
  }
  await page.click(sel('nav-hamburguesa'));
  const panelVisible = await page.waitForSelector(sel('nav-panel'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!panelVisible) {
    brazo('V3', false, 'nav-panel no abrió');
    return;
  }
  if (!(await visible(page, 'nav-transferir'))) {
    brazo('V3', false, 'nav-transferir no aparece en nav-panel');
    return;
  }
  await page.click(sel('nav-transferir'));
  const fallas = [];
  const pasos = await page.waitForSelector(sel('transferir-pasos'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!pasos) fallas.push('transferir-pasos no visible tras clic');
  const panelOculto = await page.waitForSelector(sel('nav-panel'), { state: 'hidden', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!panelOculto) fallas.push('nav-panel sigue visible tras clic');
  brazo('V3', fallas.length === 0, fallas.join(' · '));
});

// ── V4 · sin cuentas ───────────────────────────────────────────────────────────────────
await correr('V4', async () => {
  const u = await usuarioCon(0, 'v4');
  const page = await paginaNueva();
  await entrarUI(page, u.email);
  const fin = await estadoTerminal(page);
  if (fin !== 'vacio') throw new Error(`preparación: data-estado=${fin}, esperado vacio`);
  if (!(await visible(page, 'nav-transferir'))) {
    brazo('V4', false, 'nav-transferir no aparece para usuario sin cuentas');
    return;
  }
  await page.click(sel('nav-transferir'));
  const sinCuentas = await page.waitForSelector(sel('transferir-sin-cuentas'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  const fallas = [];
  if (!sinCuentas) fallas.push('transferir-sin-cuentas no visible');
  else {
    await recolectar(page);
    if (await visible(page, 'transferir-pasos')) fallas.push('transferir-pasos visible con cero cuentas');
  }
  brazo('V4', fallas.length === 0, fallas.join(' · '));
});

// ── A1 · pestañas ──────────────────────────────────────────────────────────────────────
await correr('A1', async () => {
  const u = await usuarioConSaldosAfirmados('a1');
  const page = await paginaNueva();
  await entrarUI(page, u.email);
  await estadoTerminal(page);
  const nav = await irATransferir(page);
  if (!nav.ok) { brazo('A1', false, nav.motivo); return; }
  await recolectar(page);

  const fallas = [];
  const rolTablist = await page.getAttribute(sel('transferir-pasos'), 'role');
  if (rolTablist !== 'tablist') fallas.push(`transferir-pasos role=${rolTablist}`);

  const tabs = ['transferir-paso-origen', 'transferir-paso-destino', 'transferir-paso-revisar'];
  // El orden de los [role=tab] dentro de transferir-pasos debe ser origen, destino, revisar (M32, § 5.1)
  const ordenTabs = await page.$$eval(`${sel('transferir-pasos')} [role="tab"]`, (els) => els.map((e) => e.getAttribute('data-testid')));
  if (JSON.stringify(ordenTabs) !== JSON.stringify(tabs)) {
    fallas.push(`orden de [role=tab] en DOM = [${ordenTabs.join(', ')}], esperado [${tabs.join(', ')}]`);
  }
  for (const t of tabs) {
    const rol = await page.getAttribute(sel(t), 'role');
    if (rol !== 'tab') fallas.push(`${t} role=${rol}`);
  }

  const selO = await page.getAttribute(sel('transferir-paso-origen'), 'aria-selected');
  const selD = await page.getAttribute(sel('transferir-paso-destino'), 'aria-selected');
  const selR = await page.getAttribute(sel('transferir-paso-revisar'), 'aria-selected');
  const disR = await page.getAttribute(sel('transferir-paso-revisar'), 'aria-disabled');
  if (selO !== 'true') fallas.push(`Origen aria-selected=${selO}`);
  if (selD !== 'false') fallas.push(`Destino aria-selected=${selD}`);
  if (selR !== 'false') fallas.push(`Revisar aria-selected=${selR}`);
  if (disR !== 'true') fallas.push(`Revisar aria-disabled=${disR}`);

  for (const t of tabs) {
    const ctrlId = await page.getAttribute(sel(t), 'aria-controls');
    if (!ctrlId) { fallas.push(`${t} sin aria-controls`); continue; }
    const panel = await page.$(`#${ctrlId}`);
    if (!panel) { fallas.push(`panel #${ctrlId} de ${t} no existe`); continue; }
    const rolPanel = await panel.getAttribute('role');
    if (rolPanel !== 'tabpanel') fallas.push(`panel #${ctrlId} role=${rolPanel}`);
    const vis = await panel.isVisible();
    if (t === 'transferir-paso-origen' && !vis) fallas.push('panel de Origen no visible');
    if (t !== 'transferir-paso-origen' && vis) fallas.push(`panel #${ctrlId} de ${t} es visible`);
  }
  brazo('A1', fallas.length === 0, fallas.join(' · '));
});

// ── A2 · no se salta ───────────────────────────────────────────────────────────────────
await correr('A2', async () => {
  const u = await usuarioConSaldosAfirmados('a2');
  const page = await paginaNueva();
  await entrarUI(page, u.email);
  await estadoTerminal(page);
  const nav = await irATransferir(page);
  if (!nav.ok) { brazo('A2', false, nav.motivo); return; }
  if (!(await visible(page, 'transferir-origen-siguiente'))) {
    brazo('A2', false, 'transferir-origen-siguiente no visible');
    return;
  }
  await page.click(sel('transferir-origen-siguiente'));
  const enDestino = await page.waitForSelector(`${sel('transferir-paso-destino')}[aria-selected="true"]`, { timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!enDestino) { brazo('A2', false, 'no pasó a Destino'); return; }

  // Elige destino explícitamente para aislar la validación del monto (M4, § 5.1)
  await elegirDestinoPropia(page, u.ids[1]);

  const fallas = [];
  // Antes de los clics exige Revisar con aria-disabled="true" (§ 5.1)
  const disR = await page.getAttribute(sel('transferir-paso-revisar'), 'aria-disabled');
  if (disR !== 'true') fallas.push(`Revisar aria-disabled=${disR} antes de intentar avanzar`);

  const ctrlRevisar = await page.getAttribute(sel('transferir-paso-revisar'), 'aria-controls');
  // { force: true }: Playwright no hace clic sobre un elemento con
  // aria-disabled="true" (espera "enabled" hasta el tope): sin force A2 no puede evaluar la app
  // que cumpla § 4.2. Un usuario real sí entrega ese clic; lo que se mide es que no active nada.
  await page.click(sel('transferir-paso-revisar'), { force: true });
  await page.click(sel('transferir-destino-siguiente'), { force: true });

  // Tras clics llena monto y espera por condición aria-disabled="false" en Revisar sin requestAnimationFrame (§ 5.1)
  await page.fill(sel('transferir-monto'), MONTO_FELIZ);
  const habR = await page.waitForFunction(
    // Habilitada = sin aria-disabled="true" (la spec no exige el valor "false"; quitar el atributo es correcto).
    (s) => { const e = document.querySelector(s); return !!e && e.getAttribute('aria-disabled') !== 'true'; },
    sel('transferir-paso-revisar'),
    { timeout: ESPERA_MS }
  ).then(() => true, () => false);
  if (!habR) fallas.push('tras llenar monto, transferir-paso-revisar sigue con aria-disabled="true"');

  const selD = await page.getAttribute(sel('transferir-paso-destino'), 'aria-selected');
  if (selD !== 'true') fallas.push(`Destino aria-selected=${selD}`);
  if (ctrlRevisar) {
    const visR = await page.isVisible(`#${ctrlRevisar}`).catch(() => false);
    if (visR) fallas.push('panel de Revisar visible tras clics inválidos');
  }
  brazo('A2', fallas.length === 0, fallas.join(' · '));
});

// ── A3 · existe pero no se ve ──────────────────────────────────────────────────────────
await correr('A3', async () => {
  const u = await usuarioConSaldosAfirmados('a3');
  const page = await paginaNueva();
  await entrarUI(page, u.email);
  await estadoTerminal(page);
  const nav = await irATransferir(page);
  if (!nav.ok) { brazo('A3', false, nav.motivo); return; }

  await elegirOrigen(page, u.ids[1]);
  if (!(await visible(page, 'transferir-origen-siguiente'))) {
    brazo('A3', false, 'transferir-origen-siguiente no visible');
    return;
  }
  await page.click(sel('transferir-origen-siguiente'));
  const enDestino = await page.waitForSelector(`${sel('transferir-paso-destino')}[aria-selected="true"]`, { timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!enDestino) { brazo('A3', false, 'no pasó a Destino'); return; }

  // Elige destino explícitamente porque la spec no fija preselección (§ 5.1)
  await elegirDestinoPropia(page, u.ids[0]);

  await page.fill(sel('transferir-monto'), MONTO_FELIZ);
  if (!(await visible(page, 'transferir-destino-siguiente'))) {
    brazo('A3', false, 'transferir-destino-siguiente no visible');
    return;
  }
  await page.click(sel('transferir-destino-siguiente'));
  const enRevisar = await page.waitForSelector(`${sel('transferir-paso-revisar')}[aria-selected="true"]`, { timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!enRevisar) { brazo('A3', false, 'no pasó a Revisar'); return; }

  const fallas = [];
  const elOrigen = await page.$(sel('transferir-origen'));
  const elMonto = await page.$(sel('transferir-monto'));
  if (!elOrigen) fallas.push('transferir-origen no está en el DOM en Revisar');
  else if (await elOrigen.isVisible()) fallas.push('transferir-origen visible en Revisar');
  if (!elMonto) fallas.push('transferir-monto no está en el DOM en Revisar');
  else if (await elMonto.isVisible()) fallas.push('transferir-monto visible en Revisar');

  if (!(await visible(page, 'transferir-revisar-volver'))) fallas.push('transferir-revisar-volver no visible');
  else {
    await page.click(sel('transferir-revisar-volver'));
    const destVolver = await page.waitForSelector(`${sel('transferir-paso-destino')}[aria-selected="true"]`, { timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!destVolver) fallas.push('volver no llevó a Destino');
    if (!(await visible(page, 'transferir-destino-volver'))) fallas.push('transferir-destino-volver no visible');
    else {
      await page.click(sel('transferir-destino-volver'));
      const origVolver = await page.waitForSelector(`${sel('transferir-paso-origen')}[aria-selected="true"]`, { timeout: ESPERA_MS })
        .then(() => true, () => false);
      if (!origVolver) fallas.push('volver no llevó a Origen');
      else {
        const valOrigen = await page.$eval(sel('transferir-origen'), (e) => e.value);
        if (valOrigen !== u.ids[1]) fallas.push(`origen conservado «${valOrigen}» ≠ «${u.ids[1]}»`);
        await page.click(sel('transferir-origen-siguiente'));
        await page.waitForSelector(`${sel('transferir-paso-destino')}[aria-selected="true"]`, { timeout: ESPERA_MS });
        const valMonto = await page.inputValue(sel('transferir-monto'));
        if (valMonto !== MONTO_FELIZ) fallas.push(`monto conservado «${valMonto}» ≠ «${MONTO_FELIZ}»`);
      }
    }
  }
  brazo('A3', fallas.length === 0, fallas.join(' · '));
});

// ── A4 · flechas ───────────────────────────────────────────────────────────────────────
await correr('A4', async () => {
  const u = await usuarioConSaldosAfirmados('a4');
  const page = await paginaNueva();
  await entrarUI(page, u.email);
  await estadoTerminal(page);
  const nav = await irATransferir(page);
  if (!nav.ok) { brazo('A4', false, nav.motivo); return; }

  if (!(await visible(page, 'transferir-paso-origen'))) {
    brazo('A4', false, 'transferir-paso-origen no visible');
    return;
  }
  await page.focus(sel('transferir-paso-origen'));
  const fallas = [];

  // → hacia Destino
  await page.keyboard.press('ArrowRight');
  const enD = await page.waitForFunction((t) => document.activeElement?.getAttribute('data-testid') === t && document.querySelector(`[data-testid="${t}"]`)?.getAttribute('aria-selected') === 'true',
    'transferir-paso-destino', { timeout: ESPERA_MS }).then(() => true, () => false);
  if (!enD) fallas.push('primera → no activó y enfocó Destino');

  // → salta Revisar y va a Origen
  await page.keyboard.press('ArrowRight');
  const enO = await page.waitForFunction((t) => document.activeElement?.getAttribute('data-testid') === t && document.querySelector(`[data-testid="${t}"]`)?.getAttribute('aria-selected') === 'true',
    'transferir-paso-origen', { timeout: ESPERA_MS }).then(() => true, () => false);
  if (!enO) fallas.push('segunda → no saltó Revisar hacia Origen');

  // ← vuelve a Destino
  await page.keyboard.press('ArrowLeft');
  const enD2 = await page.waitForFunction((t) => document.activeElement?.getAttribute('data-testid') === t && document.querySelector(`[data-testid="${t}"]`)?.getAttribute('aria-selected') === 'true',
    'transferir-paso-destino', { timeout: ESPERA_MS }).then(() => true, () => false);
  if (!enD2) fallas.push('← no activó y enfocó Destino');

  brazo('A4', fallas.length === 0, fallas.join(' · '));
});

// ── A5 · Mis cuentas sin el origen ─────────────────────────────────────────────────────
await correr('A5', async () => {
  const u = await usuarioConSaldosAfirmados('a5');
  const page = await paginaNueva();
  await entrarUI(page, u.email);
  await estadoTerminal(page);
  const nav = await irATransferir(page);
  if (!nav.ok) { brazo('A5', false, nav.motivo); return; }

  const fallas = [];
  // Caso 1: origen = u.ids[0] (la primera)
  await elegirOrigen(page, u.ids[0]);
  if (!(await visible(page, 'transferir-origen-siguiente'))) {
    brazo('A5', false, 'transferir-origen-siguiente no visible');
    return;
  }
  await page.click(sel('transferir-origen-siguiente'));
  await page.waitForSelector(`${sel('transferir-paso-destino')}[aria-selected="true"]`, { timeout: ESPERA_MS });
  if (await visible(page, 'transferir-destino-modo-propia')) {
    await page.check(sel('transferir-destino-modo-propia')).catch(() => page.click(sel('transferir-destino-modo-propia')));
  }
  const opts1 = await page.$$eval(`${sel('transferir-destino-propia')} option`, (os) => os.map((o) => o.value));
  if (opts1.includes(u.ids[0])) fallas.push(`caso 1: transferir-destino-propia incluye el origen ${u.ids[0]}`);
  if (!opts1.includes(u.ids[1])) fallas.push(`caso 1: transferir-destino-propia no contiene la segunda cuenta ${u.ids[1]}`);

  // Caso 2: volver a Origen, elegir u.ids[1] (la segunda)
  await page.click(sel('transferir-destino-volver'));
  await page.waitForSelector(`${sel('transferir-paso-origen')}[aria-selected="true"]`, { timeout: ESPERA_MS });
  await elegirOrigen(page, u.ids[1]);
  await page.click(sel('transferir-origen-siguiente'));
  await page.waitForSelector(`${sel('transferir-paso-destino')}[aria-selected="true"]`, { timeout: ESPERA_MS });
  const opts2 = await page.$$eval(`${sel('transferir-destino-propia')} option`, (os) => os.map((o) => o.value));
  if (opts2.includes(u.ids[1])) fallas.push(`caso 2: transferir-destino-propia incluye el origen ${u.ids[1]}`);
  if (!opts2.includes(u.ids[0])) fallas.push(`caso 2: transferir-destino-propia no contiene la primera cuenta ${u.ids[0]}`);

  brazo('A5', fallas.length === 0, fallas.join(' · '));
});

// ── A6 · monto literal ─────────────────────────────────────────────────────────────────
await correr('A6', async () => {
  const u = await usuarioConSaldosAfirmados('a6');
  const page = await paginaNueva();
  await entrarUI(page, u.email);
  await estadoTerminal(page);
  const rev = await llenarAsistenteYRevisar(page, u.origenId, u.destinoId, MONTO_FELIZ);
  if (!rev.ok) { brazo('A6', false, rev.motivo); return; }

  const fallas = [];
  const elRevMonto = await page.$(sel('transferir-revisar-monto'));
  if (!elRevMonto) fallas.push('transferir-revisar-monto no existe en Revisar');
  else {
    const dataMonto = await elRevMonto.getAttribute('data-monto');
    if (dataMonto !== MONTO_FELIZ) fallas.push(`data-monto=«${dataMonto}», esperado «${MONTO_FELIZ}»`);
  }

  let postReq = null;
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url() === `${API}/transferencias`) postReq = req;
  });

  if (!(await visible(page, 'transferir-enviar'))) {
    fallas.push('transferir-enviar no visible');
  } else {
    await page.click(sel('transferir-enviar'));
    const dialogo = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!dialogo) fallas.push('confirmar-dialogo no visible');
    else {
      await page.click(sel('confirmar-aceptar'));
      const exito = await page.waitForSelector(sel('transferir-exito'), { state: 'visible', timeout: ESPERA_MS })
        .then(() => true, () => false);
      if (!exito) fallas.push('transferir-exito no visible tras confirmar');
      if (!postReq) fallas.push('cero POST /transferencias');
      else {
        const cuerpo = JSON.parse(postReq.postData() ?? '{}');
        if (cuerpo.monto !== MONTO_FELIZ) fallas.push(`cuerpo.monto=«${cuerpo.monto}» (tipo ${typeof cuerpo.monto}) ≠ «${MONTO_FELIZ}»`);
        if (cuerpo.origenId !== u.origenId) fallas.push(`cuerpo.origenId=«${cuerpo.origenId}» ≠ «${u.origenId}»`);
        if (cuerpo.destinoId !== u.destinoId) fallas.push(`cuerpo.destinoId=«${cuerpo.destinoId}» ≠ «${u.destinoId}»`);
      }
    }
  }
  brazo('A6', fallas.length === 0, fallas.join(' · '));
});

// ── D1 · modal en Shadow DOM ───────────────────────────────────────────────────────────
await correr('D1', async () => {
  const u = await usuarioConSaldosAfirmados('d1');
  const page = await paginaNueva();
  const posts = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url() === `${API}/transferencias`) posts.push(req);
  });
  await entrarUI(page, u.email);
  await estadoTerminal(page);
  const rev = await llenarAsistenteYRevisar(page, u.origenId, u.destinoId, MONTO_FELIZ);
  if (!rev.ok) { brazo('D1', false, rev.motivo); return; }

  if (!(await visible(page, 'transferir-enviar'))) {
    brazo('D1', false, 'transferir-enviar no visible');
    return;
  }
  await page.click(sel('transferir-enviar'));
  const dialogoVisible = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!dialogoVisible) {
    brazo('D1', false, 'confirmar-dialogo no visible tras clic en transferir-enviar');
    return;
  }
  await recolectar(page);

  const chequeo = await page.evaluate(() => {
    function buscarEnDOMYShadow(raiz, selector) {
      const e = raiz.querySelector(selector);
      if (e) return e;
      for (const hijo of raiz.querySelectorAll('*')) {
        if (hijo.shadowRoot) {
          const res = buscarEnDOMYShadow(hijo.shadowRoot, selector);
          if (res) return res;
        }
      }
      return null;
    }
    const dlg = buscarEnDOMYShadow(document, '[data-testid="confirmar-dialogo"]');
    if (!dlg) return { ok: false, fallas: ['confirmar-dialogo no encontrado en DOM ni ShadowRoots'] };
    const fallas = [];
    const root = dlg.getRootNode();
    const esShadow = root instanceof ShadowRoot;
    if (!esShadow) fallas.push(`getRootNode() no es ShadowRoot (es ${root.nodeName})`);
    else if (root.mode !== 'open') fallas.push(`shadowRoot mode=${root.mode}`);
    const rol = dlg.getAttribute('role');
    if (rol !== 'dialog') fallas.push(`role=${rol}`);
    const modal = dlg.getAttribute('aria-modal');
    if (modal !== 'true') fallas.push(`aria-modal=${modal}`);
    const labelledby = dlg.getAttribute('aria-labelledby');
    if (!labelledby) fallas.push('sin aria-labelledby');
    else {
      const titulo = root.getElementById ? root.getElementById(labelledby) : root.querySelector(`#${CSS.escape(labelledby)}`);
      if (!titulo) fallas.push(`aria-labelledby=«${labelledby}» no resuelve en la misma raíz`);
      else if (!titulo.textContent?.trim()) fallas.push(`elemento «${labelledby}» sin texto`);
    }

    // Confirmar-aceptar y confirmar-cancelar deben tener el mismo getRootNode() que confirmar-dialogo (M31, § 5.1)
    const btnAceptar = buscarEnDOMYShadow(document, '[data-testid="confirmar-aceptar"]');
    const btnCancelar = buscarEnDOMYShadow(document, '[data-testid="confirmar-cancelar"]');
    if (!btnAceptar) fallas.push('confirmar-aceptar no encontrado en DOM ni ShadowRoots');
    else if (btnAceptar.getRootNode() !== root) fallas.push('confirmar-aceptar no tiene el mismo getRootNode() que confirmar-dialogo');
    if (!btnCancelar) fallas.push('confirmar-cancelar no encontrado en DOM ni ShadowRoots');
    else if (btnCancelar.getRootNode() !== root) fallas.push('confirmar-cancelar no tiene el mismo getRootNode() que confirmar-dialogo');

    return { ok: fallas.length === 0, fallas };
  });

  const fallas = [...chequeo.fallas];
  if (posts.length > 0) fallas.push(`hubo ${posts.length} POST /transferencias antes de confirmar`);
  brazo('D1', fallas.length === 0, fallas.join(' · '));
});

// ── D2 · foco atrapado ─────────────────────────────────────────────────────────────────
await correr('D2', async () => {
  const u = await usuarioConSaldosAfirmados('d2');
  const page = await paginaNueva();
  await entrarUI(page, u.email);
  await estadoTerminal(page);
  const rev = await llenarAsistenteYRevisar(page, u.origenId, u.destinoId, MONTO_FELIZ);
  if (!rev.ok) { brazo('D2', false, rev.motivo); return; }

  if (!(await visible(page, 'transferir-enviar'))) {
    brazo('D2', false, 'transferir-enviar no visible');
    return;
  }
  await page.click(sel('transferir-enviar'));
  const dlg = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!dlg) {
    brazo('D2', false, 'confirmar-dialogo no visible');
    return;
  }

  const init = await page.waitForFunction(() => {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el?.getAttribute('data-testid') === 'confirmar-cancelar';
  }, { timeout: ESPERA_MS }).then(() => true, () => false);

  const fallas = [];
  if (!init) {
    const focoAct = await focoProfundo(page);
    fallas.push(`foco inicial en «${focoAct.testid ?? focoAct.tag}», esperado confirmar-cancelar`);
  }

  // Ciclo de Tab debe pasar por confirmar-aceptar y confirmar-cancelar (M28, § 5.1)
  const visitadosTab = new Set();
  for (let i = 1; i <= 6; i++) {
    await page.keyboard.press('Tab');
    const f = await focoProfundo(page);
    if (f.testid) visitadosTab.add(f.testid);
    if (!f.enDialogo) { fallas.push(`Tab paso ${i}: foco salió del diálogo a «${f.testid ?? f.tag}»`); break; }
  }
  if (!visitadosTab.has('confirmar-aceptar')) fallas.push('ciclo de Tab no pasó por confirmar-aceptar');
  if (!visitadosTab.has('confirmar-cancelar')) fallas.push('ciclo de Tab no pasó por confirmar-cancelar');
  for (let i = 1; i <= 6; i++) {
    await page.keyboard.press('Shift+Tab');
    const f = await focoProfundo(page);
    if (!f.enDialogo) { fallas.push(`Shift+Tab paso ${i}: foco salió del diálogo a «${f.testid ?? f.tag}»`); break; }
  }
  brazo('D2', fallas.length === 0, fallas.join(' · '));
});

// ── D3 · cancelar ──────────────────────────────────────────────────────────────────────
await correr('D3', async () => {
  const u = await usuarioConSaldosAfirmados('d3');
  const page = await paginaNueva();
  const posts = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url() === `${API}/transferencias`) posts.push(req);
  });
  await entrarUI(page, u.email);
  await estadoTerminal(page);
  const rev = await llenarAsistenteYRevisar(page, u.origenId, u.destinoId, MONTO_FELIZ);
  if (!rev.ok) { brazo('D3', false, rev.motivo); return; }

  const fallas = [];
  // (a) Clic en confirmar-cancelar
  if (!(await visible(page, 'transferir-enviar'))) {
    brazo('D3', false, 'transferir-enviar no visible');
    return;
  }
  await page.click(sel('transferir-enviar'));
  const dlg1 = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!dlg1) {
    brazo('D3', false, 'confirmar-dialogo no visible');
    return;
  }
  await page.click(sel('confirmar-cancelar'));
  const cerro1 = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'hidden', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!cerro1) fallas.push('(a) confirmar-cancelar no ocultó el diálogo');
  const foco1 = await focoLlegaA(page, 'transferir-enviar');
  if (!foco1.ok) fallas.push(`(a) foco tras cancelar quedó en ${foco1.foco}`);

  // (b) Escape
  await page.click(sel('transferir-enviar'));
  const dlg2 = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!dlg2) fallas.push('(b) confirmar-dialogo no volvió a abrir');
  else {
    await page.keyboard.press('Escape');
    const cerro2 = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'hidden', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!cerro2) fallas.push('(b) Escape no cerró el diálogo');
    const foco2 = await focoLlegaA(page, 'transferir-enviar');
    if (!foco2.ok) fallas.push(`(b) foco tras Escape quedó en ${foco2.foco}`);
  }

  if (posts.length > 0) fallas.push(`hubo ${posts.length} POST tras cancelar`);
  brazo('D3', fallas.length === 0, fallas.join(' · '));
});

// ── T1 · éxito ─────────────────────────────────────────────────────────────────────────
await correr('T1', async () => {
  const u = await usuarioConSaldosAfirmados('t1');
  const page = await paginaNueva();
  const posts = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url() === `${API}/transferencias`) posts.push(req);
  });
  await entrarUI(page, u.email);
  await estadoTerminal(page);
  const rev = await llenarAsistenteYRevisar(page, u.origenId, u.destinoId, MONTO_FELIZ);
  if (!rev.ok) { brazo('T1', false, rev.motivo); return; }

  if (!(await visible(page, 'transferir-enviar'))) {
    brazo('T1', false, 'transferir-enviar no visible');
    return;
  }
  await page.click(sel('transferir-enviar'));
  const dlg = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!dlg) { brazo('T1', false, 'confirmar-dialogo no visible'); return; }

  const respPromesa = page.waitForResponse((r) => r.request().method() === 'POST' && r.url() === `${API}/transferencias`, { timeout: ESPERA_MS })
    .catch((e) => e);
  await page.click(sel('confirmar-aceptar'));
  const resp = await respPromesa;
  if (resp instanceof Error) {
    brazo('T1', false, `POST /transferencias no respondió: ${resp.message.split('\n')[0]}`);
    return;
  }
  const exito = await page.waitForSelector(sel('transferir-exito'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!exito) {
    brazo('T1', false, 'transferir-exito no visible tras confirmar');
    return;
  }
  await recolectar(page);

  const fallas = [];
  if (resp.status() !== 201) fallas.push(`POST status=${resp.status()}`);
  const cuerpoResp = await resp.json().catch(() => ({}));
  const txIdResp = cuerpoResp.transaccionId;
  const clave = posts[0]?.headers()['idempotency-key'];
  // La Idempotency-Key debe cumplir formato UUID (M34, § 5.1)
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!clave) fallas.push('Idempotency-Key vacía o ausente en el POST');
  else if (!UUID_REGEX.test(clave)) fallas.push(`Idempotency-Key «${clave}» no cumple formato UUID`);
  const textoTx = (await page.textContent(sel('transferir-transaccion-id')))?.trim();
  if (textoTx !== txIdResp) fallas.push(`transferir-transaccion-id «${textoTx}» ≠ «${txIdResp}»`);
  if (await visible(page, 'transferir-repetida')) fallas.push('transferir-repetida visible en primer envío');

  // transferir-exito con role="status" (M33, § 5.1)
  const rolExito = await page.getAttribute(sel('transferir-exito'), 'role');
  if (rolExito !== 'status') fallas.push(`transferir-exito role=«${rolExito}», esperado «status»`);

  const cuentasFin = await cuentasApi(u.token);
  const oFin = cuentasFin.find((c) => c.id === u.origenId)?.saldo;
  const dFin = cuentasFin.find((c) => c.id === u.destinoId)?.saldo;
  if (oFin !== '749.90') fallas.push(`saldo origen API = «${oFin}», esperado 749.90`);
  if (dFin !== '250.10') fallas.push(`saldo destino API = «${dFin}», esperado 250.10`);
  brazo('T1', fallas.length === 0, fallas.join(' · '));
});

// ── T2 · doble clic ────────────────────────────────────────────────────────────────────
await correr('T2', async () => {
  const u = await usuarioConSaldosAfirmados('t2');
  const page = await paginaNueva();
  const posts = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url() === `${API}/transferencias`) posts.push(req);
  });
  await entrarUI(page, u.email);
  await estadoTerminal(page);
  const rev = await llenarAsistenteYRevisar(page, u.origenId, u.destinoId, MONTO_FELIZ);
  if (!rev.ok) { brazo('T2', false, rev.motivo); return; }

  if (!(await visible(page, 'transferir-enviar'))) {
    brazo('T2', false, 'transferir-enviar no visible');
    return;
  }
  await page.click(sel('transferir-enviar'));
  const dlg = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!dlg) { brazo('T2', false, 'confirmar-dialogo no visible'); return; }

  // Dos click() sincrónicos atravesando shadow root abierto dentro de la página (M16, § 5.1)
  await page.evaluate(() => {
    function buscarEnDOMYShadow(raiz, selector) {
      const e = raiz.querySelector(selector);
      if (e) return e;
      for (const hijo of raiz.querySelectorAll('*')) {
        if (hijo.shadowRoot) {
          const res = buscarEnDOMYShadow(hijo.shadowRoot, selector);
          if (res) return res;
        }
      }
      return null;
    }
    const btn = buscarEnDOMYShadow(document, '[data-testid="confirmar-aceptar"]');
    if (!btn) throw new Error('confirmar-aceptar no encontrado para doble clic');
    btn.click();
    btn.click();
  });
  const exito = await page.waitForSelector(sel('transferir-exito'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!exito) { brazo('T2', false, 'transferir-exito no visible tras doble clic'); return; }

  const fallas = [];
  const claves = posts.map((p) => p.headers()['idempotency-key']);
  const clavesUnicas = new Set(claves);
  if (clavesUnicas.size > 1) fallas.push(`doble clic generó claves distintas: [${claves.join(', ')}]`);
  const cuentasFin = await cuentasApi(u.token);
  const oFin = cuentasFin.find((c) => c.id === u.origenId)?.saldo;
  if (oFin !== '749.90') fallas.push(`saldo origen API = «${oFin}», esperado 749.90 (baja una sola vez)`);
  brazo('T2', fallas.length === 0, fallas.join(' · '));
});

// ── T3 · clave nueva por operación ─────────────────────────────────────────────────────
await correr('T3', async () => {
  const u = await usuarioConSaldosAfirmados('t3');
  const page = await paginaNueva();
  const posts = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url() === `${API}/transferencias`) posts.push(req);
  });
  await entrarUI(page, u.email);
  await estadoTerminal(page);

  const rev1 = await llenarAsistenteYRevisar(page, u.origenId, u.destinoId, '100.00');
  if (!rev1.ok) { brazo('T3', false, rev1.motivo); return; }
  await page.click(sel('transferir-enviar'));
  await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS });
  await page.click(sel('confirmar-aceptar'));
  const exito1 = await page.waitForSelector(sel('transferir-exito'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!exito1) { brazo('T3', false, 'primer envío no llegó a transferir-exito'); return; }

  if (!(await visible(page, 'transferir-nueva'))) {
    brazo('T3', false, 'transferir-nueva no visible');
    return;
  }
  await page.click(sel('transferir-nueva'));
  const enOrigen = await page.waitForSelector(`${sel('transferir-paso-origen')}[aria-selected="true"]`, { timeout: ESPERA_MS })
    .then(() => true, () => false);
  const fallas = [];
  if (!enOrigen) fallas.push('transferir-nueva no devolvió a Origen aria-selected="true"');

  await page.click(sel('transferir-origen-siguiente'));
  await page.waitForSelector(`${sel('transferir-paso-destino')}[aria-selected="true"]`, { timeout: ESPERA_MS });

  // Tras transferir-nueva el monto debe estar vacío antes de volver a escribirlo (M27, § 5.1)
  const montoVacio = await page.inputValue(sel('transferir-monto')).catch(() => null);
  if (montoVacio !== '') fallas.push(`monto tras transferir-nueva = «${montoVacio}», esperado vacío`);

  // Elige destino explícitamente en el segundo envío (§ 5.1)
  await elegirDestinoPropia(page, u.ids[1]);

  await page.fill(sel('transferir-monto'), '100.00');
  await page.click(sel('transferir-destino-siguiente'));
  await page.waitForSelector(`${sel('transferir-paso-revisar')}[aria-selected="true"]`, { timeout: ESPERA_MS });
  await page.click(sel('transferir-enviar'));
  await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS });
  await page.click(sel('confirmar-aceptar'));
  const exito2 = await page.waitForSelector(sel('transferir-exito'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!exito2) fallas.push('segundo envío no llegó a transferir-exito');

  const clave1 = posts[0]?.headers()['idempotency-key'];
  const clave2 = posts[1]?.headers()['idempotency-key'];
  if (!clave1 || !clave2) fallas.push(`claves no capturadas: clave1=${clave1} clave2=${clave2}`);
  else if (clave1 === clave2) fallas.push(`ambos envíos llevaron la misma clave «${clave1}»`);
  brazo('T3', fallas.length === 0, fallas.join(' · '));
});

// ── T4 · rechazo con código ────────────────────────────────────────────────────────────
await correr('T4', async () => {
  const u = await usuarioConSaldosAfirmados('t4');
  const page = await paginaNueva();
  await entrarUI(page, u.email);
  await estadoTerminal(page);
  const rev = await llenarAsistenteYRevisar(page, u.origenId, u.destinoId, MONTO_EXCEDE);
  if (!rev.ok) { brazo('T4', false, rev.motivo); return; }

  if (!(await visible(page, 'transferir-enviar'))) {
    brazo('T4', false, 'transferir-enviar no visible');
    return;
  }
  await page.click(sel('transferir-enviar'));
  const dlg = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!dlg) { brazo('T4', false, 'confirmar-dialogo no visible'); return; }

  await page.click(sel('confirmar-aceptar'));
  const err = await page.waitForSelector(`${sel('transferir-error')}[data-codigo="FONDOS_INSUFICIENTES"]`, { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  const fallas = [];
  if (!err) fallas.push('transferir-error[data-codigo="FONDOS_INSUFICIENTES"] no visible');
  else await recolectar(page);

  const selR = await page.getAttribute(sel('transferir-paso-revisar'), 'aria-selected');
  if (selR !== 'true') fallas.push(`Revisar aria-selected=${selR} tras rechazo`);
  const estadoForm = await page.getAttribute(sel('transferir-form'), 'data-estado');
  if (estadoForm !== 'error') fallas.push(`data-estado=${estadoForm}, esperado error`);

  const cuentasFin = await cuentasApi(u.token);
  const oFin = cuentasFin.find((c) => c.id === u.origenId)?.saldo;
  if (oFin !== '1000.00') fallas.push(`saldo origen API cambió a «${oFin}»`);
  brazo('T4', fallas.length === 0, fallas.join(' · '));
});

// ── T5 · validación con código ─────────────────────────────────────────────────────────
await correr('T5', async () => {
  const u = await usuarioConSaldosAfirmados('t5');
  const fallas = [];

  const casos = [
    { num: 1, modo: 'propia', destino: u.destinoId, monto: MONTO_COMA, recolectar: false, esperado: 'MONTO_INVALIDO' },
    { num: 2, modo: 'otra', destino: u.origenId, monto: MONTO_FELIZ, recolectar: true, esperado: 'MISMA_CUENTA' },
    { num: 3, modo: 'otra', destino: ID_INEXISTENTE, monto: MONTO_FELIZ, recolectar: false, esperado: 'CUENTA_NO_ENCONTRADA' },
  ];

  for (const c of casos) {
    // Cada uno de los tres casos en una página nueva para independencia de pantalla (§ 5.1)
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    await estadoTerminal(page);

    const cOk = await llenarAsistenteYRevisar(page, u.origenId, c.destino, c.monto, c.modo);
    if (!cOk.ok) {
      await page.context().close();
      if (c.num === 1) { brazo('T5', false, cOk.motivo); return; }
      fallas.push(`caso ${c.num}: ${cOk.motivo}`);
      continue;
    }

    if (c.recolectar) {
      // Con «Otras cuentas» activo recolecta para que R1 vea transferir-destino-id (§ 5.1)
      await recolectar(page);
    }

    if (!(await visible(page, 'transferir-enviar'))) {
      fallas.push(`caso ${c.num}: transferir-enviar no visible`);
      await page.context().close();
      continue;
    }
    await page.click(sel('transferir-enviar'));
    const dlg = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!dlg) {
      fallas.push(`caso ${c.num}: confirmar-dialogo no visible`);
      await page.context().close();
      continue;
    }

    // Captura POST y exige que transferir-error[data-codigo] sea igual al código de la respuesta real (M30, § 5.1)
    const respPromesa = page.waitForResponse((r) => r.request().method() === 'POST' && r.url() === `${API}/transferencias`, { timeout: ESPERA_MS })
      .catch((e) => e);
    await page.click(sel('confirmar-aceptar'));
    const resp = await respPromesa;

    if (resp instanceof Error) {
      fallas.push(`caso ${c.num}: POST /transferencias no respondió (${resp.message.split('\n')[0]})`);
    } else {
      const cuerpoResp = await resp.json().catch(() => ({}));
      const codApi = cuerpoResp.codigo;
      if (!codApi) {
        fallas.push(`caso ${c.num}: respuesta del API sin código (${resp.status()})`);
      } else if (codApi !== c.esperado) {
        // Se comprueba el código esperado de cada caso contra el API.
        fallas.push(`caso ${c.num}: el API respondió «${codApi}», esperado «${c.esperado}»`);
      } else {
        const errEl = await page.waitForSelector(`${sel('transferir-error')}[data-codigo="${codApi}"]`, { state: 'visible', timeout: ESPERA_MS })
          .then(() => true, () => false);
        if (!errEl) {
          const codVisto = await page.getAttribute(sel('transferir-error'), 'data-codigo').catch(() => null);
          fallas.push(`caso ${c.num}: transferir-error data-codigo=«${codVisto}», esperado «${codApi}»`);
        }
      }
    }
    await page.context().close();
  }

  brazo('T5', fallas.length === 0, fallas.join(' · '));
});

// ── T6 · sin respuesta, ejecutada ──────────────────────────────────────────────────────
await correr('T6', async () => {
  const u = await usuarioConSaldosAfirmados('t6');
  const page = await paginaNueva();
  let intentos = 0;
  const claves = [];
  await page.route(`${API}/transferencias`, async (route) => {
    if (route.request().method() === 'POST') {
      intentos++;
      claves.push(route.request().headers()['idempotency-key']);
      if (intentos === 1) {
        await route.fetch(); // backend recibe y ejecuta
        return route.abort('failed'); // browser pierde la respuesta
      }
    }
    return route.continue();
  });
  await entrarUI(page, u.email);
  await estadoTerminal(page);
  const rev = await llenarAsistenteYRevisar(page, u.origenId, u.destinoId, MONTO_FELIZ);
  if (!rev.ok) { brazo('T6', false, rev.motivo); return; }

  if (!(await visible(page, 'transferir-enviar'))) {
    brazo('T6', false, 'transferir-enviar no visible');
    return;
  }
  await page.click(sel('transferir-enviar'));
  const dlg = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!dlg) { brazo('T6', false, 'confirmar-dialogo no visible'); return; }

  await page.click(sel('confirmar-aceptar'));
  const sinResp = await page.waitForSelector(sel('transferir-sin-respuesta'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!sinResp) { brazo('T6', false, 'transferir-sin-respuesta no visible'); return; }
  await recolectar(page);

  const fallas = [];
  if (await visible(page, 'transferir-error')) fallas.push('transferir-error visible en fallo de red');
  if (!(await visible(page, 'transferir-reintentar'))) fallas.push('transferir-reintentar no visible');
  else {
    await page.click(sel('transferir-reintentar'));
    const exito = await page.waitForSelector(sel('transferir-exito'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!exito) fallas.push('transferir-exito no visible tras reintentar');
    else {
      await recolectar(page);
      if (!(await visible(page, 'transferir-repetida'))) fallas.push('transferir-repetida no visible tras reintento de ejecutada');
      if (claves.length < 2 || claves[0] !== claves[1]) fallas.push(`reintentar cambió clave: [${claves.join(', ')}]`);
      const cuentasFin = await cuentasApi(u.token);
      const oFin = cuentasFin.find((c) => c.id === u.origenId)?.saldo;
      if (oFin !== '749.90') fallas.push(`saldo origen API = «${oFin}», esperado 749.90 (baja una sola vez)`);
    }
  }
  brazo('T6', fallas.length === 0, fallas.join(' · '));
});

// ── T7 · sin respuesta, no ejecutada ───────────────────────────────────────────────────
await correr('T7', async () => {
  const u = await usuarioConSaldosAfirmados('t7');
  const page = await paginaNueva();
  let intentos = 0;
  const claves = [];
  await page.route(`${API}/transferencias`, async (route) => {
    if (route.request().method() === 'POST') {
      intentos++;
      claves.push(route.request().headers()['idempotency-key']);
      if (intentos === 1) {
        return route.abort('failed'); // abortado antes de llegar al backend
      }
    }
    return route.continue();
  });
  await entrarUI(page, u.email);
  await estadoTerminal(page);
  const rev = await llenarAsistenteYRevisar(page, u.origenId, u.destinoId, MONTO_FELIZ);
  if (!rev.ok) { brazo('T7', false, rev.motivo); return; }

  if (!(await visible(page, 'transferir-enviar'))) {
    brazo('T7', false, 'transferir-enviar no visible');
    return;
  }
  await page.click(sel('transferir-enviar'));
  const dlg = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!dlg) { brazo('T7', false, 'confirmar-dialogo no visible'); return; }

  await page.click(sel('confirmar-aceptar'));
  const sinResp = await page.waitForSelector(sel('transferir-sin-respuesta'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!sinResp) { brazo('T7', false, 'transferir-sin-respuesta no visible'); return; }

  const fallas = [];
  if (!(await visible(page, 'transferir-reintentar'))) fallas.push('transferir-reintentar no visible');
  else {
    await page.click(sel('transferir-reintentar'));
    const exito = await page.waitForSelector(sel('transferir-exito'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!exito) fallas.push('transferir-exito no visible tras reintentar');
    else {
      if (await visible(page, 'transferir-repetida')) fallas.push('transferir-repetida visible tras primera ejecución real');
      if (claves.length < 2 || claves[0] !== claves[1]) fallas.push(`reintentar cambió clave: [${claves.join(', ')}]`);
      const cuentasFin = await cuentasApi(u.token);
      const oFin = cuentasFin.find((c) => c.id === u.origenId)?.saldo;
      if (oFin !== '749.90') fallas.push(`saldo origen API = «${oFin}», esperado 749.90`);
    }
  }
  brazo('T7', fallas.length === 0, fallas.join(' · '));
});

// ── T8 · token en el POST ──────────────────────────────────────────────────────────────
await correr('T8', async () => {
  const u = await usuarioConSaldosAfirmados('t8');
  const page = await paginaNueva();
  await page.route(`${API}/transferencias`, async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const { authorization: _a, ...resto } = req.headers();
      return route.continue({ headers: resto });
    }
    return route.continue();
  });
  await entrarUI(page, u.email);
  await estadoTerminal(page);
  const rev = await llenarAsistenteYRevisar(page, u.origenId, u.destinoId, MONTO_FELIZ);
  if (!rev.ok) { brazo('T8', false, rev.motivo); return; }

  if (!(await visible(page, 'transferir-enviar'))) {
    brazo('T8', false, 'transferir-enviar no visible');
    return;
  }
  await page.click(sel('transferir-enviar'));
  const dlg = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!dlg) { brazo('T8', false, 'confirmar-dialogo no visible'); return; }

  await page.click(sel('confirmar-aceptar'));
  const aviso = await page.waitForSelector(sel('sesion-aviso'), { state: 'visible', timeout: ESPERA_MS })
    .then((h) => h, () => null);
  const fallas = [];
  if (!aviso) fallas.push('sesion-aviso no visible tras 401 en POST');
  else {
    const [m, c] = [await aviso.getAttribute('data-motivo'), await aviso.getAttribute('data-codigo')];
    if (m !== 'token') fallas.push(`data-motivo=${m}`);
    if (c !== 'TOKEN_AUSENTE') fallas.push(`data-codigo=${c}`);
  }
  if (await page.$(sel('usuario-email'))) fallas.push('usuario-email sigue presente');
  if (await visible(page, 'transferir-error')) fallas.push('401 cayó en transferir-error');
  brazo('T8', fallas.length === 0, fallas.join(' · '));
});

// ── T9 · enviando ──────────────────────────────────────────────────────────────────────
await correr('T9', async () => {
  const u = await usuarioConSaldosAfirmados('t9');
  const page = await paginaNueva();
  let soltarPost;
  const postRetenido = new Promise((r) => { soltarPost = r; });
  let resolverPostLlego;
  const promPostLlego = new Promise((r) => { resolverPostLlego = r; });
  await page.route(`${API}/transferencias`, async (route) => {
    if (route.request().method() === 'POST') {
      resolverPostLlego?.();
      await postRetenido;
    }
    return route.continue();
  });
  await entrarUI(page, u.email);
  await estadoTerminal(page);
  const rev = await llenarAsistenteYRevisar(page, u.origenId, u.destinoId, MONTO_FELIZ);
  if (!rev.ok) {
    soltarPost?.();
    brazo('T9', false, rev.motivo);
    return;
  }

  if (!(await visible(page, 'transferir-enviar'))) {
    soltarPost?.();
    brazo('T9', false, 'transferir-enviar no visible');
    return;
  }
  await page.click(sel('transferir-enviar'));
  const dlg = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!dlg) {
    soltarPost?.();
    brazo('T9', false, 'confirmar-dialogo no visible');
    return;
  }

  let timerLlego;
  await page.click(sel('confirmar-aceptar'));
  const postLlego = await Promise.race([
    promPostLlego.then(() => true),
    new Promise((_, rej) => { timerLlego = setTimeout(() => rej(new Error('timeout')), ESPERA_MS); }),
  ]).catch(() => false).finally(() => clearTimeout(timerLlego));

  if (!postLlego) {
    soltarPost?.();
    brazo('T9', false, 'POST /transferencias no se emitió tras confirmar');
    return;
  }

  const fallas = [];
  // Con el POST retenido verifica data-estado="enviando", aria-busy="true" y botón deshabilitado (M29, § 5.1)
  const estadoForm = await page.getAttribute(sel('transferir-form'), 'data-estado');
  if (estadoForm !== 'enviando') fallas.push(`data-estado=«${estadoForm}», esperado «enviando»`);
  const busy = await page.getAttribute(sel('transferir-form'), 'aria-busy');
  if (busy !== 'true') fallas.push(`aria-busy=«${busy}», esperado «true»`);

  const btnEnviar = await page.$(sel('transferir-enviar'));
  if (!btnEnviar) {
    fallas.push('transferir-enviar no está en el DOM durante envío');
  } else {
    const disabledProp = await btnEnviar.isDisabled().catch(() => false);
    const ariaDisabled = await btnEnviar.getAttribute('aria-disabled');
    if (!disabledProp && ariaDisabled !== 'true') {
      fallas.push(`transferir-enviar no está deshabilitado (disabled=${disabledProp}, aria-disabled=«${ariaDisabled}»)`);
    }
  }

  soltarPost?.();
  const exito = await page.waitForSelector(sel('transferir-exito'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!exito) fallas.push('transferir-exito no visible tras liberar el POST');

  brazo('T9', fallas.length === 0, fallas.join(' · '));
});

// ── P1 · comprobante ───────────────────────────────────────────────────────────────────
await correr('P1', async () => {
  const u = await usuarioConSaldosAfirmados('p1');
  const page = await paginaNueva();
  await entrarUI(page, u.email);
  await estadoTerminal(page);
  const rev = await llenarAsistenteYRevisar(page, u.origenId, u.destinoId, MONTO_FELIZ);
  if (!rev.ok) { brazo('P1', false, rev.motivo); return; }

  if (!(await visible(page, 'transferir-enviar'))) {
    brazo('P1', false, 'transferir-enviar no visible');
    return;
  }
  await page.click(sel('transferir-enviar'));
  await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS });
  await page.click(sel('confirmar-aceptar'));
  const exito = await page.waitForSelector(sel('transferir-exito'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!exito) { brazo('P1', false, 'transferir-exito no visible'); return; }

  const txId = (await page.textContent(sel('transferir-transaccion-id')))?.trim();
  if (!txId) { brazo('P1', false, 'transferir-transaccion-id vacío'); return; }

  if (!(await visible(page, 'transferir-comprobante-pdf'))) {
    brazo('P1', false, 'transferir-comprobante-pdf no visible');
    return;
  }
  await recolectar(page);

  let resolverPeticion;
  let timerReq;
  const promPeticionPdf = new Promise((r) => { resolverPeticion = r; });
  let soltarPdf;
  const pdfRetenido = new Promise((r) => { soltarPdf = r; });
  let peticionPdf = null;
  await page.route(`**/transferencias/${txId}/comprobante.pdf`, async (route) => {
    peticionPdf = route.request();
    resolverPeticion?.(peticionPdf);
    await pdfRetenido;
    await route.continue();
  });

  const promNuevaPagina = page.context().waitForEvent('page', { timeout: ESPERA_MS }).catch((e) => e);
  await page.click(sel('transferir-comprobante-pdf'));
  const nuevaPagina = await promNuevaPagina;
  if (nuevaPagina instanceof Error) {
    soltarPdf?.();
    brazo('P1', false, `no se abrió la nueva pestaña antes del fetch: ${nuevaPagina.message.split('\n')[0]}`);
    return;
  }

  // Espera la petición del PDF por condición con tope ESPERA_MS con el PDF aún retenido (§ 5.1)
  await Promise.race([
    promPeticionPdf,
    new Promise((_, rej) => { timerReq = setTimeout(() => rej(new Error('timeout')), ESPERA_MS); }),
  ]).catch(() => null).finally(() => clearTimeout(timerReq));

  const fallas = [];
  if (!peticionPdf) fallas.push('no se interceptó GET .../comprobante.pdf');
  else {
    const authH = String(peticionPdf.headers()['authorization'] ?? '');
    if (!authH.startsWith('Bearer ')) fallas.push(`Authorization no es Bearer: «${authH}»`);
    if (!peticionPdf.url().includes(`/transferencias/${txId}/comprobante.pdf`)) {
      fallas.push(`URL sin transaccionId: «${peticionPdf.url()}»`);
    }
  }

  const promDescarga = nuevaPagina.waitForEvent('download', { timeout: ESPERA_MS }).catch((e) => e);
  soltarPdf();
  const descarga = await promDescarga;
  if (descarga instanceof Error) {
    fallas.push(`descarga no emitida: ${descarga.message.split('\n')[0]}`);
  } else {
    const dUrl = descarga.url();
    if (!dUrl.startsWith('blob:http://localhost:4200/')) {
      fallas.push(`URL de descarga «${dUrl}» no empieza con blob:http://localhost:4200/`);
    }
    const ruta = await descarga.path().catch(() => null);
    if (!ruta) fallas.push('descarga.path() no disponible');
    else {
      const bytes = readFileSync(ruta);
      const magico = bytes.subarray(0, 5).toString('latin1');
      if (magico !== '%PDF-') fallas.push(`archivo descargado empieza con «${magico}», esperado %PDF-`);
      const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true });
      if (!text.includes(txId)) fallas.push(`texto del PDF no contiene transaccionId «${txId}»`);
    }
  }

  if (!(await visible(page, 'transferir-exito'))) fallas.push('la página de la app navegó fuera de transferir-exito');
  brazo('P1', fallas.length === 0, fallas.join(' · '));
});

// ── P2 · comprobante que falla ─────────────────────────────────────────────────────────
await correr('P2', async () => {
  const u = await usuarioConSaldosAfirmados('p2');
  const page = await paginaNueva();
  await entrarUI(page, u.email);
  await estadoTerminal(page);
  const rev = await llenarAsistenteYRevisar(page, u.origenId, u.destinoId, MONTO_FELIZ);
  if (!rev.ok) { brazo('P2', false, rev.motivo); return; }

  if (!(await visible(page, 'transferir-enviar'))) {
    brazo('P2', false, 'transferir-enviar no visible');
    return;
  }
  await page.click(sel('transferir-enviar'));
  await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS });
  await page.click(sel('confirmar-aceptar'));
  const exito = await page.waitForSelector(sel('transferir-exito'), { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!exito) { brazo('P2', false, 'transferir-exito no visible'); return; }

  const txId = (await page.textContent(sel('transferir-transaccion-id')))?.trim();
  if (!txId) { brazo('P2', false, 'transferir-transaccion-id vacío'); return; }

  if (!(await visible(page, 'transferir-comprobante-pdf'))) {
    brazo('P2', false, 'transferir-comprobante-pdf no visible');
    return;
  }

  await page.route(`**/transferencias/${txId}/comprobante.pdf`, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ codigo: 'ERROR_PDF', mensaje: 'Fallo simulado' }),
    });
  });

  const promNuevaPagina = page.context().waitForEvent('page', { timeout: ESPERA_MS }).catch((e) => e);
  await page.click(sel('transferir-comprobante-pdf'));
  const nuevaPagina = await promNuevaPagina;
  if (nuevaPagina instanceof Error) {
    brazo('P2', false, `no se abrió pestaña: ${nuevaPagina.message.split('\n')[0]}`);
    return;
  }

  const cerro = await nuevaPagina.waitForEvent('close', { timeout: ESPERA_MS })
    .then(() => true, () => nuevaPagina.isClosed());
  const fallas = [];
  if (!cerro) fallas.push('la pestaña nueva no se cerró tras error 500');

  const alerta = await page.waitForSelector(`${sel('transferir-exito')} [role="alert"]`, { state: 'visible', timeout: ESPERA_MS })
    .then(() => true, () => false);
  if (!alerta) fallas.push('no apareció role="alert" dentro de transferir-exito');

  brazo('P2', fallas.length === 0, fallas.join(' · '));
});

// ── R1 · testids sobre la unión de todo el recorrido (va al final a propósito) ─────────
await correr('R1', async () => {
  const faltan = LISTA.filter((t) => !vistos.has(t));
  const sobran = [...vistos].filter((t) => !LISTA.includes(t) && !UNION_POSTERIORES.has(t));
  brazo('R1', faltan.length === 0 && sobran.length === 0 && repetidos.size === 0,
    `faltan [${faltan.join(', ')}] · sobran [${sobran.join(', ')}] · repetidos [${[...repetidos].join(', ')}] (lista de ${LISTA.length})`);
});

await navegador.close();
const verdes = resultados.filter((r) => r.ok).length;
const rojos = resultados.filter((r) => !r.ok).map((r) => r.id);
console.log(`\nverificar:s10-t3 → ${verdes}/${resultados.length} brazos verdes${rojos.length ? ` · rojos: ${rojos.join(' ')}` : ''}`);
process.exit(rojos.length === 0 && resultados.length === BRAZOS_TOTAL ? 0 : 1);
