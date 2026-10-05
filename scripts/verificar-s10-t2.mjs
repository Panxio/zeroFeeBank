// Árbitro de S-10 · T2 (specs/S-10-T2-barra-resumen.md § 5). Corre contra el ARTEFACTO servido:
// el backend (`node dist/main.js`) en :3000 y el build de producción de web/ en :4200.
// Lo levanta scripts/verificar-s10-t2.sh; este archivo sólo mira. No importa código de la app.
// Contiene los brazos de T1 (B1, B2, R2–R11, con R1 y R10 cambiados por § 5 de T2) y los de T2.
//
// Salida: una línea por brazo (OK | ROJO: motivo) y un resumen «N/M». Exit 0 sólo con todo verde.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const API = 'http://localhost:3000';
const APP = 'http://localhost:4200';
const HOSTS_PERMITIDOS = new Set(['localhost:3000', 'localhost:4200']);
const ESPERA_MS = 8000; // tope de cada espera por CONDICIÓN (no es un sleep): un rojo, no un cuelgue
const CLAVE = 'Clave-Arnes-2026';
const ESCRITORIO = { width: 1280, height: 800 }; // § 2
const TELEFONO = { width: 390, height: 844 };    // § 2
const CIERRE_MIN_MS = 280;  // § 2: ventana aceptada para el cierre diferido de 300 ms
const CIERRE_MAX_MS = 1500;
const BRAZOS_TOTAL = 31;    // 13 de T1 + 18 de T2

const LISTA = readFileSync(new URL('../specs/S-10-testids-T2.txt', import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
// `cuenta-tipo` entra por enmienda: es la casuística DE_FILA que T4 y boletas
// ya contemplan en su propio DE_FILA. Se pinta
// una vez por fila de cuenta, así que verlo repetido es lo correcto, no un defecto.
const DE_FILA = new Set(['cuenta-fila', 'cuenta-id', 'cuenta-copiar-id', 'cuenta-saldo', 'cuenta-tipo']);
// Enmienda E2 de specs/S-17-movimientos.md § 5.1.
// OJO: T2 usa UNA sola LISTA para `faltan` y para `sobran`, así que sumarle acá los testids de las
// unidades posteriores le exigiría montar pantallas que T2 no visita nunca y la dejaría roja para
// siempre. Por eso van listas APARTE que eximen SÓLO a `sobran` — que es exactamente lo que
// verificar-s10-t4.mjs:3284 ya hacía con sus cinco listas y T2/T3 nunca recibieron.
// Lo que FALTA se sigue midiendo contra LISTA, y un testid que no esté en NINGUNA lista sigue
// poniendo R1 rojo: no se relaja ninguna aserción, se actualiza el contrato versionado (C3).
const leerLista = (n) => readFileSync(new URL(`../specs/${n}`, import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const UNION_POSTERIORES = new Set([
  'S-10-testids-T3.txt',           // nav-transferir, ir-transferir
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
const emailNuevo = (p) => `s10t2-${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@arnes.local`;

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
// con la respuesta 401 de GET /cuentas. La versión fijada esperaba la vista y era imposible sin
// una espera por tiempo dentro de la app (requería setTimeout de 80 ms).
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

// R10 cambiado por T2 § 5: `salir` vive en el menú de usuario.
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
    // Sincronía: un `cerrar` LEGÍTIMO del marco, posterior al ajeno, y un viaje de ida y vuelta.
    // (el marco se vuelve a pedir: R6 lo navega fuera y de vuelta)
    await (await marcoDe(page)).click(sel('login-email'));
    await page.keyboard.press('Escape');
    await esperarPopoverCerrado(page);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    const sesion = await page.$(sel('usuario-email'));
    brazo(id, yo.length === 0 && !sesion, `aceptó el mensaje: GET /auth/yo × ${yo.length}, usuario-email ${sesion ? 'presente' : 'ausente'}`);
  });
}
// R6 enmendado (T1 § 6.1): el mensaje sale de `login-marco` MISMO, navegado a otro origen
// (127.0.0.1:3000 ≠ localhost:3000). Así `source` coincide y sólo el chequeo de origen lo frena.
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
  // document.fonts.check() da true si la familia NO existe: se mira la cara, por condición.
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
  // Espera por CONDICIÓN: el portapapeles se escribe async; se relee hasta el tope.
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
// El 500 conserva las cabeceras reales (CORS incluido): sólo cambian el estado y el cuerpo.
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
    // Se captura ya: si entrarUI lanza, una promesa rechazada sin dueño tumbaba el runner entero.
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
  await estadoTerminal(page); // sincronía: la vista de sesión ya montó y cargó
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
  // El lapso se mide EN la página. Enmienda § 5.2: la marca de salida es el primer `mouseover` que
  // el navegador despacha FUERA de nav-cuentas y su submenú (captura en document: mismo movimiento
  // que dispara el mouseleave de la app). La versión fijada marcaba antes de pedir el movimiento y
  // medía ~500 ms de latencia de entrada: un cierre de 0 ms (M3) caía dentro de la ventana.
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

await correr('N3', async () => {
  if (!escritorio) throw new Error('N1 no dejó página');
  const { page, token, ids } = escritorio;
  const k = (await filas(page)).length;
  const rol = await page.$eval(sel('nav-cuentas'), (e) => e.getAttribute('role') ?? (e.tagName === 'A' && e.hasAttribute('href') ? 'link' : e.tagName));
  ids.push((await abrirCuenta(token, ids[ids.length - 1])).id);
  await page.click(sel('nav-cuentas'));
  const llego = await nFilasLlegaA(page, k + 1);
  const sesion = !!(await page.$(sel('usuario-email')));
  const fallas = [];
  if (rol !== 'link') fallas.push(`nav-cuentas con rol ${rol}`);
  if (!llego) fallas.push(`las filas no pasaron de ${k} a ${k + 1} (hay ${(await filas(page)).length})`);
  if (!sesion) fallas.push('se perdió la sesión (recarga del documento)');
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
console.log(`\nverificar:s10-t2 → ${verdes}/${resultados.length} brazos verdes${rojos.length ? ` · rojos: ${rojos.join(' ')}` : ''}`);
process.exit(rojos.length === 0 && resultados.length === BRAZOS_TOTAL ? 0 : 1);
