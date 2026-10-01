// Árbitro de UX-b2 (specs/UX-b2.md § 6). Corre contra el ARTEFACTO servido:
// el backend (`node dist/main.js`) en :3000 y el build de pruebas de web/ en :4200.
// Lo levanta scripts/verificar-ux-b2.sh; este archivo sólo mira. No importa código de
// la app y no toca la base de datos: todo estado entra por las costuras /__test__/ y por el API
// público (perfil SUT, § 6 de la spec).
//
// Contiene exactamente los 17 brazos de § 6.1 con sus ids exactos:
//   P1, P2, P3, P4, P5, P6, P7, V1, V2, V3, V4, V5, V6, G1, L1, L2, L3.
//
// ── Decisiones de implementación del arnés (F4a) ───────────────────────────
// 1. **Detección unificada de peticiones POST a `/cobrar` (D140-3, § 6):**
//    La función `esCobrar(url)` evalúa si `new URL(url).pathname.endsWith('/cobrar')`. Esto captura
//    de forma homogénea `/boletas/:id/cobrar`, el segmento vacío `/boletas//cobrar` (cuando el id está vacío)
//    y la ruta normalizada `/cobrar` producida por id `..` (G1).
// 2. **Verificación de pre-vuelo estricta en G1 (§ 6.1, fila G1):**
//    Dentro del brazo G1, antes de evaluar la interfaz, se constata que la petición normalizada haya
//    salido como `POST /cobrar` y haya retornado status 404 sin la propiedad `codigo`. Si alguna de estas
//    condiciones no se cumple, G1 cae en rojo con lo medido y se escala (el árbitro no escribe archivos).
// 3. **Intercepción limpia y demora en V5 sin temporizadores (D142-3, § 6):**
//    En V5 se demora la respuesta real de la ruta mediante una promesa resuelta de forma explícita por el arnés
//    (`promesaDemora`) una vez comprobado el estado en la pantalla limpia. Se cumple la regla dura: nunca
//    `route.fulfill` ni respuestas fabricadas, y cero llamadas a `sleep` o `waitForTimeout`.
// 4. **Detección inequívoca de pestañas en P1–P7 (§ 6.1, § 7.1):**
//    En los brazos P1 a P7, si las pestañas `boletas-pestana-lista` o `boletas-pestana-emitir` no están en el DOM,
//    el brazo falla inmediatamente con el motivo exacto declarado en la línea base: «la pestaña no existe».
// 5. **Carrera reactiva de eventos en V3 y V4 (D140-3, D141-3, D142-2):**
//    Al enviar o reintentar con id vacío se realiza un `Promise.race` entre el evento de petición `request`
//    hacia `/cobrar` y la visibilidad de `ventanilla-aviso`. En la app defectuosa, el POST sale inmediatamente,
//    capturando el defecto con el motivo «sale el POST» sin esperas ciegas ni temporizadores.
// 6. **Aislamiento e independencia de cada brazo:**
//    Todo brazo que muta estado parte de `reset()` (`POST /__test__/reset`) y monta su escenario mediante
//    el API público o el seed `boletas-en-cada-estado`. Ningún brazo depende del orden de ejecución.
// 7. **Gestión y cierre garantizado de contextos y navegador:**
//    Todos los contextos abiertos se registran en `contextosAbiertos` y se cierran en `finally` por cada brazo;
//    el navegador Playwright se cierra en el bloque `finally` global antes de terminar el proceso.
//
// ── NACE SIN EL ARREGLO: línea base fijada antes de medir, 0/17 (§ 7.1) ──────────────
// ROJOS esperados (17): P1, P2, P3, P4, P5, P6, P7, V1, V2, V3, V4, V5, V6, G1, L1, L2, L3.
// VERDES esperados (0): ninguno.
// Motivo declarado de cada rojo:
//   - P*: la pestaña no existe
//   - V1/V2: el estado se conserva
//   - V3/V4: sale el POST
//   - V5: el estado se conserva antes de soltar la respuesta
//   - V6 y L1–L3: sin marca-inicio
//   - G1: <p> vacío
// Predicción fijada por escrito en la spec antes de correr; no se mueve.

import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { chromium } from 'playwright-core';

const API = 'http://localhost:3000';
const APP = 'http://localhost:4200';
const HOSTS_PERMITIDOS = new Set(['localhost:3000', 'localhost:4200']);
const ESPERA_MS = 8000;
const CLAVE = 'Clave-Arnes-2026';
const BRAZOS_TOTAL = 17;

const ESCRITORIO = { width: 1280, height: 800 };
const ESCENARIO_BOLETAS = 'boletas-en-cada-estado';
// RUT del retirador configurado en la siembra S-23 (specs/S-23-boletas-seed.md, verificar-s17-boletas.mjs:32):
const RUT_RETIRADOR = '9876543-3';

// ── Constantes y literales de D141-4 (specs/UX-b2.md § 2, líneas 66-69; § 4, líneas 127-129) ──
// Aviso de id vacío (specs/UX-b2.md § 2, línea 67; D141-4):
const LITERAL_AVISO_VACIO = 'Ingresa el ID de la boleta.';

// Genérico de textoError (specs/UX-b2.md § 2, línea 68; D141-4):
const LITERAL_GENERICO = 'No se pudo completar la operación.';

// Pestaña inicial (specs/UX-b2.md § 4, línea 127; D140-1):
const PESTANA_INICIAL = 'lista';

const resultados = [];
function brazo(id, ok, motivo = '') {
  resultados.push({ id, ok });
  console.log(`${ok ? 'OK' : 'ROJO'} ${id}${motivo ? ` · ${motivo}` : ''}`);
}

const contextosAbiertos = new Set();
async function cerrarContextos() {
  for (const c of contextosAbiertos) await c.close().catch(() => {});
  contextosAbiertos.clear();
}

async function correr(id, fn) {
  try {
    await fn();
  } catch (e) {
    console.error(`\n[STACK ${id}]`, e.stack || e);
    brazo(id, false, `excepción: ${String(e?.message ?? e).split('\n')[0]}`);
  } finally {
    await cerrarContextos();
  }
}

