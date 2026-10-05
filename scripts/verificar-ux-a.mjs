// Árbitro de UX-a (specs/UX-a.md § 6). Corre contra el ARTEFACTO servido:
// el backend (`node dist/main.js`) en :3000 y el build de pruebas de web/ en :4200.
// Lo levanta scripts/verificar-ux-a.sh; este archivo sólo mira. No importa código de
// la app y no toca la base de datos: todo estado entra por las costuras /__test__/ y por el API
// público (perfil SUT, § 5 de la spec).
//
// Contiene exactamente los 17 brazos de § 6.1 (O3d: D128-3, § 8.1):
//   O1a, O1b, O3a, O3b, O3c, O3d, U1, U2, U3a, U3b, U3c, U5, U6a, U6b, S64a, S64b, S64c.
//
// ── Decisiones de implementación del arnés (F4a) ──────────────────────────────────────────
// 1. **Medición de texto en una sola línea mediante Range (O3a, U1):** la spec (§ 6.1) exige
//    comprobar que el texto no se parte en varias líneas evaluando que los rectángulos devueltos
//    por `Range.getClientRects()` compartan un único `top` (±1 px). La implementación construye
//    el `Range` con `selectNodeContents(el)` dentro del contexto del navegador sobre los nodos
//    renderizados, filtrando rectángulos sin dimensiones (`width > 0 && height > 0`).
// 2. **Aserción con reintento para S64a/b/c mediante `page.waitForFunction` (sin sleep):**
//    como la relectura de cuentas tras emitir, devolver o liberar es asíncrona (H-04), el arnés
//    espera la presencia del saldo en la opción usando `page.waitForFunction` con el tope
//    `ESPERA_MS` (8000 ms), evaluando frame a frame sin ningún `sleep` ni `waitForTimeout`.
//    Si la condición se cumple o expira, se lee el texto actual de la opción en el DOM para
//    reportar los valores medidos en la salida.
// 3. **Aislamiento e independencia de cada brazo mediante siembra propia:** cada brazo que
//    requiere credenciales, boletas o mutación de estado (U2, U3c, U5, U6a, U6b, S64a, S64b,
//    S64c) ejecuta su propia preparación `sembrarBoletasAfirmado()` (`reset` + `seed
//    boletas-en-cada-estado`), garantizando que ningún reset previo invalide el token ni
//    genere excepciones espurias de autenticación (401) o de elementos no encontrados.
// 4. **Gatillado de blur en U3a y U3b:** para verificar el formateo de RUT al salir del campo,
//    tras teclear con `page.fill` se dispara el evento `blur` explícito (`dispatchEvent('blur')`),
//    se invoca `el.blur()` y se desplaza el foco a otro control (`page.focus(...)`), garantizando
//    que los manejadores de eventos nativos y de Angular se activen con fidelidad.
// 5. **Extracción y validación de PDF con unpdf (U6a, U6b):** los PDF se descargan por HTTP
//    autorizado vía API, se extrae el texto usando `unpdf` (`extractText` con `getDocumentProxy`),
//    se normalizan espacios (`replace(/\s+/g, ' ').trim()`) como en `test/comprobantes-pdf.int.spec.ts`
//    y se evalúa la presencia literal de «zeroFeeBank» y el patrón `\(UTC\):\s*<ISO>` para cada fecha.
// 6. **Cierre limpio de contextos y navegador:** los contextos de Playwright se registran en un
//    `Set` y se cierran en el `finally` de cada ejecución (`correr`), y el navegador se cierra
//    en el bloque `finally` global antes de `process.exit`, previniendo procesos zombi.
//
// ── NACE SIN EL ARREGLO: línea base fijada antes de medir, 2/16 (§ 7.1) ──────────────
// ROJOS esperados (14): O1a, O1b, O3a, O3b, U1, U2, U3a, U3c, U5, U6a, U6b, S64a, S64b, S64c.
// VERDES esperados (2): O3c, U3b.
// Predicción fijada por escrito en la spec antes de correr; no se mueve.
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { chromium } from 'playwright-core';
import { extractText, getDocumentProxy } from 'unpdf';

const API = 'http://localhost:3000';
const APP = 'http://localhost:4200';
const HOSTS_PERMITIDOS = new Set(['localhost:3000', 'localhost:4200']);
const ESPERA_MS = 8000; // tope de cada espera por CONDICIÓN (no es un sleep): un rojo, no un cuelgue
const CLAVE = 'Clave-Arnes-2026';

// ── Constantes de § 4 (specs/UX-a.md) ──────────────────────────────────────────────────
const ESCRITORIO = { width: 1280, height: 800 };      // el que usan los scripts de captura existentes (§ 4)
const TELEFONO = { width: 390, height: 844 };         // ídem; es donde se vieron O3 y U5 (§ 4)
const TOLERANCIA_PX = 1;                              // redondeo de subpíxel entre motores; no absorbe un defecto real (§ 4)
const PATRON_U3 = /^[0-9]{1,8}[0-9kK]$/;              // D125-1 + rango del backend (§ 3, § 4)
const ESCENARIO_BOLETAS = 'boletas-en-cada-estado';  // trae las 5 filas, así aparecen los 4 botones posibles (specs/S-23-boletas-seed.md, § 4)
const BRAZOS_TOTAL = 17;

// Constantes de negocio de § 3 / § 4
const MONTO_FELIZ = '250.10';
const PLAZO_FELIZ = '30';
const RUT_BENEFICIARIO = '12345678-5';
const NOMBRE_BENEFICIARIO = 'Constructora Andes SpA';
const RUT_RETIRADOR = '9876543-3';
const NOMBRE_RETIRADOR = 'Ana Soto';
const GLOSA_FELIZ = 'Fiel cumplimiento contrato 123';

