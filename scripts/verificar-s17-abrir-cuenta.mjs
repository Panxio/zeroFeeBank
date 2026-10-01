// Árbitro de S-17 · Abrir cuenta (specs/S-17-abrir-cuenta.md § 5). Corre contra el ARTEFACTO
// servido: el backend (`node dist/main.js`) en :3000 y el build de pruebas de web/ en :4200.
// Lo levanta scripts/verificar-s17-abrir-cuenta.sh; este archivo sólo mira. No importa código de la app.
// Contiene exactamente los 18 brazos de § 5 y § 5.1: N1–N4, C1–C2, A1–A5, E1–E4, I1–I2, S1.
//
// Salida: una línea por brazo (OK | ROJO: motivo) y un resumen «N/M». Exit 0 sólo con todo verde.
//
// TRAMPA MEDIDA EN F0 (§ 5 de la spec), obligatoria en N1 y en todo brazo que navegue por el menú:
// `nav-cuentas-menu` está en display:none hasta aria-expanded="true" (web/src/styles.css:166,181) y
// el CLICK en `nav-cuentas` CIERRA el menú y navega al Resumen (web/src/app/app.ts:354). Se abre con
// hover o con flecha abajo. Un brazo que haga click y luego busque el ítem da rojo sobre una app sana.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const API = 'http://localhost:3000';
const APP = 'http://localhost:4200';
const HOSTS_PERMITIDOS = new Set(['localhost:3000', 'localhost:4200']);
const ESPERA_MS = 8000; // tope de cada espera por CONDICIÓN (no es un sleep): un rojo, no un cuelgue
const CLAVE = 'Clave-Arnes-2026';
const ESCRITORIO = { width: 1280, height: 800 }; // § 3
const BRAZOS_TOTAL = 18;

// Constantes de negocio de § 3
const MONTO_MINIMO = '1000.00';
const MONTO_BAJO_MINIMO = '999.99';   // un centavo bajo el mínimo: el borde exacto
const MONTO_EXCEDE = '2000.00';       // mayor que los 1.000,00 de la cuenta de partida