// ── HTTP crudo para API y costuras ───────────────────────────────────────────────────
function pedir(metodo, ruta, cabeceras = {}, cuerpo) {
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
const JSON_H = { 'content-type': 'application/json' };
const codigoDe = (body) => { try { return JSON.parse(body).codigo ?? null; } catch { return null; } };

async function reset() {
  const r = await pedir('POST', '/__test__/reset', JSON_H, {});
  if (r.status !== 200) throw new Error(`reset falló: ${r.status} ${r.body}`);
}

async function registrar(email) {
  const r = await pedir('POST', '/auth/registro', JSON_H, { email, password: CLAVE });
  if (r.status !== 201) throw new Error(`preparación: registro → ${r.status} ${r.body}`);
}

async function tokenDe(email, password = CLAVE) {
  const r = await pedir('POST', '/auth/login', JSON_H, { email, password });
  if (r.status !== 200) throw new Error(`preparación: login → ${r.status} ${r.body}`);
  return JSON.parse(r.body).token;
}

async function abrirCuentaApi(token, { tipo, monto, origenId }) {
  const cuerpo = { tipo, monto };
  if (origenId) cuerpo.cuentaOrigenId = origenId;
  const r = await pedir('POST', '/cuentas',
    { ...JSON_H, authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() }, cuerpo);
  if (r.status !== 201) throw new Error(`preparación: POST /cuentas → ${r.status} ${codigoDe(r.body) ?? r.body}`);
  return JSON.parse(r.body);
}

async function sembrarBoletasAfirmado() {
  await reset();
  const r = await pedir('POST', '/__test__/seed', JSON_H, { escenario: ESCENARIO_BOLETAS });
  if (r.status !== 201) throw new Error(`preparación: seed respondió ${r.status} ${r.body}`);
  const data = JSON.parse(r.body);
  if (!data.cuentas || data.cuentas.length === 0) throw new Error('preparación: sin cuentas en seed');
  if (!data.credenciales?.email || !data.credenciales?.password) throw new Error('preparación: sin credenciales en seed');
  const boletas = data.boletas || [];
  if (boletas.length !== 5) throw new Error(`preparación: esperadas 5 boletas pero fueron ${boletas.length}`);
  const token = await tokenDe(data.credenciales.email, data.credenciales.password);
  const ids = {};
  for (const b of boletas) ids[b.etiqueta] = b.id;
  return {
    email: data.credenciales.email,
    password: data.credenciales.password,
    token,
    cuentaId: data.cuentas[0].id,
    boletas,
    ids,
  };
}

// ── Red y detección de endpoints ─────────────────────────────────────────────────────
function esCobrar(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.pathname.endsWith('/cobrar');
  } catch {
    return false;
  }
}

// ── Navegador y ayudantes de UI ──────────────────────────────────────────────────────
const navegador = await chromium.launch({ headless: true });
const sel = (t) => `[data-testid="${t}"]`;