// ── Tabla literal de U3 (specs/UX-a.md § 6.3, copiada como constante sin agregar ni quitar casos)
const TABLA_U3 = [
  { tecleado: '123456785', trasBlur: '12.345.678-5', brazo: 'U3a' },
  { tecleado: '98765433', trasBlur: '9.876.543-3', brazo: 'U3a' },
  { tecleado: '11', trasBlur: '1-1', brazo: 'U3a' },
  { tecleado: '1k', trasBlur: '1-K', brazo: 'U3a' },
  { tecleado: '12345678k', trasBlur: '12.345.678-K', brazo: 'U3a' },
  { tecleado: '12345678K', trasBlur: '12.345.678-K', brazo: 'U3a' },
  { tecleado: '123456789', trasBlur: '12.345.678-9', brazo: 'U3a' },
  { tecleado: '012345678', trasBlur: '01.234.567-8', brazo: 'U3a' },
  { tecleado: ' 12345678-5 ', trasBlur: ' 12345678-5 ', brazo: 'U3b' },
  { tecleado: '12345678-5', trasBlur: '12345678-5', brazo: 'U3b' },
  { tecleado: '12345678-K', trasBlur: '12345678-K', brazo: 'U3b' },
  { tecleado: '12.345.678-5', trasBlur: '12.345.678-5', brazo: 'U3b' },
  { tecleado: ' 123456785', trasBlur: ' 123456785', brazo: 'U3b' },
  { tecleado: '1234567895', trasBlur: '1234567895', brazo: 'U3b' },
  { tecleado: 'abc', trasBlur: 'abc', brazo: 'U3b' },
  { tecleado: '', trasBlur: '', brazo: 'U3b' },
];

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
    brazo(id, false, `excepción: ${String(e?.message ?? e).split('\n')[0]}`);
  } finally {
    await cerrarContextos();
  }
}

// ── HTTP crudo ────────────────────────────────────────────────────────────────────────
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

async function tokenDe(email, password = CLAVE) {
  const r = await pedir('POST', '/auth/login', JSON_H, { email, password });
  if (r.status !== 200) throw new Error(`login por API → ${r.status} ${r.body}`);
  return JSON.parse(r.body);
}

