// Árbitro de S-10 · T1 (specs/S-10-T1-acceso.md § 5). Corre contra el ARTEFACTO servido:
// el backend (`node dist/main.js`) en :3000 y el build de producción de web/ en :4200.
// Lo levanta scripts/verificar-s10-t1.sh; este archivo sólo mira. No importa código de la app.
//
// Salida: una línea por brazo (OK | ROJO: motivo) y un resumen «N/M». Exit 0 sólo con todo verde.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const API = 'http://localhost:3000';
const APP = 'http://localhost:4200';
const HOSTS_PERMITIDOS = new Set(['localhost:3000', 'localhost:4200']);
const ESPERA_MS = 8000; // tope de cada espera por CONDICIÓN (no es un sleep): un rojo, no un cuelgue
const CLAVE = 'Clave-Arnes-2026';

const LISTA = readFileSync(new URL('../specs/S-10-testids-T1.txt', import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

const resultados = [];
function brazo(id, ok, motivo = '') {
  resultados.push({ id, ok });
  console.log(`  ${id} ${ok ? 'OK' : `ROJO: ${motivo}`}`);
}
async function correr(id, fn) {
  try { await fn(); } catch (e) { brazo(id, false, `excepción: ${String(e?.message ?? e).split('\n')[0]}`); }
}

// ── HTTP crudo: fetch no deja fijar Origin de forma fiable ─────────────────────────────
function pedir(metodo, ruta, cabeceras = {}, cuerpo) {
  return new Promise((ok, mal) => {
    const req = http.request(`${API}${ruta}`, { method: metodo, headers: cabeceras }, (res) => {
      let datos = '';
      res.on('data', (c) => { datos += c; });
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: datos }));
    });
    req.on('error', mal);
    if (cuerpo) req.end(JSON.stringify(cuerpo)); else req.end();
  });
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
const emailNuevo = (p) => `s10t1-${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@arnes.local`;

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

// ── Navegador ──────────────────────────────────────────────────────────────────────────
const navegador = await chromium.launch({ headless: true });
const fuera = []; // peticiones a hosts no permitidos (R11), de TODAS las páginas
const sel = (t) => `[data-testid="${t}"]`;

// `vigilar = false` sólo para R6, que navega él mismo a 127.0.0.1:3000: esa petición es del
// arnés, no de la app, y no debe contar en R11.
async function paginaNueva(opciones = {}, vigilar = true) {
  const ctx = await navegador.newContext(opciones);
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

// Todos los testids del DOM de cada documento (y de sus shadow roots abiertos).
const vistos = new Set();
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
    ids.forEach((i) => vistos.add(i));
  }
}

// ── Recorrido principal: R3 → R4 → R2 → R10, y R1 sobre la unión ────────────────────────
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
  await page.click(sel('salir'));
  await page.waitForSelector(sel('usuario-email'), { state: 'detached', timeout: ESPERA_MS });
  await page.waitForSelector(sel('login-abrir'), { state: 'visible', timeout: ESPERA_MS });
  const foco = await focoEn(page);
  brazo('R10', foco === 'login-abrir', `foco en ${foco}`);
});

await correr('R1', async () => {
  const faltan = LISTA.filter((t) => !vistos.has(t));
  const sobran = [...vistos].filter((t) => !LISTA.includes(t));
  brazo('R1', faltan.length === 0 && sobran.length === 0,
    `faltan [${faltan.join(', ')}] · sobran [${sobran.join(', ')}] (lista de ${LISTA.length})`);
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
// R6 enmendado (§ 6.1): el mensaje sale de `login-marco` MISMO, navegado a otro origen
// (127.0.0.1:3000 ≠ localhost:3000). Así `source` coincide y sólo el chequeo de origen lo frena.
// La versión fijada lo enviaba desde la anfitriona, y el chequeo de `source` lo tapaba (M3 ciego).
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

// ── R11 · fuentes empaquetadas ─────────────────────────────────────────────────────────
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

await navegador.close();
const verdes = resultados.filter((r) => r.ok).length;
const rojos = resultados.filter((r) => !r.ok).map((r) => r.id);
console.log(`\nverificar:s10-t1 → ${verdes}/${resultados.length} brazos verdes${rojos.length ? ` · rojos: ${rojos.join(' ')}` : ''}`);
process.exit(rojos.length === 0 && resultados.length === 13 ? 0 : 1);
