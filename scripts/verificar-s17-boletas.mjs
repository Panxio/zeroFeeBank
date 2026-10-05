// Árbitro de S-17 · Boletas (specs/S-17-boletas.md § 5). Corre contra el ARTEFACTO servido:
// el backend (`node dist/main.js`) en :3000 y el build de pruebas de web/ en :4200.
// Lo levanta scripts/verificar-s17-boletas.sh; este archivo sólo mira. No importa código de la app.
// Contiene exactamente los 43 brazos de § 5, § 5.3 y § 5.4: BN1–BN7, L1–L6, E1–E9, A1–A5, P1–P4, VT1–VT11, R1.
//
// Salida: una línea por brazo (OK | ROJO: motivo) y un resumen «N/M». Exit 0 sólo con todo verde.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { extractText, getDocumentProxy } from 'unpdf';

const API = 'http://localhost:3000';
const APP = 'http://localhost:4200';
const URL_VENTANILLA = 'http://localhost:4200/#ventanilla';
const HOSTS_PERMITIDOS = new Set(['localhost:3000', 'localhost:4200']);
const ESPERA_MS = 8000; // tope de cada espera por CONDICIÓN (no es un sleep): un rojo, no un cuelgue
const CLAVE = 'Clave-Arnes-2026';
const ESCRITORIO = { width: 1280, height: 800 }; // § 3
const TELEFONO = { width: 390, height: 844 };    // § 3
// 42 + VT11 (UX-b2 § 5, brazo nuevo de F4a): la cuenta fija sube en uno.
const BRAZOS_TOTAL = 43;

// Constantes de negocio de § 3
const INSTANTE_F_ISO = '2026-09-15T01:30:00.000Z';
const AVANCE_A2_MS = 31 * 86400000; // 2 678 400 000 ms (31 días)
const MONTO_FELIZ = '250.10';
const MONTO_COMA = '12,50';
const MONTO_EXCEDE = '5000.00';
const PLAZO_FELIZ = '30';
const RUT_BENEFICIARIO = '12345678-5';
const NOMBRE_BENEFICIARIO = 'Constructora Andes SpA';
const RUT_RETIRADOR = '9876543-3';
const NOMBRE_RETIRADOR = 'Ana Soto';
const GLOSA_FELIZ = 'Fiel cumplimiento contrato 123';
const RUT_INVALIDO = '12345678-9';
const NOMBRE_LARGO = 'a'.repeat(121);
const GLOSA_LARGA = 'a'.repeat(201);
const ID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';
const ID_MALFORMADO = 'abc';