async function relojBackendDesfijar() {
  const r = await pedir('POST', '/__test__/reloj', JSON_H, { instante: null });
  if (r.status !== 200) throw new Error(`preparación: reloj desfijar falló con ${r.status} ${r.body}`);
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

// ── Preparación del escenario sembrado con límites afirmados (S-23) ────────────────────
async function sembrarBoletasAfirmado() {
  const rReset = await pedir('POST', '/__test__/reset', JSON_H, {});
  if (rReset.status !== 200) throw new Error(`preparación: reset respondió ${rReset.status}`);

  const r = await pedir('POST', '/__test__/seed', JSON_H, { escenario: ESCENARIO_BOLETAS });
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
  if (datos.origenId) await page.selectOption(sel('emitir-origen'), datos.origenId);
  if (datos.monto !== undefined) await page.fill(sel('emitir-monto'), datos.monto);
  if (datos.plazo !== undefined) await page.fill(sel('emitir-plazo'), String(datos.plazo));
  if (datos.benRut !== undefined) await page.fill(sel('emitir-beneficiario-rut'), datos.benRut);
  if (datos.benNombre !== undefined) await page.fill(sel('emitir-beneficiario-nombre'), datos.benNombre);
  if (datos.retRut !== undefined) await page.fill(sel('emitir-retirador-rut'), datos.retRut);
  if (datos.retNombre !== undefined) await page.fill(sel('emitir-retirador-nombre'), datos.retNombre);
  if (datos.glosa !== undefined) await page.fill(sel('emitir-glosa'), datos.glosa);
}

/**
 * Aserción con reintento para S64a/b/c mediante condición de Playwright (H-04).
 * Evalúa frame a frame sin sleep hasta ESPERA_MS o hasta que la opción contenga el saldo esperado.
 */
async function esperarSaldoEnOpcion(page, cuentaId, saldoEsperado, timeout = ESPERA_MS) {
  const textoBuscado = `$ ${saldoEsperado}`;
  const selector = `${sel('emitir-origen')} option[value="${cuentaId}"]`;

  const ok = await page.waitForFunction(
    ({ selOrigen, cid, buscado }) => {
      const opt = document.querySelector(`${selOrigen} option[value="${cid}"]`);
      return opt && opt.textContent && opt.textContent.includes(buscado);
    },
    { selOrigen: sel('emitir-origen'), cid: cuentaId, buscado: textoBuscado },
    { timeout },
  ).then(() => true, () => false);

  const textoActual = await page.$eval(selector, (el) => el.textContent?.trim() ?? '').catch(() => '');
  return { ok, textoActual, textoBuscado };
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Arranque y preparación ─────────────────────────────────────────────────────────────
await relojBackendDesfijar().catch(() => {});

try {
  const prep = await sembrarBoletasAfirmado();
  console.log(`  preparación OK · reset + seed ${ESCENARIO_BOLETAS} · titular ${prep.email} · cuenta ${prep.cuentaId.slice(0, 8)}\n`);
} catch (e) {
  console.log(`\nPREPARACIÓN ROTA: ${String(e?.message ?? e)}`);
  console.log('El arnés NO pudo medir. Esto no es un veredicto sobre la pantalla.');
  await navegador.close().catch(() => {});
  process.exit(2);
}

try {
  // ── O1a · estilo computado de #transferir-monto ───────────────────────────────────────
  await correr('O1a', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    await page.click(sel('nav-transferir'));
    await page.waitForSelector(sel('transferir-pasos'), { state: 'visible', timeout: ESPERA_MS });
    await page.click(sel('transferir-origen-siguiente'));
    await page.waitForSelector(`${sel('transferir-paso-destino')}[aria-selected="true"]`, { timeout: ESPERA_MS });
    await page.waitForSelector(sel('transferir-monto'), { state: 'visible', timeout: ESPERA_MS });

    const est = await page.evaluate((selector) => {
      const input = document.querySelector(selector);
      if (!input) return { error: 'input no encontrado' };
      const cont = input.closest('.con-prefijo');
      if (!cont) return { error: 'contenedor .con-prefijo no encontrado' };
      const inSt = window.getComputedStyle(input);
      const coSt = window.getComputedStyle(cont);
      return {
        inBorders: [
          parseFloat(inSt.borderTopWidth) || 0,
          parseFloat(inSt.borderRightWidth) || 0,
          parseFloat(inSt.borderBottomWidth) || 0,
          parseFloat(inSt.borderLeftWidth) || 0,
        ],
        inBordersRaw: [inSt.borderTopWidth, inSt.borderRightWidth, inSt.borderBottomWidth, inSt.borderLeftWidth],
        coBorders: [
          parseFloat(coSt.borderTopWidth) || 0,
          parseFloat(coSt.borderRightWidth) || 0,
          parseFloat(coSt.borderBottomWidth) || 0,
          parseFloat(coSt.borderLeftWidth) || 0,
        ],
        coBordersRaw: [coSt.borderTopWidth, coSt.borderRightWidth, coSt.borderBottomWidth, coSt.borderLeftWidth],
      };
    }, sel('transferir-monto'));

    if (est.error) {
      brazo('O1a', false, est.error);
      return;
    }

    const inCero = est.inBorders.every((b) => b === 0);
    const coMayorCero = est.coBorders.some((b) => b > 0);
    const ok = inCero && coMayorCero;

    if (ok) {
      brazo('O1a', true, `input bordes 0px · contenedor .con-prefijo borde [${est.coBordersRaw.join(', ')}]`);
    } else {
      brazo('O1a', false, `input border-width=[${est.inBordersRaw.join(', ')}] (esperado 0px) · contenedor border-width=[${est.coBordersRaw.join(', ')}]`);
    }
  });

  // ── O1b · foco por teclado en el input de monto ──────────────────────────────────────
  await correr('O1b', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    await page.click(sel('nav-transferir'));
    await page.waitForSelector(sel('transferir-pasos'), { state: 'visible', timeout: ESPERA_MS });
    await page.click(sel('transferir-origen-siguiente'));
    await page.waitForSelector(`${sel('transferir-paso-destino')}[aria-selected="true"]`, { timeout: ESPERA_MS });
    await page.waitForSelector(sel('transferir-monto'), { state: 'visible', timeout: ESPERA_MS });

    await page.focus(sel('transferir-monto'));
    await asentar(page);

    const foc = await page.evaluate((selector) => {
      const input = document.querySelector(selector);
      if (!input) return { error: 'input no encontrado' };
      const cont = input.closest('.con-prefijo');
      if (!cont) return { error: 'contenedor .con-prefijo no encontrado' };
      const inSt = window.getComputedStyle(input);
      const coSt = window.getComputedStyle(cont);
      return {
        coOutlineStyle: coSt.outlineStyle,
        coOutlineWidth: parseFloat(coSt.outlineWidth) || 0,
        inOutlineStyle: inSt.outlineStyle,
        inOutlineWidth: parseFloat(inSt.outlineWidth) || 0,
        inBorders: [
          parseFloat(inSt.borderTopWidth) || 0,
          parseFloat(inSt.borderRightWidth) || 0,
          parseFloat(inSt.borderBottomWidth) || 0,
          parseFloat(inSt.borderLeftWidth) || 0,
        ],
        inBordersRaw: [inSt.borderTopWidth, inSt.borderRightWidth, inSt.borderBottomWidth, inSt.borderLeftWidth],
      };
    }, sel('transferir-monto'));

    if (foc.error) {
      brazo('O1b', false, foc.error);
      return;
    }

    const coOk = foc.coOutlineStyle !== 'none' && foc.coOutlineWidth >= 2;
    const inOutlineOk = foc.inOutlineStyle === 'none' || foc.inOutlineWidth === 0;
    const inBordersOk = foc.inBorders.every((b) => b === 0);
    const inOk = inOutlineOk && inBordersOk;
    const ok = coOk && inOk;

    if (ok) {
      brazo('O1b', true, `contenedor outline=${foc.coOutlineStyle} ${foc.coOutlineWidth}px · input outline=${foc.inOutlineStyle} y bordes 0px`);
    } else {
      brazo('O1b', false, `contenedor outline=${foc.coOutlineStyle} ${foc.coOutlineWidth}px (esperado ≠ none y ≥ 2px) · input outline=${foc.inOutlineStyle} ${foc.inOutlineWidth}px, bordes=[${foc.inBordersRaw.join(', ')}]`);
    }
  });

  // ── O3a · escritorio, todas las filas de boletas-tabla ───────────────────────────────
  await correr('O3a', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('O3a', false, ir.motivo); return; }

    const resO3a = await page.evaluate((selTabla) => {
      const tabla = document.querySelector(selTabla);
      if (!tabla) return { error: 'boletas-tabla no encontrada' };
      const filas = Array.from(tabla.querySelectorAll('tbody tr, [data-testid="boleta-fila"]'));
      if (filas.length === 0) return { error: 'sin filas en boletas-tabla' };

      const fallas = [];
      const todasSeparaciones = [];

      for (let idx = 0; idx < filas.length; idx++) {
        const fila = filas[idx];
        const celda = fila.querySelector('.celda-acciones, td:last-child');
        if (!celda) {
          fallas.push(`fila ${idx}: celda de acciones no encontrada`);
          continue;
        }
        const cRect = celda.getBoundingClientRect();
        const btns = Array.from(celda.querySelectorAll('button')).filter((b) => b.getBoundingClientRect().width > 0);
        if (btns.length === 0) continue;

        // En cada botón: texto en una sola línea, sin recorte y dentro del rectángulo de su celda
        for (const btn of btns) {
          const bTxt = btn.textContent.trim();
          const bRect = btn.getBoundingClientRect();

          const range = document.createRange();
          range.selectNodeContents(btn);
          const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
          if (rects.length > 0) {
            const tops = rects.map((r) => r.top);
            const diffTop = Math.max(...tops) - Math.min(...tops);
            if (diffTop > 1) {
              fallas.push(`fila ${idx} botón «${bTxt}»: texto en múltiples líneas (diff tops ${diffTop.toFixed(1)}px > 1px)`);
            }
          }

          if (btn.scrollWidth > btn.clientWidth + 1) {
            fallas.push(`fila ${idx} botón «${bTxt}»: recortado (scrollWidth ${btn.scrollWidth} > clientWidth ${btn.clientWidth})`);
          }

          const fuera =
            bRect.left < cRect.left - 1 ||
            bRect.right > cRect.right + 1 ||
            bRect.top < cRect.top - 1 ||
            bRect.bottom > cRect.bottom + 1;
          if (fuera) {
            fallas.push(`fila ${idx} botón «${bTxt}»: fuera del rectángulo de la celda (btn [${bRect.left.toFixed(0)}, ${bRect.right.toFixed(0)}, ${bRect.top.toFixed(0)}, ${bRect.bottom.toFixed(0)}] vs celda [${cRect.left.toFixed(0)}, ${cRect.right.toFixed(0)}, ${cRect.top.toFixed(0)}, ${cRect.bottom.toFixed(0)}])`);
          }
        }

        // En filas con >= 2 botones además: mismos top y height (±1) y separación > 0
        if (btns.length >= 2) {
          const bTops = btns.map((b) => b.getBoundingClientRect().top);
          const diffRowTops = Math.max(...bTops) - Math.min(...bTops);
          if (diffRowTops > 1) {
            fallas.push(`fila ${idx}: botones con distinto top (${bTops.map((t) => t.toFixed(1)).join(', ')}, diff ${diffRowTops.toFixed(1)}px > 1px)`);
          }

          const bHeights = btns.map((b) => b.getBoundingClientRect().height);
          const diffRowHeights = Math.max(...bHeights) - Math.min(...bHeights);
          if (diffRowHeights > 1) {
            fallas.push(`fila ${idx}: botones con distinto height (${bHeights.map((h) => h.toFixed(1)).join(', ')}, diff ${diffRowHeights.toFixed(1)}px > 1px)`);
          }

          const btnsSorted = [...btns].sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
          for (let i = 0; i < btnsSorted.length - 1; i++) {
            const r1 = btnsSorted[i].getBoundingClientRect();
            const r2 = btnsSorted[i + 1].getBoundingClientRect();
            const sep = r2.left - r1.right;
            todasSeparaciones.push(sep);
            if (sep <= 0) {
              fallas.push(`fila ${idx}: separación entre «${btnsSorted[i].textContent.trim()}» y «${btnsSorted[i + 1].textContent.trim()}» es ${sep.toFixed(1)}px (esperado > 0)`);
            }
          }
        }
      }

      if (todasSeparaciones.length > 1) {
        const diffSeps = Math.max(...todasSeparaciones) - Math.min(...todasSeparaciones);
        if (diffSeps > 1) {
          fallas.push(`separación no uniforme entre filas (${todasSeparaciones.map((s) => s.toFixed(1)).join('px, ')}px, diff ${diffSeps.toFixed(1)}px > 1px)`);
        }
      }

      return { fallas, todasSeparaciones, totalFilas: filas.length };
    }, sel('boletas-tabla'));

    if (resO3a.error) {
      brazo('O3a', false, resO3a.error);
      return;
    }

    if (resO3a.fallas.length === 0) {
      brazo('O3a', true, `${resO3a.totalFilas} filas en una línea, separación uniforme ${resO3a.todasSeparaciones[0]?.toFixed(1)}px`);
    } else {
      brazo('O3a', false, resO3a.fallas.slice(0, 3).join(' · '));
    }
  });

  // ── O3b · teléfono, las mismas filas en columna ──────────────────────────────────────
  await correr('O3b', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva({ viewport: TELEFONO });
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    await page.click(sel('nav-hamburguesa'));
    await page.waitForSelector(`${sel('nav-panel')}[data-abierto="true"]`, { state: 'visible', timeout: ESPERA_MS });
    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('O3b', false, ir.motivo); return; }

    const resO3b = await page.evaluate((selTabla) => {
      const tabla = document.querySelector(selTabla);
      if (!tabla) return { error: 'boletas-tabla no encontrada' };
      const filas = Array.from(tabla.querySelectorAll('tbody tr, [data-testid="boleta-fila"]'));
      if (filas.length === 0) return { error: 'sin filas en boletas-tabla' };

      const fallas = [];
      let filasMultiples = 0;

      for (let idx = 0; idx < filas.length; idx++) {
        const fila = filas[idx];
        const celda = fila.querySelector('.celda-acciones, td:last-child');
        if (!celda) continue;
        const btns = Array.from(celda.querySelectorAll('button')).filter((b) => b.getBoundingClientRect().width > 0);
        if (btns.length < 2) continue;
        filasMultiples++;

        const bLefts = btns.map((b) => b.getBoundingClientRect().left);
        const diffLeft = Math.max(...bLefts) - Math.min(...bLefts);
        if (diffLeft > 1) {
          fallas.push(`fila ${idx}: botones con distinto left (${bLefts.map((l) => l.toFixed(1)).join(', ')}, diff ${diffLeft.toFixed(1)}px > 1px)`);
        }

        const bWidths = btns.map((b) => b.getBoundingClientRect().width);
        const diffWidth = Math.max(...bWidths) - Math.min(...bWidths);
        if (diffWidth > 1) {
          fallas.push(`fila ${idx}: botones con distinto width (${bWidths.map((w) => w.toFixed(1)).join(', ')}, diff ${diffWidth.toFixed(1)}px > 1px)`);
        }

        const btnsSorted = [...btns].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        for (let i = 0; i < btnsSorted.length - 1; i++) {
          const bot1 = btnsSorted[i].getBoundingClientRect().bottom;
          const top2 = btnsSorted[i + 1].getBoundingClientRect().top;
          if (top2 < bot1 - 1) {
            fallas.push(`fila ${idx}: botón ${i + 1} solapa con botón ${i} (bot1=${bot1.toFixed(1)}, top2=${top2.toFixed(1)})`);
          }
        }
      }

      return { fallas, filasMultiples };
    }, sel('boletas-tabla'));

    if (resO3b.error) {
      brazo('O3b', false, resO3b.error);
      return;
    }

    if (resO3b.fallas.length === 0) {
      brazo('O3b', true, `${resO3b.filasMultiples} filas apiladas en columna con mismo left y width`);
    } else {
      brazo('O3b', false, resO3b.fallas.slice(0, 3).join(' · '));
    }
  });

  // ── O3c · Resumen, celda .celda-acciones del botón copiar ─────────────────────────────
  await correr('O3c', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const resO3c = await page.evaluate((selBtn) => {
      const btn = document.querySelector(selBtn);
      if (!btn) return { error: `botón ${selBtn} no encontrado` };
      const celda = btn.closest('.celda-acciones') || btn.closest('td');
      if (!celda) return { error: 'celda del botón copiar no encontrada' };
      const st = window.getComputedStyle(celda);
      return {
        width: parseFloat(st.width) || 0,
        widthRaw: st.width,
        textAlign: st.textAlign,
      };
    }, sel('cuenta-copiar-id'));

    if (resO3c.error) {
      brazo('O3c', false, resO3c.error);
      return;
    }

    const widthOk = Math.abs(resO3c.width - 110) <= 1;
    const alignOk = resO3c.textAlign === 'right';
    const ok = widthOk && alignOk;

    if (ok) {
      brazo('O3c', true, `width=${resO3c.widthRaw}, text-align=${resO3c.textAlign}`);
    } else {
      brazo('O3c', false, `width=${resO3c.widthRaw} (esperado 110px), text-align=${resO3c.textAlign} (esperado right)`);
    }
  });

  // ── O3d · la celda de acciones ocupa el alto de su fila, en los dos anchos (D128-3) ──────
  // Se comprobó en vivo que el borde inferior de la celda de acciones quedaba más arriba
  // que el del resto de la fila; ni O3a ni O3b lo miraban. Mide geometría, no la regla CSS.
  await correr('O3d', async () => {
    const fallas = [];
    for (const [ancho, viewport] of [['escritorio', ESCRITORIO], ['teléfono', TELEFONO]]) {
      const s = await sembrarBoletasAfirmado();
      const page = await paginaNueva({ viewport });
      await entrarUI(page, s.email, s.password);
      await estadoTerminal(page);
      if (viewport === TELEFONO) {
        await page.click(sel('nav-hamburguesa'));
        await page.waitForSelector(`${sel('nav-panel')}[data-abierto="true"]`, { state: 'visible', timeout: ESPERA_MS });
      }
      const ir = await irABoletas(page);
      if (!ir.ok) { fallas.push(`${ancho}: ${ir.motivo}`); continue; }

      const res = await page.evaluate(({ selTabla, tol }) => {
        const tabla = document.querySelector(selTabla);
        if (!tabla) return { error: 'boletas-tabla no encontrada' };
        const filas = Array.from(tabla.querySelectorAll('tbody tr'));
        if (filas.length === 0) return { error: 'sin filas en boletas-tabla' };
        const malas = [];
        filas.forEach((fila, idx) => {
          const f = fila.getBoundingClientRect();
          Array.from(fila.children).forEach((td, j) => {
            const c = td.getBoundingClientRect();
            if (Math.abs(c.top - f.top) > tol || Math.abs(c.bottom - f.bottom) > tol) {
              malas.push(`fila ${idx} celda ${j}: top/bottom ${c.top.toFixed(1)}/${c.bottom.toFixed(1)} vs fila ${f.top.toFixed(1)}/${f.bottom.toFixed(1)}`);
            }
          });
        });
        return { malas, totalFilas: filas.length };
      }, { selTabla: sel('boletas-tabla'), tol: TOLERANCIA_PX });

      if (res.error) fallas.push(`${ancho}: ${res.error}`);
      else if (res.malas.length > 0) fallas.push(`${ancho}: ${res.malas.slice(0, 2).join(' · ')}`);
    }
    brazo('O3d', fallas.length === 0, fallas.length === 0 ? 'todas las celdas con el alto de su fila, en los dos anchos' : fallas.join(' · '));
  });

  // ── U1 · boleta-monto de cada fila, en los dos anchos ─────────────────────────────────
  await correr('U1', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('U1', false, ir.motivo); return; }

    const fallasU1 = [];
    for (const [nombreVp, vp] of [['escritorio', ESCRITORIO], ['teléfono', TELEFONO]]) {
      await page.setViewportSize(vp);
      await asentar(page);
      const res = await page.evaluate((selMonto) => {
        const montos = Array.from(document.querySelectorAll(selMonto));
        if (montos.length === 0) return { error: `elementos ${selMonto} no encontrados` };
        const fallas = [];
        for (let i = 0; i < montos.length; i++) {
          const el = montos[i];
          const range = document.createRange();
          range.selectNodeContents(el);
          const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
          if (rects.length > 0) {
            const tops = rects.map((r) => r.top);
            const diff = Math.max(...tops) - Math.min(...tops);
            if (diff > 1) {
              fallas.push(`fila ${i} «${el.textContent.trim()}»: texto en múltiples líneas (diff tops ${diff.toFixed(1)}px > 1px)`);
            }
          }
        }
        return { fallas, total: montos.length };
      }, sel('boleta-monto'));

      if (res.error) fallasU1.push(`${nombreVp}: ${res.error}`);
      else if (res.fallas.length > 0) fallasU1.push(`${nombreVp}: ${res.fallas.join('; ')}`);
    }

    if (fallasU1.length === 0) {
      brazo('U1', true, 'texto en una línea en escritorio y teléfono');
    } else {
      brazo('U1', false, fallasU1.join(' · '));
    }
  });

  // ── U2 · encabezados de movimientos-tabla ─────────────────────────────────────────────
  await correr('U2', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    await page.click(sel('nav-movimientos'));
    await page.waitForSelector(sel('movimientos-region'), { state: 'visible', timeout: ESPERA_MS });
    await page.waitForSelector(sel('movimientos-cuenta'), { state: 'visible', timeout: ESPERA_MS });
    await page.selectOption(sel('movimientos-cuenta'), s.cuentaId);
    await page.click(sel('movimientos-buscar'));
    await page.waitForSelector(sel('movimientos-tabla'), { state: 'visible', timeout: ESPERA_MS });

    const ths = await page.evaluate((selTabla) => {
      const tabla = document.querySelector(selTabla);
      if (!tabla) return null;
      return Array.from(tabla.querySelectorAll('th')).map((th) => th.textContent.trim());
    }, sel('movimientos-tabla'));

    if (!ths || ths.length === 0) {
      brazo('U2', false, 'movimientos-tabla sin encabezados th');
      return;
    }

    const tieneTipo = ths.includes('Tipo');
    const tieneSigno = ths.includes('Signo');
    const ok = tieneTipo && !tieneSigno;

    if (ok) {
      brazo('U2', true, `encabezados [${ths.join(', ')}]`);
    } else {
      brazo('U2', false, `encabezados [${ths.join(', ')}], tiene Tipo=${tieneTipo}, tiene Signo=${tieneSigno}`);
    }
  });

  // ── U3a · cada caso a formatear de § 3 (tabla literal), en los dos campos ────────────
  await correr('U3a', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('U3a', false, ir.motivo); return; }

    // enmendado en F4a de UX-b2 (O2)
    const pestanaEmitirU3a = await page.waitForSelector(sel('boletas-pestana-emitir'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!pestanaEmitirU3a) { brazo('U3a', false, 'boletas-pestana-emitir no aparece (la pestaña no existe)'); return; }
    await page.click(sel('boletas-pestana-emitir'));
    await page.waitForSelector(sel('boletas-panel-emitir'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null); // C4

    const casosU3a = TABLA_U3.filter((c) => c.brazo === 'U3a');
    const fallasU3a = [];
    for (const c of casosU3a) {
      for (const campo of ['emitir-beneficiario-rut', 'emitir-retirador-rut']) {
        await page.fill(sel(campo), c.tecleado);
        const antes = await page.inputValue(sel(campo));
        if (antes !== c.tecleado) {
          fallasU3a.push(`${campo}: antes de blur valor=«${antes}», esperado «${c.tecleado}»`);
        }
        await page.dispatchEvent(sel(campo), 'blur');
        await page.$eval(sel(campo), (el) => el.blur());
        await page.focus(sel('emitir-monto'));
        await asentar(page);
        const despues = await page.inputValue(sel(campo));
        if (despues !== c.trasBlur) {
          fallasU3a.push(`${campo} tecleado «${c.tecleado}» tras blur dio «${despues}», esperado «${c.trasBlur}»`);
        }
      }
    }

    if (fallasU3a.length === 0) {
      brazo('U3a', true, `${casosU3a.length} casos formateados ok en ambos campos`);
    } else {
      brazo('U3a', false, fallasU3a.slice(0, 3).join(' · '));
    }
  });

  // ── U3b · cada caso a dejar intacto de § 3, incluidos ' 12345678-5 ' y 12345678-K ─────
  await correr('U3b', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('U3b', false, ir.motivo); return; }

    // enmendado en F4a de UX-b2 (O2)
    const pestanaEmitirU3b = await page.waitForSelector(sel('boletas-pestana-emitir'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!pestanaEmitirU3b) { brazo('U3b', false, 'boletas-pestana-emitir no aparece (la pestaña no existe)'); return; }
    await page.click(sel('boletas-pestana-emitir'));
    await page.waitForSelector(sel('boletas-panel-emitir'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null); // C4

    const casosU3b = TABLA_U3.filter((c) => c.brazo === 'U3b');
    const fallasU3b = [];
    for (const c of casosU3b) {
      for (const campo of ['emitir-beneficiario-rut', 'emitir-retirador-rut']) {
        await page.fill(sel(campo), c.tecleado);
        await page.dispatchEvent(sel(campo), 'blur');
        await page.$eval(sel(campo), (el) => el.blur());
        await page.focus(sel('emitir-monto'));
        await asentar(page);
        const despues = await page.inputValue(sel(campo));
        if (despues !== c.tecleado) {
          fallasU3b.push(`${campo} tecleado «${c.tecleado}» tras blur dio «${despues}», esperado idéntico`);
        }
      }
    }

    if (fallasU3b.length === 0) {
      brazo('U3b', true, `${casosU3b.length} casos intactos tras blur en ambos campos`);
    } else {
      brazo('U3b', false, fallasU3b.slice(0, 3).join(' · '));
    }
  });

  // ── U3c · emitir con 123456785 y 98765433 tecleados, blur, enviar ─────────────────────
  await correr('U3c', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('U3c', false, ir.motivo); return; }

    // enmendado en F4a de UX-b2 (O2)
    const pestanaEmitirU3c = await page.waitForSelector(sel('boletas-pestana-emitir'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!pestanaEmitirU3c) { brazo('U3c', false, 'boletas-pestana-emitir no aparece (la pestaña no existe)'); return; }
    await page.click(sel('boletas-pestana-emitir'));
    await page.waitForSelector(sel('boletas-panel-emitir'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null); // C4

    await page.selectOption(sel('emitir-origen'), s.cuentaId);
    await page.fill(sel('emitir-monto'), MONTO_FELIZ);
    await page.fill(sel('emitir-plazo'), PLAZO_FELIZ);
    await page.fill(sel('emitir-beneficiario-nombre'), NOMBRE_BENEFICIARIO);
    await page.fill(sel('emitir-retirador-nombre'), NOMBRE_RETIRADOR);
    await page.fill(sel('emitir-glosa'), GLOSA_FELIZ);

    await page.fill(sel('emitir-beneficiario-rut'), '123456785');
    await page.dispatchEvent(sel('emitir-beneficiario-rut'), 'blur');
    await page.$eval(sel('emitir-beneficiario-rut'), (el) => el.blur());

    await page.fill(sel('emitir-retirador-rut'), '98765433');
    await page.dispatchEvent(sel('emitir-retirador-rut'), 'blur');
    await page.$eval(sel('emitir-retirador-rut'), (el) => el.blur());

    await page.focus(sel('emitir-enviar'));
    await asentar(page);

    const reqPromise = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url() === `${API}/boletas`,
      { timeout: ESPERA_MS },
    );
    const resPromise = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url() === `${API}/boletas`,
      { timeout: ESPERA_MS },
    );

    await page.click(sel('emitir-enviar'));

    const req = await reqPromise;
    const res = await resPromise;

    let cuerpo = {};
    try { cuerpo = JSON.parse(req.postData() ?? '{}'); } catch {}
    const status = res.status();

    const benRutOk = cuerpo.beneficiarioRut === '12.345.678-5';
    const retRutOk = cuerpo.retiradorRut === '9.876.543-3';
    const statusOk = status === 201;
    const ok = benRutOk && retRutOk && statusOk;

    if (ok) {
      brazo('U3c', true, 'POST /boletas 201 con RUTs formateados');
    } else {
      brazo('U3c', false, `beneficiarioRut=«${cuerpo.beneficiarioRut}», retiradorRut=«${cuerpo.retiradorRut}», HTTP=${status}`);
    }
  });

  // ── U5 · teléfono, menú abierto ───────────────────────────────────────────────────────
  await correr('U5', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva({ viewport: TELEFONO });
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    await page.click(sel('nav-hamburguesa'));
    await page.waitForSelector(`${sel('nav-panel')}[data-abierto="true"]`, { state: 'visible', timeout: ESPERA_MS });

    const resU5 = await page.evaluate((selectors) => {
      const getRect = (testId) => document.querySelector(`[data-testid="${testId}"]`)?.getBoundingClientRect();
      const rResumen = getRect(selectors.resumen);
      const rAbrir = getRect(selectors.abrir);
      const rTransferir = getRect(selectors.transferir);
      const rMov = getRect(selectors.mov);

      if (!rResumen || !rAbrir || !rTransferir || !rMov) {
        return { error: 'uno o más enlaces del menú no encontrados' };
      }

      const sepResumenAbrir = rAbrir.top - rResumen.bottom;
      const sepTransferirMov = rMov.top - rTransferir.bottom;

      return {
        sepResumenAbrir,
        sepTransferirMov,
        diff: Math.abs(sepResumenAbrir - sepTransferirMov),
      };
    }, {
      resumen: 'nav-resumen',
      abrir: 'nav-abrir-cuenta',
      transferir: 'nav-transferir',
      mov: 'nav-movimientos',
    });

    if (resU5.error) {
      brazo('U5', false, resU5.error);
      return;
    }

    const ok = resU5.sepResumenAbrir > 0 && resU5.sepTransferirMov > 0 && resU5.diff <= TOLERANCIA_PX;
    if (ok) {
      brazo('U5', true, `sepResumenAbrir=${resU5.sepResumenAbrir.toFixed(1)}px, sepTransferirMov=${resU5.sepTransferirMov.toFixed(1)}px (diff=${resU5.diff.toFixed(1)}px <= 1px)`);
    } else {
      brazo('U5', false, `sepResumenAbrir=${resU5.sepResumenAbrir.toFixed(1)}px, sepTransferirMov=${resU5.sepTransferirMov.toFixed(1)}px (diff=${resU5.diff.toFixed(1)}px > 1px o no > 0)`);
    }
  });

  // ── U6a · texto del PDF de comprobante (con unpdf, como test:pdf) ─────────────────────
  await correr('U6a', async () => {
    const s = await sembrarBoletasAfirmado();
    const bList = await boletasApi(s.token);
    const boleta = bList.find((b) => b.id === s.ids['VIGENTE']) || bList[0];
    if (!boleta) {
      brazo('U6a', false, 'sin boletas para comprobante');
      return;
    }

    const r = await pedir('GET', `/boletas/${boleta.id}/comprobante.pdf`, { authorization: `Bearer ${s.token}` });
    if (r.status !== 200) {
      brazo('U6a', false, `GET comprobante.pdf dio ${r.status}`);
      return;
    }

    const { text } = await extractText(await getDocumentProxy(new Uint8Array(r.buf)), { mergePages: true });
    const norm = text.replace(/\s+/g, ' ').trim();

    const fallasU6a = [];
    if (!norm.includes('zeroFeeBank')) {
      fallasU6a.push('no contiene «zeroFeeBank»');
    }

    const fechas = [
      { nombre: 'emisión', iso: boleta.emitidaEn },
      { nombre: 'vencimiento', iso: boleta.venceEn },
    ];
    for (const f of fechas) {
      if (!norm.includes(f.iso)) {
        fallasU6a.push(`fecha ${f.nombre} ISO «${f.iso}» ausente en PDF`);
        continue;
      }
      const regexUtc = new RegExp(`\\(UTC\\):\\s*${escapeRegex(f.iso)}`);
      if (!regexUtc.test(norm)) {
        fallasU6a.push(`fecha ${f.nombre} «${f.iso}» no precedida por «(UTC):»`);
      }
    }

    if (fallasU6a.length === 0) {
      brazo('U6a', true, 'comprobante contiene zeroFeeBank y fechas rotuladas (UTC):');
    } else {
      brazo('U6a', false, fallasU6a.join(' · '));
    }
  });

  // ── U6b · texto del PDF de resumen de una boleta con fondos liberados ─────────────────
  await correr('U6b', async () => {
    const s = await sembrarBoletasAfirmado();
    const bList = await boletasApi(s.token);
    const boleta = bList.find((b) => b.fondosLiberados === true) || bList.find((b) => b.id === s.ids['VENCIDA_LIBERADA']);
    if (!boleta) {
      brazo('U6b', false, 'sin boleta con fondos liberados para resumen');
      return;
    }

    const r = await pedir('GET', `/boletas/${boleta.id}/resumen.pdf`, { authorization: `Bearer ${s.token}` });
    if (r.status !== 200) {
      brazo('U6b', false, `GET resumen.pdf dio ${r.status}`);
      return;
    }

    const { text } = await extractText(await getDocumentProxy(new Uint8Array(r.buf)), { mergePages: true });
    const norm = text.replace(/\s+/g, ' ').trim();

    const fallasU6b = [];
    if (!norm.includes('zeroFeeBank')) {
      fallasU6b.push('no contiene «zeroFeeBank»');
    }

    const regexIso = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
    const isosEncontrados = norm.match(regexIso) ?? [];
    if (isosEncontrados.length < 3) {
      fallasU6b.push(`esperadas 3 fechas ISO, encontradas ${isosEncontrados.length} ([${isosEncontrados.join(', ')}])`);
    }

    for (const isoStr of isosEncontrados) {
      const regexUtc = new RegExp(`\\(UTC\\):\\s*${escapeRegex(isoStr)}`);
      if (!regexUtc.test(norm)) {
        fallasU6b.push(`fecha ISO «${isoStr}» no precedida por «(UTC):»`);
      }
    }

    if (!norm.includes(boleta.emitidaEn)) {
      fallasU6b.push(`fecha emisión «${boleta.emitidaEn}» ausente`);
    }
    if (!norm.includes(boleta.venceEn)) {
      fallasU6b.push(`fecha vencimiento «${boleta.venceEn}» ausente`);
    }

    if (fallasU6b.length === 0) {
      brazo('U6b', true, 'resumen contiene zeroFeeBank y 3 fechas rotuladas (UTC):');
    } else {
      brazo('U6b', false, fallasU6b.join(' · '));
    }
  });

  // ── S64a · emitir desde una cuenta del selector ──────────────────────────────────────
  await correr('S64a', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('S64a', false, ir.motivo); return; }

    // enmendado en F4a de UX-b2 (O2)
    const pestanaEmitirS64a = await page.waitForSelector(sel('boletas-pestana-emitir'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (!pestanaEmitirS64a) { brazo('S64a', false, 'boletas-pestana-emitir no aparece (la pestaña no existe)'); return; }
    await page.click(sel('boletas-pestana-emitir'));
    await page.waitForSelector(sel('boletas-panel-emitir'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null); // C4

    const cuentaId = s.cuentaId;
    const optAntes = await page.$eval(
      `${sel('emitir-origen')} option[value="${cuentaId}"]`,
      (el) => el.textContent?.trim() ?? '',
    );

    await llenarFormularioEmitir(page, {
      origenId: cuentaId,
      monto: MONTO_FELIZ,
      plazo: PLAZO_FELIZ,
      benRut: RUT_BENEFICIARIO,
      benNombre: NOMBRE_BENEFICIARIO,
      retRut: RUT_RETIRADOR,
      retNombre: NOMBRE_RETIRADOR,
      glosa: GLOSA_FELIZ,
    });
    await page.click(sel('emitir-enviar'));
    await page.waitForSelector(sel('emitir-exito'), { state: 'visible', timeout: ESPERA_MS });

    const cList = await cuentasApi(s.token);
    const cCuenta = cList.find((c) => c.id === cuentaId);
    if (!cCuenta) throw new Error(`cuenta ${cuentaId} no encontrada en GET /cuentas`);
    const nuevoSaldo = cCuenta.saldo;

    if (optAntes.includes(`$ ${nuevoSaldo}`)) {
      throw new Error(`saldo antes de emitir ya contenía $ ${nuevoSaldo} (${optAntes})`);
    }

    const resS64a = await esperarSaldoEnOpcion(page, cuentaId, nuevoSaldo, ESPERA_MS);
    if (resS64a.ok) {
      brazo('S64a', true, `opción actualizada a «${resS64a.textoActual}» tras emitir`);
    } else {
      brazo('S64a', false, `opción tiene «${resS64a.textoActual}», esperado que contenga «$ ${nuevoSaldo}»`);
    }
  });

  // ── S64b · devolver la boleta VIGENTE ────────────────────────────────────────────────
  await correr('S64b', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('S64b', false, ir.motivo); return; }

    const cuentaId = s.cuentaId;
    const optAntes = await page.$eval(
      `${sel('emitir-origen')} option[value="${cuentaId}"]`,
      (el) => el.textContent?.trim() ?? '',
    );

    const vigId = s.ids['VIGENTE'];
    const filaSel = `${sel('boleta-fila')}[data-boleta-id="${vigId}"]`;
    const btnDevolver = await page.$(`${filaSel} ${sel('boleta-devolver')}`);
    if (!btnDevolver) throw new Error(`botón boleta-devolver no encontrado en ${filaSel}`);

    await btnDevolver.click();
    await page.waitForSelector(`${filaSel}[data-estado="DEVUELTA"], ${filaSel} ${sel('boleta-resumen-pdf')}`, { state: 'attached', timeout: ESPERA_MS });

    const cList = await cuentasApi(s.token);
    const cCuenta = cList.find((c) => c.id === cuentaId);
    if (!cCuenta) throw new Error(`cuenta ${cuentaId} no encontrada en GET /cuentas`);
    const nuevoSaldo = cCuenta.saldo;

    if (optAntes.includes(`$ ${nuevoSaldo}`)) {
      throw new Error(`saldo antes de devolver ya contenía $ ${nuevoSaldo} (${optAntes})`);
    }

    const resS64b = await esperarSaldoEnOpcion(page, cuentaId, nuevoSaldo, ESPERA_MS);
    if (resS64b.ok) {
      brazo('S64b', true, `opción actualizada a «${resS64b.textoActual}» tras devolver`);
    } else {
      brazo('S64b', false, `opción tiene «${resS64b.textoActual}», esperado que contenga «$ ${nuevoSaldo}»`);
    }
  });

  // ── S64c · liberar la VENCIDA_POR_LIBERAR sembrada ───────────────────────────────────
  await correr('S64c', async () => {
    const s = await sembrarBoletasAfirmado();
    const page = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(page, s.email, s.password);
    await estadoTerminal(page);

    const ir = await irABoletas(page);
    if (!ir.ok) { brazo('S64c', false, ir.motivo); return; }

    const cuentaId = s.cuentaId;
    const optAntes = await page.$eval(
      `${sel('emitir-origen')} option[value="${cuentaId}"]`,
      (el) => el.textContent?.trim() ?? '',
    );

    const vencId = s.ids['VENCIDA_POR_LIBERAR'];
    const filaSel = `${sel('boleta-fila')}[data-boleta-id="${vencId}"]`;
    const btnLiberar = await page.$(`${filaSel} ${sel('boleta-liberar')}`);
    if (!btnLiberar) throw new Error(`botón boleta-liberar no encontrado en ${filaSel}`);

    await btnLiberar.click();
    await page.waitForSelector(`${filaSel}[data-fondos-liberados="true"]`, { state: 'attached', timeout: ESPERA_MS });

    const cList = await cuentasApi(s.token);
    const cCuenta = cList.find((c) => c.id === cuentaId);
    if (!cCuenta) throw new Error(`cuenta ${cuentaId} no encontrada en GET /cuentas`);
    const nuevoSaldo = cCuenta.saldo;

    if (optAntes.includes(`$ ${nuevoSaldo}`)) {
      throw new Error(`saldo antes de liberar ya contenía $ ${nuevoSaldo} (${optAntes})`);
    }

    const resS64c = await esperarSaldoEnOpcion(page, cuentaId, nuevoSaldo, ESPERA_MS);
    if (resS64c.ok) {
      brazo('S64c', true, `opción actualizada a «${resS64c.textoActual}» tras liberar`);
    } else {
      brazo('S64c', false, `opción tiene «${resS64c.textoActual}», esperado que contenga «$ ${nuevoSaldo}»`);
    }
  });
} finally {
  await relojBackendDesfijar().catch(() => {});
  await navegador.close().catch(() => {});
}

const verdes = resultados.filter((r) => r.ok).length;
console.log(`\nverificar:ux-a: ${verdes}/${BRAZOS_TOTAL}`);
process.exit(verdes === BRAZOS_TOTAL ? 0 : 1);