const LISTA_S17AC = readFileSync(new URL('../specs/S-17-testids-abrir-cuenta.txt', import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const LISTA_T4 = readFileSync(new URL('../specs/S-10-testids-T4.txt', import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const LISTA_BOLETAS = readFileSync(new URL('../specs/S-17-testids-boletas.txt', import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
// Enmienda de specs/S-17-movimientos.md § 5.1: los testids de la pantalla de
// Movimientos entran en la unión contra la que se mide lo que SOBRA. Lo que FALTA se sigue
// midiendo contra LISTA_S17AC, y un testid ajeno sigue poniendo N4 rojo.
const LISTA_S17MOV = readFileSync(new URL('../specs/S-17-testids-movimientos.txt', import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
// enmienda § 5.1 de S-17-pagos: los testids de la pantalla de Pagos entran en la unión
// contra la que se mide lo que SOBRA. Lo que FALTA se sigue midiendo contra LISTA_S17AC, y un
// testid ajeno sigue poniendo N4 rojo.
const LISTA_S17PAG = readFileSync(new URL('../specs/S-17-testids-pagos.txt', import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
// enmienda § 5.1 de S-17-contacto
const LISTA_S17CON = readFileSync(new URL('../specs/S-17-testids-contacto.txt', import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const UNION = new Set([...LISTA_T4, ...LISTA_BOLETAS, ...LISTA_S17AC, ...LISTA_S17MOV, ...LISTA_S17PAG, ...LISTA_S17CON]);

// Testids que se repiten legítimamente, uno por fila de la tabla de cuentas
const DE_FILA = new Set(['cuenta-fila', 'cuenta-id', 'cuenta-copiar-id', 'cuenta-saldo', 'cuenta-tipo']);

const resultados = [];
function brazo(id, ok, motivo = '') {
  resultados.push({ id, ok });
  console.log(`  ${id} ${ok ? 'OK' : `ROJO: ${motivo}`}`);
}

// Cierre de contextos por brazo (BITÁCORA #184: la fuga de contextos cegó BV1 en T4)
const contextosAbiertos = new Set();
async function cerrarContextos() {
  for (const c of contextosAbiertos) await c.close().catch(() => {});
  contextosAbiertos.clear();
}
async function correr(id, fn) {
  try {
    await fn();
  } catch (e) {
    brazo(id, false, `excepción: ${String(e?.message ?? e).split('\n')[0]}`);
  } finally {
    await cerrarContextos();
  }
}

// ── HTTP crudo, con reintento ante error de red ────────────────────────────────────────
// Resiliencia ante error de red: en verificar-s17-boletas.mjs un ECONNRESET tumbó el proceso entero y
// dejó una corrida de 53 brazos sin resumen. Acá el error de red se reintenta una vez y, si
// vuelve a fallar, se propaga como excepción del brazo —no del proceso—, que es lo que `correr`
// ya sabe convertir en un rojo con motivo.
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
    const red = ['ECONNRESET', 'ECONNREFUSED', 'EPIPE'].includes(e?.code);
    if (!red) throw e;
    return await pedirUnaVez(metodo, ruta, cabeceras, cuerpo);
  }
}

const JSON_H = { 'content-type': 'application/json' };

async function registrar(email) {
  const r = await pedir('POST', '/auth/registro', JSON_H, { email, password: CLAVE });
  if (r.status !== 201) throw new Error(`registro por API → ${r.status} ${r.body}`);
}

async function tokenDe(email, password = CLAVE) {
  const r = await pedir('POST', '/auth/login', JSON_H, { email, password });
  if (r.status !== 200) throw new Error(`login por API → ${r.status} ${r.body}`);
  return JSON.parse(r.body);
}

async function abrirCuentaApi(token, origenId, tipo = 'CORRIENTE', monto) {
  const cuerpo = { tipo };
  if (origenId) cuerpo.cuentaOrigenId = origenId;
  if (monto) cuerpo.monto = monto;
  const r = await pedir('POST', '/cuentas',
    { ...JSON_H, authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() }, cuerpo);
  if (r.status !== 201) {
    let codigo = '';
    try { codigo = JSON.parse(r.body).codigo; } catch {}
    throw new Error(`preparación: POST /cuentas falló con ${r.status}${codigo ? ` ${codigo}` : ''}`);
  }
  return JSON.parse(r.body);
}

async function cuentasApi(token) {
  const r = await pedir('GET', '/cuentas', { authorization: `Bearer ${token}` });
  if (r.status !== 200) throw new Error(`preparación: GET /cuentas falló con ${r.status} ${r.body}`);
  return JSON.parse(r.body).cuentas;
}

const emailNuevo = (p) => `s17ac-${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@arnes.local`;

// ── Preparación con los límites del propio contrato AFIRMADOS ──────────────────────────
// Regla del proyecto: todo dato de preparación se construye con una función que afirma sus
// propios límites. Es la defensa contra el brazo imposible.

/** Titular recién registrado y SIN cuentas. Afirma que de verdad no tiene ninguna. */
async function titularSinCuentas(prefijo) {
  const email = emailNuevo(prefijo);
  await registrar(email);
  const { token } = await tokenDe(email);
  const cuentas = await cuentasApi(token);
  if (cuentas.length !== 0) {
    throw new Error(`preparación: se esperaba un titular sin cuentas y tiene ${cuentas.length}`);
  }
  return { email, token };
}

/**
 * Titular con UNA cuenta CORRIENTE en 1.000,00. No se usa el escenario `cuenta-unica` del seed:
 * no devuelve credenciales (costuras.service.ts:822) y sin ellas no se puede entrar por la UI,
 * lo que dejaría imposible todo brazo de esta unidad. Afirma tipo y saldo antes de devolver.
 */
async function titularConUnaCuenta(prefijo) {
  const { email, token } = await titularSinCuentas(prefijo);
  const creada = await abrirCuentaApi(token, null, 'CORRIENTE');
  const cuentas = await cuentasApi(token);
  if (cuentas.length !== 1) {
    throw new Error(`preparación: se esperaba 1 cuenta y hay ${cuentas.length}`);
  }
  if (cuentas[0].tipo !== 'CORRIENTE') {
    throw new Error(`preparación: se esperaba CORRIENTE y es ${cuentas[0].tipo}`);
  }
  if (cuentas[0].saldo !== MONTO_MINIMO) {
    throw new Error(`preparación: se esperaba saldo ${MONTO_MINIMO} y es ${cuentas[0].saldo}`);
  }
  return { email, token, cuentaId: creada.id };
}

// ── Navegador y ayudantes de UI ────────────────────────────────────────────────────────
const navegador = await chromium.launch({ headless: true });
const fuera = [];
const sel = (t) => `[data-testid="${t}"]`;

async function paginaNueva(opciones = {}) {
  const ctx = await navegador.newContext({ viewport: ESCRITORIO, ...opciones });
  contextosAbiertos.add(ctx);
  const page = await ctx.newPage();
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (!['data:', 'blob:'].includes(u.protocol) && !HOSTS_PERMITIDOS.has(u.host)) fuera.push(req.url());
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

async function entrarUI(page, email, password = CLAVE) {
  await page.click(sel('login-abrir'));
  await page.waitForSelector(`${sel('login-popover')}[data-estado="listo"]`, { state: 'attached', timeout: ESPERA_MS });
  const f = await marcoDe(page);
  await f.fill(sel('login-email'), email);
  await f.fill(sel('login-password'), password);
  await f.click(sel('login-enviar'));
  await page.waitForSelector(sel('cuentas-region'), { state: 'attached', timeout: ESPERA_MS });
}

const TERMINAL = ['listo', 'vacio', 'error'];
async function estadoCuentas(page) {
  const h = await page.waitForSelector(TERMINAL.map((e) => `${sel('cuentas-region')}[data-estado="${e}"]`).join(', '),
    { state: 'attached', timeout: ESPERA_MS });
  return h.getAttribute('data-estado');
}

/**
 * Llega a la vista de apertura POR EL MENÚ. Abre el submenú con hover —nunca con click sobre
 * `nav-cuentas`, que lo cierra y navega al Resumen (app.ts:354)— y espera un estado terminal.
 */
async function irAAbrirCuenta(page) {
  await page.hover(sel('nav-cuentas'));
  await page.waitForSelector(`${sel('nav-cuentas')}[aria-expanded="true"]`, { state: 'attached', timeout: ESPERA_MS });
  await page.waitForSelector(sel('nav-abrir-cuenta'), { state: 'visible', timeout: ESPERA_MS });
  await page.click(sel('nav-abrir-cuenta'));
  const reg = await page.waitForSelector(
    TERMINAL.map((e) => `${sel('abrir-cuenta-region')}[data-estado="${e}"]`).join(', '),
    { state: 'visible', timeout: ESPERA_MS },
  ).catch(() => null);
  if (!reg) throw new Error('abrir-cuenta-region no llegó a un estado terminal');
  return reg.getAttribute('data-estado');
}

/** Rellena y envía el formulario de apertura. `origen` undefined = no se toca el selector. */
async function enviarApertura(page, { tipo = 'CORRIENTE', monto, origen } = {}) {
  await page.selectOption(sel('abrir-cuenta-tipo'), tipo);
  if (monto !== undefined) await page.fill(sel('abrir-cuenta-monto'), monto);
  if (origen !== undefined) await page.selectOption(sel('abrir-cuenta-origen'), origen);
  await page.click(sel('abrir-cuenta-enviar'));
}

/** Filas del Resumen tal como las ve la persona: atributos primero, texto aparte. */
async function filasResumen(page) {
  await page.waitForSelector(sel('cuentas-tabla'), { state: 'visible', timeout: ESPERA_MS });
  return page.$$eval(sel('cuenta-fila'), (filas) => filas.map((f) => {
    const tipo = f.querySelector('[data-testid="cuenta-tipo"]');
    const saldo = f.querySelector('[data-testid="cuenta-saldo"]');
    return {
      cuentaId: f.getAttribute('data-cuenta-id'),
      tipo: tipo?.getAttribute('data-tipo') ?? null,
      tipoTexto: (tipo?.textContent ?? '').trim(),
      monto: saldo?.getAttribute('data-monto') ?? null,
    };
  }));
}

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

// Asienta microtareas y DOM en el navegador (no es espera por tiempo)
async function asentar(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)));
  }));
}

/**
 * Registra la `Idempotency-Key` de cada POST /cuentas que sale del navegador.
 * Enmienda de F3: contar cuentas por API no distingue «la app reusó la clave»
 * de «la app deshabilitó el botón». JA5 habla de la CLAVE, así que la clave es lo que se mira.
 */
function observarClaves(page) {
  const claves = [];
  page.on('request', (req) => {
    if (req.method() !== 'POST') return;
    if (!req.url().endsWith('/cuentas')) return;
    claves.push(req.headers()['idempotency-key'] ?? null);
  });
  return claves;
}

const codigoError = (page) => page.$eval(sel('abrir-cuenta-codigo-error'),
  (e) => e.getAttribute('data-codigo') ?? e.textContent.trim()).catch(() => null);

console.log('verificar:s17-abrir-cuenta · 18 brazos (specs/S-17-abrir-cuenta.md § 5 y § 5.1)\n');

try {
  // ── N · Navegación y contrato ────────────────────────────────────────────────────────

  // N1 · El ítem del submenú lleva a la vista, y el Resumen deja de estar montado (JA1).
  await correr('N1', async () => {
    const u = await titularConUnaCuenta('n1');
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    await estadoCuentas(page);
    const estado = await irAAbrirCuenta(page);
    const resumenMontado = await page.$(sel('cuentas-tabla'));
    await recolectar(page);
    brazo('N1', estado !== null && resumenMontado === null,
      `estado=${estado} · tabla del Resumen ${resumenMontado ? 'SIGUE montada (JA1: una vista a la vez)' : 'desmontada'}`);
  });

  // N2 · Alcanzable por teclado y con nombre accesible correcto (rol + etiqueta).
  await correr('N2', async () => {
    const u = await titularConUnaCuenta('n2');
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    await estadoCuentas(page);
    await page.focus(sel('nav-cuentas'));
    await page.press(sel('nav-cuentas'), 'ArrowDown');
    await page.waitForSelector(`${sel('nav-cuentas')}[aria-expanded="true"]`, { state: 'attached', timeout: ESPERA_MS });
    const item = await page.waitForSelector(sel('nav-abrir-cuenta'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null);
    if (!item) { brazo('N2', false, 'nav-abrir-cuenta no visible tras ArrowDown'); return; }
    // Enmienda de F3: el `|| tagName === 'a'` era un colador —un <a> sin href ni
    // tabindex NO es alcanzable por teclado y pasaba igual—, y el rol se leía sin afirmarse.
    // Además ArrowDown enfoca `nav-resumen` (app.ts:344), así que hay que navegar de verdad hasta
    // el ítem y preguntarle al navegador quién tiene el foco.
    const info = await item.evaluate((e) => ({
      rol: e.getAttribute('role') ?? e.tagName.toLowerCase(),
      nombre: (e.getAttribute('aria-label') ?? e.textContent ?? '').trim(),
      href: e.hasAttribute('href'),
      tabindex: e.tabIndex,
    }));
    // Se camina el submenú con Tab hasta que el foco caiga en nav-abrir-cuenta (tope: 6 saltos).
    let enfocadoDeVerdad = false;
    for (let i = 0; i < 6 && !enfocadoDeVerdad; i++) {
      await page.keyboard.press('Tab');
      enfocadoDeVerdad = await page.evaluate(
        () => document.activeElement?.getAttribute('data-testid') === 'nav-abrir-cuenta');
    }
    const rolValido = info.rol === 'link' || info.rol === 'a' || info.rol === 'menuitem' || info.rol === 'button';
    await recolectar(page);
    brazo('N2', info.nombre.length > 0 && rolValido && enfocadoDeVerdad,
      `rol=${info.rol} (válido=${rolValido}) · nombre="${info.nombre}" · href=${info.href} · tabIndex=${info.tabindex} · el foco llegó por teclado=${enfocadoDeVerdad}`);
  });

  // N3 · El estado vacío del Resumen ofrece la apertura (hoy no ofrece nada).
  await correr('N3', async () => {
    const u = await titularSinCuentas('n3');
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    const estado = await estadoCuentas(page);
    if (estado !== 'vacio') { brazo('N3', false, `se esperaba cuentas-region vacio y fue ${estado}`); return; }
    const boton = await page.waitForSelector(sel('abrir-primera-cuenta'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null);
    if (!boton) { brazo('N3', false, 'abrir-primera-cuenta no aparece en el estado vacío'); return; }
    // Enmienda de F3: se recolecta AQUÍ, con el estado vacío todavía montado. El
    // click lo desmonta, y recolectar después dejaba a `abrir-primera-cuenta` fuera de `vistos`
    // para siempre: N4 daba rojo sobre cualquier app sana.
    await recolectar(page);
    await boton.click();
    const reg = await page.waitForSelector(
      TERMINAL.map((e) => `${sel('abrir-cuenta-region')}[data-estado="${e}"]`).join(', '),
      { state: 'visible', timeout: ESPERA_MS },
    ).catch(() => null);
    await recolectar(page);
    brazo('N3', reg !== null, 'el botón del estado vacío no llevó a abrir-cuenta-region');
  });

  // ── C · Carga (C4) ───────────────────────────────────────────────────────────────────

  // C1 · Mientras carga no se envía. Se mira el atributo Y el efecto: un click forzado no
  // crea nada. Un brazo que sólo mirara [disabled] sería ciego.
  await correr('C1', async () => {
    const u = await titularConUnaCuenta('c1');
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    await estadoCuentas(page);
    // Se retrasa GET /cuentas para poder observar el estado de carga.
    await page.route('**/cuentas', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await new Promise((r) => setTimeout(r, 1500));
      return route.continue();
    });
    await page.hover(sel('nav-cuentas'));
    await page.waitForSelector(`${sel('nav-cuentas')}[aria-expanded="true"]`, { state: 'attached', timeout: ESPERA_MS });
    await page.click(sel('nav-abrir-cuenta'));
    const cargando = await page.waitForSelector(sel('abrir-cuenta-cargando'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null);
    if (!cargando) { brazo('C1', false, 'abrir-cuenta-cargando no aparece'); return; }
    // El conteo previo se toma ANTES de mirar el botón, para no gastar la ventana de carga en
    // llamadas del propio arnés.
    const antes = (await cuentasApi(u.token)).length;
    const existeBoton = await page.$(sel('abrir-cuenta-enviar'));
    if (existeBoton === null) {
      brazo('C1', false, 'abrir-cuenta-enviar no está en el DOM durante la carga (§ 4.1: el formulario se renderiza siempre y el botón se deshabilita)');
      await page.unroute('**/cuentas');
      return;
    }
    const deshabilitado = await page.$eval(sel('abrir-cuenta-enviar'), (b) => b.disabled === true);
    await page.click(sel('abrir-cuenta-enviar'), { force: true }).catch(() => {});
    // Enmienda de F3: antes se leía el efecto ~30 ms después del click, así que un
    // POST en vuelo aterrizaba DESPUÉS de la lectura y la ausencia se afirmaba antes de que el
    // efecto existiera. Ahora se espera a que la carga termine de verdad —que es más que el tiempo
    // de ida y vuelta de un POST— y recién entonces se cuenta.
    await page.waitForSelector(
      TERMINAL.map((e) => `${sel('abrir-cuenta-region')}[data-estado="${e}"]`).join(', '),
      { state: 'visible', timeout: ESPERA_MS },
    );
    await asentar(page);
    const despues = (await cuentasApi(u.token)).length;
    await page.unroute('**/cuentas');
    await recolectar(page);
    brazo('C1', deshabilitado === true && antes === despues,
      `disabled=${deshabilitado} · cuentas ${antes}→${despues} (un click forzado durante la carga no debe crear nada)`);
  });

  // C2 · Error de carga con reintento que se recupera.
  await correr('C2', async () => {
    const u = await titularConUnaCuenta('c2');
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    await estadoCuentas(page);
    let fallar = true;
    await page.route('**/cuentas', (route) => {
      if (route.request().method() === 'GET' && fallar) return route.abort('failed');
      return route.continue();
    });
    await page.hover(sel('nav-cuentas'));
    await page.waitForSelector(`${sel('nav-cuentas')}[aria-expanded="true"]`, { state: 'attached', timeout: ESPERA_MS });
    await page.click(sel('nav-abrir-cuenta'));
    const err = await page.waitForSelector(sel('abrir-cuenta-error'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null);
    if (!err) { brazo('C2', false, 'abrir-cuenta-error no aparece con GET /cuentas caído'); return; }
    const reint = await page.$(sel('abrir-cuenta-reintentar'));
    if (!reint) { brazo('C2', false, 'abrir-cuenta-reintentar no aparece junto al error'); return; }
    // Enmienda de F3: mismo motivo que en N3. El reintento exitoso desmonta el
    // error, así que estos dos testids se recolectan mientras existen.
    await recolectar(page);
    fallar = false;
    await reint.click();
    const form = await page.waitForSelector(sel('abrir-cuenta-form'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null);
    await page.unroute('**/cuentas');
    await recolectar(page);
    brazo('C2', form !== null, 'el reintento no recuperó el formulario');
  });

  // ── A · Apertura feliz (CA1, CA2) y el tipo real (J1) ────────────────────────────────

  // A1 · CA1 · Sin cuentas: no se pide origen y la primera cuenta aparece con su tipo y su saldo.
  await correr('A1', async () => {
    const u = await titularSinCuentas('a1');
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    await estadoCuentas(page);
    await irAAbrirCuenta(page);
    const selectorOrigen = await page.$(sel('abrir-cuenta-origen'));
    if (selectorOrigen !== null) { brazo('A1', false, 'el selector de origen se renderiza sin cuentas (JA4)'); return; }
    // Enmienda de F3: A1 enviaba sin tocar el monto, así que el 1000.00 que veía venía
    // del DEFECTO del backend, no del prellenado que pide JA3. Ahora el prellenado se afirma.
    const prellenado = await page.inputValue(sel('abrir-cuenta-monto'));
    if (prellenado !== MONTO_MINIMO) {
      brazo('A1', false, `el monto no viene prellenado con ${MONTO_MINIMO} (JA3): dice "${prellenado}"`);
      return;
    }
    await enviarApertura(page, { tipo: 'CORRIENTE' });
    await page.waitForSelector(sel('cuentas-tabla'), { state: 'visible', timeout: ESPERA_MS });
    const filas = await filasResumen(page);
    const api = await cuentasApi(u.token);
    await recolectar(page);
    brazo('A1',
      filas.length === 1 && filas[0].tipo === 'CORRIENTE' && filas[0].monto === MONTO_MINIMO && api.length === 1,
      `filas=${filas.length} · data-tipo=${filas[0]?.tipo} · data-monto=${filas[0]?.monto} · cuentas en API=${api.length}`);
  });

  // A2 · CA2 · Con una cuenta: abre una AHORRO desde ella y el origen queda en 0.00 exacto.
  await correr('A2', async () => {
    const u = await titularConUnaCuenta('a2');
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    await estadoCuentas(page);
    await irAAbrirCuenta(page);
    await enviarApertura(page, { tipo: 'AHORRO', monto: MONTO_MINIMO, origen: u.cuentaId });
    await page.waitForSelector(sel('cuentas-tabla'), { state: 'visible', timeout: ESPERA_MS });
    // Sin el catch. Si la relectura no llega, el brazo cae por timeout y
    // se lee como lo que es; con el catch seguía adelante y comparaba contra datos que no llegaron.
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-testid="cuenta-fila"]').length === n, 2, { timeout: ESPERA_MS },
    );
    const filas = await filasResumen(page);
    const origen = filas.find((f) => f.cuentaId === u.cuentaId);
    const nueva = filas.find((f) => f.cuentaId !== u.cuentaId);
    await recolectar(page);
    brazo('A2',
      filas.length === 2 && origen?.monto === '0.00' && nueva?.tipo === 'AHORRO' && nueva?.monto === MONTO_MINIMO,
      `filas=${filas.length} · origen=${origen?.monto} (debe ser 0.00 exacto) · nueva tipo=${nueva?.tipo} monto=${nueva?.monto}`);
  });

  // A3 · J1 · Las dos filas muestran tipos DISTINTOS en el atributo.
  await correr('A3', async () => {
    const u = await titularConUnaCuenta('a3');
    await abrirCuentaApi(u.token, u.cuentaId, 'AHORRO');
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    await estadoCuentas(page);
    const filas = await filasResumen(page);
    const tipos = filas.map((f) => f.tipo).sort();
    await recolectar(page);
    brazo('A3',
      filas.length === 2 && tipos[0] === 'AHORRO' && tipos[1] === 'CORRIENTE',
      `data-tipo de las filas: [${tipos.join(', ')}] (se esperaban AHORRO y CORRIENTE)`);
  });

  // A4 · J1 · El RÓTULO VISIBLE. Ancla de texto DELIBERADA y declarada en § 5: es lo único que
  // prueba que la persona ve el tipo. A3 no lo cubre (K2 y K3 de § 6 lo demuestran).
  await correr('A4', async () => {
    const u = await titularConUnaCuenta('a4');
    await abrirCuentaApi(u.token, u.cuentaId, 'AHORRO');
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    await estadoCuentas(page);
    const filas = await filasResumen(page);
    const corriente = filas.find((f) => f.cuentaId === u.cuentaId);
    const ahorro = filas.find((f) => f.cuentaId !== u.cuentaId);
    await recolectar(page);
    // La regex insensible aceptaba el enum crudo «AHORRO», que es
    // justo lo que JA7 prohíbe mostrar. Se exige el rótulo tal cual, sensible a mayúsculas.
    brazo('A4',
      (ahorro?.tipoTexto ?? '').includes('Ahorro') && (corriente?.tipoTexto ?? '').includes('Corriente')
      && !(ahorro?.tipoTexto ?? '').includes('AHORRO') && !(corriente?.tipoTexto ?? '').includes('CORRIENTE'),
      `rótulos visibles: corriente="${corriente?.tipoTexto}" · ahorro="${ahorro?.tipoTexto}" (se esperan «Corriente» y «Ahorro», no el enum crudo)`);
  });

  // A5 · JA7 · El selector de origen muestra el tipo real de cada cuenta. La spec lo exigía en § 1
  // y en JA7 y ningún brazo lo miraba, así que un selector que rotulara todo «Corriente» —el defecto
  // real que hoy existe en Transferir, app.html:346— habría pasado invisible.
  await correr('A5', async () => {
    const u = await titularConUnaCuenta('a5');
    const ahorroApi = await abrirCuentaApi(u.token, u.cuentaId, 'AHORRO');
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    await estadoCuentas(page);
    await irAAbrirCuenta(page);
    const opciones = await page.$$eval(`${sel('abrir-cuenta-origen')} option`, (os) => os.map((o) => ({
      valor: o.value,
      tipo: o.getAttribute('data-tipo'),
      texto: (o.textContent ?? '').trim(),
    })));
    const opCorriente = opciones.find((o) => o.valor === u.cuentaId);
    const opAhorro = opciones.find((o) => o.valor === ahorroApi.id);
    await recolectar(page);
    brazo('A5',
      opCorriente?.tipo === 'CORRIENTE' && opAhorro?.tipo === 'AHORRO'
      && opCorriente.texto.includes('Corriente') && opAhorro.texto.includes('Ahorro'),
      `corriente: data-tipo=${opCorriente?.tipo} texto="${opCorriente?.texto}" · ahorro: data-tipo=${opAhorro?.tipo} texto="${opAhorro?.texto}"`);
  });

  // ── E · Errores de negocio (CA3) y ausencia de validación de cliente (JA2) ───────────

  // E1 · Monto un centavo bajo el mínimo.
  await correr('E1', async () => {
    const u = await titularConUnaCuenta('e1');
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    await estadoCuentas(page);
    await irAAbrirCuenta(page);
    await enviarApertura(page, { tipo: 'CORRIENTE', monto: MONTO_BAJO_MINIMO, origen: u.cuentaId });
    await page.waitForSelector(sel('abrir-cuenta-codigo-error'), { state: 'visible', timeout: ESPERA_MS }).catch(() => {});
    const codigo = await codigoError(page);
    const api = await cuentasApi(u.token);
    await recolectar(page);
    brazo('E1', codigo === 'MONTO_APERTURA_INSUFICIENTE' && api.length === 1,
      `código=${codigo} · cuentas en API=${api.length} (debía seguir en 1)`);
  });

  // E2 · Monto sobre el saldo del origen.
  await correr('E2', async () => {
    const u = await titularConUnaCuenta('e2');
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    await estadoCuentas(page);
    await irAAbrirCuenta(page);
    await enviarApertura(page, { tipo: 'CORRIENTE', monto: MONTO_EXCEDE, origen: u.cuentaId });
    await page.waitForSelector(sel('abrir-cuenta-codigo-error'), { state: 'visible', timeout: ESPERA_MS }).catch(() => {});
    const codigo = await codigoError(page);
    const api = await cuentasApi(u.token);
    await recolectar(page);
    brazo('E2', codigo === 'FONDOS_INSUFICIENTES' && api.length === 1 && api[0].saldo === MONTO_MINIMO,
      `código=${codigo} · cuentas=${api.length} · saldo del origen=${api[0]?.saldo} (debía seguir en ${MONTO_MINIMO})`);
  });

  // E3 · Con cuentas y sin elegir origen: la opción vacía de JA4 es lo que hace alcanzable el código.
  await correr('E3', async () => {
    const u = await titularConUnaCuenta('e3');
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    await estadoCuentas(page);
    await irAAbrirCuenta(page);
    // Antes, un selector ausente caía en el catch y el brazo culpaba a la
    // opción vacía. Ahora se separa «no está» de «no arranca vacío».
    const haySelector = await page.$(sel('abrir-cuenta-origen'));
    if (haySelector === null) {
      brazo('E3', false, 'abrir-cuenta-origen no está en el DOM teniendo cuentas (JA4)');
      return;
    }
    const valorPorDefecto = await page.$eval(sel('abrir-cuenta-origen'), (s) => s.value);
    if (valorPorDefecto !== '') {
      brazo('E3', false, `el selector de origen no arranca en la opción vacía (value="${valorPorDefecto}"), así que CUENTA_ORIGEN_REQUERIDA es inalcanzable desde la pantalla (JA4)`);
      return;
    }
    await enviarApertura(page, { tipo: 'CORRIENTE', monto: MONTO_MINIMO });
    await page.waitForSelector(sel('abrir-cuenta-codigo-error'), { state: 'visible', timeout: ESPERA_MS }).catch(() => {});
    const codigo = await codigoError(page);
    const api = await cuentasApi(u.token);
    await recolectar(page);
    brazo('E3', codigo === 'CUENTA_ORIGEN_REQUERIDA' && api.length === 1,
      `código=${codigo} · cuentas en API=${api.length}`);
  });

  // E4 · Sin validación de cliente, comprobado sobre el DOM RENDERIZADO (JA2).
  await correr('E4', async () => {
    const u = await titularConUnaCuenta('e4');
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    await estadoCuentas(page);
    await irAAbrirCuenta(page);
    const hallazgos = await page.$eval(sel('abrir-cuenta-form'), (form) => {
      const fallas = [];
      if (!form.hasAttribute('novalidate')) fallas.push('el form no lleva novalidate');
      // La lista es EXACTAMENTE la de JA2. `maxlength` y `minlength`
      // estaban de más y habrían dado rojo por algo que la spec no prohíbe.
      const prohibidos = ['min', 'max', 'step', 'pattern', 'required'];
      form.querySelectorAll('input, select, textarea').forEach((campo) => {
        prohibidos.forEach((a) => {
          if (campo.hasAttribute(a)) fallas.push(`${campo.getAttribute('data-testid') ?? campo.name ?? campo.tagName} tiene ${a}`);
        });
      });
      return fallas;
    });
    await recolectar(page);
    brazo('E4', hallazgos.length === 0, hallazgos.join(' · '));
  });

  // ── I · Idempotencia (CA4, JA5) ──────────────────────────────────────────────────────

  // I1 · Doble clic → exactamente una cuenta nueva.
  await correr('I1', async () => {
    const u = await titularConUnaCuenta('i1');
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    await estadoCuentas(page);
    await irAAbrirCuenta(page);
    const claves = observarClaves(page);
    await page.selectOption(sel('abrir-cuenta-tipo'), 'AHORRO');
    await page.fill(sel('abrir-cuenta-monto'), MONTO_MINIMO);
    await page.selectOption(sel('abrir-cuenta-origen'), u.cuentaId);
    // El `Promise.all` de dos clicks se quedaba esperando `enabled` si la
    // app deshabilitaba el botón al primero, y el brazo moría por timeout sobre una app sana.
    // `dblclick` es el gesto real del doble clic y es lo que ya usa la verificación de boletas (:975).
    await page.dblclick(sel('abrir-cuenta-enviar'));
    await page.waitForSelector(sel('cuentas-tabla'), { state: 'visible', timeout: ESPERA_MS });
    await asentar(page);
    const api = await cuentasApi(u.token);
    // Contar cuentas no distingue idempotencia de «deshabilité el botón».
    // JA5 exige que la clave se REUSE en el doble clic, así que si salieron dos POST se
    // comprueba que llevaran la MISMA clave. Con un solo POST, no hay clave que comparar y se dice.
    const clavesDistintas = claves.length > 1 && new Set(claves).size > 1;
    await recolectar(page);
    brazo('I1', api.length === 2 && !clavesDistintas,
      `cuentas en API=${api.length} (se esperaban 2) · POST observados=${claves.length} · claves distintas=${clavesDistintas} (JA5 exige reusar la clave en el doble clic)`);
  });

  // I2 · Tras un 4xx la clave se descarta: el envío corregido sí crea la cuenta.
  await correr('I2', async () => {
    const u = await titularConUnaCuenta('i2');
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    await estadoCuentas(page);
    await irAAbrirCuenta(page);
    const claves = observarClaves(page);
    await enviarApertura(page, { tipo: 'AHORRO', monto: MONTO_BAJO_MINIMO, origen: u.cuentaId });
    await page.waitForSelector(sel('abrir-cuenta-codigo-error'), { state: 'visible', timeout: ESPERA_MS }).catch(() => {});
    const codigo = await codigoError(page);
    if (codigo !== 'MONTO_APERTURA_INSUFICIENTE') {
      brazo('I2', false, `el rechazo previo no ocurrió (código=${codigo}): el brazo no probaría nada`);
      return;
    }
    await enviarApertura(page, { tipo: 'AHORRO', monto: MONTO_MINIMO, origen: u.cuentaId });
    await page.waitForSelector(sel('cuentas-tabla'), { state: 'visible', timeout: ESPERA_MS });
    await asentar(page);
    const api = await cuentasApi(u.token);
    const ahorro = api.find((c) => c.tipo === 'AHORRO');
    // Corrección en la verificación: el brazo afirmaba que «si la clave se reusara, el
    // backend devolvería el rechazo guardado». ESO NO ES CIERTO en este backend:
    // idempotencia.ejecutor.ts:74 guarda la clave DESPUÉS de que la operación tuvo éxito,
    // y MONTO_APERTURA_INSUFICIENTE se lanza antes todavía, en el controlador
    // (cuentas.controller.ts:76). Un 4xx NUNCA persiste la clave, así que el reintento
    // con la misma clave habría funcionado igual y I2 daba VERDE cumpliera JA5 o no.
    // Lo observable es la clave que sale del navegador: tras un 4xx tiene que ser OTRA.
    const dosClaves = claves.length >= 2;
    const seDescarto = dosClaves && claves[claves.length - 1] !== claves[0];
    await recolectar(page);
    brazo('I2', api.length === 2 && ahorro !== undefined && seDescarto,
      `cuentas=${api.length} · ¿hay AHORRO?=${ahorro !== undefined} · POST observados=${claves.length} · ¿clave descartada tras el 4xx?=${seDescarto} (JA5)`);
  });

  // ── S · El saldo que se muestra es el del API, no el previo (JA6) ────────────────────
  await correr('S1', async () => {
    const u = await titularConUnaCuenta('s1');
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    await estadoCuentas(page);
    await irAAbrirCuenta(page);
    // Comparar sólo los números deja pasar una app que calcula el saldo en el cliente
    // (1000 − 1000 = 0.00 calza exacto) sin releer nada, que es justo lo que JA6 prohíbe.
    // Se observa que el GET /cuentas OCURRA después del 201.
    // Este bloque había quedado por error en A2 —donde nunca se evalúa— y S1 referenciaba
    // la variable sin declararla, cayendo con ReferenceError.
    let getsTrasEnviar = 0;
    let enviado = false;
    page.on('request', (req) => {
      if (enviado && req.method() === 'GET' && req.url().endsWith('/cuentas')) getsTrasEnviar++;
    });
    enviado = true;
    await enviarApertura(page, { tipo: 'AHORRO', monto: MONTO_MINIMO, origen: u.cuentaId });
    await page.waitForSelector(sel('cuentas-tabla'), { state: 'visible', timeout: ESPERA_MS });
    // Sin el catch. Si la relectura no llega, el brazo cae por timeout y
    // se lee como lo que es; con el catch seguía adelante y comparaba contra datos que no llegaron.
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-testid="cuenta-fila"]').length === n, 2, { timeout: ESPERA_MS },
    );
    const filas = await filasResumen(page);
    const api = await cuentasApi(u.token);
    const desajustes = api.filter((c) => {
      const fila = filas.find((f) => f.cuentaId === c.id);
      return !fila || fila.monto !== c.saldo;
    }).map((c) => `${c.id.slice(0, 8)}: API=${c.saldo} pantalla=${filas.find((f) => f.cuentaId === c.id)?.monto ?? 'AUSENTE'}`);
    await recolectar(page);
    brazo('S1', desajustes.length === 0 && getsTrasEnviar > 0,
      `${desajustes.join(' · ')}${getsTrasEnviar > 0 ? '' : ' · la pantalla NO releyó GET /cuentas tras el 201 (JA6): los saldos podrían calzar por cálculo en el cliente'}`);
  });

  // ── N4 · Contrato de testids sobre el ARTEFACTO RENDERIZADO ─────────────────────────
  // Va al final a propósito: mide lo que se recolectó en todos los recorridos de arriba.
  await correr('N4', async () => {
    const faltan = LISTA_S17AC.filter((t) => !vistos.has(t));
    const sobran = [...vistos].filter((t) => !UNION.has(t));
    // `vistos` se llena con los recorridos de los 17 brazos anteriores. Si uno cayó antes
    // de recolectar, sus testids no entran y N4 diría «faltan» por culpa de OTRO brazo.
    // No se relaja el veredicto —sigue rojo—, pero el motivo aclara la causa:
    // un fallo que se diagnostica mal retrasa el avance.
    const rojosPrevios = resultados.filter((r) => !r.ok).map((r) => r.id);
    const arrastre = rojosPrevios.length > 0
      ? ` · ⚠ CAUSA POSIBLEMENTE ARRASTRADA: ya venían rojos [${rojosPrevios.join(' ')}], y un brazo que cae antes de recolectar deja sus testids fuera de la cuenta`
      : '';
    brazo('N4', faltan.length === 0 && sobran.length === 0 && repetidos.size === 0 && fuera.length === 0,
      `faltan [${faltan.join(', ')}] · sobran [${sobran.join(', ')}] · repetidos [${[...repetidos].join(', ')}] · fuera [${[...new Set(fuera)].slice(0, 3).join(', ')}] (lista de ${LISTA_S17AC.length})${arrastre}`);
  });
} finally {
  await navegador.close().catch(() => {});
}

const verdes = resultados.filter((r) => r.ok).length;
const rojos = resultados.filter((r) => !r.ok).map((r) => r.id);
console.log(`\nverificar:s17-abrir-cuenta → ${verdes}/${resultados.length} brazos verdes${rojos.length ? ` · rojos: ${rojos.join(' ')}` : ''}`);
process.exit(rojos.length === 0 && resultados.length === BRAZOS_TOTAL ? 0 : 1);