async function paginaNueva(opciones = {}, urlDestino = APP) {
  const ctx = await navegador.newContext({ viewport: ESCRITORIO, ...opciones });
  contextosAbiertos.add(ctx);
  const page = await ctx.newPage();
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
async function estadoTerminal(page) {
  const h = await page.waitForSelector(
    TERMINAL.map((e) => `${sel('cuentas-region')}[data-estado="${e}"]`).join(', '),
    { state: 'attached', timeout: ESPERA_MS }
  );
  return h.getAttribute('data-estado');
}

async function irABoletas(page) {
  const btn = page.locator(sel('nav-boletas'));
  if ((await btn.count()) === 0 || !(await btn.isVisible())) {
    return { ok: false, motivo: 'nav-boletas no aparece' };
  }
  await btn.click();
  const reg = await page.waitForSelector(
    TERMINAL.map((e) => `${sel('boletas-region')}[data-estado="${e}"]`).join(', '),
    { state: 'visible', timeout: ESPERA_MS }
  ).catch(() => null);
  if (!reg) return { ok: false, motivo: 'boletas-region sin estado terminal' };
  return { ok: true, estado: await reg.getAttribute('data-estado') };
}

// ─────────────────────────────────────────────────────────────────────────────────────
// ── SUITE DE PRUEBAS UX-b2 (17 BRAZOS) ───────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────────────
try {

  // ── P1 · Con 5 boletas, tablist, pestañas y paneles, panel emitir en DOM no visible ───
  await correr('P1', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);
    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('P1', false, ir.motivo); return; }

    const pestanaLista = page.locator(sel('boletas-pestana-lista'));
    const pestanaEmitir = page.locator(sel('boletas-pestana-emitir'));
    if ((await pestanaLista.count()) === 0 || (await pestanaEmitir.count()) === 0) {
      brazo('P1', false, 'la pestaña no existe');
      return;
    }

    const fallas = [];
    const tablist = page.locator('[role="tablist"][aria-label="Boletas"]');
    if ((await tablist.count()) === 0) fallas.push('tablist con aria-label="Boletas" no encontrado');
    const tabs = tablist.locator('[role="tab"]');
    if ((await tabs.count()) !== 2) fallas.push(`tablist tiene ${await tabs.count()} role="tab", esperados 2`);

    const selLista = await pestanaLista.getAttribute('aria-selected');
    const tabIndexLista = await pestanaLista.getAttribute('tabindex');
    if (selLista !== 'true') fallas.push(`boletas-pestana-lista aria-selected=${selLista}, esperado true`);
    if (tabIndexLista !== '0') fallas.push(`boletas-pestana-lista tabindex=${tabIndexLista}, esperado 0`);

    const selEmitir = await pestanaEmitir.getAttribute('aria-selected');
    const tabIndexEmitir = await pestanaEmitir.getAttribute('tabindex');
    if (selEmitir !== 'false') fallas.push(`boletas-pestana-emitir aria-selected=${selEmitir}, esperado false`);
    if (tabIndexEmitir !== '-1') fallas.push(`boletas-pestana-emitir tabindex=${tabIndexEmitir}, esperado -1`);

    const panelListaId = await pestanaLista.getAttribute('aria-controls');
    const panelEmitirId = await pestanaEmitir.getAttribute('aria-controls');
    const panelLista = page.locator(sel('boletas-panel-lista'));
    const panelEmitir = page.locator(sel('boletas-panel-emitir'));

    if (!panelListaId || (await panelLista.getAttribute('id')) !== panelListaId) {
      fallas.push(`panel lista id=${await panelLista.getAttribute('id')}, esperado aria-controls=${panelListaId}`);
    }
    if ((await panelLista.getAttribute('role')) !== 'tabpanel') {
      fallas.push(`panel lista role=${await panelLista.getAttribute('role')}, esperado tabpanel`);
    }
    if ((await panelLista.getAttribute('aria-labelledby')) !== await pestanaLista.getAttribute('id')) {
      fallas.push('panel lista aria-labelledby no coincide con id de pestaña lista');
    }

    if (!panelEmitirId || (await panelEmitir.getAttribute('id')) !== panelEmitirId) {
      fallas.push(`panel emitir id=${await panelEmitir.getAttribute('id')}, esperado aria-controls=${panelEmitirId}`);
    }
    if ((await panelEmitir.getAttribute('role')) !== 'tabpanel') {
      fallas.push(`panel emitir role=${await panelEmitir.getAttribute('role')}, esperado tabpanel`);
    }
    if ((await panelEmitir.getAttribute('aria-labelledby')) !== await pestanaEmitir.getAttribute('id')) {
      fallas.push('panel emitir aria-labelledby no coincide con id de pestaña emitir');
    }

    if (!(await page.locator(sel('boletas-tabla')).isVisible())) {
      fallas.push('boletas-tabla no visible');
    }

    if ((await panelEmitir.count()) === 0) {
      fallas.push('boletas-panel-emitir no montado');
    } else if (await panelEmitir.isVisible()) {
      fallas.push('boletas-panel-emitir visible, esperado no visible');
    }

    const selOrigen = page.locator(sel('emitir-origen'));
    if ((await selOrigen.count()) === 0) {
      fallas.push('emitir-origen no montado en el DOM');
    } else {
      const optCount = await selOrigen.locator('option').count();
      if (optCount === 0) fallas.push('emitir-origen sin opciones en el DOM');
    }

    brazo('P1', fallas.length === 0, fallas.length === 0 ? 'tablist, pestañas, paneles montados, panel emitir oculto con opciones' : fallas.join(' · '));
  });

  // ── P2 · Con 0 boletas y ≥1 cuenta: boletas-vacio, pestaña emitir visible, emitir-form en DOM no visible ──
  await correr('P2', async () => {
    await reset();
    const email = `uxb2-p2-${Date.now()}@banco.test`;
    await registrar(email);
    const token = await tokenDe(email);
    await abrirCuentaApi(token, { tipo: 'CORRIENTE', monto: '1000.00' });

    const page = await paginaNueva();
    await entrarUI(page, email);
    await estadoTerminal(page);
    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('P2', false, ir.motivo); return; }

    const pestanaLista = page.locator(sel('boletas-pestana-lista'));
    const pestanaEmitir = page.locator(sel('boletas-pestana-emitir'));
    if ((await pestanaLista.count()) === 0 || (await pestanaEmitir.count()) === 0) {
      brazo('P2', false, 'la pestaña no existe');
      return;
    }

    const fallas = [];
    if (!(await page.locator(sel('boletas-vacio')).isVisible())) {
      fallas.push('boletas-vacio no visible');
    }
    if ((await pestanaLista.getAttribute('aria-selected')) !== 'true') {
      fallas.push('boletas-pestana-lista no seleccionada');
    }
    if (!(await pestanaEmitir.isVisible())) {
      fallas.push('boletas-pestana-emitir no visible');
    }
    if ((await page.locator(sel('boletas-sin-cuentas')).count()) > 0) {
      fallas.push('boletas-sin-cuentas presente en el DOM');
    }

    const emitirForm = page.locator(sel('emitir-form'));
    if ((await emitirForm.count()) === 0) {
      fallas.push('emitir-form no montado en el DOM');
    } else if (await emitirForm.isVisible()) {
      fallas.push('emitir-form visible en pestaña lista, esperado oculto');
    }

    brazo('P2', fallas.length === 0, fallas.length === 0 ? 'boletas-vacio visible, «Mis boletas» seleccionada, emitir-form en DOM y oculto' : fallas.join(' · '));
  });

  // ── P3 · Clic en «Emitir»: su panel visible, el de lista no visible, aria-selected/tabindex intercambiados ──
  await correr('P3', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);
    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('P3', false, ir.motivo); return; }

    const pestanaLista = page.locator(sel('boletas-pestana-lista'));
    const pestanaEmitir = page.locator(sel('boletas-pestana-emitir'));
    if ((await pestanaLista.count()) === 0 || (await pestanaEmitir.count()) === 0) {
      brazo('P3', false, 'la pestaña no existe');
      return;
    }

    await pestanaEmitir.click();
    await page.waitForSelector(`${sel('boletas-pestana-emitir')}[aria-selected="true"]`, { timeout: ESPERA_MS });

    const fallas = [];
    const panelEmitir = page.locator(sel('boletas-panel-emitir'));
    const panelLista = page.locator(sel('boletas-panel-lista'));

    if (!(await panelEmitir.isVisible())) fallas.push('boletas-panel-emitir no visible tras clic');
    if (await panelLista.isVisible()) fallas.push('boletas-panel-lista visible tras conmutar');

    const selEmitir = await pestanaEmitir.getAttribute('aria-selected');
    const tabIndexEmitir = await pestanaEmitir.getAttribute('tabindex');
    const selLista = await pestanaLista.getAttribute('aria-selected');
    const tabIndexLista = await pestanaLista.getAttribute('tabindex');

    if (selEmitir !== 'true' || tabIndexEmitir !== '0') {
      fallas.push(`boletas-pestana-emitir aria-selected=${selEmitir}, tabindex=${tabIndexEmitir}`);
    }
    if (selLista !== 'false' || tabIndexLista !== '-1') {
      fallas.push(`boletas-pestana-lista aria-selected=${selLista}, tabindex=${tabIndexLista}`);
    }

    brazo('P3', fallas.length === 0, fallas.length === 0 ? 'panel emitir visible, panel lista oculto, atributos intercambiados' : fallas.join(' · '));
  });

  // ── P4 · Foco en «Mis boletas», →: «Emitir» seleccionada y con foco; ←: vuelve ──
  await correr('P4', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);
    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('P4', false, ir.motivo); return; }

    const pestanaLista = page.locator(sel('boletas-pestana-lista'));
    const pestanaEmitir = page.locator(sel('boletas-pestana-emitir'));
    if ((await pestanaLista.count()) === 0 || (await pestanaEmitir.count()) === 0) {
      brazo('P4', false, 'la pestaña no existe');
      return;
    }

    await pestanaLista.focus();
    await page.keyboard.press('ArrowRight');

    const fallas = [];
    const emitirSel = await pestanaEmitir.getAttribute('aria-selected');
    const emitirFoco = await page.evaluate((s) => document.activeElement === document.querySelector(s), sel('boletas-pestana-emitir'));
    if (emitirSel !== 'true') fallas.push(`tras ArrowRight: boletas-pestana-emitir aria-selected=${emitirSel}, esperado true`);
    if (!emitirFoco) fallas.push('tras ArrowRight: boletas-pestana-emitir no tiene el foco');

    await page.keyboard.press('ArrowLeft');
    const listaSel = await pestanaLista.getAttribute('aria-selected');
    const listaFoco = await page.evaluate((s) => document.activeElement === document.querySelector(s), sel('boletas-pestana-lista'));
    if (listaSel !== 'true') fallas.push(`tras ArrowLeft: boletas-pestana-lista aria-selected=${listaSel}, esperado true`);
    if (!listaFoco) fallas.push('tras ArrowLeft: boletas-pestana-lista no tiene el foco');

    brazo('P4', fallas.length === 0, fallas.length === 0 ? 'ArrowRight pasa a Emitir con foco, ArrowLeft vuelve con foco' : fallas.join(' · '));
  });

  // ── P5 · Emitir con éxito: emitir-exito visible y «Emitir» sigue seleccionada; clic en «Mis boletas» → fila VIGENTE ──
  await correr('P5', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);
    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('P5', false, ir.motivo); return; }

    const pestanaLista = page.locator(sel('boletas-pestana-lista'));
    const pestanaEmitir = page.locator(sel('boletas-pestana-emitir'));
    if ((await pestanaEmitir.count()) === 0 || (await pestanaLista.count()) === 0) {
      brazo('P5', false, 'la pestaña no existe');
      return;
    }

    await pestanaEmitir.click();
    await page.waitForSelector(sel('boletas-panel-emitir'), { state: 'visible', timeout: ESPERA_MS });

    await page.selectOption(sel('emitir-origen'), s.cuentaId);
    await page.fill(sel('emitir-monto'), '100.00');
    await page.fill(sel('emitir-plazo'), '30');
    await page.fill(sel('emitir-beneficiario-rut'), '12345678-5');
    await page.fill(sel('emitir-retirador-rut'), '9876543-3');
    await page.fill(sel('emitir-beneficiario-nombre'), 'Beneficiario P5');
    await page.fill(sel('emitir-retirador-nombre'), 'Retirador P5');
    await page.fill(sel('emitir-glosa'), 'Glosa P5');
    await page.click(sel('emitir-enviar'));

    await page.waitForSelector(sel('emitir-exito'), { state: 'visible', timeout: ESPERA_MS });
    const idEmitido = (await page.textContent(sel('emitir-boleta-id')) ?? '').trim();

    const fallas = [];
    const selEmitirDespues = await pestanaEmitir.getAttribute('aria-selected');
    if (selEmitirDespues !== 'true') {
      fallas.push(`tras emitir con éxito, boletas-pestana-emitir aria-selected=${selEmitirDespues}, esperado true (D140-2)`);
    }

    await pestanaLista.click();
    await page.waitForSelector(sel('boletas-panel-lista'), { state: 'visible', timeout: ESPERA_MS });

    const filaSel = `${sel('boleta-fila')}[data-boleta-id="${idEmitido}"]`;
    const filaVisible = await page.waitForSelector(filaSel, { state: 'visible', timeout: ESPERA_MS }).then(() => true, () => false);
    if (!filaVisible) {
      fallas.push(`fila de boleta emitida ${idEmitido} no visible en Mis boletas`);
    } else {
      const estadoFila = await page.locator(filaSel).getAttribute('data-estado');
      if (estadoFila !== 'VIGENTE') fallas.push(`fila emitida data-estado=${estadoFila}, esperado VIGENTE`);
    }

    brazo('P5', fallas.length === 0, fallas.length === 0 ? 'emitir-exito visible, «Emitir» seleccionada, boleta VIGENTE visible en Mis boletas' : fallas.join(' · '));
  });

  // ── P6 · Teclear un monto en «Emitir», ir a «Mis boletas» y volver: el monto sigue (D140-5) ──
  await correr('P6', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);
    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('P6', false, ir.motivo); return; }

    const pestanaLista = page.locator(sel('boletas-pestana-lista'));
    const pestanaEmitir = page.locator(sel('boletas-pestana-emitir'));
    if ((await pestanaEmitir.count()) === 0 || (await pestanaLista.count()) === 0) {
      brazo('P6', false, 'la pestaña no existe');
      return;
    }

    await pestanaEmitir.click();
    await page.waitForSelector(sel('boletas-panel-emitir'), { state: 'visible', timeout: ESPERA_MS });

    const montoTecleado = '750.00';
    await page.fill(sel('emitir-monto'), montoTecleado);

    await pestanaLista.click();
    await page.waitForSelector(sel('boletas-panel-lista'), { state: 'visible', timeout: ESPERA_MS });

    await pestanaEmitir.click();
    await page.waitForSelector(sel('boletas-panel-emitir'), { state: 'visible', timeout: ESPERA_MS });

    const montoLeido = await page.inputValue(sel('emitir-monto'));
    if (montoLeido !== montoTecleado) {
      brazo('P6', false, `el monto en «Emitir» cambió tras conmutar pestañas: «${montoLeido}», esperado «${montoTecleado}»`);
    } else {
      brazo('P6', true, 'monto tecleado en «Emitir» persiste tras ir a «Mis boletas» y volver');
    }
  });

  // ── P7 · Abrir «Emitir», ir al Resumen por la barra y volver a Boletas: «Mis boletas» seleccionada (D140-1) ──
  await correr('P7', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);
    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('P7', false, ir.motivo); return; }

    const pestanaLista = page.locator(sel('boletas-pestana-lista'));
    const pestanaEmitir = page.locator(sel('boletas-pestana-emitir'));
    if ((await pestanaEmitir.count()) === 0 || (await pestanaLista.count()) === 0) {
      brazo('P7', false, 'la pestaña no existe');
      return;
    }

    await pestanaEmitir.click();
    await page.waitForSelector(`${sel('boletas-pestana-emitir')}[aria-selected="true"]`, { timeout: ESPERA_MS });

    // Ir a Resumen por la barra (clic en nav-cuentas, ruta estable hacia Resumen)
    await page.click(sel('nav-cuentas'));
    await page.waitForSelector(sel('cuentas-region'), { state: 'visible', timeout: ESPERA_MS });
    await estadoTerminal(page);

    // Volver a Boletas
    const ir2 = await irABoletas(page);
    if (!ir2.ok) { brazo('P7', false, ir2.motivo); return; }

    const selLista = await page.locator(sel('boletas-pestana-lista')).getAttribute('aria-selected');
    if (selLista !== 'true') {
      brazo('P7', false, `al volver a Boletas, boletas-pestana-lista aria-selected=${selLista}, esperado true (D140-1)`);
    } else {
      brazo('P7', true, 'al reingresar a Boletas desde Resumen, «Mis boletas» abre seleccionada');
    }
  });

  // ── V1 · Id aleatorio inexistente + RUT → error; volver; ir-ventanilla: limpio ───────
  await correr('V1', async () => {
    const page = await paginaNueva();
    await page.click(sel('ir-ventanilla'));
    await page.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS });

    await page.fill(sel('ventanilla-boleta-id'), randomUUID());
    await page.fill(sel('ventanilla-rut'), RUT_RETIRADOR);
    await page.click(sel('ventanilla-cobrar'));
    await page.waitForSelector(sel('ventanilla-error'), { state: 'visible', timeout: ESPERA_MS });

    await page.click(sel('ventanilla-volver'));
    await page.waitForSelector(sel('portada'), { state: 'visible', timeout: ESPERA_MS });

    await page.click(sel('ir-ventanilla'));
    await page.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS });

    const idVal = await page.inputValue(sel('ventanilla-boleta-id'));
    const rutVal = await page.inputValue(sel('ventanilla-rut'));
    const errVis = await page.locator(sel('ventanilla-error')).isVisible();
    const exVis = await page.locator(sel('ventanilla-exito')).isVisible();
    const srVis = await page.locator(sel('ventanilla-sin-respuesta')).isVisible();
    const avVis = (await page.locator(sel('ventanilla-aviso')).count() > 0) && (await page.locator(sel('ventanilla-aviso')).isVisible());

    if (idVal !== '' || rutVal !== '' || errVis || exVis || srVis || avVis) {
      brazo('V1', false, `el estado se conserva (id=«${idVal}», rut=«${rutVal}», error=${errVis}, exito=${exVis}, sinResp=${srVis}, aviso=${avVis})`);
    } else {
      brazo('V1', true, 'ventanilla limpia tras salir con ventanilla-volver y reentrar');
    }
  });

  // ── V2 · Cobro feliz → éxito; atrás; re-entra con adelante: limpio ───────────────────
  await correr('V2', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await page.click(sel('ir-ventanilla'));
    await page.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS });

    await page.fill(sel('ventanilla-boleta-id'), s.ids['VIGENTE']);
    await page.fill(sel('ventanilla-rut'), RUT_RETIRADOR);
    await page.click(sel('ventanilla-cobrar'));
    await page.waitForSelector(sel('ventanilla-exito'), { state: 'visible', timeout: ESPERA_MS });

    await page.goBack();
    await page.waitForSelector(sel('portada'), { state: 'visible', timeout: ESPERA_MS });

    await page.goForward();
    await page.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS });

    const idVal = await page.inputValue(sel('ventanilla-boleta-id'));
    const rutVal = await page.inputValue(sel('ventanilla-rut'));
    const errVis = await page.locator(sel('ventanilla-error')).isVisible();
    const exVis = await page.locator(sel('ventanilla-exito')).isVisible();
    const srVis = await page.locator(sel('ventanilla-sin-respuesta')).isVisible();
    const avVis = (await page.locator(sel('ventanilla-aviso')).count() > 0) && (await page.locator(sel('ventanilla-aviso')).isVisible());

    if (idVal !== '' || rutVal !== '' || errVis || exVis || srVis || avVis) {
      brazo('V2', false, `el estado se conserva (id=«${idVal}», rut=«${rutVal}», exito=${exVis}, error=${errVis})`);
    } else {
      brazo('V2', true, 'ventanilla limpia tras atrás y adelante del navegador');
    }
  });

  // ── V3 · Primero id inexistente + RUT → error visible; luego id vacío e id "   ": 0 POST, aviso con literal, error ausente ──
  await correr('V3', async () => {
    const page = await paginaNueva();

    await page.click(sel('ir-ventanilla'));
    await page.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS });

    // Primero: id inexistente + RUT → error visible (F2 H1)
    await page.fill(sel('ventanilla-boleta-id'), randomUUID());
    await page.fill(sel('ventanilla-rut'), RUT_RETIRADOR);
    await page.click(sel('ventanilla-cobrar'));
    await page.waitForSelector(sel('ventanilla-error'), { state: 'visible', timeout: ESPERA_MS });

    // Probar id vacío y en otra vuelta id "   "
    for (const valorVacio of ['', '   ']) {
      await page.fill(sel('ventanilla-boleta-id'), valorVacio);

      // Carrera reactiva: o sale un POST o aparece ventanilla-aviso (sin temporizadores)
      let handlerPost;
      const promesaPost = new Promise((resolve) => {
        handlerPost = (req) => {
          if (req.method() === 'POST' && esCobrar(req.url())) {
            resolve({ tipo: 'post', url: req.url() });
          }
        };
        page.on('request', handlerPost);
      });

      const promesaAviso = page.waitForSelector(sel('ventanilla-aviso'), { state: 'visible', timeout: 3000 })
        .then(() => ({ tipo: 'aviso' }))
        .catch(() => ({ tipo: 'timeout' }));

      await page.click(sel('ventanilla-cobrar'));
      let ev;
      try {
        ev = await Promise.race([promesaPost, promesaAviso]);
      } finally {
        if (handlerPost) page.off('request', handlerPost);
      }

      if (ev.tipo === 'post') {
        brazo('V3', false, `sale el POST (${ev.url}) con id='${valorVacio}'`);
        return;
      }

      if (ev.tipo === 'timeout') {
        brazo('V3', false, `ventanilla-aviso no apareció tras intentar cobrar con id='${valorVacio}'`);
        return;
      }

      const txtAviso = (await page.textContent(sel('ventanilla-aviso')) ?? '').trim();
      if (txtAviso !== LITERAL_AVISO_VACIO) {
        brazo('V3', false, `ventanilla-aviso texto=«${txtAviso}», esperado «${LITERAL_AVISO_VACIO}»`);
        return;
      }

      if (await page.locator(sel('ventanilla-error')).isVisible()) {
        brazo('V3', false, 'ventanilla-error visible, esperado ausente al mostrar aviso de vacío');
        return;
      }
    }

    brazo('V3', true, '0 POST a /cobrar con id vacío y espacios, ventanilla-aviso con literal y error ausente');
  });

  // ── V4 · Primer POST abortado → sin-respuesta; borrar id; reintentar: 0 POST, aviso y sin-respuesta visibles; reescribir id y reintentar: 1 POST con misma clave ──
  await correr('V4', async () => {
    const s = await sembrarBoletasAfirmado();
    const idBoleta = s.ids['VIGENTE'];
    const page = await paginaNueva();

    let intentosPost = 0;
    const claves = [];

    await page.route((url) => esCobrar(url), async (route) => {
      if (route.request().method() === 'POST') {
        intentosPost++;
        claves.push(route.request().headers()['idempotency-key']);
        if (intentosPost === 1) {
          return route.abort('failed');
        }
      }
      return route.continue();
    });

    await page.click(sel('ir-ventanilla'));
    await page.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS });

    await page.fill(sel('ventanilla-boleta-id'), idBoleta);
    await page.fill(sel('ventanilla-rut'), RUT_RETIRADOR);
    await page.click(sel('ventanilla-cobrar'));

    // Esperar primer fallo de red abortado
    await page.waitForSelector(sel('ventanilla-sin-respuesta'), { state: 'visible', timeout: ESPERA_MS });

    // Borrar el id
    await page.fill(sel('ventanilla-boleta-id'), '');

    // Al reintentar con id vacío: verificar carrera (POST vs aviso)
    let handlerPost;
    const promesaPost = new Promise((resolve) => {
      handlerPost = (req) => {
        if (req.method() === 'POST' && esCobrar(req.url())) {
          resolve({ tipo: 'post', url: req.url() });
        }
      };
      page.on('request', handlerPost);
    });

    const promesaAviso = page.waitForSelector(sel('ventanilla-aviso'), { state: 'visible', timeout: 3000 })
      .then(() => ({ tipo: 'aviso' }))
      .catch(() => ({ tipo: 'timeout' }));

    await page.click(sel('ventanilla-reintentar'));
    let ev;
    try {
      ev = await Promise.race([promesaPost, promesaAviso]);
    } finally {
      if (handlerPost) page.off('request', handlerPost);
    }

    if (ev.tipo === 'post') {
      brazo('V4', false, `sale el POST (${ev.url}) al reintentar con id vacío`);
      return;
    }

    if (ev.tipo === 'timeout') {
      brazo('V4', false, 'ventanilla-aviso no visible tras reintentar con id vacío');
      return;
    }

    const fallas = [];
    const sinRespVis = await page.locator(sel('ventanilla-sin-respuesta')).isVisible();
    const reintVis = await page.locator(sel('ventanilla-reintentar')).isVisible();
    if (!sinRespVis || !reintVis) {
      fallas.push('ventanilla-sin-respuesta o ventanilla-reintentar no visibles tras aviso en reintento (D142-2)');
    }

    // Escribir de nuevo el id y reintentar
    await page.fill(sel('ventanilla-boleta-id'), idBoleta);
    const postsAntes = intentosPost;
    await page.click(sel('ventanilla-reintentar'));

    // Esperar a que se complete el segundo POST sin temporizador ciego
    await page.waitForResponse((res) => esCobrar(res.url()) && res.request().method() === 'POST', { timeout: ESPERA_MS })
      .catch(() => null);

    if (intentosPost < postsAntes + 1) {
      fallas.push('no salió el POST al reintentar con el id reingresado');
    } else {
      if (claves.length < 2 || claves[0] !== claves[1]) {
        fallas.push(`Idempotency-Key cambió al reintentar: [${claves.join(', ')}]`);
      }
    }

    brazo('V4', fallas.length === 0, fallas.length === 0 ? '0 POST al reintentar con id vacío, aviso visible y sin-respuesta mantenido; reintento con id reusa Idempotency-Key' : fallas.join(' · '));
  });

  // ── V5 · Cobro con respuesta demorada: salir y volver a entrar: id vacío y controles habilitados; soltar respuesta: ni éxito ni error ──
  await correr('V5', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();

    let resolverDemora;
    const promesaDemora = new Promise((resolve) => { resolverDemora = resolve; });
    let postDemorado = false;

    try {
      await page.route((url) => esCobrar(url), async (route) => {
        if (route.request().method() === 'POST' && !postDemorado) {
          postDemorado = true;
          await promesaDemora;
          return route.continue();
        }
        return route.continue();
      });

      await page.click(sel('ir-ventanilla'));
      await page.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS });

      await page.fill(sel('ventanilla-boleta-id'), s.ids['VIGENTE']);
      await page.fill(sel('ventanilla-rut'), RUT_RETIRADOR);
      await page.click(sel('ventanilla-cobrar'));

      // Esperar a que la petición quede en vuelo (botón deshabilitado por cobrandoVentanilla)
      await page.waitForSelector(`${sel('ventanilla-cobrar')}[disabled]`, { timeout: ESPERA_MS });

      // Salir con ventanilla-volver
      await page.click(sel('ventanilla-volver'));
      await page.waitForSelector(sel('portada'), { state: 'visible', timeout: ESPERA_MS });

      // Volver a entrar
      await page.click(sel('ir-ventanilla'));
      await page.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS });

      // Medición del estado ANTES de soltar la respuesta tardía
      const idVal = await page.inputValue(sel('ventanilla-boleta-id'));
      const idDisabled = await page.isDisabled(sel('ventanilla-boleta-id'));
      const rutDisabled = await page.isDisabled(sel('ventanilla-rut'));
      const cobrarDisabled = await page.isDisabled(sel('ventanilla-cobrar'));

      if (idVal !== '' || idDisabled || rutDisabled || cobrarDisabled) {
        resolverDemora?.();
        brazo('V5', false, `el estado se conserva antes de soltar la respuesta (id=«${idVal}», disabled: id=${idDisabled}, rut=${rutDisabled}, cobrar=${cobrarDisabled})`);
        return;
      }

      // Soltar la respuesta y esperar requestfinished
      const finReq = page.waitForEvent('requestfinished', (req) => esCobrar(req.url()));
      resolverDemora();
      await finReq;

      // Esperar dos requestAnimationFrame en la página (F2 C4)
      await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(resolve);
        });
      }));

      // Recién entonces: ni éxito ni error (D141-2)
      const exitoVis = await page.locator(sel('ventanilla-exito')).isVisible();
      const errorVis = await page.locator(sel('ventanilla-error')).isVisible();

      const fallas = [];
      if (exitoVis) fallas.push('ventanilla-exito visible tras respuesta tardía de cobro descartado');
      if (errorVis) fallas.push('ventanilla-error visible tras respuesta tardía de cobro descartado');

      brazo('V5', fallas.length === 0, fallas.length === 0 ? 'ventanilla limpia y habilitada antes de soltar respuesta, y respuesta tardía descartada sin éxito ni error' : fallas.join(' · '));
    } finally {
      resolverDemora?.();
    }
  });

  // ── V6 · Id inexistente + RUT → error; salir con marca-inicio; re-entrar con page.goto(#ventanilla): limpio ──
  await correr('V6', async () => {
    const page = await paginaNueva();
    await page.click(sel('ir-ventanilla'));
    await page.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS });

    await page.fill(sel('ventanilla-boleta-id'), randomUUID());
    await page.fill(sel('ventanilla-rut'), RUT_RETIRADOR);
    await page.click(sel('ventanilla-cobrar'));
    await page.waitForSelector(sel('ventanilla-error'), { state: 'visible', timeout: ESPERA_MS });

    const marca = page.locator(sel('marca-inicio'));
    if ((await marca.count()) === 0) {
      brazo('V6', false, 'sin marca-inicio');
      return;
    }

    await marca.click();
    await page.waitForSelector(sel('portada'), { state: 'visible', timeout: ESPERA_MS });

    await page.goto(`${APP}/#ventanilla`, { waitUntil: 'load' });
    await page.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS });

    const idVal = await page.inputValue(sel('ventanilla-boleta-id'));
    const rutVal = await page.inputValue(sel('ventanilla-rut'));
    const errVis = await page.locator(sel('ventanilla-error')).isVisible();
    const exVis = await page.locator(sel('ventanilla-exito')).isVisible();
    const srVis = await page.locator(sel('ventanilla-sin-respuesta')).isVisible();
    const avVis = (await page.locator(sel('ventanilla-aviso')).count() > 0) && (await page.locator(sel('ventanilla-aviso')).isVisible());

    if (idVal !== '' || rutVal !== '' || errVis || exVis || srVis || avVis) {
      brazo('V6', false, `el estado se conserva (id=«${idVal}», rut=«${rutVal}», error=${errVis})`);
    } else {
      brazo('V6', true, 'ventanilla limpia tras salir con marca-inicio y reentrar con URL #ventanilla');
    }
  });

  // ── G1 · Id '..': petición normalizada a POST /cobrar y Nest 404 sin codigo; ventanilla-error con literal genérico ──
  await correr('G1', async () => {
    const page = await paginaNueva();
    await page.click(sel('ir-ventanilla'));
    await page.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS });

    let reqUrl = null;
    let reqMethod = null;
    let resStatus = null;
    let resBody = null;

    const esperarRespuesta = page.waitForResponse(async (res) => {
      try {
        const u = new URL(res.url());
        if (u.pathname === '/cobrar') {
          reqUrl = res.url();
          reqMethod = res.request().method();
          resStatus = res.status();
          try {
            resBody = await res.json();
          } catch {
            resBody = null;
          }
          return true;
        }
      } catch {}
      return false;
    });

    await page.fill(sel('ventanilla-boleta-id'), '..');
    await page.fill(sel('ventanilla-rut'), RUT_RETIRADOR);
    await page.click(sel('ventanilla-cobrar'));

    await esperarRespuesta;

    // F4a verifica PRIMERO que la petición salió a /cobrar y volvió 404 sin codigo; si no, rojo con lo medido y se escala
    const preFlightOk = (
      reqMethod === 'POST' &&
      resStatus === 404 &&
      resBody !== null &&
      typeof resBody.codigo === 'undefined'
    );

    // Pre-flight medido en F4a: POST /cobrar → 404 sin `codigo`. Si deja de valer, el brazo
    // es IMPOSIBLE tal como está escrito: rojo con lo medido, y se escala (§ 6.1, fila G1).
    if (!preFlightOk) {
      brazo('G1', false, `pre-flight falló, el brazo no es válido: escalar · método=${reqMethod}, status=${resStatus}, body=${JSON.stringify(resBody)}`);
      return;
    }

    // Esperar ventanilla-error en UI
    await page.waitForSelector(sel('ventanilla-error'), { state: 'visible', timeout: ESPERA_MS });
    const codigo = await page.locator(sel('ventanilla-error')).getAttribute('data-codigo');
    const textoP = (await page.locator(`${sel('ventanilla-error')} p`).textContent() ?? '').trim();

    const fallas = [];
    if (codigo !== 'ERROR') {
      fallas.push(`ventanilla-error data-codigo=«${codigo}», esperado «ERROR»`);
    }
    if (textoP !== LITERAL_GENERICO) {
      if (textoP === '') {
        fallas.push(`<p> vacío, esperado «${LITERAL_GENERICO}»`);
      } else {
        fallas.push(`texto <p>=«${textoP}», esperado «${LITERAL_GENERICO}»`);
      }
    }

    brazo('G1', fallas.length === 0, fallas.length === 0 ? 'ventanilla-error[data-codigo=ERROR] con <p> == literal genérico' : fallas.join(' · '));
  });

  // ── L1 · Con sesión, desde Boletas: marca-inicio rol link y nombre «zeroFeeBank, inicio»; clic → cuentas-region y GET /cuentas ──
  await correr('L1', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva();
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);
    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('L1', false, ir.motivo); return; }

    const logo = page.locator(sel('marca-inicio'));
    if ((await logo.count()) === 0) {
      brazo('L1', false, 'sin marca-inicio');
      return;
    }

    const fallas = [];
    // Rol y nombre COMPUTADOS: un <a> sin href no tiene rol link y pasaba en verde.
    const porRol = page.getByRole('link', { name: 'zeroFeeBank, inicio', exact: true }).and(logo);
    if ((await porRol.count()) === 0) fallas.push('marca-inicio no expone rol link con nombre accesible «zeroFeeBank, inicio»');

    const nombre = await logo.getAttribute('aria-label');
    if (nombre !== 'zeroFeeBank, inicio') {
      fallas.push(`marca-inicio aria-label=«${nombre}», esperado «zeroFeeBank, inicio»`);
    }

    // Esperar GET /cuentas iniciado DESPUÉS del clic (lección punto 11)
    const reqCuentasPromesa = page.waitForRequest((req) => {
      try {
        const u = new URL(req.url());
        return req.method() === 'GET' && u.pathname === '/cuentas';
      } catch {
        return false;
      }
    }, { timeout: ESPERA_MS }).catch(() => null);

    await logo.click();
    await page.waitForSelector(sel('cuentas-region'), { state: 'visible', timeout: ESPERA_MS });

    const reqCuentas = await reqCuentasPromesa;
    if (!reqCuentas) {
      fallas.push('no se inició GET /cuentas tras clic en marca-inicio');
    }

    brazo('L1', fallas.length === 0, fallas.length === 0 ? 'marca-inicio enlace accesible lleva a Resumen y recarga cuentas con GET /cuentas' : fallas.join(' · '));
  });

  // ── L2 · En la ventanilla: marca-inicio es <a> con rol link y mismo nombre; clic → portada visible, sin ventanilla, URL sin # ──
  await correr('L2', async () => {
    const page = await paginaNueva();
    await page.click(sel('ir-ventanilla'));
    await page.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS });

    const logo = page.locator(sel('marca-inicio'));
    if ((await logo.count()) === 0) {
      brazo('L2', false, 'sin marca-inicio');
      return;
    }

    const fallas = [];
    const tag = await logo.evaluate((el) => el.tagName.toLowerCase());
    if (tag !== 'a') fallas.push(`marca-inicio en ventanilla es <${tag}>, esperado <a>`);
    // Rol y nombre COMPUTADOS: la fila pide `<a>` Y rol link; el tag solo no lo prueba.
    const porRol = page.getByRole('link', { name: 'zeroFeeBank, inicio', exact: true }).and(logo);
    if ((await porRol.count()) === 0) fallas.push('marca-inicio no expone rol link con nombre accesible «zeroFeeBank, inicio»');

    const nombre = await logo.getAttribute('aria-label');
    if (nombre !== 'zeroFeeBank, inicio') {
      fallas.push(`marca-inicio aria-label=«${nombre}», esperado «zeroFeeBank, inicio»`);
    }

    await logo.click();
    await page.waitForSelector(sel('portada'), { state: 'visible', timeout: ESPERA_MS });

    if (await page.locator(sel('ventanilla')).isVisible()) {
      fallas.push('ventanilla sigue visible tras clic en marca-inicio');
    }

    const urlActual = page.url();
    if (urlActual.includes('#')) {
      fallas.push(`URL conserva '#' tras clic en marca-inicio (${urlActual})`);
    }

    brazo('L2', fallas.length === 0, fallas.length === 0 ? '<a> marca-inicio en ventanilla lleva a portada y deja URL sin #' : fallas.join(' · '));
  });

  // ── L3 · Sin sesión, en la portada: clic en marca-inicio → portada visible y URL idéntica ──
  await correr('L3', async () => {
    const page = await paginaNueva();
    await page.waitForSelector(sel('portada'), { state: 'visible', timeout: ESPERA_MS });

    const logo = page.locator(sel('marca-inicio'));
    if ((await logo.count()) === 0) {
      brazo('L3', false, 'sin marca-inicio');
      return;
    }

    const urlAntes = page.url();
    await logo.click();
    await page.waitForSelector(sel('portada'), { state: 'visible', timeout: ESPERA_MS });
    const urlDespues = page.url();

    if (urlDespues !== urlAntes) {
      brazo('L3', false, `URL cambió tras clic en marca-inicio en portada sin sesión: «${urlDespues}», esperada idéntica a «${urlAntes}»`);
    } else {
      brazo('L3', true, 'marca-inicio en portada sin sesión previene navegación por defecto y mantiene URL');
    }
  });

} finally {
  await navegador.close().catch(() => {});
}

const verdes = resultados.filter((r) => r.ok).length;
console.log(`\nverificar:ux-b2: ${verdes}/${BRAZOS_TOTAL}`);
process.exit(verdes === BRAZOS_TOTAL ? 0 : 1);