const LISTA_S17 = readFileSync(new URL('../specs/S-17-testids-boletas.txt', import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const LISTA_T4 = readFileSync(new URL('../specs/S-10-testids-T4.txt', import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
// Enmienda de specs/S-17-abrir-cuenta.md § 6.2: los
// testids de la apertura entran en la unión contra la que se mide lo que SOBRA. Lo que FALTA se
// sigue midiendo contra LISTA_S17, y un testid ajeno sigue poniendo R1 rojo: no se relaja ninguna
// aserción, se actualiza el contrato versionado.
const LISTA_S17AC = readFileSync(new URL('../specs/S-17-testids-abrir-cuenta.txt', import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
// Enmienda de specs/S-17-movimientos.md § 5.1:
// los testids de la pantalla de Movimientos entran en la unión contra la que se mide lo que SOBRA.
// Lo que FALTA se sigue midiendo contra LISTA_S17, y un testid ajeno sigue poniendo R1 rojo.
const LISTA_S17MOV = readFileSync(new URL('../specs/S-17-testids-movimientos.txt', import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
// enmienda § 5.1 de S-17-pagos: los testids de la pantalla de Pagos entran en la unión
// contra la que se mide lo que SOBRA. Lo que FALTA se sigue midiendo contra LISTA_S17, y un
// testid ajeno sigue poniendo R1 rojo.
const LISTA_S17PAG = readFileSync(new URL('../specs/S-17-testids-pagos.txt', import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
// enmienda § 5.1 de S-17-contacto
const LISTA_S17CON = readFileSync(new URL('../specs/S-17-testids-contacto.txt', import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
// enmienda C3 de S-35
const LISTA_S35 = readFileSync(new URL('../specs/S-35-testids-idioma.txt', import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const UNION_T4_S17 = new Set([...LISTA_T4, ...LISTA_S17, ...LISTA_S17AC, ...LISTA_S17MOV, ...LISTA_S17PAG, ...LISTA_S17CON, ...LISTA_S35]);

const DE_FILA = new Set([
  // `cuenta-tipo` es DE FILA (se repite una vez por cuenta): hoy el escenario de boletas
  // siembra una sola y por eso no se notó, pero con dos filas R1 lo contaría como repetido y
  // daría rojo sobre una app sana. Es la trampa de tres líneas que ya costó la enmienda de T4.
  'cuenta-fila', 'cuenta-id', 'cuenta-copiar-id', 'cuenta-saldo', 'cuenta-tipo',
  'boleta-fila', 'boleta-estado', 'boleta-monto', 'boleta-cuenta',
  'boleta-emitida-en', 'boleta-vence-en', 'boleta-devolver', 'boleta-liberar',
  'boleta-comprobante-pdf', 'boleta-resumen-pdf',
]);

const resultados = [];
function brazo(id, ok, motivo = '') {
  resultados.push({ id, ok });
  console.log(`  ${id} ${ok ? 'OK' : `ROJO: ${motivo}`}`);
}

// Cierre de contextos por brazo (la fuga de contextos cegó BV1 en T4)
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

// ── HTTP crudo ────────────────────────────────────────────────────────────────────────
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

async function tokenDe(email, password = CLAVE) {
  const r = await pedir('POST', '/auth/login', JSON_H, { email, password });
  if (r.status !== 200) throw new Error(`login por API → ${r.status} ${r.body}`);
  return JSON.parse(r.body);
}

// ── Costuras del reloj backend (L5, A2) ────────────────────────────────────────────────
async function relojBackendFijar(instanteIso) {
  const r = await pedir('POST', '/__test__/reloj', JSON_H, { instante: instanteIso });
  if (r.status !== 200) throw new Error(`preparación: reloj fijar falló con ${r.status} ${r.body}`);
}

async function relojBackendAvanzar(avanzarMs) {
  const r = await pedir('POST', '/__test__/reloj', JSON_H, { avanzarMs });
  if (r.status !== 200) throw new Error(`preparación: reloj avanzar falló con ${r.status} ${r.body}`);
}

async function relojBackendDesfijar() {
  const r = await pedir('POST', '/__test__/reloj', JSON_H, { instante: null });
  if (r.status !== 200) throw new Error(`preparación: reloj desfijar falló con ${r.status} ${r.body}`);
}

// ── Cuentas y boletas por API ──────────────────────────────────────────────────────────
async function abrirCuenta(token, origenId, tipo = 'CORRIENTE') {
  const cuerpo = origenId ? { tipo, cuentaOrigenId: origenId } : { tipo };
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

async function boletasApi(token) {
  const r = await pedir('GET', '/boletas', { authorization: `Bearer ${token}` });
  if (r.status !== 200) throw new Error(`preparación: GET /boletas falló con ${r.status} ${r.body}`);
  return JSON.parse(r.body).boletas;
}

const emailNuevo = (p) => `s17-${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@arnes.local`;

async function usuarioCon(n, prefijo) {
  const email = emailNuevo(prefijo);
  await registrar(email);
  const { token } = await tokenDe(email);
  const ids = [];
  for (let i = 0; i < n; i++) ids.push((await abrirCuenta(token, ids[ids.length - 1])).id);
  return { email, token, ids };
}

async function fondearCuenta(destinoId, monto = '1000.00') {
  const f = await usuarioCon(1, 'fondeo');
  const r = await pedir('POST', '/transferencias', {
    ...JSON_H,
    authorization: `Bearer ${f.token}`,
    'idempotency-key': randomUUID(),
  }, { origenId: f.ids[0], destinoId, monto });
  if (r.status !== 201) throw new Error(`preparación: fondeo falló con ${r.status}`);
}

async function abrirCuentaAhorro(token, origenId) {
  return abrirCuenta(token, origenId, 'AHORRO');
}

async function emitirBoletaApi(token, cuentaOrigenId, monto = MONTO_FELIZ) {
  const r = await pedir('POST', '/boletas', {
    ...JSON_H,
    authorization: `Bearer ${token}`,
    'idempotency-key': randomUUID(),
  }, {
    cuentaOrigenId,
    monto,
    plazoDias: 30,
    beneficiarioRut: RUT_BENEFICIARIO,
    beneficiarioNombre: NOMBRE_BENEFICIARIO,
    retiradorRut: RUT_RETIRADOR,
    retiradorNombre: NOMBRE_RETIRADOR,
    glosa: GLOSA_FELIZ,
  });
  if (r.status !== 201) {
    let codigo = '';
    try { codigo = JSON.parse(r.body).codigo; } catch {}
    throw new Error(`preparación: emitir boleta falló con ${r.status}${codigo ? ` ${codigo}` : ''}`);
  }
  return JSON.parse(r.body);
}

// ── Preparación del escenario sembrado con límites afirmados (S-23) ────────────────────
async function sembrarBoletasAfirmado() {
  const r = await pedir('POST', '/__test__/seed', JSON_H, { escenario: 'boletas-en-cada-estado' });
  if (r.status !== 201) throw new Error(`preparación: seed respondió ${r.status} ${r.body}`);
  const data = JSON.parse(r.body);
  if (!data.cuentas || data.cuentas.length === 0) throw new Error('preparación: sin cuentas en seed');
  if (data.cuentas[0].saldoCentavos !== '74000') {
    throw new Error(`preparación: saldoCentavos esperado 74000 pero fue ${data.cuentas[0].saldoCentavos}`);
  }
  if (!data.credenciales?.email || !data.credenciales?.password) {
    throw new Error('preparación: credenciales ausentes en seed');
  }
  const boletas = data.boletas || [];
  if (boletas.length !== 5) {
    throw new Error(`preparación: esperadas 5 boletas pero fueron ${boletas.length}`);
  }
  const etiquetas = boletas.map((b) => b.etiqueta);
  const esperadas = ['VIGENTE', 'VENCIDA_POR_LIBERAR', 'VENCIDA_LIBERADA', 'COBRADA', 'DEVUELTA'];
  for (const esp of esperadas) {
    if (!etiquetas.includes(esp)) {
      throw new Error(`preparación: falta boleta con etiqueta ${esp}`);
    }
  }
  const tokenResp = await tokenDe(data.credenciales.email, data.credenciales.password);
  const token = tokenResp.token;
  const bApi = await boletasApi(token);
  if (bApi.length !== 5) throw new Error(`preparación: GET /boletas devolvió ${bApi.length}`);
  const map = {};
  for (const b of boletas) {
    map[b.etiqueta] = bApi.find((x) => x.id === b.id);
    if (!map[b.etiqueta]) throw new Error(`preparación: boleta ${b.id} no encontrada en GET /boletas`);
  }
  if (map['VIGENTE'].estado !== 'VIGENTE' || map['VIGENTE'].fondosLiberados !== false) {
    throw new Error(`preparación: VIGENTE inválida (${map['VIGENTE'].estado}, ${map['VIGENTE'].fondosLiberados})`);
  }
  if (map['VENCIDA_POR_LIBERAR'].estado !== 'VENCIDA' || map['VENCIDA_POR_LIBERAR'].fondosLiberados !== false) {
    throw new Error(`preparación: VENCIDA_POR_LIBERAR inválida (${map['VENCIDA_POR_LIBERAR'].estado}, ${map['VENCIDA_POR_LIBERAR'].fondosLiberados})`);
  }
  if (map['VENCIDA_LIBERADA'].estado !== 'VENCIDA' || map['VENCIDA_LIBERADA'].fondosLiberados !== true) {
    throw new Error(`preparación: VENCIDA_LIBERADA inválida (${map['VENCIDA_LIBERADA'].estado}, ${map['VENCIDA_LIBERADA'].fondosLiberados})`);
  }
  if (map['COBRADA'].estado !== 'COBRADA' || map['COBRADA'].fondosLiberados !== true) {
    throw new Error(`preparación: COBRADA inválida (${map['COBRADA'].estado}, ${map['COBRADA'].fondosLiberados})`);
  }
  if (map['DEVUELTA'].estado !== 'DEVUELTA' || map['DEVUELTA'].fondosLiberados !== true) {
    throw new Error(`preparación: DEVUELTA inválida (${map['DEVUELTA'].estado}, ${map['DEVUELTA'].fondosLiberados})`);
  }
  const ids = {};
  for (const b of boletas) ids[b.etiqueta] = b.id;
  return {
    usuarioId: data.usuarioId,
    cuentaId: data.cuentas[0].id,
    email: data.credenciales.email,
    password: data.credenciales.password,
    token,
    boletas: data.boletas,
    ids,
  };
}

// ── Navegador y ayudantes de UI ────────────────────────────────────────────────────────
const navegador = await chromium.launch({ headless: true });
const fuera = [];
const sel = (t) => `[data-testid="${t}"]`;
// UX-b1 § 4, D130-4
const abreviar = (id) => (id.length > 6 ? `…${id.slice(-6)}` : id);

async function paginaNueva(opciones = {}, vigilar = true, urlDestino = APP) {
  const ctx = await navegador.newContext({ viewport: ESCRITORIO, ...opciones });
  contextosAbiertos.add(ctx);
  const page = await ctx.newPage();
  if (vigilar) page.on('request', (req) => {
    const u = new URL(req.url());
    if (!['data:', 'blob:'].includes(u.protocol) && !HOSTS_PERMITIDOS.has(u.host)) fuera.push(req.url());
  });
  page.setDefaultTimeout(ESPERA_MS);
  await page.goto(urlDestino, { waitUntil: 'load' });
  await page.waitForSelector(`${sel('portada')}, ${sel('ventanilla')}`, { state: 'attached', timeout: ESPERA_MS });
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

// Login por la UI con credenciales (password como parámetro para el seed)
async function entrarUI(page, email, password = CLAVE, montada = true) {
  const f = await abrirPopover(page);
  await f.fill(sel('login-email'), email);
  await f.fill(sel('login-password'), password);
  await f.click(sel('login-enviar'));
  if (montada) await page.waitForSelector(sel('cuentas-region'), { state: 'attached', timeout: ESPERA_MS });
}

const TERMINAL = ['listo', 'vacio', 'error'];
async function estadoTerminal(page) {
  const h = await page.waitForSelector(TERMINAL.map((e) => `${sel('cuentas-region')}[data-estado="${e}"]`).join(', '),
    { state: 'attached', timeout: ESPERA_MS });
  return h.getAttribute('data-estado');
}

const visible = (page, t) => page.isVisible(sel(t));

async function irABoletas(page) {
  if (!(await visible(page, 'nav-boletas'))) return { ok: false, motivo: 'nav-boletas no aparece' };
  await page.click(sel('nav-boletas'));
  const reg = await page.waitForSelector(
    TERMINAL.map((e) => `${sel('boletas-region')}[data-estado="${e}"]`).join(', '),
    { state: 'visible', timeout: ESPERA_MS },
  ).catch(() => null);
  if (!reg) return { ok: false, motivo: 'boletas-region sin estado terminal' };
  return { ok: true, estado: await reg.getAttribute('data-estado') };
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
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 0);
      });
    });
  }));
}

async function llenarFormularioEmitir(page, datos) {
  if (datos.origenId) {
    await page.selectOption(sel('emitir-origen'), datos.origenId);
  }
  if (datos.monto !== undefined) await page.fill(sel('emitir-monto'), datos.monto);
  if (datos.plazo !== undefined) await page.fill(sel('emitir-plazo'), String(datos.plazo));
  if (datos.benRut !== undefined) await page.fill(sel('emitir-beneficiario-rut'), datos.benRut);
  if (datos.benNombre !== undefined) await page.fill(sel('emitir-beneficiario-nombre'), datos.benNombre);
  if (datos.retRut !== undefined) await page.fill(sel('emitir-retirador-rut'), datos.retRut);
  if (datos.retNombre !== undefined) await page.fill(sel('emitir-retirador-nombre'), datos.retNombre);
  if (datos.glosa !== undefined) await page.fill(sel('emitir-glosa'), datos.glosa);
}

// Desfijar reloj backend preventivamente antes de empezar
await relojBackendDesfijar().catch(() => {});

try {
  // ── BN1 · nav-boletas ────────────────────────────────────────────────────────────────
  await correr('BN1', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    if (!(await visible(page, 'nav-boletas'))) {
      brazo('BN1', false, 'nav-boletas no aparece');
      return;
    }
    const rol = await page.$eval(sel('nav-boletas'), (e) => e.getAttribute('role') ?? (e.tagName === 'A' && e.hasAttribute('href') ? 'link' : e.tagName));
    const fallas = [];
    if (rol !== 'link') fallas.push(`nav-boletas con rol ${rol}`);

    let pidioBoletas = false;
    let pidioCuentas = false;
    page.on('request', (req) => {
      if (req.method() === 'GET') {
        if (req.url() === `${API}/boletas`) pidioBoletas = true;
        if (req.url() === `${API}/cuentas`) pidioCuentas = true;
      }
    });

    await page.click(sel('nav-boletas'));
    const visibleBoletas = await page.waitForSelector(
      TERMINAL.map((e) => `${sel('boletas-region')}[data-estado="${e}"]`).join(', '),
      { state: 'visible', timeout: ESPERA_MS },
    ).then(() => true, () => false);
    if (!visibleBoletas) {
      fallas.push('boletas-region sin estado terminal tras clic');
    } else {
      await recolectar(page);
      if (!pidioBoletas) fallas.push('no se pidió GET /boletas');
      if (!pidioCuentas) fallas.push('no se pidió GET /cuentas');
      if (await visible(page, 'cuentas-region')) fallas.push('cuentas-region sigue visible');
      if (await visible(page, 'transferir-pasos')) fallas.push('transferir-pasos visible');
    }
    brazo('BN1', fallas.length === 0, fallas.join(' · '));
  });

  // ── BN2 · panel de teléfono ──────────────────────────────────────────────────────────
  await correr('BN2', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva({ viewport: TELEFONO });
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    if (!(await visible(page, 'nav-hamburguesa'))) {
      brazo('BN2', false, 'nav-hamburguesa no aparece');
      return;
    }
    await page.click(sel('nav-hamburguesa'));
    const panelVisible = await page.waitForSelector(sel('nav-panel'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!panelVisible) {
      brazo('BN2', false, 'nav-panel no abrió');
      return;
    }
    if (!(await visible(page, 'nav-boletas'))) {
      brazo('BN2', false, 'nav-boletas no aparece en nav-panel');
      return;
    }
    await page.click(sel('nav-boletas'));
    const fallas = [];
    const boletasVisible = await page.waitForSelector(sel('boletas-region'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!boletasVisible) fallas.push('boletas-region no visible tras clic');
    const panelOculto = await page.waitForSelector(sel('nav-panel'), { state: 'hidden', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!panelOculto) fallas.push('nav-panel sigue visible tras clic');
    await recolectar(page);
    brazo('BN2', fallas.length === 0, fallas.join(' · '));
  });

  // ── BN3 · carga ──────────────────────────────────────────────────────────────────────
  await correr('BN3', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    if (!(await visible(page, 'nav-boletas'))) {
      brazo('BN3', false, 'nav-boletas no aparece');
      return;
    }

    let soltarBoletas;
    const boletasRetenido = new Promise((r) => { soltarBoletas = r; });
    await page.route(`${API}/boletas`, async (route) => {
      if (route.request().method() === 'GET') {
        await boletasRetenido;
      }
      await route.continue();
    });

    try {
      await page.click(sel('nav-boletas'));
      const cargando = await page.waitForSelector(`${sel('boletas-region')}[data-estado="cargando"][aria-busy="true"]`, { state: 'attached', timeout: ESPERA_MS })
        .then(() => true, () => false);
      const fallas = [];
      if (!cargando) fallas.push('boletas-region no está en cargando con aria-busy="true"');
      const indVisible = await page.waitForSelector(sel('boletas-cargando'), { state: 'visible', timeout: ESPERA_MS })
        .then(() => true, () => false);
      if (!indVisible) fallas.push('boletas-cargando no visible durante carga');

      await recolectar(page);
      soltarBoletas?.();

      const listo = await page.waitForSelector(`${sel('boletas-region')}[data-estado="listo"]`, { state: 'attached', timeout: ESPERA_MS })
        .then(() => true, () => false);
      if (!listo) fallas.push('boletas-region no pasó a listo');
      else {
        const busy = await page.getAttribute(sel('boletas-region'), 'aria-busy');
        if (busy === 'true') fallas.push('aria-busy sigue true en listo');
        if (await visible(page, 'boletas-cargando')) fallas.push('boletas-cargando sigue visible');
      }
      await recolectar(page);
      brazo('BN3', fallas.length === 0, fallas.join(' · '));
    } finally {
      soltarBoletas?.();
    }
  });

  // ── BN4 · vacío ──────────────────────────────────────────────────────────────────────
  await correr('BN4', async () => {
    const u = await usuarioCon(1, 'bn4');
    const bList = await boletasApi(u.token);
    if (bList.length !== 0) throw new Error(`preparación: boletas esperadas 0 pero son ${bList.length}`);
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    await estadoTerminal(page);

    if (!(await visible(page, 'nav-boletas'))) {
      brazo('BN4', false, 'nav-boletas no aparece');
      return;
    }
    await page.click(sel('nav-boletas'));
    const vacio = await page.waitForSelector(`${sel('boletas-region')}[data-estado="vacio"]`, { state: 'attached', timeout: ESPERA_MS })
      .then(() => true, () => false);
    const fallas = [];
    if (!vacio) fallas.push('boletas-region no pasó a vacio');
    if (!(await page.waitForSelector(sel('boletas-vacio'), { state: 'visible', timeout: ESPERA_MS }).then(() => true, () => false))) {
      fallas.push('boletas-vacio no visible');
    }
    // enmendado en F4a de UX-b2 (O2)
    const pestanaListaSel = await page.waitForSelector(`${sel('boletas-pestana-lista')}[aria-selected="true"]`, { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!pestanaListaSel) fallas.push('boletas-pestana-lista[aria-selected=true] no visible con cero boletas');
    if (await visible(page, 'emitir-form')) fallas.push('emitir-form visible con cero boletas');
    const pestanaEmitirSel = await page.waitForSelector(sel('boletas-pestana-emitir'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!pestanaEmitirSel) {
      fallas.push('boletas-pestana-emitir no aparece (la pestaña no existe)');
    } else {
      await page.click(sel('boletas-pestana-emitir'));
      const formTrasClic = await page.waitForSelector(sel('emitir-form'), { state: 'visible', timeout: ESPERA_MS })
        .then(() => true, () => false);
      if (!formTrasClic) fallas.push('emitir-form no visible tras clic en «Emitir»');
    }
    await recolectar(page);
    brazo('BN4', fallas.length === 0, fallas.join(' · '));
  });

  // ── BN5 · error y reintento ──────────────────────────────────────────────────────────
  await correr('BN5', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    let fallar = true;
    await page.route(`${API}/boletas`, async (route) => {
      if (route.request().method() === 'GET' && fallar) {
        fallar = false;
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ codigo: 'ERROR_SIMULADO' }) });
      }
      return route.continue();
    });
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    if (!(await visible(page, 'nav-boletas'))) {
      brazo('BN5', false, 'nav-boletas no aparece');
      return;
    }
    await page.click(sel('nav-boletas'));
    const errorReg = await page.waitForSelector(`${sel('boletas-region')}[data-estado="error"]`, { state: 'attached', timeout: ESPERA_MS })
      .then(() => true, () => false);
    const fallas = [];
    if (!errorReg) fallas.push('boletas-region no pasó a error');
    if (!(await page.waitForSelector(sel('boletas-error'), { state: 'visible', timeout: ESPERA_MS }).then(() => true, () => false))) {
      fallas.push('boletas-error no visible');
    }
    if (!(await page.waitForSelector(sel('boletas-reintentar'), { state: 'visible', timeout: ESPERA_MS }).then(() => true, () => false))) {
      fallas.push('boletas-reintentar no visible');
    } else {
      await recolectar(page);
      let pidioBoletasClic = false;
      let pidioCuentasClic = false;
      page.on('request', (req) => {
        if (req.method() === 'GET') {
          if (req.url() === `${API}/boletas`) pidioBoletasClic = true;
          if (req.url() === `${API}/cuentas`) pidioCuentasClic = true;
        }
      });
      await page.click(sel('boletas-reintentar'));
      const listo = await page.waitForSelector(`${sel('boletas-region')}[data-estado="listo"]`, { state: 'attached', timeout: ESPERA_MS })
        .then(() => true, () => false);
      if (!listo) fallas.push('boletas-region no pasó a listo tras reintentar');
      else {
        if (!pidioBoletasClic) fallas.push('reintentar no pidió GET /boletas');
        if (!pidioCuentasClic) fallas.push('reintentar no pidió GET /cuentas');
        const filas = await page.$$(sel('boleta-fila'));
        if (filas.length !== 5) fallas.push(`filas tras reintentar = ${filas.length}, esperado 5`);
      }
    }
    await recolectar(page);
    brazo('BN5', fallas.length === 0, fallas.join(' · '));
  });

  // ── BN6 · sin cuentas ────────────────────────────────────────────────────────────────
  await correr('BN6', async () => {
    const u = await usuarioCon(0, 'bn6');
    const cList = await cuentasApi(u.token);
    if (cList.length !== 0) throw new Error(`preparación: cuentas esperadas 0 pero son ${cList.length}`);
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    await estadoTerminal(page);

    if (!(await visible(page, 'nav-boletas'))) {
      brazo('BN6', false, 'nav-boletas no aparece');
      return;
    }
    await page.click(sel('nav-boletas'));
    // enmendado en F4a de UX-b2 (O2)
    const pestanaEmitirBn6 = await page.waitForSelector(sel('boletas-pestana-emitir'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!pestanaEmitirBn6) {
      brazo('BN6', false, 'boletas-pestana-emitir no aparece (la pestaña no existe)');
      return;
    }
    await page.click(sel('boletas-pestana-emitir'));
    const sinCuentas = await page.waitForSelector(sel('boletas-sin-cuentas'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    const fallas = [];
    if (!sinCuentas) fallas.push('boletas-sin-cuentas no visible');
    else {
      if (await visible(page, 'emitir-form')) fallas.push('emitir-form visible con cero cuentas');
    }
    await recolectar(page);
    brazo('BN6', fallas.length === 0, fallas.join(' · '));
  });

  // ── BN7 · relectura que falla (§ 4.1, J10; § 5.3 H-3) ─────────────────────────────────
  await correr('BN7', async () => {
    const fallas = [];
    for (const caso of ['a', 'b']) {
      const s = await sembrarBoletasAfirmado();
      const idVigente = s.ids['VIGENTE'];
      const page = await paginaNueva();
      let postVisto = false;
      let yaFallo = false;
      page.on('request', (req) => {
        if (req.method() === 'POST' && req.url() === `${API}/boletas/${idVigente}/devolver`) postVisto = true;
      });
      await page.route(`${API}/boletas`, async (route) => {
        if (route.request().method() === 'GET' && postVisto && !yaFallo) {
          yaFallo = true;
          return caso === 'a'
            ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
            : route.abort();
        }
        return route.continue();
      });

      await entrarUI(page, s.email, s.password);
      await estadoTerminal(page);
      const ir = await irABoletas(page);
      if (!ir.ok) { fallas.push(`caso ${caso}: ${ir.motivo}`); continue; }
      if (ir.estado !== 'listo') { fallas.push(`caso ${caso}: estado inicial «${ir.estado}», esperado "listo"`); continue; }

      const filaSel = `${sel('boleta-fila')}[data-boleta-id="${idVigente}"]`;
      const btnDevolver = await page.$(`${filaSel} ${sel('boleta-devolver')}`);
      if (!btnDevolver) { fallas.push(`caso ${caso}: boleta-devolver no visible en VIGENTE`); continue; }

      await btnDevolver.click();
      const error = await page.waitForSelector(`${sel('boletas-region')}[data-estado="error"]`, { state: 'visible', timeout: ESPERA_MS })
        .then(() => true, () => false);
      if (!error) { fallas.push(`caso ${caso}: boletas-region sin data-estado="error" tras el GET fallado`); continue; }
      if (!(await visible(page, 'boletas-error'))) { fallas.push(`caso ${caso}: boletas-error no visible`); continue; }

      if (!yaFallo) { fallas.push(`caso ${caso}: no hubo GET /boletas después del POST`); continue; }
      await recolectar(page);
    }
    brazo('BN7', fallas.length === 0, fallas.join(' · '));
  });

  // ── L1 · las 5 del escenario ──────────────────────────────────────────────────────────
  await correr('L1', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('L1', false, ir.motivo); return; }

    const filas = await page.$$(sel('boleta-fila'));
    const fallas = [];
    if (filas.length !== 5) fallas.push(`cantidad de boleta-fila = ${filas.length}, esperado 5`);

    const esperados = {
      VIGENTE: { estado: 'VIGENTE', fondos: 'false' },
      VENCIDA_POR_LIBERAR: { estado: 'VENCIDA', fondos: 'false' },
      VENCIDA_LIBERADA: { estado: 'VENCIDA', fondos: 'true' },
      COBRADA: { estado: 'COBRADA', fondos: 'true' },
      DEVUELTA: { estado: 'DEVUELTA', fondos: 'true' },
    };

    for (const [etiqueta, esp] of Object.entries(esperados)) {
      const id = s.ids[etiqueta];
      const filaSel = `${sel('boleta-fila')}[data-boleta-id="${id}"]`;
      const f = await page.$(filaSel);
      if (!f) {
        fallas.push(`fila para ${etiqueta} (${id}) no encontrada`);
        continue;
      }
      const estadoAttr = await f.getAttribute('data-estado');
      const fondosAttr = await f.getAttribute('data-fondos-liberados');
      if (estadoAttr !== esp.estado) fallas.push(`${etiqueta} data-estado="${estadoAttr}", esperado "${esp.estado}"`);
      if (fondosAttr !== esp.fondos) fallas.push(`${etiqueta} data-fondos-liberados="${fondosAttr}", esperado "${esp.fondos}"`);
    }

    const orden = await page.$$eval(sel('boleta-fila'), (fs) => fs.map((f2) => f2.getAttribute('data-boleta-id')));
    const esperadoOrden = (await boletasApi(s.token)).map((b) => b.id);
    if (orden.length !== esperadoOrden.length) {
      fallas.push(`orden de filas: largo ${orden.length}, esperado ${esperadoOrden.length}`);
    } else {
      for (let i = 0; i < orden.length; i++) {
        if (orden[i] !== esperadoOrden[i]) {
          fallas.push(`orden de filas: posición ${i} = «${orden[i]}», esperado «${esperadoOrden[i]}»`);
          break;
        }
      }
    }
    await recolectar(page);
    brazo('L1', fallas.length === 0, fallas.join(' · '));
  });

  // ── L2 · acciones por estado (CA8) ───────────────────────────────────────────────────
  await correr('L2', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('L2', false, ir.motivo); return; }

    const fallas = [];
    for (const etiqueta of ['VIGENTE', 'VENCIDA_POR_LIBERAR', 'VENCIDA_LIBERADA', 'COBRADA', 'DEVUELTA']) {
      const id = s.ids[etiqueta];
      const filaSel = `${sel('boleta-fila')}[data-boleta-id="${id}"]`;
      const devolver = await page.$(`${filaSel} ${sel('boleta-devolver')}`);
      const liberar = await page.$(`${filaSel} ${sel('boleta-liberar')}`);
      const comprobante = await page.$(`${filaSel} ${sel('boleta-comprobante-pdf')}`);
      const resumen = await page.$(`${filaSel} ${sel('boleta-resumen-pdf')}`);

      if (etiqueta === 'VIGENTE') {
        if (!devolver) fallas.push(`falta boleta-devolver en ${etiqueta}`);
      } else {
        if (devolver) fallas.push(`sobra boleta-devolver en ${etiqueta}`);
      }

      if (etiqueta === 'VENCIDA_POR_LIBERAR') {
        if (!liberar) fallas.push(`falta boleta-liberar en ${etiqueta}`);
      } else {
        if (liberar) fallas.push(`sobra boleta-liberar en ${etiqueta}`);
      }

      if (!comprobante) fallas.push(`falta boleta-comprobante-pdf en ${etiqueta}`);

      if (['VENCIDA_LIBERADA', 'COBRADA', 'DEVUELTA'].includes(etiqueta)) {
        if (!resumen) fallas.push(`falta boleta-resumen-pdf en ${etiqueta}`);
      } else {
        if (resumen) fallas.push(`sobra boleta-resumen-pdf en ${etiqueta}`);
      }
    }
    await recolectar(page);
    brazo('L2', fallas.length === 0, fallas.join(' · '));
  });

  // ── L3 · las dos vencidas se distinguen (R9) ─────────────────────────────────────────
  await correr('L3', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('L3', false, ir.motivo); return; }

    const idVPorLiberar = s.ids['VENCIDA_POR_LIBERAR'];
    const idVLiberada = s.ids['VENCIDA_LIBERADA'];
    const t1 = (await page.textContent(`${sel('boleta-fila')}[data-boleta-id="${idVPorLiberar}"] ${sel('boleta-estado')}`))?.trim();
    const t2 = (await page.textContent(`${sel('boleta-fila')}[data-boleta-id="${idVLiberada}"] ${sel('boleta-estado')}`))?.trim();

    const fallas = [];
    if (!t1) fallas.push('boleta-estado de VENCIDA_POR_LIBERAR vacío');
    if (!t2) fallas.push('boleta-estado de VENCIDA_LIBERADA vacío');
    if (t1 && t2 && t1 === t2) fallas.push(`textos iguales: «${t1}»`);
    await recolectar(page);
    brazo('L3', fallas.length === 0, fallas.join(' · '));
  });

  // ── L4 · cuenta de origen (J11) ──────────────────────────────────────────────────────
  await correr('L4', async () => {
    const s = await sembrarBoletasAfirmado();
    // Fondeo adicional para permitir abrir cuenta AHORRO (mínimo 1000.00)
    await fondearCuenta(s.cuentaId, '1000.00');
    const ahorro = await abrirCuentaAhorro(s.token, s.cuentaId);
    await emitirBoletaApi(s.token, ahorro.id);

    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('L4', false, ir.motivo); return; }

    const todasBoletasApi = await boletasApi(s.token);
    const fallas = [];
    for (const b of todasBoletasApi) {
      const cuentaEl = await page.$(`${sel('boleta-fila')}[data-boleta-id="${b.id}"] ${sel('boleta-cuenta')}`);
      if (!cuentaEl) {
        fallas.push(`boleta-cuenta no encontrado para ${b.id}`);
        continue;
      }
      const cIdAttr = await cuentaEl.getAttribute('data-cuenta-id');
      if (cIdAttr !== b.cuentaOrigenId) {
        fallas.push(`boleta ${b.id} data-cuenta-id="${cIdAttr}", esperado "${b.cuentaOrigenId}"`);
      }
      // enmendado en F4a de UX-b1 (D130-1|O5): se lee el hijo aria-hidden, no el textContent del nodo, que siempre arrastra el .sr-only (#3).
      const tipo = b.cuentaOrigenId === ahorro.id ? 'Ahorro' : 'Corriente';
      const corto = abreviar(b.cuentaOrigenId);
      // Por D133-1: el hijo aria-hidden lleva sólo la abreviatura y el tipo va fuera de él
      // y del .sr-only, como texto que el lector de pantalla lee.
      const hijo = await cuentaEl.$('[aria-hidden="true"]');
      const txt = hijo ? ((await hijo.textContent()) ?? '').trim() : null;
      if (txt === null) {
        fallas.push(`boleta ${tipo} ${b.id} sin hijo aria-hidden (esperado «${corto}»)`);
      } else if (txt !== corto) {
        fallas.push(`boleta ${tipo} ${b.id} texto aria-hidden «${txt}», esperado «${corto}»`);
      }
      const fuera = await cuentaEl.evaluate((el) => {
        const dentroDeHijo = (node) => {
          for (let p = node.parentElement; p && p !== el; p = p.parentElement) {
            if (p.getAttribute('aria-hidden') === 'true' || p.classList.contains('sr-only')) return true;
          }
          return false;
        };
        const partes = [];
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        while (w.nextNode()) if (!dentroDeHijo(w.currentNode)) partes.push(w.currentNode.textContent ?? '');
        return partes.join('').trim();
      });
      if (fuera !== tipo) fallas.push(`boleta ${tipo} ${b.id} texto fuera del aria-hidden y del .sr-only «${fuera}», esperado «${tipo}»`);
      const sr = await cuentaEl.$('.sr-only');
      const txtSr = sr ? ((await sr.textContent()) ?? '').trim() : '';
      const visibleConId = (await cuentaEl.evaluate((el) => el.textContent ?? '')).replace(txtSr, '');
      if (visibleConId.includes(b.cuentaOrigenId)) fallas.push(`boleta ${tipo} ${b.id} el id completo aparece fuera del .sr-only`);
    }
    await recolectar(page);
    brazo('L4', fallas.length === 0, fallas.join(' · '));
  });

  // ── L5 · fechas UTC (CA10) ───────────────────────────────────────────────────────────
  await correr('L5', async () => {
    try {
      await relojBackendFijar(INSTANTE_F_ISO);
      const s = await sembrarBoletasAfirmado();
      const bApi = (await boletasApi(s.token)).find((b) => b.id === s.ids['VIGENTE']);
      if (!bApi) throw new Error('preparación: boleta VIGENTE no encontrada en API');

      const page = await paginaNueva({ timezoneId: 'America/Santiago' });
      await entrarUI(page, s.email, s.password);
      await estadoTerminal(page);

      const ir = await irABoletas(page);
      if (!ir.ok) { brazo('L5', false, ir.motivo); return; }

      const filaSel = `${sel('boleta-fila')}[data-boleta-id="${s.ids['VIGENTE']}"]`;
      const emitidaEl = await page.$(`${filaSel} ${sel('boleta-emitida-en')}`);
      const venceEl = await page.$(`${filaSel} ${sel('boleta-vence-en')}`);
      const fallas = [];
      if (!emitidaEl) fallas.push('boleta-emitida-en no encontrado');
      else {
        const txt = (await emitidaEl.textContent())?.trim() ?? '';
        const inst = await emitidaEl.getAttribute('data-instante');
        if (txt !== '2026-09-14 01:30 UTC') fallas.push(`boleta-emitida-en texto=«${txt}», esperado «2026-09-14 01:30 UTC»`);
        if (inst !== bApi.emitidaEn) fallas.push(`boleta-emitida-en data-instante=«${inst}», esperado «${bApi.emitidaEn}»`);
      }

      if (!venceEl) fallas.push('boleta-vence-en no encontrado');
      else {
        const txt = (await venceEl.textContent())?.trim() ?? '';
        const inst = await venceEl.getAttribute('data-instante');
        if (txt !== '2026-10-14 01:30 UTC') fallas.push(`boleta-vence-en texto=«${txt}», esperado «2026-10-14 01:30 UTC»`);
        if (inst !== bApi.venceEn) fallas.push(`boleta-vence-en data-instante=«${inst}», esperado «${bApi.venceEn}»`);
      }
      await recolectar(page);
      brazo('L5', fallas.length === 0, fallas.join(' · '));
    } finally {
      await relojBackendDesfijar().catch(() => {});
    }
  });

  // ── L6 · monto literal ───────────────────────────────────────────────────────────────
  await correr('L6', async () => {
    const s = await sembrarBoletasAfirmado();
    const bApi = await boletasApi(s.token);
    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('L6', false, ir.motivo); return; }

    const fallas = [];
    for (const b of bApi) {
      const montoEl = await page.$(`${sel('boleta-fila')}[data-boleta-id="${b.id}"] ${sel('boleta-monto')}`);
      if (!montoEl) {
        fallas.push(`boleta-monto no encontrado para ${b.id}`);
        continue;
      }
      const mAttr = await montoEl.getAttribute('data-monto');
      if (mAttr !== b.monto) fallas.push(`boleta ${b.id} data-monto="${mAttr}", esperado "${b.monto}"`);
    }
    await recolectar(page);
    brazo('L6', fallas.length === 0, fallas.join(' · '));
  });

  // ── E1 · emitir (CA4) ────────────────────────────────────────────────────────────────
  await correr('E1', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('E1', false, ir.motivo); return; }

    // enmendado en F4a de UX-b2 (O2)
    const pestanaEmitirE1 = await page.waitForSelector(sel('boletas-pestana-emitir'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!pestanaEmitirE1) { brazo('E1', false, 'boletas-pestana-emitir no aparece (la pestaña no existe)'); return; }
    await page.click(sel('boletas-pestana-emitir'));
    await page.waitForSelector(sel('boletas-panel-emitir'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null); // C4

    if (!(await visible(page, 'emitir-form'))) {
      brazo('E1', false, 'emitir-form no aparece');
      return;
    }

    let peticionPost = null;
    let clavePost = null;
    let cuerpoPost = null;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url() === `${API}/boletas`) {
        peticionPost = req;
        clavePost = req.headers()['idempotency-key'];
        try { cuerpoPost = JSON.parse(req.postData() || '{}'); } catch {}
      }
    });

    await llenarFormularioEmitir(page, {
      origenId: s.cuentaId,
      monto: MONTO_FELIZ,
      plazo: PLAZO_FELIZ,
      benRut: RUT_BENEFICIARIO,
      benNombre: NOMBRE_BENEFICIARIO,
      retRut: RUT_RETIRADOR,
      retNombre: NOMBRE_RETIRADOR,
      glosa: GLOSA_FELIZ,
    });

    await page.click(sel('emitir-enviar'));
    const exito = await page.waitForSelector(sel('emitir-exito'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    const fallas = [];
    if (!exito) fallas.push('emitir-exito no visible');
    else {
      await recolectar(page);
      if (!peticionPost) fallas.push('no se interceptó POST /boletas');
      if (!clavePost) fallas.push('Idempotency-Key vacía o ausente');
      if (cuerpoPost?.monto !== '250.10' || typeof cuerpoPost?.monto !== 'string') {
        fallas.push(`cuerpo.monto = ${JSON.stringify(cuerpoPost?.monto)}, esperado "250.10" (string)`);
      }
      if (cuerpoPost?.cuentaOrigenId !== s.cuentaId) {
        fallas.push(`cuerpo.cuentaOrigenId = ${JSON.stringify(cuerpoPost?.cuentaOrigenId)}, esperado «${s.cuentaId}»`);
      }
      if (cuerpoPost?.plazoDias !== 30 || typeof cuerpoPost?.plazoDias !== 'number') {
        fallas.push(`cuerpo.plazoDias = ${JSON.stringify(cuerpoPost?.plazoDias)}, esperado 30 (number)`);
      }

      const nuevaId = (await page.textContent(sel('emitir-boleta-id')))?.trim();
      if (!nuevaId) fallas.push('emitir-boleta-id vacío');
      // UX-b2 § 5 (D140-2): tras el éxito la pestaña no conmuta; recién se abre «Mis boletas».
      const emitirSigueSel = await page.waitForSelector(`${sel('boletas-pestana-emitir')}[aria-selected="true"]`, { state: 'visible', timeout: ESPERA_MS })
        .then(() => true, () => false);
      if (!emitirSigueSel) fallas.push('boletas-pestana-emitir sin aria-selected="true" tras emitir (D140-2)');
      if (nuevaId && emitirSigueSel) {
        await page.click(sel('boletas-pestana-lista'));
        const fila = await page.waitForSelector(`${sel('boleta-fila')}[data-boleta-id="${nuevaId}"][data-estado="VIGENTE"]`, { state: 'visible', timeout: ESPERA_MS })
          .then(() => true, () => false);
        if (!fila) fallas.push(`boleta-fila con id ${nuevaId} y estado VIGENTE no apareció en tabla`);
      }

      const estadoFormE1 = await page.getAttribute(sel('emitir-form'), 'data-estado');
      if (estadoFormE1 !== 'editando') fallas.push(`emitir-form data-estado="${estadoFormE1}", esperado "editando"`);
      for (const campo of ['emitir-monto', 'emitir-plazo', 'emitir-beneficiario-rut', 'emitir-beneficiario-nombre', 'emitir-retirador-rut', 'emitir-retirador-nombre', 'emitir-glosa']) {
        const v = await page.$eval(sel(campo), (e) => e.value).catch(() => null);
        if (v !== '') fallas.push(`tras éxito, ${campo} = «${v}», esperado vacío`);
      }

      const cuentas = await cuentasApi(s.token);
      const cOrigen = cuentas.find((c) => c.id === s.cuentaId);
      if (cOrigen?.saldo !== '489.90') fallas.push(`saldo cuenta API = «${cOrigen?.saldo}», esperado 489.90`);
    }
    await recolectar(page);
    brazo('E1', fallas.length === 0, fallas.join(' · '));
  });

  // ── E2 · doble clic ──────────────────────────────────────────────────────────────────
  await correr('E2', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('E2', false, ir.motivo); return; }

    // enmendado en F4a de UX-b2 (O2)
    const pestanaEmitirE2 = await page.waitForSelector(sel('boletas-pestana-emitir'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!pestanaEmitirE2) { brazo('E2', false, 'boletas-pestana-emitir no aparece (la pestaña no existe)'); return; }
    await page.click(sel('boletas-pestana-emitir'));
    await page.waitForSelector(sel('boletas-panel-emitir'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null); // C4

    if (!(await visible(page, 'emitir-form'))) {
      brazo('E2', false, 'emitir-form no aparece');
      return;
    }

    const claves = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url() === `${API}/boletas`) {
        claves.push(req.headers()['idempotency-key']);
      }
    });

    await llenarFormularioEmitir(page, {
      origenId: s.cuentaId,
      monto: MONTO_FELIZ,
      plazo: PLAZO_FELIZ,
      benRut: RUT_BENEFICIARIO,
      benNombre: NOMBRE_BENEFICIARIO,
      retRut: RUT_RETIRADOR,
      retNombre: NOMBRE_RETIRADOR,
      glosa: GLOSA_FELIZ,
    });

    await page.dblclick(sel('emitir-enviar'));

    const exito = await page.waitForSelector(sel('emitir-exito'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    const fallas = [];
    if (!exito) fallas.push('emitir-exito no visible');
    else {
      if (claves.length < 1) fallas.push(`se capturaron ${claves.length} POSTs, esperados >= 1`);
      const difClaves = new Set(claves);
      if (difClaves.size !== 1) fallas.push(`claves distintas en doble clic: [${claves.join(', ')}]`);

      const cuentas = await cuentasApi(s.token);
      const cOrigen = cuentas.find((c) => c.id === s.cuentaId);
      if (cOrigen?.saldo !== '489.90') fallas.push(`saldo cuenta API = «${cOrigen?.saldo}», esperado 489.90`);

      const boletas = await boletasApi(s.token);
      if (boletas.length !== 6) fallas.push(`boletas API = ${boletas.length}, esperado 6 (una más)`);
    }
    await recolectar(page);
    brazo('E2', fallas.length === 0, fallas.join(' · '));
  });

  // ── E3 · clave nueva por operación ───────────────────────────────────────────────────
  await correr('E3', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('E3', false, ir.motivo); return; }

    // enmendado en F4a de UX-b2 (O2)
    const pestanaEmitirE3 = await page.waitForSelector(sel('boletas-pestana-emitir'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!pestanaEmitirE3) { brazo('E3', false, 'boletas-pestana-emitir no aparece (la pestaña no existe)'); return; }
    await page.click(sel('boletas-pestana-emitir'));
    await page.waitForSelector(sel('boletas-panel-emitir'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null); // C4

    if (!(await visible(page, 'emitir-form'))) {
      brazo('E3', false, 'emitir-form no aparece');
      return;
    }

    const claves = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url() === `${API}/boletas`) {
        claves.push(req.headers()['idempotency-key']);
      }
    });

    // Primera emisión
    await llenarFormularioEmitir(page, {
      origenId: s.cuentaId,
      monto: MONTO_FELIZ,
      plazo: PLAZO_FELIZ,
      benRut: RUT_BENEFICIARIO,
      benNombre: NOMBRE_BENEFICIARIO,
      retRut: RUT_RETIRADOR,
      retNombre: NOMBRE_RETIRADOR,
      glosa: GLOSA_FELIZ,
    });
    await page.click(sel('emitir-enviar'));
    const exito1 = await page.waitForSelector(sel('emitir-exito'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!exito1) {
      brazo('E3', false, 'emitir-exito no visible en primera emisión');
      return;
    }

    // Segunda emisión
    await llenarFormularioEmitir(page, {
      origenId: s.cuentaId,
      monto: MONTO_FELIZ,
      plazo: PLAZO_FELIZ,
      benRut: RUT_BENEFICIARIO,
      benNombre: NOMBRE_BENEFICIARIO,
      retRut: RUT_RETIRADOR,
      retNombre: NOMBRE_RETIRADOR,
      glosa: GLOSA_FELIZ,
    });
    const respPost2 = page.waitForResponse((r) => r.request().method() === 'POST' && r.url() === `${API}/boletas`, { timeout: ESPERA_MS });
    await page.click(sel('emitir-enviar'));
    await respPost2;
    const exito2 = await page.waitForSelector(sel('emitir-exito'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    const fallas = [];
    if (!exito2) fallas.push('emitir-exito no visible en segunda emisión');
    if (claves.length < 2) fallas.push(`se capturaron ${claves.length} POSTs`);
    else if (claves[0] === claves[1]) fallas.push(`misma clave en dos emisiones distintas: «${claves[0]}»`);

    await recolectar(page);
    brazo('E3', fallas.length === 0, fallas.join(' · '));
  });

  // ── E4 · rechazos con código (CA5) ───────────────────────────────────────────────────
  await correr('E4', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('E4', false, ir.motivo); return; }

    // enmendado en F4a de UX-b2 (O2)
    const pestanaEmitirE4 = await page.waitForSelector(sel('boletas-pestana-emitir'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!pestanaEmitirE4) { brazo('E4', false, 'boletas-pestana-emitir no aparece (la pestaña no existe)'); return; }
    await page.click(sel('boletas-pestana-emitir'));
    await page.waitForSelector(sel('boletas-panel-emitir'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null); // C4

    if (!(await visible(page, 'emitir-form'))) {
      brazo('E4', false, 'emitir-form no aparece');
      return;
    }

    const casos = [
      { campo: 'plazo', valor: '0', codigo: 'PLAZO_INVALIDO' },
      { campo: 'benRut', valor: RUT_INVALIDO, codigo: 'RUT_INVALIDO' },
      { campo: 'retRut', valor: RUT_INVALIDO, codigo: 'RUT_INVALIDO' },
      { campo: 'benNombre', valor: NOMBRE_LARGO, codigo: 'NOMBRE_INVALIDO' },
      { campo: 'glosa', valor: GLOSA_LARGA, codigo: 'GLOSA_INVALIDA' },
      { campo: 'monto', valor: MONTO_COMA, codigo: 'MONTO_INVALIDO' },
      { campo: 'monto', valor: MONTO_EXCEDE, codigo: 'FONDOS_INSUFICIENTES' },
    ];

    const fallas = [];
    for (const c of casos) {
      const base = {
        origenId: s.cuentaId,
        monto: MONTO_FELIZ,
        plazo: PLAZO_FELIZ,
        benRut: RUT_BENEFICIARIO,
        benNombre: NOMBRE_BENEFICIARIO,
        retRut: RUT_RETIRADOR,
        retNombre: NOMBRE_RETIRADOR,
        glosa: GLOSA_FELIZ,
        [c.campo]: c.valor,
      };
      await llenarFormularioEmitir(page, base);
      const respPost = page.waitForResponse((r) => r.request().method() === 'POST' && r.url() === `${API}/boletas`, { timeout: ESPERA_MS });
      await page.click(sel('emitir-enviar'));
      try {
        await respPost;
      } catch {
        fallas.push(`caso ${c.campo}=«${c.valor.slice(0, 10)}»: sin respuesta del POST`);
        continue;
      }

      const errorVis = await page.waitForSelector(`${sel('emitir-error')}[data-codigo="${c.codigo}"]`, { state: 'visible', timeout: ESPERA_MS })
        .then(() => true, () => false);
      if (!errorVis) {
        fallas.push(`caso ${c.campo}=«${c.valor.slice(0, 10)}»: emitir-error[data-codigo="${c.codigo}"] no visible`);
      } else {
        const estadoForm = await page.getAttribute(sel('emitir-form'), 'data-estado');
        if (estadoForm !== 'error') fallas.push(`caso ${c.campo}: emitir-form data-estado="${estadoForm}", esperado "error"`);
      }
      const cuentas = await cuentasApi(s.token);
      const cOrigen = cuentas.find((x) => x.id === s.cuentaId);
      if (cOrigen?.saldo !== '740.00') fallas.push(`caso ${c.campo}: saldo API cambió a «${cOrigen?.saldo}»`);
      const boletas = await boletasApi(s.token);
      if (boletas.length !== 5) fallas.push(`caso ${c.campo}: boletas API cambió a ${boletas.length}`);
      await recolectar(page);
    }
    brazo('E4', fallas.length === 0, fallas.join(' · '));
  });

  // ── E5 · sin validación nativa (J1) ──────────────────────────────────────────────────
  await correr('E5', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('E5', false, ir.motivo); return; }

    // enmendado en F4a de UX-b2 (O2)
    const pestanaEmitirE5 = await page.waitForSelector(sel('boletas-pestana-emitir'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!pestanaEmitirE5) { brazo('E5', false, 'boletas-pestana-emitir no aparece (la pestaña no existe)'); return; }
    await page.click(sel('boletas-pestana-emitir'));
    await page.waitForSelector(sel('boletas-panel-emitir'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null); // C4

    if (!(await visible(page, 'emitir-form'))) {
      brazo('E5', false, 'emitir-form no aparece');
      return;
    }

    let salioPost = false;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url() === `${API}/boletas`) salioPost = true;
    });

    await llenarFormularioEmitir(page, {
      origenId: s.cuentaId,
      monto: MONTO_FELIZ,
      plazo: '1.5',
      benRut: RUT_BENEFICIARIO,
      benNombre: NOMBRE_BENEFICIARIO,
      retRut: RUT_RETIRADOR,
      retNombre: NOMBRE_RETIRADOR,
      glosa: GLOSA_FELIZ,
    });

    await page.click(sel('emitir-enviar'));
    const errorVis = await page.waitForSelector(`${sel('emitir-error')}[data-codigo="PLAZO_INVALIDO"]`, { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    const fallas = [];
    if (!salioPost) fallas.push('no salió POST /boletas con plazo "1.5" (validación nativa client-side)');
    if (!errorVis) fallas.push('emitir-error[data-codigo="PLAZO_INVALIDO"] no visible');
    await recolectar(page);
    brazo('E5', fallas.length === 0, fallas.join(' · '));
  });

  // ── E6 · sin respuesta, ejecutada ────────────────────────────────────────────────────
  await correr('E6', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    let intentos = 0;
    const claves = [];
    await page.route(`${API}/boletas`, async (route) => {
      if (route.request().method() === 'POST') {
        intentos++;
        claves.push(route.request().headers()['idempotency-key']);
        if (intentos === 1) {
          await route.fetch();
          return route.abort('failed');
        }
      }
      return route.continue();
    });

    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('E6', false, ir.motivo); return; }

    // enmendado en F4a de UX-b2 (O2)
    const pestanaEmitirE6 = await page.waitForSelector(sel('boletas-pestana-emitir'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!pestanaEmitirE6) { brazo('E6', false, 'boletas-pestana-emitir no aparece (la pestaña no existe)'); return; }
    await page.click(sel('boletas-pestana-emitir'));
    await page.waitForSelector(sel('boletas-panel-emitir'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null); // C4

    if (!(await visible(page, 'emitir-form'))) {
      brazo('E6', false, 'emitir-form no aparece');
      return;
    }

    await llenarFormularioEmitir(page, {
      origenId: s.cuentaId,
      monto: MONTO_FELIZ,
      plazo: PLAZO_FELIZ,
      benRut: RUT_BENEFICIARIO,
      benNombre: NOMBRE_BENEFICIARIO,
      retRut: RUT_RETIRADOR,
      retNombre: NOMBRE_RETIRADOR,
      glosa: GLOSA_FELIZ,
    });

    await page.click(sel('emitir-enviar'));
    const sinResp = await page.waitForSelector(sel('emitir-sin-respuesta'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    const fallas = [];
    if (!sinResp) fallas.push('emitir-sin-respuesta no visible');
    else {
      await recolectar(page);
      if (await visible(page, 'emitir-error')) fallas.push('emitir-error visible en pérdida de red');
      if (!(await visible(page, 'emitir-reintentar'))) fallas.push('emitir-reintentar no visible');
      else {
        await page.click(sel('emitir-reintentar'));
        const exito = await page.waitForSelector(sel('emitir-exito'), { state: 'visible', timeout: ESPERA_MS })
          .then(() => true, () => false);
        if (!exito) fallas.push('emitir-exito no visible tras reintentar');
        else {
          if (claves.length < 2 || claves[0] !== claves[1]) fallas.push(`reintentar cambió clave: [${claves.join(', ')}]`);
          const cuentas = await cuentasApi(s.token);
          const cOrigen = cuentas.find((x) => x.id === s.cuentaId);
          if (cOrigen?.saldo !== '489.90') fallas.push(`saldo cuenta API = «${cOrigen?.saldo}», esperado 489.90 (baja una sola vez)`);
          const boletas = await boletasApi(s.token);
          if (boletas.length !== 6) fallas.push(`boletas API = ${boletas.length}, esperado 6 (una sola vez)`);
        }
      }
    }
    await recolectar(page);
    brazo('E6', fallas.length === 0, fallas.join(' · '));
  });

  // ── E7 · token en el POST ────────────────────────────────────────────────────────────
  await correr('E7', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await page.route(`${API}/boletas`, async (route) => {
      if (route.request().method() === 'POST') {
        const headers = { ...route.request().headers() };
        delete headers['authorization'];
        const res = await route.fetch({ headers });
        return route.fulfill({ response: res });
      }
      return route.continue();
    });

    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('E7', false, ir.motivo); return; }

    // enmendado en F4a de UX-b2 (O2)
    const pestanaEmitirE7 = await page.waitForSelector(sel('boletas-pestana-emitir'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!pestanaEmitirE7) { brazo('E7', false, 'boletas-pestana-emitir no aparece (la pestaña no existe)'); return; }
    await page.click(sel('boletas-pestana-emitir'));
    await page.waitForSelector(sel('boletas-panel-emitir'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null); // C4

    if (!(await visible(page, 'emitir-form'))) {
      brazo('E7', false, 'emitir-form no aparece');
      return;
    }

    await llenarFormularioEmitir(page, {
      origenId: s.cuentaId,
      monto: MONTO_FELIZ,
      plazo: PLAZO_FELIZ,
      benRut: RUT_BENEFICIARIO,
      benNombre: NOMBRE_BENEFICIARIO,
      retRut: RUT_RETIRADOR,
      retNombre: NOMBRE_RETIRADOR,
      glosa: GLOSA_FELIZ,
    });

    await page.click(sel('emitir-enviar'));
    const aviso = await page.waitForSelector(`${sel('sesion-aviso')}[data-motivo="token"][data-codigo="TOKEN_AUSENTE"]`, { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    const fallas = [];
    if (!aviso) fallas.push('sesion-aviso[data-motivo="token"][data-codigo="TOKEN_AUSENTE"] no visible');
    else {
      if (await visible(page, 'usuario-email')) fallas.push('usuario-email sigue visible tras 401');
    }
    await recolectar(page);
    brazo('E7', fallas.length === 0, fallas.join(' · '));
  });

  // ── E8 · emitir envía lo escrito (J1; § 5.3 H-1) ────────────────────────────────────
  await correr('E8', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('E8', false, ir.motivo); return; }

    // enmendado en F4a de UX-b2 (O2)
    const pestanaEmitirE8 = await page.waitForSelector(sel('boletas-pestana-emitir'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!pestanaEmitirE8) { brazo('E8', false, 'boletas-pestana-emitir no aparece (la pestaña no existe)'); return; }
    await page.click(sel('boletas-pestana-emitir'));
    await page.waitForSelector(sel('boletas-panel-emitir'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null); // C4

    if (!(await visible(page, 'emitir-form'))) {
      brazo('E8', false, 'emitir-form no aparece');
      return;
    }

    const benRutEscrito = ` ${RUT_BENEFICIARIO} `;
    const benNombreEscrito = ` ${NOMBRE_BENEFICIARIO} `;
    const retRutEscrito = ` ${RUT_RETIRADOR} `;
    const retNombreEscrito = ` ${NOMBRE_RETIRADOR} `;
    const glosaEscrita = ` ${GLOSA_FELIZ} `;

    await llenarFormularioEmitir(page, {
      origenId: s.cuentaId,
      monto: MONTO_FELIZ,
      plazo: PLAZO_FELIZ,
      benRut: benRutEscrito,
      benNombre: benNombreEscrito,
      retRut: retRutEscrito,
      retNombre: retNombreEscrito,
      glosa: glosaEscrita,
    });

    const resp = page.waitForResponse((r) => r.request().method() === 'POST' && r.url() === `${API}/boletas`, { timeout: ESPERA_MS });
    await page.click(sel('emitir-enviar'));

    let cuerpo = null;
    try {
      const post = await resp;
      try { cuerpo = JSON.parse(post.request().postData() || '{}'); } catch {}
    } catch {
      brazo('E8', false, 'sin respuesta del POST /boletas');
      return;
    }

    const esperados = [
      ['beneficiarioRut', benRutEscrito],
      ['beneficiarioNombre', benNombreEscrito],
      ['retiradorRut', retRutEscrito],
      ['retiradorNombre', retNombreEscrito],
      ['glosa', glosaEscrita],
    ];
    const fallas = [];
    for (const [campo, escrito] of esperados) {
      if (cuerpo?.[campo] !== escrito) {
        fallas.push(`${campo} «${cuerpo?.[campo]}» ≠ «${escrito}»`);
      }
    }
    await recolectar(page);
    brazo('E8', fallas.length === 0, fallas.join(' · '));
  });

  // ── E9 · el envío de emitir se cierra mientras está en curso (§ 4.3; § 5.4 H-5) ──────
  await correr('E9', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();

    let soltarPost;
    const postRetenido = new Promise((r) => { soltarPost = r; });
    let resolverPostLlego;
    const promPostLlego = new Promise((r) => { resolverPostLlego = r; });

    await page.route(`${API}/boletas`, async (route) => {
      if (route.request().method() === 'POST') {
        resolverPostLlego?.();
        await postRetenido;
      }
      return route.continue();
    });

    try {
      await entrarUI(page, s.email, s.password);
      await estadoTerminal(page);

      const ir = await irABoletas(page);
      if (!ir.ok) { brazo('E9', false, ir.motivo); return; }

      // enmendado en F4a de UX-b2 (O2)
      const pestanaEmitirE9 = await page.waitForSelector(sel('boletas-pestana-emitir'), { state: 'visible', timeout: ESPERA_MS })
        .then(() => true, () => false);
      if (!pestanaEmitirE9) { brazo('E9', false, 'boletas-pestana-emitir no aparece (la pestaña no existe)'); return; }
      await page.click(sel('boletas-pestana-emitir'));
      await page.waitForSelector(sel('boletas-panel-emitir'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null); // C4

      if (!(await visible(page, 'emitir-form'))) {
        brazo('E9', false, 'emitir-form no aparece');
        return;
      }

      await llenarFormularioEmitir(page, {
        origenId: s.cuentaId,
        monto: MONTO_FELIZ,
        plazo: PLAZO_FELIZ,
        benRut: RUT_BENEFICIARIO,
        benNombre: NOMBRE_BENEFICIARIO,
        retRut: RUT_RETIRADOR,
        retNombre: NOMBRE_RETIRADOR,
        glosa: GLOSA_FELIZ,
      });

      const fallas = [];
      const promReq = page.waitForRequest((r) => r.method() === 'POST' && r.url() === `${API}/boletas`, { timeout: ESPERA_MS });
      await page.click(sel('emitir-enviar'));
      await Promise.all([promReq, promPostLlego]);

      const deshabilitadoEnCurso = await page.isDisabled(sel('emitir-enviar'));
      if (!deshabilitadoEnCurso) {
        fallas.push('emitir-enviar no está deshabilitado mientras el envío está en curso');
      }

      soltarPost?.();

      const exito = await page.waitForSelector(sel('emitir-exito'), { state: 'visible', timeout: ESPERA_MS })
        .then(() => true, () => false);
      if (!exito) {
        fallas.push('emitir-exito no visible tras liberar el POST');
      } else {
        const deshabilitadoTrasExito = await page.isDisabled(sel('emitir-enviar'));
        if (deshabilitadoTrasExito) {
          fallas.push('emitir-enviar sigue deshabilitado tras éxito');
        }
      }

      await recolectar(page);
      brazo('E9', fallas.length === 0, fallas.join(' · '));
    } finally {
      soltarPost?.();
    }
  });

  // ── A1 · devolver (CA7) ──────────────────────────────────────────────────────────────
  await correr('A1', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('A1', false, ir.motivo); return; }

    const idVigente = s.ids['VIGENTE'];
    const filaSel = `${sel('boleta-fila')}[data-boleta-id="${idVigente}"]`;
    const btnDevolver = await page.$(`${filaSel} ${sel('boleta-devolver')}`);
    if (!btnDevolver) {
      brazo('A1', false, 'boleta-devolver no visible en VIGENTE');
      return;
    }

    let clavePost = null;
    let postVisto = false;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url() === `${API}/boletas/${idVigente}/devolver`) {
        clavePost = req.headers()['idempotency-key'];
        postVisto = true;
      }
    });
    const relee = page.waitForRequest((r) => r.method() === 'GET' && r.url() === `${API}/boletas` && postVisto,
      { timeout: ESPERA_MS }).then(() => true, () => false);

    await btnDevolver.click();
    const devuelto = await page.waitForSelector(`${filaSel}[data-estado="DEVUELTA"][data-fondos-liberados="true"]`, { state: 'attached', timeout: ESPERA_MS })
      .then(() => true, () => false);
    const fallas = [];
    if (!devuelto) fallas.push('fila no pasó a data-estado="DEVUELTA" y data-fondos-liberados="true"');
    else {
      if (!clavePost) fallas.push('Idempotency-Key ausente en POST devolver');
      if (!(await relee)) fallas.push('no se pidió GET /boletas después del POST');
      // § 5.2 (JZ4): selector compuesto → page.isVisible directo; `visible` envuelve con sel() y daba SyntaxError
      if (await page.isVisible(`${filaSel} ${sel('boleta-devolver')}`)) fallas.push('boleta-devolver sigue visible');
      if (!(await page.isVisible(`${filaSel} ${sel('boleta-resumen-pdf')}`))) fallas.push('boleta-resumen-pdf no visible tras devolver');

      const cuentas = await cuentasApi(s.token);
      const cOrigen = cuentas.find((x) => x.id === s.cuentaId);
      if (cOrigen?.saldo !== '900.00') fallas.push(`saldo cuenta API = «${cOrigen?.saldo}», esperado 900.00`);
    }
    await recolectar(page);
    brazo('A1', fallas.length === 0, fallas.join(' · '));
  });

  // ── A2 · liberar (CA6) ───────────────────────────────────────────────────────────────
  await correr('A2', async () => {
    try {
      await relojBackendFijar(INSTANTE_F_ISO);
      const s = await sembrarBoletasAfirmado();
      const saldoInicial = '740.00';

      const page1 = await paginaNueva();
      await entrarUI(page1, s.email, s.password);
      await estadoTerminal(page1);

      const ir1 = await irABoletas(page1);
      if (!ir1.ok) { brazo('A2', false, ir1.motivo); return; }

      // enmendado en F4a de UX-b2 (O2)
      const pestanaEmitirA2 = await page1.waitForSelector(sel('boletas-pestana-emitir'), { state: 'visible', timeout: ESPERA_MS })
        .then(() => true, () => false);
      if (!pestanaEmitirA2) { brazo('A2', false, 'boletas-pestana-emitir no aparece (la pestaña no existe)'); return; }
      await page1.click(sel('boletas-pestana-emitir'));
      await page1.waitForSelector(sel('boletas-panel-emitir'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null); // C4

      if (!(await visible(page1, 'emitir-form'))) {
        brazo('A2', false, 'emitir-form no aparece');
        return;
      }

      await llenarFormularioEmitir(page1, {
        origenId: s.cuentaId,
        monto: MONTO_FELIZ,
        plazo: PLAZO_FELIZ,
        benRut: RUT_BENEFICIARIO,
        benNombre: NOMBRE_BENEFICIARIO,
        retRut: RUT_RETIRADOR,
        retNombre: NOMBRE_RETIRADOR,
        glosa: GLOSA_FELIZ,
      });
      await page1.click(sel('emitir-enviar'));
      const exito = await page1.waitForSelector(sel('emitir-exito'), { state: 'visible', timeout: ESPERA_MS })
        .then(() => true, () => false);
      if (!exito) { brazo('A2', false, 'emitir-exito no visible'); return; }
      const nuevaId = (await page1.textContent(sel('emitir-boleta-id')))?.trim();
      if (!nuevaId) { brazo('A2', false, 'emitir-boleta-id vacío'); return; }

      const cPost = (await cuentasApi(s.token)).find((x) => x.id === s.cuentaId);
      if (cPost?.saldo !== '489.90') {
        brazo('A2', false, `saldo tras emitir = ${cPost?.saldo}, esperado 489.90`);
        return;
      }

      // Avanzar reloj 31 días (2678400000 ms)
      await relojBackendAvanzar(AVANCE_A2_MS);
      const { token: tokenNuevo } = await tokenDe(s.email, s.password); // § 5.2 (JZ5): tokenDe devuelve el cuerpo del login

      // Entrada de nuevo (el token anterior vence al pasar 31 días)
      const page2 = await paginaNueva();
      await entrarUI(page2, s.email, s.password);
      await estadoTerminal(page2);

      const ir2 = await irABoletas(page2);
      if (!ir2.ok) { brazo('A2', false, ir2.motivo); return; }

      const filaSel = `${sel('boleta-fila')}[data-boleta-id="${nuevaId}"]`;
      const filaVencida = await page2.waitForSelector(`${filaSel}[data-estado="VENCIDA"][data-fondos-liberados="false"]`, { state: 'attached', timeout: ESPERA_MS })
        .then(() => true, () => false);
      const fallas = [];
      if (!filaVencida) fallas.push('fila emitida no aparece VENCIDA con data-fondos-liberados="false" tras avanzar reloj');
      else {
        if (await page2.isVisible(`${filaSel} ${sel('boleta-devolver')}`)) fallas.push('boleta-devolver visible en vencida');
        const btnLiberar = await page2.$(`${filaSel} ${sel('boleta-liberar')}`);
        if (!btnLiberar) fallas.push('boleta-liberar no visible en VENCIDA con fondos por liberar');
        else {
          let claveVencer = null;
          page2.on('request', (req) => {
            if (req.method() === 'POST' && req.url() === `${API}/boletas/${nuevaId}/vencer`) {
              claveVencer = req.headers()['idempotency-key'];
            }
          });
          await btnLiberar.click();
          const liberada = await page2.waitForSelector(`${filaSel}[data-fondos-liberados="true"]`, { state: 'attached', timeout: ESPERA_MS })
            .then(() => true, () => false);
          if (!liberada) fallas.push('fila no pasó a data-fondos-liberados="true" tras liberar');
          if (!claveVencer) fallas.push('Idempotency-Key ausente en POST vencer');
          if (await page2.isVisible(`${filaSel} ${sel('boleta-liberar')}`)) fallas.push('boleta-liberar sigue visible');

          const cuentasFin = await cuentasApi(tokenNuevo);
          const cFin = cuentasFin.find((x) => x.id === s.cuentaId);
          if (cFin?.saldo !== saldoInicial) fallas.push(`saldo cuenta API = «${cFin?.saldo}», esperado saldo original ${saldoInicial}`);
        }
      }
      await recolectar(page2);
      brazo('A2', fallas.length === 0, fallas.join(' · '));
    } finally {
      await relojBackendDesfijar().catch(() => {});
    }
  });

  // ── A3 · doble clic en una acción ────────────────────────────────────────────────────
  await correr('A3', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('A3', false, ir.motivo); return; }

    const idVigente = s.ids['VIGENTE'];
    const filaSel = `${sel('boleta-fila')}[data-boleta-id="${idVigente}"]`;
    const btnDevolver = await page.$(`${filaSel} ${sel('boleta-devolver')}`);
    if (!btnDevolver) {
      brazo('A3', false, 'boleta-devolver no visible en VIGENTE');
      return;
    }

    const claves = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url() === `${API}/boletas/${idVigente}/devolver`) {
        claves.push(req.headers()['idempotency-key']);
      }
    });

    await btnDevolver.dblclick();

    const devuelto = await page.waitForSelector(`${filaSel}[data-estado="DEVUELTA"]`, { state: 'attached', timeout: ESPERA_MS })
      .then(() => true, () => false);
    const fallas = [];
    if (!devuelto) fallas.push('fila no pasó a data-estado="DEVUELTA"');
    else {
      if (claves.length < 1) fallas.push(`se capturaron ${claves.length} POSTs`);
      const difClaves = new Set(claves);
      if (difClaves.size !== 1) fallas.push(`claves distintas en doble clic: [${claves.join(', ')}]`);

      const cuentas = await cuentasApi(s.token);
      const cOrigen = cuentas.find((x) => x.id === s.cuentaId);
      if (cOrigen?.saldo !== '900.00') fallas.push(`saldo cuenta API = «${cOrigen?.saldo}», esperado 900.00`);
    }
    await recolectar(page);
    brazo('A3', fallas.length === 0, fallas.join(' · '));
  });

  // ── A4 · acción rechazada ────────────────────────────────────────────────────────────
  await correr('A4', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('A4', false, ir.motivo); return; }

    const idVigente = s.ids['VIGENTE'];
    const filaSel = `${sel('boleta-fila')}[data-boleta-id="${idVigente}"]`;
    const btnDevolver = await page.$(`${filaSel} ${sel('boleta-devolver')}`);
    if (!btnDevolver) {
      brazo('A4', false, 'boleta-devolver no visible en VIGENTE');
      return;
    }

    // Devolver por el API antes del clic en la UI
    const rDev = await pedir('POST', `/boletas/${idVigente}/devolver`, {
      ...JSON_H,
      authorization: `Bearer ${s.token}`,
      'idempotency-key': randomUUID(),
    });
    if (rDev.status !== 200) throw new Error(`preparación: devolución por API dio ${rDev.status}`);

    let postVisto = false;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url() === `${API}/boletas/${idVigente}/devolver`) postVisto = true;
    });
    const relee = page.waitForRequest((r) => r.method() === 'GET' && r.url() === `${API}/boletas` && postVisto,
      { timeout: ESPERA_MS }).then(() => true, () => false);

    await btnDevolver.click();

    const errorVis = await page.waitForSelector(`${sel('boletas-accion-error')}[data-codigo="TRANSICION_INVALIDA"][data-boleta-id="${idVigente}"]`, { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    const fallas = [];
    if (!errorVis) fallas.push(`boletas-accion-error[data-codigo="TRANSICION_INVALIDA"][data-boleta-id="${idVigente}"] no visible`);
    else await recolectar(page);
    const filaDev = await page.waitForSelector(`${filaSel}[data-estado="DEVUELTA"]`, { state: 'attached', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!filaDev) fallas.push('fila no se actualizó a DEVUELTA tras releer lista');
    else {
      if (!(await relee)) fallas.push('no se pidió GET /boletas después del POST');
      if (await page.$(`${filaSel} ${sel('boleta-devolver')}`)) fallas.push('boleta-devolver en la fila DEVUELTA');
    }

    const cuentas = await cuentasApi(s.token);
    const cOrigen = cuentas.find((x) => x.id === s.cuentaId);
    if (cOrigen?.saldo !== '900.00') fallas.push(`saldo cuenta API = «${cOrigen?.saldo}», esperado 900.00`);

    await recolectar(page);
    brazo('A4', fallas.length === 0, fallas.join(' · '));
  });

  // ── A5 · acción sin respuesta ────────────────────────────────────────────────────────
  await correr('A5', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    const idVigente = s.ids['VIGENTE'];
    await page.route(`**/boletas/${idVigente}/devolver`, async (route) => {
      await route.fetch();
      return route.abort('failed');
    });

    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('A5', false, ir.motivo); return; }

    const filaSel = `${sel('boleta-fila')}[data-boleta-id="${idVigente}"]`;
    const btnDevolver = await page.$(`${filaSel} ${sel('boleta-devolver')}`);
    if (!btnDevolver) {
      brazo('A5', false, 'boleta-devolver no visible en VIGENTE');
      return;
    }

    let postVisto = false;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url() === `${API}/boletas/${idVigente}/devolver`) postVisto = true;
    });
    const relee = page.waitForRequest((r) => r.method() === 'GET' && r.url() === `${API}/boletas` && postVisto,
      { timeout: ESPERA_MS }).then(() => true, () => false);

    await btnDevolver.click();
    const sinResp = await page.waitForSelector(sel('boletas-accion-sin-respuesta'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    const fallas = [];
    if (!sinResp) fallas.push('boletas-accion-sin-respuesta no visible');
    else {
      await recolectar(page);
      if (await visible(page, 'boletas-accion-error')) fallas.push('boletas-accion-error visible en pérdida de respuesta');
      const filaDev = await page.waitForSelector(`${filaSel}[data-estado="DEVUELTA"]`, { state: 'attached', timeout: ESPERA_MS })
        .then(() => true, () => false);
      if (!filaDev) fallas.push('fila no quedó en DEVUELTA');
      else if (!(await relee)) fallas.push('no se pidió GET /boletas después del POST');
    }
    await recolectar(page);
    brazo('A5', fallas.length === 0, fallas.join(' · '));
  });

  // ── P1 · comprobante ─────────────────────────────────────────────────────────────────
  await correr('P1', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('P1', false, ir.motivo); return; }

    const idVigente = s.ids['VIGENTE'];
    const filaSel = `${sel('boleta-fila')}[data-boleta-id="${idVigente}"]`;
    const btnPdf = await page.$(`${filaSel} ${sel('boleta-comprobante-pdf')}`);
    if (!btnPdf) {
      brazo('P1', false, 'boleta-comprobante-pdf no visible en VIGENTE');
      return;
    }

    let peticionPdf = null;
    let conteoGetPdf = 0;
    page.on('request', (req) => {
      if (req.method() === 'GET' && req.url().includes(`/boletas/${idVigente}/comprobante.pdf`)) {
        peticionPdf = req;
        conteoGetPdf++;
      }
    });
    let descargas = 0;
    page.on('download', () => { descargas++; });
    const respPdf = page.waitForResponse((r) => r.request().method() === 'GET' && r.url().includes(`/boletas/${idVigente}/comprobante.pdf`), { timeout: ESPERA_MS })
      .catch((e) => e);

    let nuevaPaginaAbierta = false;
    page.context().on('page', () => { nuevaPaginaAbierta = true; });

    const promDescarga = page.waitForEvent('download', { timeout: ESPERA_MS }).catch((e) => e);
    await btnPdf.click();
    const descarga = await promDescarga;
    const fallas = [];
    if (nuevaPaginaAbierta) fallas.push('se abrió otra página o pestaña');
    if (!(await visible(page, 'boletas-region'))) fallas.push('la app no sigue en boletas-region');

    if (descarga instanceof Error) {
      fallas.push(`descarga no emitida: ${descarga.message.split('\n')[0]}`);
    } else {
      const respRegistro = await respPdf;
      if (respRegistro instanceof Error) fallas.push(`respuesta del GET del PDF no vista: ${respRegistro.message.split('\n')[0]}`);
      await asentar(page);
      if (descargas !== 1) fallas.push(`descargas = ${descargas}, esperado 1`);
      if (conteoGetPdf !== 1) fallas.push(`GET del PDF contados = ${conteoGetPdf}, esperado 1`);

      const nombreEsperado = `boleta-${idVigente}-comprobante.pdf`;
      const nombre = descarga.suggestedFilename();
      if (nombre !== nombreEsperado) fallas.push(`nombre de descarga «${nombre}», esperado «${nombreEsperado}»`);

      if (!peticionPdf) fallas.push('no se interceptó GET .../comprobante.pdf');
      else {
        const authH = String(peticionPdf.headers()['authorization'] ?? '');
        if (!authH.startsWith('Bearer ')) fallas.push(`Authorization no es Bearer: «${authH}»`);
      }

      const ruta = await descarga.path().catch(() => null);
      if (!ruta) fallas.push('descarga.path() no disponible');
      else {
        const bytes = readFileSync(ruta);
        const magico = bytes.subarray(0, 5).toString('latin1');
        if (magico !== '%PDF-') fallas.push(`archivo descargado empieza con «${magico}», esperado %PDF-`);
        const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true });
        if (!text.includes(idVigente)) fallas.push(`texto del PDF no contiene id «${idVigente}»`);
      }
    }
    await recolectar(page);
    brazo('P1', fallas.length === 0, fallas.join(' · '));
  });

  // ── P2 · resumen ─────────────────────────────────────────────────────────────────────
  await correr('P2', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('P2', false, ir.motivo); return; }

    const idCobrada = s.ids['COBRADA'];
    const filaSel = `${sel('boleta-fila')}[data-boleta-id="${idCobrada}"]`;
    const btnPdf = await page.$(`${filaSel} ${sel('boleta-resumen-pdf')}`);
    if (!btnPdf) {
      brazo('P2', false, 'boleta-resumen-pdf no visible en COBRADA');
      return;
    }

    let peticionPdf = null;
    let conteoGetPdf = 0;
    page.on('request', (req) => {
      if (req.method() === 'GET' && req.url().includes(`/boletas/${idCobrada}/resumen.pdf`)) {
        peticionPdf = req;
        conteoGetPdf++;
      }
    });
    let descargas = 0;
    page.on('download', () => { descargas++; });
    const respPdf = page.waitForResponse((r) => r.request().method() === 'GET' && r.url().includes(`/boletas/${idCobrada}/resumen.pdf`), { timeout: ESPERA_MS })
      .catch((e) => e);

    let nuevaPaginaAbierta = false;
    page.context().on('page', () => { nuevaPaginaAbierta = true; });

    const promDescarga = page.waitForEvent('download', { timeout: ESPERA_MS }).catch((e) => e);
    await btnPdf.click();
    const descarga = await promDescarga;
    const fallas = [];
    if (nuevaPaginaAbierta) fallas.push('se abrió otra página o pestaña');
    if (!(await visible(page, 'boletas-region'))) fallas.push('la app no sigue en boletas-region');

    if (descarga instanceof Error) {
      fallas.push(`descarga no emitida: ${descarga.message.split('\n')[0]}`);
    } else {
      const respRegistro = await respPdf;
      if (respRegistro instanceof Error) fallas.push(`respuesta del GET del PDF no vista: ${respRegistro.message.split('\n')[0]}`);
      await asentar(page);
      if (descargas !== 1) fallas.push(`descargas = ${descargas}, esperado 1`);
      if (conteoGetPdf !== 1) fallas.push(`GET del PDF contados = ${conteoGetPdf}, esperado 1`);

      const nombreEsperado = `boleta-${idCobrada}-resumen.pdf`;
      const nombre = descarga.suggestedFilename();
      if (nombre !== nombreEsperado) fallas.push(`nombre de descarga «${nombre}», esperado «${nombreEsperado}»`);

      if (!peticionPdf) fallas.push('no se interceptó GET .../resumen.pdf');
      else {
        const authH = String(peticionPdf.headers()['authorization'] ?? '');
        if (!authH.startsWith('Bearer ')) fallas.push(`Authorization no es Bearer: «${authH}»`);
      }

      const ruta = await descarga.path().catch(() => null);
      if (!ruta) fallas.push('descarga.path() no disponible');
      else {
        const bytes = readFileSync(ruta);
        const magico = bytes.subarray(0, 5).toString('latin1');
        if (magico !== '%PDF-') fallas.push(`archivo descargado empieza con «${magico}», esperado %PDF-`);
        const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true });
        if (!text.includes(idCobrada)) fallas.push(`texto del PDF no contiene id «${idCobrada}»`);
      }
    }
    await recolectar(page);
    brazo('P2', fallas.length === 0, fallas.join(' · '));
  });

  // ── P3 · PDF que falla ───────────────────────────────────────────────────────────────
  await correr('P3', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    const idVigente = s.ids['VIGENTE'];
    await page.route(`**/boletas/${idVigente}/comprobante.pdf`, async (route) => {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ codigo: 'ERROR_PDF' }) });
    });

    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('P3', false, ir.motivo); return; }

    const filaSel = `${sel('boleta-fila')}[data-boleta-id="${idVigente}"]`;
    const btnPdf = await page.$(`${filaSel} ${sel('boleta-comprobante-pdf')}`);
    if (!btnPdf) {
      brazo('P3', false, 'boleta-comprobante-pdf no visible en VIGENTE');
      return;
    }

    let huboDescarga = false;
    page.on('download', () => { huboDescarga = true; });

    await btnPdf.click();
    const alerta = await page.waitForSelector(`${sel('boletas-region')} [role="alert"]`, { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    const fallas = [];
    if (!alerta) fallas.push('no apareció role="alert" dentro de boletas-region');
    if (huboDescarga) fallas.push('se emitió una descarga al fallar el PDF');

    await recolectar(page);
    brazo('P3', fallas.length === 0, fallas.join(' · '));
  });

  // ── P4 · el 401 de un PDF cierra la sesión (§ 4.1; § 5.3 H-4) ────────────────────────
  await correr('P4', async () => {
    const s = await sembrarBoletasAfirmado();
    const idVigente = s.ids['VIGENTE'];
    const page = await paginaNueva();
    await page.route(`**/boletas/${idVigente}/comprobante.pdf`, async (route) => {
      const headers = { ...route.request().headers() };
      delete headers['authorization'];
      const res = await route.fetch({ headers });
      return route.fulfill({ response: res });
    });

    let descargas = 0;
    page.on('download', () => { descargas++; });

    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('P4', false, ir.motivo); return; }

    const filaSel = `${sel('boleta-fila')}[data-boleta-id="${idVigente}"]`;
    const btnPdf = await page.$(`${filaSel} ${sel('boleta-comprobante-pdf')}`);
    if (!btnPdf) {
      brazo('P4', false, 'boleta-comprobante-pdf no visible en VIGENTE');
      return;
    }

    await btnPdf.click();
    const aviso = await page.waitForSelector(`${sel('sesion-aviso')}[data-motivo="token"][data-codigo="TOKEN_AUSENTE"]`, { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    const fallas = [];
    if (!aviso) fallas.push('sesion-aviso[data-motivo="token"][data-codigo="TOKEN_AUSENTE"] no visible');
    else {
      if (await visible(page, 'usuario-email')) fallas.push('usuario-email sigue visible tras 401');
      if (descargas !== 0) fallas.push(`descargas = ${descargas}, esperado 0`);
    }
    await recolectar(page);
    brazo('P4', fallas.length === 0, fallas.join(' · '));
  });

  // ── VT1 · llegada desde la portada (CA11) ─────────────────────────────────────────────
  await correr('VT1', async () => {
    const page = await paginaNueva();
    if (!(await visible(page, 'ir-ventanilla'))) {
      brazo('VT1', false, 'ir-ventanilla no aparece en la portada');
      return;
    }
    const rol = await page.$eval(sel('ir-ventanilla'), (e) => e.getAttribute('role') ?? (e.tagName === 'A' && e.hasAttribute('href') ? 'link' : e.tagName));
    const fallas = [];
    if (rol !== 'link') fallas.push(`ir-ventanilla con rol ${rol}`);

    await page.click(sel('ir-ventanilla'));
    const ventVisible = await page.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!ventVisible) fallas.push('ventanilla no visible tras clic');
    else {
      if (await visible(page, 'portada')) fallas.push('portada sigue visible');
      const hash = await page.evaluate(() => location.hash);
      if (hash !== '#ventanilla') fallas.push(`location.hash = «${hash}», esperado «#ventanilla»`);
    }
    await recolectar(page);
    brazo('VT1', fallas.length === 0, fallas.join(' · '));
  });

  // ── VT2 · URL directa (CA11) ─────────────────────────────────────────────────────────
  await correr('VT2', async () => {
    const page = await paginaNueva({}, true, URL_VENTANILLA);
    const ventVisible = await page.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    const fallas = [];
    if (!ventVisible) {
      brazo('VT2', false, 'ventanilla no visible en URL directa');
      return;
    }
    if (await visible(page, 'usuario-email')) fallas.push('sesión activa en ventanilla directa');
    if (await visible(page, 'portada')) fallas.push('portada visible con la ventanilla');
    await recolectar(page);
    brazo('VT2', fallas.length === 0, fallas.join(' · '));
  });

  // ── VT3 · volver ─────────────────────────────────────────────────────────────────────
  await correr('VT3', async () => {
    const page = await paginaNueva();
    if (!(await visible(page, 'ir-ventanilla'))) {
      brazo('VT3', false, 'ir-ventanilla no aparece en la portada');
      return;
    }
    await page.click(sel('ir-ventanilla'));
    const ventVisible = await page.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!ventVisible) { brazo('VT3', false, 'ventanilla no visible tras clic'); return; }

    if (!(await visible(page, 'ventanilla-volver'))) {
      brazo('VT3', false, 'ventanilla-volver no visible');
      return;
    }

    const fallas = [];
    // Volver por enlace ventanilla-volver
    await page.click(sel('ventanilla-volver'));
    const portVisible1 = await page.waitForSelector(sel('portada'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!portVisible1) fallas.push('portada no visible tras ventanilla-volver');
    if (await visible(page, 'ventanilla')) fallas.push('ventanilla sigue visible tras ventanilla-volver');
    const hash1 = await page.evaluate(() => location.hash);
    if (hash1 !== '') fallas.push(`location.hash = «${hash1}», esperado «» tras volver`);

    // Volver por page.goBack()
    await page.click(sel('ir-ventanilla'));
    await page.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS });
    await page.goBack();
    const portVisible2 = await page.waitForSelector(sel('portada'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!portVisible2) fallas.push('portada no visible tras goBack()');
    if (await visible(page, 'ventanilla')) fallas.push('ventanilla sigue visible tras goBack()');

    await recolectar(page);
    brazo('VT3', fallas.length === 0, fallas.join(' · '));
  });

  // ── VT4 · cobro (CA12) ───────────────────────────────────────────────────────────────
  await correr('VT4', async () => {
    const s = await sembrarBoletasAfirmado();
    const idVigente = s.ids['VIGENTE'];
    const page = await paginaNueva();
    if (!(await visible(page, 'ir-ventanilla'))) {
      brazo('VT4', false, 'ir-ventanilla no aparece en la portada');
      return;
    }
    await page.click(sel('ir-ventanilla'));
    const ventVisible = await page.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!ventVisible) { brazo('VT4', false, 'ventanilla no visible'); return; }

    let peticionPost = null;
    let clavePost = null;
    let cuerpoPost = null;
    let authH = null;
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes(`/boletas/${idVigente}/cobrar`)) {
        peticionPost = req;
        clavePost = req.headers()['idempotency-key'];
        authH = req.headers()['authorization'];
        try { cuerpoPost = JSON.parse(req.postData() || '{}'); } catch {}
      }
    });

    await page.fill(sel('ventanilla-boleta-id'), idVigente);
    await page.fill(sel('ventanilla-rut'), RUT_RETIRADOR);
    await page.click(sel('ventanilla-cobrar'));

    const exito = await page.waitForSelector(`${sel('ventanilla-exito')}[data-estado="COBRADA"]`, { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    const fallas = [];
    if (!exito) fallas.push('ventanilla-exito[data-estado="COBRADA"] no visible');
    else {
      if (!peticionPost) fallas.push('no se interceptó POST /boletas/:id/cobrar');
      if (!clavePost) fallas.push('Idempotency-Key ausente');
      if (authH !== undefined) fallas.push(`Authorization presente en ventanilla: «${authH}»`);
      if (cuerpoPost?.rutRetirador !== RUT_RETIRADOR) {
        fallas.push(`cuerpo.rutRetirador = «${cuerpoPost?.rutRetirador}», esperado «${RUT_RETIRADOR}»`);
      }

      const montoEl = await page.$(`${sel('ventanilla-exito')} ${sel('ventanilla-monto')}`);
      if (!montoEl) fallas.push('ventanilla-monto no encontrado dentro de ventanilla-exito');
      else {
        const mAttr = await montoEl.getAttribute('data-monto');
        if (mAttr !== '160.00') fallas.push(`ventanilla-monto data-monto="${mAttr}", esperado "160.00"`);
      }

      // El titular en otro contexto ve esa fila COBRADA
      const page2 = await paginaNueva();
      await entrarUI(page2, s.email, s.password);
      await estadoTerminal(page2);
      const ir2 = await irABoletas(page2);
      if (!ir2.ok) fallas.push(ir2.motivo);
      else {
        const fila = await page2.waitForSelector(`${sel('boleta-fila')}[data-boleta-id="${idVigente}"][data-estado="COBRADA"]`, { state: 'attached', timeout: ESPERA_MS })
          .then(() => true, () => false);
        if (!fila) fallas.push('titular no ve fila con data-estado="COBRADA"');
      }
    }
    await recolectar(page);
    brazo('VT4', fallas.length === 0, fallas.join(' · '));
  });

  // ── VT5 · rechazos (CA13) ───────────────────────────────────────────────────────────
  await correr('VT5', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    if (!(await visible(page, 'ir-ventanilla'))) {
      brazo('VT5', false, 'ir-ventanilla no aparece en la portada');
      return;
    }
    await page.click(sel('ir-ventanilla'));
    const ventVisible = await page.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!ventVisible) { brazo('VT5', false, 'ventanilla no visible'); return; }

    const casos = [
      { id: s.ids['VIGENTE'], rut: '12345678-5', codigo: 'RETIRADOR_NO_AUTORIZADO' },
      { id: s.ids['COBRADA'], rut: RUT_RETIRADOR, codigo: 'TRANSICION_INVALIDA' },
      { id: ID_INEXISTENTE, rut: RUT_RETIRADOR, codigo: 'BOLETA_NO_ENCONTRADA' },
      { id: ID_MALFORMADO, rut: RUT_RETIRADOR, codigo: 'BOLETA_NO_ENCONTRADA' },
      { id: s.ids['VIGENTE'], rut: RUT_INVALIDO, codigo: 'RUT_INVALIDO' },
      { id: 'a/b', rut: RUT_RETIRADOR, codigo: 'BOLETA_NO_ENCONTRADA' },
    ];

    const fallas = [];
    for (const c of casos) {
      await page.fill(sel('ventanilla-boleta-id'), c.id);
      await page.fill(sel('ventanilla-rut'), c.rut);
      const respPost = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().startsWith(`${API}/boletas/`) && r.url().endsWith('/cobrar'), { timeout: ESPERA_MS });
      await page.click(sel('ventanilla-cobrar'));
      try {
        await respPost;
      } catch {
        fallas.push(`caso ${c.codigo} (${c.id}): sin respuesta del POST`);
        continue;
      }

      const errorVis = await page.waitForSelector(`${sel('ventanilla-error')}[data-codigo="${c.codigo}"]`, { state: 'visible', timeout: ESPERA_MS })
        .then(() => true, () => false);
      if (!errorVis) fallas.push(`caso ${c.codigo} (${c.id}): ventanilla-error[data-codigo="${c.codigo}"] no visible`);

      // Verificar API sin cambio
      const bApi = await boletasApi(s.token);
      const cuentas = await cuentasApi(s.token);
      const cOrigen = cuentas.find((x) => x.id === s.cuentaId);
      if (cOrigen?.saldo !== '740.00') fallas.push(`caso ${c.codigo}: saldo API cambió a «${cOrigen?.saldo}»`);

      const estadosMap = Object.fromEntries(bApi.map((b) => [b.id, b.estado]));
      if (estadosMap[s.ids['VIGENTE']] !== 'VIGENTE') fallas.push(`caso ${c.codigo}: VIGENTE cambió de estado`);
      if (estadosMap[s.ids['VENCIDA_POR_LIBERAR']] !== 'VENCIDA') fallas.push(`caso ${c.codigo}: VENCIDA_POR_LIBERAR cambió de estado`);
      if (estadosMap[s.ids['VENCIDA_LIBERADA']] !== 'VENCIDA') fallas.push(`caso ${c.codigo}: VENCIDA_LIBERADA cambió de estado`);
      if (estadosMap[s.ids['COBRADA']] !== 'COBRADA') fallas.push(`caso ${c.codigo}: COBRADA cambió de estado`);
      if (estadosMap[s.ids['DEVUELTA']] !== 'DEVUELTA') fallas.push(`caso ${c.codigo}: DEVUELTA cambió de estado`);

      await recolectar(page);
    }
    brazo('VT5', fallas.length === 0, fallas.join(' · '));
  });

  // ── VT6 · doble clic (CA14) ──────────────────────────────────────────────────────────
  await correr('VT6', async () => {
    const s = await sembrarBoletasAfirmado();
    const idVigente = s.ids['VIGENTE'];
    const page = await paginaNueva();
    if (!(await visible(page, 'ir-ventanilla'))) {
      brazo('VT6', false, 'ir-ventanilla no aparece en la portada');
      return;
    }
    await page.click(sel('ir-ventanilla'));
    const ventVisible = await page.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!ventVisible) { brazo('VT6', false, 'ventanilla no visible'); return; }

    const claves = [];
    const codigos = [];
    page.on('response', (res) => {
      if (res.request().method() === 'POST' && res.url().includes(`/boletas/${idVigente}/cobrar`)) {
        claves.push(res.request().headers()['idempotency-key']);
        codigos.push(res.status());
      }
    });

    await page.fill(sel('ventanilla-boleta-id'), idVigente);
    await page.fill(sel('ventanilla-rut'), RUT_RETIRADOR);

    await page.dblclick(sel('ventanilla-cobrar'));

    const exito = await page.waitForSelector(sel('ventanilla-exito'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    const fallas = [];
    if (!exito) fallas.push('ventanilla-exito no visible');
    else {
      if (claves.length < 1) fallas.push(`se capturaron ${claves.length} POSTs`);
      const difClaves = new Set(claves);
      if (difClaves.size !== 1) fallas.push(`claves distintas en doble clic: [${claves.join(', ')}]`);
      for (const st of codigos) {
        if (st !== 200) fallas.push(`código HTTP no fue 200: ${st}`);
      }

      const bApi = (await boletasApi(s.token)).find((b) => b.id === idVigente);
      if (bApi?.estado !== 'COBRADA') fallas.push(`estado en API = «${bApi?.estado}», esperado COBRADA`);
    }
    await recolectar(page);
    brazo('VT6', fallas.length === 0, fallas.join(' · '));
  });

  // ── VT7 · sin respuesta ──────────────────────────────────────────────────────────────
  await correr('VT7', async () => {
    const s = await sembrarBoletasAfirmado();
    const idVigente = s.ids['VIGENTE'];
    const page = await paginaNueva();
    let intentos = 0;
    const claves = [];
    await page.route(`**/boletas/${idVigente}/cobrar`, async (route) => {
      if (route.request().method() === 'POST') {
        intentos++;
        claves.push(route.request().headers()['idempotency-key']);
        if (intentos === 1) {
          await route.fetch();
          return route.abort('failed');
        }
      }
      return route.continue();
    });

    if (!(await visible(page, 'ir-ventanilla'))) {
      brazo('VT7', false, 'ir-ventanilla no aparece en la portada');
      return;
    }
    await page.click(sel('ir-ventanilla'));
    const ventVisible = await page.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!ventVisible) { brazo('VT7', false, 'ventanilla no visible'); return; }

    await page.fill(sel('ventanilla-boleta-id'), idVigente);
    await page.fill(sel('ventanilla-rut'), RUT_RETIRADOR);
    await page.click(sel('ventanilla-cobrar'));

    const sinResp = await page.waitForSelector(sel('ventanilla-sin-respuesta'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    const fallas = [];
    if (!sinResp) fallas.push('ventanilla-sin-respuesta no visible');
    else {
      await recolectar(page);
      if (await visible(page, 'ventanilla-error')) fallas.push('ventanilla-error visible en fallo de red');
      if (!(await visible(page, 'ventanilla-reintentar'))) fallas.push('ventanilla-reintentar no visible');
      else {
        await page.click(sel('ventanilla-reintentar'));
        const exito = await page.waitForSelector(`${sel('ventanilla-exito')}[data-estado="COBRADA"]`, { state: 'visible', timeout: ESPERA_MS })
          .then(() => true, () => false);
        if (!exito) fallas.push('ventanilla-exito[data-estado="COBRADA"] no visible tras reintentar');
        if (claves.length < 2 || claves[0] !== claves[1]) fallas.push(`reintentar cambió clave: [${claves.join(', ')}]`);
      }
    }
    await recolectar(page);
    brazo('VT7', fallas.length === 0, fallas.join(' · '));
  });

  // ── VT8 · clave nueva tras un rechazo ────────────────────────────────────────────────
  await correr('VT8', async () => {
    const s = await sembrarBoletasAfirmado();
    const idVigente = s.ids['VIGENTE'];
    const page = await paginaNueva();
    if (!(await visible(page, 'ir-ventanilla'))) {
      brazo('VT8', false, 'ir-ventanilla no aparece en la portada');
      return;
    }
    await page.click(sel('ir-ventanilla'));
    const ventVisible = await page.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!ventVisible) { brazo('VT8', false, 'ventanilla no visible'); return; }

    const claves = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes(`/boletas/${idVigente}/cobrar`)) {
        claves.push(req.headers()['idempotency-key']);
      }
    });

    await page.fill(sel('ventanilla-boleta-id'), idVigente);
    await page.fill(sel('ventanilla-rut'), '12345678-5');
    await page.click(sel('ventanilla-cobrar'));

    const errorVis = await page.waitForSelector(`${sel('ventanilla-error')}[data-codigo="RETIRADOR_NO_AUTORIZADO"]`, { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!errorVis) {
      brazo('VT8', false, 'ventanilla-error[data-codigo="RETIRADOR_NO_AUTORIZADO"] no visible');
      return;
    }

    await page.fill(sel('ventanilla-rut'), RUT_RETIRADOR);
    await page.click(sel('ventanilla-cobrar'));

    const exito = await page.waitForSelector(`${sel('ventanilla-exito')}[data-estado="COBRADA"]`, { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    const fallas = [];
    if (!exito) fallas.push('ventanilla-exito[data-estado="COBRADA"] no visible tras corregir');
    if (claves.length < 2) fallas.push(`se capturaron ${claves.length} POSTs`);
    else if (claves[0] === claves[1]) fallas.push(`misma clave tras rechazo: «${claves[0]}»`);

    await recolectar(page);
    brazo('VT8', fallas.length === 0, fallas.join(' · '));
  });

  // ── VT9 · con sesión se ignora (J9) ──────────────────────────────────────────────────
  await correr('VT9', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    if (!(await visible(page, 'ir-ventanilla'))) {
      brazo('VT9', false, 'ir-ventanilla no aparece en la portada');
      return;
    }
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const promHashChange = page.evaluate(() => new Promise((resolve) => {
      window.addEventListener('hashchange', () => resolve(), { once: true });
    }));
    await page.evaluate(() => { window.location.hash = '#ventanilla'; });
    await promHashChange;
    await asentar(page);

    const fallas = [];
    if (!(await visible(page, 'usuario-email'))) fallas.push('usuario-email no visible tras hashchange');
    if (await visible(page, 'ventanilla')) fallas.push('ventanilla visible con sesión activa');

    await recolectar(page);
    brazo('VT9', fallas.length === 0, fallas.join(' · '));
  });

  // ── VT10 · la ventanilla envía lo escrito (§ 4.6; § 5.3 H-2) ─────────────────────────
  await correr('VT10', async () => {
    const s = await sembrarBoletasAfirmado();
    const idEscrito = ` ${s.ids['VIGENTE']} `;
    const rutEscrito = ` ${RUT_RETIRADOR} `;
    const page = await paginaNueva();
    if (!(await visible(page, 'ir-ventanilla'))) {
      brazo('VT10', false, 'ir-ventanilla no aparece en la portada');
      return;
    }
    await page.click(sel('ir-ventanilla'));
    const ventVisible = await page.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!ventVisible) { brazo('VT10', false, 'ventanilla no visible'); return; }

    await page.fill(sel('ventanilla-boleta-id'), idEscrito);
    await page.fill(sel('ventanilla-rut'), rutEscrito);

    const resp = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().startsWith(`${API}/boletas/`) && r.url().endsWith('/cobrar'), { timeout: ESPERA_MS });
    await page.click(sel('ventanilla-cobrar'));

    let cuerpo = null;
    let ruta = null;
    try {
      const post = await resp;
      ruta = new URL(post.url()).pathname;
      try { cuerpo = JSON.parse(post.request().postData() || '{}'); } catch {}
    } catch {
      brazo('VT10', false, 'sin respuesta del POST …/cobrar');
      return;
    }

    const rutaEsperada = `/boletas/${encodeURIComponent(idEscrito)}/cobrar`;
    const fallas = [];
    if (ruta !== rutaEsperada) fallas.push(`ruta = «${ruta}», esperada «${rutaEsperada}»`);
    if (cuerpo?.rutRetirador !== rutEscrito) {
      fallas.push(`cuerpo.rutRetirador = «${cuerpo?.rutRetirador}», esperado «${rutEscrito}»`);
    }
    await recolectar(page);
    brazo('VT10', fallas.length === 0, fallas.join(' · '));
  });

  // ── VT11 · id vacío + RUT → aviso, sin POST (UX-b2 § 3.2, D140-3) ─────────────────────
  // Ningún otro brazo de la suite deja el id vacío, y
  // R1 necesita ver `ventanilla-aviso`. El aviso es lo único que se afirma aquí.
  await correr('VT11', async () => {
    const page = await paginaNueva();
    if (!(await visible(page, 'ir-ventanilla'))) {
      brazo('VT11', false, 'ir-ventanilla no aparece en la portada');
      return;
    }
    await page.click(sel('ir-ventanilla'));
    const ventVisible = await page.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!ventVisible) { brazo('VT11', false, 'ventanilla no visible'); return; }

    await page.fill(sel('ventanilla-boleta-id'), '');
    await page.fill(sel('ventanilla-rut'), RUT_RETIRADOR);
    await page.click(sel('ventanilla-cobrar'));

    const aviso = await page.waitForSelector(sel('ventanilla-aviso'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    const fallas = [];
    if (!aviso) fallas.push('ventanilla-aviso no visible con id vacío');
    await recolectar(page);
    brazo('VT11', fallas.length === 0, fallas.join(' · '));
  });

  // ── R1 · testids nuevos renderizados ─────────────────────────────────────────────────
  await correr('R1', async () => {
    const faltan = LISTA_S17.filter((t) => !vistos.has(t));
    const sobran = [...vistos].filter((t) => !UNION_T4_S17.has(t));
    brazo('R1', faltan.length === 0 && sobran.length === 0 && repetidos.size === 0 && fuera.length === 0,
      `faltan [${faltan.join(', ')}] · sobran [${sobran.join(', ')}] · repetidos [${[...repetidos].join(', ')}] · fuera [${[...new Set(fuera)].slice(0, 3).join(', ')}] (lista de ${LISTA_S17.length})`);
  });
} finally {
  await relojBackendDesfijar().catch(() => {});
  await navegador.close().catch(() => {});
}

const verdes = resultados.filter((r) => r.ok).length;
const rojos = resultados.filter((r) => !r.ok).map((r) => r.id);
console.log(`\nverificar:s17-boletas → ${verdes}/${resultados.length} brazos verdes${rojos.length ? ` · rojos: ${rojos.join(' ')}` : ''}`);
process.exit(rojos.length === 0 && resultados.length === BRAZOS_TOTAL ? 0 : 1);
