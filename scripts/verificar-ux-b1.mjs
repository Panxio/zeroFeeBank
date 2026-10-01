// Árbitro de UX-b1 (specs/UX-b1.md § 6). Corre contra el ARTEFACTO servido:
// el backend (`node dist/main.js`) en :3000 y el build de pruebas de web/ en :4200.
// Lo levanta scripts/verificar-ux-b1.sh; este archivo sólo mira. No importa código de
// la app y no toca la base de datos: todo estado entra por las costuras /__test__/ y por el API
// público (perfil SUT, § 6.1 de la spec).
//
// Contiene exactamente los 13 brazos de § 6.1:
//   X1, A1, A2, A3, A3o, A4, A5, M1, M2, M3, M4, M5, S1.
//
// ── Decisiones de implementación del arnés (F4a) ───────────────────────────
// 1. **Verificación de «Elementos de texto» en el DOM computado (A1, A3, A3o, A4, A5):**
//    La función `verificarElementoTexto` inspecciona directamente el nodo renderizado:
//    (a) atributo `data-cuenta-id` coincidente con el UUID de la cuenta;
//    (b) hijo con `aria-hidden="true"` con la abreviatura; en boletas, además, el tipo como texto fuera
//        del `aria-hidden` y del `.sr-only` (D133-1);
//    (c) hijo `.sr-only` con texto igual al UUID completo, clase `sr-only` y estilos computados de recorte
//        efectivo (`clip` distinto de `auto` y con patrón de rectángulo nulo, o `clip-path` distinto de `none`);
//    (d) recorrido con `TreeWalker` sobre todos los nodos de texto fuera de `.sr-only` confirmando que ninguno
//        contenga el identificador completo (#6).
// 2. **Inspección de selectores en A2 mediante propiedades del DOM y atributos:**
//    Para cada uno de los seis selectores de cuenta de § 3.2 se verifican las opciones con UUID leyendo su valor
//    mediante la propiedad `o.value`, su texto visible mediante `o.textContent` y su atributo `o.getAttribute('aria-label')`.
//    No se emplean roles accesibles (`getByRole('option')`) porque Playwright calcula el nombre accesible
//    a partir de `aria-label` enmascarando el texto visible (#26).
// 3. **Verificación de tres condiciones en brazos de error (M1–M5, #4, #5):**
//    Cada brazo verifica: (1) `data-codigo` tipado en la zona contenedora; (2) igualdad exacta contra el literal
//    aprobado de § 3.3 en el `<p>` de mensaje (en Pagos, `.pagos-mensaje-error`; en el resto, el único `<p>`);
//    (3) ausencia total de dígitos (`/\d/`) e identificadores completos en el `innerText` de la zona entera,
//    previniendo que se pinte `err.mensaje` además del texto del front (#5).
// 4. **Reporte explícito en A3o (modo otra, D130-7):**
//    A3o evalúa que en Revisar el destino tecleado permanezca completo y que en éxito origen y destino cumplan
//    «Elementos de texto». Al fallar hoy en la mitad de éxito, el motivo reporta explícitamente el cumplimiento
//    de Revisar y el defecto en éxito.
// 5. **Aislamiento e independencia de cada brazo mediante reset:**
//    Cada brazo que muta estado ejecuta `reset` (`POST /__test__/reset`) y monta su escenario mediante el API
//    público o la semilla `boletas-en-cada-estado` (A5). Ningún brazo depende del orden ni toca la base de datos.
// 6. **Cierre garantizado de navegador y contextos:**
//    Todos los contextos abiertos se registran en un `Set` y se cierran en el bloque `finally` de `correr()`,
//    y el navegador Playwright se cierra en el bloque `finally` global antes de `process.exit`.
//
// ── NACE SIN EL ARREGLO: línea base fijada antes de medir, 0/13 (§ 7.1) ──────────────
// ROJOS esperados (13): X1, A1, A2, A3, A3o, A4, A5, M1, M2, M3, M4, M5, S1.
// VERDES esperados (0): ninguno.
// (En A3o, la mitad «Revisar completo» ya se cumple en main; el brazo cae por la mitad de éxito. Esa mitad verde sólo se ve roja bajo K9.)
// Predicción fijada por escrito en la spec antes de correr; no se mueve.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const API = 'http://localhost:3000';
const APP = 'http://localhost:4200';
const HOSTS_PERMITIDOS = new Set(['localhost:3000', 'localhost:4200']);
const ESPERA_MS = 8000;
const CLAVE = 'Clave-Arnes-2026';
const BRAZOS_TOTAL = 13;

const ESCRITORIO = { width: 1280, height: 800 };
const TELEFONO = { width: 390, height: 844 };
const ESCENARIO_BOLETAS = 'boletas-en-cada-estado';

// ── Constantes de § 4 (specs/UX-b1.md § 4, líneas 124-128) ──────────────────────────
// LARGO_ID_CORTO = 6 (specs/UX-b1.md § 4, línea 125): longitud del sufijo visible de cuenta.
const LARGO_ID_CORTO = 6;

// Prefijo de abreviatura: «…» U+2026 (specs/UX-b1.md § 4, línea 126).
const PREFIJO_ABREVIATURA = '…';

/**
 * Función pura de abreviación de cuenta (specs/UX-b1.md § 3.2, líneas 77-79; § 2 D130-4, líneas 59-61; #21).
 * Si la longitud es mayor a 6, antepone '…' y toma los últimos 6 caracteres; si es ≤ 6 o vacío, lo devuelve tal cual.
 */
function abreviar(id) {
  if (!id) return '';
  const str = String(id);
  return str.length > LARGO_ID_CORTO ? PREFIJO_ABREVIATURA + str.slice(-LARGO_ID_CORTO) : str;
}

// ── Textos literales de error de § 3.3 (specs/UX-b1.md § 3.3, tabla líneas 112-118; D131-3) ──
// Código FONDOS_INSUFICIENTES (specs/UX-b1.md § 3.3, línea 114):
const LITERAL_FONDOS_INSUFICIENTES = 'El saldo disponible de la cuenta de origen no alcanza para este monto.';

// Código MONTO_APERTURA_INSUFICIENTE (specs/UX-b1.md § 3.3, línea 115):
const LITERAL_MONTO_APERTURA_INSUFICIENTE = 'El monto de apertura es menor al mínimo requerido para abrir una cuenta.';

// Código TOPE_DIARIO_EXCEDIDO (specs/UX-b1.md § 3.3, línea 116):
const LITERAL_TOPE_DIARIO_EXCEDIDO = 'Este monto supera el tope diario de transferencias a otros bancos para la cuenta de origen.';

// Código MISMA_CUENTA (specs/UX-b1.md § 3.3, línea 117; D130-6):
const LITERAL_MISMA_CUENTA = 'La cuenta de destino no puede ser la misma que la cuenta de origen.';

// Constantes de negocio para bancos y pagos (§ 4 de transferir y pagos)
const BANCO_FELIZ = 'SANDBOX';
const NUMERO_VALIDO = '12345678';
const TIPO_FELIZ = 'AHORRO';
const X2_MONTO = '200.00';
const MONTO_BAJO_MINIMO = '999.99';
const MONTO_SOBRE_SALDO = '1000.01';

const BENEF_REF = {
  beneficiarioNombre: 'Luz del Sur',
  beneficiarioDireccion: 'Av. Siempre Viva 742',
  beneficiarioCiudad: 'Santiago',
  beneficiarioEstado: 'RM',
  beneficiarioCodigoPostal: '8320000',
  beneficiarioTelefono: '+56 2 2345 6789',
  cuentaBeneficiario: 'CL-000123',
};

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

async function cuentasApi(token) {
  const r = await pedir('GET', '/cuentas', { authorization: `Bearer ${token}` });
  if (r.status !== 200) throw new Error(`preparación: GET /cuentas → ${r.status} ${r.body}`);
  return JSON.parse(r.body).cuentas;
}

async function otroBancoApi(token, cuerpo) {
  return pedir('POST', '/transferencias/otros-bancos',
    { ...JSON_H, authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() }, cuerpo);
}

async function relojBackendDesfijar() {
  await pedir('POST', '/__test__/reloj', JSON_H, { instante: null }).catch(() => {});
}

async function titularDosCuentas(prefijo, limpiar = true) {
  if (limpiar) await reset();
  const email = `uxb1-${prefijo}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@banco.test`;
  await registrar(email);
  const token = await tokenDe(email);
  const corriente = await abrirCuentaApi(token, { tipo: 'CORRIENTE', monto: '2000.00' });
  const ahorro = await abrirCuentaApi(token, { tipo: 'AHORRO', monto: '1000.00', origenId: corriente.id });
  const cuentas = await cuentasApi(token);
  if (cuentas.length !== 2) throw new Error(`preparación: se esperaban 2 cuentas y hay ${cuentas.length}`);
  const c = cuentas.find((x) => x.id === corriente.id);
  const a = cuentas.find((x) => x.id === ahorro.id);
  if (c?.saldo !== '1000.00' || a?.saldo !== '1000.00') {
    throw new Error(`preparación: saldos inesperados (${c?.saldo} / ${a?.saldo})`);
  }
  return { email, token, corrienteId: corriente.id, ahorroId: ahorro.id };
}

async function titularConPagoPrevio(prefijo) {
  await reset();
  const email = `uxb1-pago-${prefijo}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@banco.test`;
  await registrar(email);
  const token = await tokenDe(email);
  const corriente = await abrirCuentaApi(token, { tipo: 'CORRIENTE', monto: '1000.00' });
  const r = await pedir('POST', '/pagos',
    { ...JSON_H, authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() },
    { cuentaOrigenId: corriente.id, monto: '10.00', ...BENEF_REF, beneficiarioNombre: 'Previo S.A.' });
  if (r.status !== 201) throw new Error(`preparación: pago previo → ${r.status} ${r.body}`);
  return { email, token, cuentaId: corriente.id };
}

async function topeAgotado(u) {
  const r1 = await otroBancoApi(u.token, {
    cuentaOrigenId: u.corrienteId, monto: X2_MONTO, banco: BANCO_FELIZ,
    numeroCuenta: NUMERO_VALIDO, tipoCuenta: TIPO_FELIZ,
  });
  if (r1.status !== 201) throw new Error(`preparación: consumo del tope → ${r1.status} ${codigoDe(r1.body)}`);
  const r2 = await otroBancoApi(u.token, {
    cuentaOrigenId: u.corrienteId, monto: '0.01', banco: BANCO_FELIZ,
    numeroCuenta: NUMERO_VALIDO, tipoCuenta: TIPO_FELIZ,
  });
  if (codigoDe(r2.body) !== 'TOPE_DIARIO_EXCEDIDO') {
    throw new Error(`preparación: el tope no quedó agotado (0.01 → ${r2.status} ${codigoDe(r2.body)})`);
  }
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
  return {
    email: data.credenciales.email,
    password: data.credenciales.password,
    token,
    cuentaId: data.cuentas[0].id,
    boletas,
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

async function entrarUI(page, email, password = CLAVE, montada = true) {
  await page.click(sel('login-abrir'));
  await page.waitForSelector(`${sel('login-popover')}[data-estado="listo"]`, { state: 'attached', timeout: ESPERA_MS });
  const f = await marcoDe(page);
  await f.fill(sel('login-email'), email);
  await f.fill(sel('login-password'), password);
  await f.click(sel('login-enviar'));
  if (montada) await page.waitForSelector(sel('cuentas-region'), { state: 'attached', timeout: ESPERA_MS });
}

const TERMINAL = ['listo', 'vacio', 'error'];
async function estadoTerminal(page) {
  const h = await page.waitForSelector(
    TERMINAL.map((e) => `${sel('cuentas-region')}[data-estado="${e}"]`).join(', '),
    { state: 'attached', timeout: ESPERA_MS }
  );
  return h.getAttribute('data-estado');
}

/**
 * Inspecciona un <dd> asociado al <dt> con el texto indicado dentro de un contenedor.
 */
async function ddPorDt(page, contenedorSel, textoDt) {
  const handle = await page.evaluateHandle(({ cont, dtTexto }) => {
    const root = document.querySelector(cont);
    if (!root) return null;
    const dts = Array.from(root.querySelectorAll('dt'));
    const dt = dts.find((e) => (e.textContent ?? '').trim().toLowerCase() === dtTexto.toLowerCase());
    if (!dt) return null;
    let sig = dt.nextElementSibling;
    while (sig && sig.tagName.toLowerCase() !== 'dd') sig = sig.nextElementSibling;
    return sig;
  }, { cont: contenedorSel, dtTexto: textoDt });
  return handle.asElement();
}

/**
 * Valida el cumplimiento riguroso de «Elementos de texto» (§ 6.1) sobre un nodo renderizado:
 * - data-cuenta-id == id
 * - hijo [aria-hidden="true"] con texto == abreviar(id)
 * - con tipo esperado (boleta-cuenta, D133-1): texto fuera del aria-hidden y del .sr-only, recortado, == tipo
 * - hijo .sr-only con texto == id, clase sr-only y recorte computado (clip o clip-path)
 * - ningún nodo de texto fuera de .sr-only contiene el id completo (#6).
 */
async function verificarElementoTexto(handle, { id, tipoEsperado = null }) {
  if (!handle) return { ok: false, motivo: 'elemento no existe' };
  return handle.evaluate((el, { idEsperado, tipo, abrev }) => {
    const fallas = [];

    // 1. data-cuenta-id
    const attrId = el.getAttribute('data-cuenta-id');
    if (attrId !== idEsperado) {
      fallas.push(`data-cuenta-id=«${attrId}» (esperado «${idEsperado}»)`);
    }

    // 2. hijo [aria-hidden="true"]
    const visibleEl = el.querySelector('[aria-hidden="true"]');
    if (!visibleEl) {
      fallas.push('hijo [aria-hidden="true"] ausente');
    } else {
      // enmendado por D133-1: el tipo ya no va dentro del aria-hidden, que lleva sólo la abreviatura.
      const txtVisible = (visibleEl.textContent ?? '').trim();
      if (txtVisible !== abrev) {
        fallas.push(`texto aria-hidden=«${txtVisible}» (esperado «${abrev}»)`);
      }
    }

    // 2b. D133-1 (sólo boleta-cuenta, el único nodo con tipo esperado): el texto fuera del aria-hidden y
    // del .sr-only, recortado, == tipo, para que el lector de pantalla lo lea.
    if (tipo) {
      const dentroDeHijo = (node) => {
        for (let p = node.parentElement; p && p !== el; p = p.parentElement) {
          if (p.getAttribute('aria-hidden') === 'true' || p.classList.contains('sr-only')) return true;
        }
        return false;
      };
      const fueraDeHijos = [];
      const walkerTipo = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (walkerTipo.nextNode()) {
        if (!dentroDeHijo(walkerTipo.currentNode)) fueraDeHijos.push(walkerTipo.currentNode.textContent ?? '');
      }
      const txtFuera = fueraDeHijos.join('').trim();
      if (txtFuera !== tipo) {
        fallas.push(`texto fuera del aria-hidden y del .sr-only=«${txtFuera}» (esperado «${tipo}»)`);
      }
    }

    // 3. hijo .sr-only
    const srEl = el.querySelector('.sr-only');
    if (!srEl) {
      fallas.push('hijo .sr-only ausente');
    } else {
      const txtSr = (srEl.textContent ?? '').trim();
      if (txtSr !== idEsperado) {
        fallas.push(`texto .sr-only=«${txtSr}» (esperado «${idEsperado}»)`);
      }
      if (!srEl.classList.contains('sr-only')) {
        fallas.push('elemento .sr-only no tiene la clase sr-only');
      }
      const cs = window.getComputedStyle(srEl);
      const clip = cs.clip;
      const clipPath = cs.clipPath;
      const recorta = (clip && clip !== 'auto' && /rect\(0/i.test(clip)) || (clipPath && clipPath !== 'none');
      if (!recorta) {
        fallas.push(`estilo no recorta: clip=«${clip}», clipPath=«${clipPath}»`);
      }
    }

    // 4. ningún nodo de texto fuera de .sr-only contiene el id completo (#6)
    const textNodes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (srEl && srEl.contains(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode.textContent ?? '');
    }
    const textoFuera = textNodes.join('');
    if (textoFuera.includes(idEsperado)) {
      fallas.push(`id completo presente fuera de .sr-only en «${textoFuera.trim()}»`);
    }

    return { ok: fallas.length === 0, motivo: fallas.join(' · ') };
  }, { idEsperado: id, tipo: tipoEsperado, abrev: abreviar(id) });
}

/**
 * Valida las opciones con UUID de un selector de cuentas (§ 6.1 A2, #26):
 * - options con UUID == cuentas esperadas (no vacío)
 * - value == id
 * - textContent contiene abreviar(id) y no contiene id completo
 * - atributo aria-label contiene el id completo
 */
async function verificarOpcionesSelector(page, selectorTestId, cuentasEsperadas, nombreSelector) {
  await page.waitForSelector(sel(selectorTestId), { state: 'attached', timeout: ESPERA_MS });
  if (cuentasEsperadas.length > 0) {
    await page.waitForSelector(`${sel(selectorTestId)} option[value="${cuentasEsperadas[0].id}"]`, { state: 'attached', timeout: ESPERA_MS }).catch(() => {});
  }
  const opciones = await page.$$eval(`${sel(selectorTestId)} option`, (opts) => {
    return opts.map((o) => ({
      value: o.value,
      text: (o.textContent ?? '').trim(),
      ariaLabel: o.getAttribute('aria-label'),
    }));
  });

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const opcionesConUuid = opciones.filter((o) => UUID_RE.test(o.value));

  if (opcionesConUuid.length !== cuentasEsperadas.length) {
    return {
      ok: false,
      motivo: `${nombreSelector}: opciones con UUID=${opcionesConUuid.length}, esperado=${cuentasEsperadas.length}`,
    };
  }

  const fallas = [];
  for (const opt of opcionesConUuid) {
    const c = cuentasEsperadas.find((x) => x.id === opt.value);
    if (!c) {
      fallas.push(`${nombreSelector}: option value «${opt.value}» no coincide con ninguna cuenta esperada`);
      continue;
    }
    const abrev = abreviar(c.id);
    if (!opt.text.includes(abrev)) {
      fallas.push(`${nombreSelector}: texto «${opt.text}» no contiene la abreviatura «${abrev}»`);
    }
    if (opt.text.includes(c.id)) {
      fallas.push(`${nombreSelector}: texto «${opt.text}» contiene el id completo «${c.id}»`);
    }
    if (!opt.ariaLabel || !opt.ariaLabel.includes(c.id)) {
      fallas.push(`${nombreSelector}: aria-label «${opt.ariaLabel}» no contiene el id completo «${c.id}»`);
    }
  }

  return { ok: fallas.length === 0, motivo: fallas.join(' · ') };
}

/**
 * Valida las tres afirmaciones de M1–M5 (§ 6.1, #4, #5):
 * (1) data-codigo == código;
 * (2) nodo de mensaje == literal de § 3.3 (el único <p>, salvo en Pagos que es .pagos-mensaje-error);
 * (3) innerText de toda la zona no contiene dígitos ni el id completo.
 */
async function afirmarZonaError(page, selectorZona, codigoEsperado, literalEsperado, { esPagos = false, cuentaId = null } = {}) {
  await page.waitForSelector(selectorZona, { state: 'visible', timeout: ESPERA_MS });
  return page.$eval(selectorZona, (zona, { codigo, literal, esPag, cid }) => {
    const fallas = [];

    // (1) data-codigo == código
    const attrCodigo = zona.getAttribute('data-codigo');
    if (attrCodigo !== codigo) {
      fallas.push(`data-codigo=«${attrCodigo}» (esperado «${codigo}»)`);
    }

    // (2) nodo de mensaje == literal
    const nodoMensaje = esPag
      ? zona.querySelector('.pagos-mensaje-error')
      : zona.querySelector('p');
    if (!nodoMensaje) {
      fallas.push(esPag ? 'nodo .pagos-mensaje-error ausente' : 'nodo p de mensaje ausente');
    } else {
      const txtMensaje = (nodoMensaje.textContent ?? '').trim();
      if (txtMensaje !== literal) {
        fallas.push(`mensaje=«${txtMensaje}» (esperado literal «${literal}»)`);
      }
    }

    // (3) innerText de toda la zona no contiene dígitos ni el id completo
    const zonaText = (zona.innerText ?? zona.textContent ?? '').trim();
    if (/\d/.test(zonaText)) {
      fallas.push(`la zona contiene dígitos: «${zonaText}»`);
    }
    if (cid && zonaText.includes(cid)) {
      fallas.push(`la zona contiene el id completo «${cid}»`);
    }

    return { ok: fallas.length === 0, motivo: fallas.join(' · ') };
  }, { codigo: codigoEsperado, literal: literalEsperado, esPag: esPagos, cid: cuentaId });
}

// ══════════════════════════════════════════════════════════════════════════════════════
// ── LOS 13 BRAZOS DE § 6.1 (specs/UX-b1.md) ──────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════════════

try {
  // ── X1 · O5: Sin botón «Transferir» en Resumen y navegación por nav-transferir ────────
  await correr('X1', async () => {
    const u = await titularDosCuentas('x1');
    const fallas = [];

    // Escritorio: 0 elementos ir-transferir
    const pageEsc = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(pageEsc, u.email);
    await estadoTerminal(pageEsc);
    const cantIrEsc = await pageEsc.$$eval(
      `${sel('ir-transferir')}, .boton-transferir-resumen, button#ir-transferir`,
      (els) => els.length
    );
    if (cantIrEsc > 0) {
      fallas.push(`escritorio: ${cantIrEsc} elemento(s) ir-transferir en Resumen listo`);
    }
    await pageEsc.context().close();

    // Teléfono: 0 elementos ir-transferir y navegación por nav-hamburguesa -> nav-transferir
    const pageTel = await paginaNueva({ viewport: TELEFONO });
    await entrarUI(pageTel, u.email);
    await estadoTerminal(pageTel);
    const cantIrTel = await pageTel.$$eval(
      `${sel('ir-transferir')}, .boton-transferir-resumen, button#ir-transferir`,
      (els) => els.length
    );
    if (cantIrTel > 0) {
      fallas.push(`teléfono: ${cantIrTel} elemento(s) ir-transferir en Resumen listo`);
    }

    const hamburguesa = await pageTel.waitForSelector(sel('nav-hamburguesa'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null);
    if (!hamburguesa) {
      fallas.push('teléfono: nav-hamburguesa no visible');
    } else {
      await pageTel.click(sel('nav-hamburguesa'));
      await pageTel.waitForSelector(`${sel('nav-hamburguesa')}[aria-expanded="true"], ${sel('nav-panel')}:not([hidden])`, { state: 'attached', timeout: ESPERA_MS });
      const navTrans = await pageTel.waitForSelector(sel('nav-transferir'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null);
      if (!navTrans) {
        fallas.push('teléfono: nav-transferir no visible tras abrir hamburguesa');
      } else {
        await pageTel.click(sel('nav-transferir'));
        const pasos = await pageTel.waitForSelector(sel('transferir-pasos'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null);
        if (!pasos) {
          fallas.push('teléfono: transferir-pasos no visible tras clic en nav-transferir');
        }
      }
    }
    await pageTel.context().close();

    brazo('X1', fallas.length === 0, fallas.length === 0 ? '0 ir-transferir en escritorio y teléfono · nav-transferir lleva a transferir-pasos' : fallas.join(' · '));
  });

  // ── A1 · O4: Resumen, cada cuenta-id cumple «Elementos de texto» ─────────────────────
  await correr('A1', async () => {
    const u = await titularDosCuentas('a1');
    const apiCuentas = await cuentasApi(u.token);
    if (apiCuentas.length !== 2) throw new Error(`preparación: se esperaban 2 cuentas en API y hay ${apiCuentas.length}`);

    const page = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(page, u.email);
    await estadoTerminal(page);

    await page.waitForSelector(sel('cuentas-tabla'), { state: 'visible', timeout: ESPERA_MS });
    const filas = await page.$$(sel('cuenta-fila'));
    if (filas.length !== 2) {
      brazo('A1', false, `preparación: DOM tiene ${filas.length} filas cuenta-fila, esperado ${apiCuentas.length}`);
      return;
    }

    const fallas = [];
    for (let i = 0; i < filas.length; i++) {
      const fila = filas[i];
      const cidFila = await fila.getAttribute('data-cuenta-id');
      const cuenta = apiCuentas.find((c) => c.id === cidFila) || apiCuentas[i];
      const cuentaIdEl = await fila.$(sel('cuenta-id'));
      if (!cuentaIdEl) {
        fallas.push(`fila ${i + 1}: span cuenta-id no encontrado`);
        continue;
      }
      const res = await verificarElementoTexto(cuentaIdEl, { id: cuenta.id });
      if (!res.ok) {
        fallas.push(`cuenta ${i + 1} (${cuenta.id}): ${res.motivo}`);
      }
    }

    brazo('A1', fallas.length === 0, fallas.length === 0 ? 'las 2 cuentas cumplen «Elementos de texto» en Resumen' : fallas.join(' · '));
  });

  // ── A2 · O4: Los seis selectores de § 3.2 cumplen abreviatura y aria-label ──────────
  await correr('A2', async () => {
    const u = await titularDosCuentas('a2');
    const apiCuentas = await cuentasApi(u.token);
    if (apiCuentas.length !== 2) throw new Error(`preparación: se esperaban 2 cuentas en API y hay ${apiCuentas.length}`);

    const page = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(page, u.email);
    await estadoTerminal(page);

    const fallas = [];

    // 1. Transferir origen
    await page.click(sel('nav-transferir'));
    await page.waitForSelector(sel('transferir-pasos'), { state: 'visible', timeout: ESPERA_MS });
    const r1 = await verificarOpcionesSelector(page, 'transferir-origen', apiCuentas, 'transferir-origen');
    if (!r1.ok) fallas.push(r1.motivo);

    // 2. Transferir destino propia (exige 2 cuentas: origen es una, destino propia muestra la otra, #8)
    const origenId = apiCuentas[0].id;
    await page.selectOption(sel('transferir-origen'), origenId);
    await page.click(sel('transferir-origen-siguiente'));
    await page.waitForSelector(`${sel('transferir-paso-destino')}[aria-selected="true"]`, { timeout: ESPERA_MS });
    await page.check(sel('transferir-destino-modo-propia')).catch(() => page.click(sel('transferir-destino-modo-propia')));
    const cuentasDestino = apiCuentas.filter((c) => c.id !== origenId);
    const r2 = await verificarOpcionesSelector(page, 'transferir-destino-propia', cuentasDestino, 'transferir-destino-propia');
    if (!r2.ok) fallas.push(r2.motivo);

    // 3. Boletas emitir
    await page.click(sel('nav-boletas'));
    await page.waitForSelector(
      TERMINAL.map((e) => `${sel('boletas-region')}[data-estado="${e}"]`).join(', '),
      { state: 'visible', timeout: ESPERA_MS }
    );
    const r3 = await verificarOpcionesSelector(page, 'emitir-origen', apiCuentas, 'emitir-origen');
    if (!r3.ok) fallas.push(r3.motivo);

    // 4. Abrir cuenta origen
    await page.hover(sel('nav-cuentas'));
    await page.waitForSelector(`${sel('nav-cuentas')}[aria-expanded="true"]`, { state: 'attached', timeout: ESPERA_MS });
    await page.click(sel('nav-abrir-cuenta'));
    await page.waitForSelector(
      TERMINAL.map((e) => `${sel('abrir-cuenta-region')}[data-estado="${e}"]`).join(', '),
      { state: 'visible', timeout: ESPERA_MS }
    );
    const r4 = await verificarOpcionesSelector(page, 'abrir-cuenta-origen', apiCuentas, 'abrir-cuenta-origen');
    if (!r4.ok) fallas.push(r4.motivo);

    // 5. Movimientos
    await page.click(sel('nav-movimientos'));
    await page.waitForSelector(sel('movimientos-region'), { state: 'visible', timeout: ESPERA_MS });
    const r5 = await verificarOpcionesSelector(page, 'movimientos-cuenta', apiCuentas, 'movimientos-cuenta');
    if (!r5.ok) fallas.push(r5.motivo);

    // 6. Pagos
    await page.click(sel('nav-pagos'));
    await page.waitForSelector(sel('pagos-region'), { state: 'visible', timeout: ESPERA_MS });
    const r6 = await verificarOpcionesSelector(page, 'pagos-origen', apiCuentas, 'pagos-origen');
    if (!r6.ok) fallas.push(r6.motivo);

    brazo('A2', fallas.length === 0, fallas.length === 0 ? 'los 6 selectores cumplen abreviatura y aria-label' : fallas.join(' · '));
  });

  // ── A3 · O4: Transferir modo propia, Revisar y éxito cumplen «Elementos de texto» ───
  await correr('A3', async () => {
    const u = await titularDosCuentas('a3');
    const page = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(page, u.email);
    await estadoTerminal(page);

    await page.click(sel('nav-transferir'));
    await page.waitForSelector(sel('transferir-pasos'), { state: 'visible', timeout: ESPERA_MS });

    await page.selectOption(sel('transferir-origen'), u.corrienteId);
    await page.click(sel('transferir-origen-siguiente'));
    await page.waitForSelector(`${sel('transferir-paso-destino')}[aria-selected="true"]`, { timeout: ESPERA_MS });

    await page.check(sel('transferir-destino-modo-propia')).catch(() => page.click(sel('transferir-destino-modo-propia')));
    await page.waitForSelector(sel('transferir-destino-propia'), { state: 'visible', timeout: ESPERA_MS });
    await page.selectOption(sel('transferir-destino-propia'), u.ahorroId);
    await page.fill(sel('transferir-monto'), '10.00');
    await page.click(sel('transferir-destino-siguiente'));
    await page.waitForSelector(`${sel('transferir-paso-revisar')}[aria-selected="true"]`, { timeout: ESPERA_MS });

    const fallas = [];

    // Revisar: origen y destino
    const ddOrigenRevisar = await ddPorDt(page, '#panel-revisar dl.revisar-datos', 'Origen');
    const ddDestinoRevisar = await ddPorDt(page, '#panel-revisar dl.revisar-datos', 'Destino');
    const revOrigen = await verificarElementoTexto(ddOrigenRevisar, { id: u.corrienteId });
    if (!revOrigen.ok) fallas.push(`Revisar origen: ${revOrigen.motivo}`);
    const revDestino = await verificarElementoTexto(ddDestinoRevisar, { id: u.ahorroId });
    if (!revDestino.ok) fallas.push(`Revisar destino: ${revDestino.motivo}`);

    // Enviar y verificar éxito
    await page.click(sel('transferir-enviar'));
    const dlg = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: 2000 }).then(() => true, () => false);
    if (dlg) await page.click(sel('confirmar-aceptar'));

    await page.waitForSelector(sel('transferir-exito'), { state: 'visible', timeout: ESPERA_MS });

    const ddOrigenExito = await ddPorDt(page, '#transferir-exito dl.exito-detalles', 'Origen');
    const ddDestinoExito = await ddPorDt(page, '#transferir-exito dl.exito-detalles', 'Destino');
    const exOrigen = await verificarElementoTexto(ddOrigenExito, { id: u.corrienteId });
    if (!exOrigen.ok) fallas.push(`éxito origen: ${exOrigen.motivo}`);
    const exDestino = await verificarElementoTexto(ddDestinoExito, { id: u.ahorroId });
    if (!exDestino.ok) fallas.push(`éxito destino: ${exDestino.motivo}`);

    brazo('A3', fallas.length === 0, fallas.length === 0 ? 'origen y destino cumplen «Elementos de texto» en Revisar y éxito' : fallas.join(' · '));
  });

  // ── A3o · O4: Transferir modo otra, Revisar destino completo y éxito abreviado ──────
  await correr('A3o', async () => {
    const u = await titularDosCuentas('a3o-orig');
    const uDest = await titularDosCuentas('a3o-dest', false);
    const page = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(page, u.email);
    await estadoTerminal(page);

    await page.click(sel('nav-transferir'));
    await page.waitForSelector(sel('transferir-pasos'), { state: 'visible', timeout: ESPERA_MS });

    await page.selectOption(sel('transferir-origen'), u.corrienteId);
    await page.click(sel('transferir-origen-siguiente'));
    await page.waitForSelector(`${sel('transferir-paso-destino')}[aria-selected="true"]`, { timeout: ESPERA_MS });

    await page.check(sel('transferir-destino-modo-otra')).catch(() => page.click(sel('transferir-destino-modo-otra')));
    await page.waitForSelector(sel('transferir-destino-id'), { state: 'visible', timeout: ESPERA_MS });
    await page.fill(sel('transferir-destino-id'), uDest.corrienteId);
    await page.fill(sel('transferir-monto'), '10.00');
    await page.click(sel('transferir-destino-siguiente'));
    await page.waitForSelector(`${sel('transferir-paso-revisar')}[aria-selected="true"]`, { timeout: ESPERA_MS });

    // Revisar: destino tecleado debe mostrarse completo (D130-7)
    const ddDestinoRevisar = await ddPorDt(page, '#panel-revisar dl.revisar-datos', 'Destino');
    const txtDestinoRevisar = ddDestinoRevisar ? await ddDestinoRevisar.evaluate((el) => (el.textContent ?? '').trim()) : '';
    const revisarDestinoCompleto = txtDestinoRevisar.includes(uDest.corrienteId);

    // Enviar y verificar éxito
    await page.click(sel('transferir-enviar'));
    const dlg = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: 2000 }).then(() => true, () => false);
    if (dlg) await page.click(sel('confirmar-aceptar'));

    await page.waitForSelector(sel('transferir-exito'), { state: 'visible', timeout: ESPERA_MS });

    const ddOrigenExito = await ddPorDt(page, '#transferir-exito dl.exito-detalles', 'Origen');
    const ddDestinoExito = await ddPorDt(page, '#transferir-exito dl.exito-detalles', 'Destino');
    const exOrigen = await verificarElementoTexto(ddOrigenExito, { id: u.corrienteId });
    const exDestino = await verificarElementoTexto(ddDestinoExito, { id: uDest.corrienteId });
    const exitoOk = exOrigen.ok && exDestino.ok;

    if (revisarDestinoCompleto && !exitoOk) {
      const motivosExito = [];
      if (!exOrigen.ok) motivosExito.push(`origen: ${exOrigen.motivo}`);
      if (!exDestino.ok) motivosExito.push(`destino: ${exDestino.motivo}`);
      brazo('A3o', false, `Revisar cumplido (destino completo: «${txtDestinoRevisar}»), pero en éxito: origen/destino no cumplen «Elementos de texto» (${motivosExito.join(' · ')})`);
    } else if (!revisarDestinoCompleto && exitoOk) {
      brazo('A3o', false, `Revisar no mostró destino completo: «${txtDestinoRevisar}»`);
    } else if (!revisarDestinoCompleto && !exitoOk) {
      brazo('A3o', false, `Revisar no mostró destino completo («${txtDestinoRevisar}») y éxito no cumple «Elementos de texto»`);
    } else {
      brazo('A3o', true, 'Revisar destino completo y éxito cumple «Elementos de texto»');
    }
  });

  // ── A4 · O4: Transferir a otro banco éxito, origen cumple «Elementos de texto», n° banco tal cual ──
  await correr('A4', async () => {
    const u = await titularDosCuentas('a4');
    const page = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(page, u.email);
    await estadoTerminal(page);

    await page.click(sel('nav-transferir'));
    await page.waitForSelector(sel('transferir-pasos'), { state: 'visible', timeout: ESPERA_MS });

    await page.selectOption(sel('transferir-origen'), u.corrienteId);
    await page.click(sel('transferir-origen-siguiente'));
    await page.waitForSelector(`${sel('transferir-paso-destino')}[aria-selected="true"]`, { timeout: ESPERA_MS });

    await page.check(sel('transferir-destino-modo-banco')).catch(() => page.click(sel('transferir-destino-modo-banco')));
    await page.waitForSelector(sel('transferir-destino-banco'), { state: 'visible', timeout: ESPERA_MS });
    await page.selectOption(sel('transferir-destino-banco'), BANCO_FELIZ);
    await page.fill(sel('transferir-destino-numero'), NUMERO_VALIDO);
    await page.selectOption(sel('transferir-destino-tipo'), TIPO_FELIZ);
    await page.fill(sel('transferir-monto'), '10.00');
    await page.click(sel('transferir-destino-siguiente'));
    await page.waitForSelector(`${sel('transferir-paso-revisar')}[aria-selected="true"]`, { timeout: ESPERA_MS });

    await page.click(sel('transferir-enviar'));
    const dlg = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: 2000 }).then(() => true, () => false);
    if (dlg) await page.click(sel('confirmar-aceptar'));

    await page.waitForSelector(sel('transferir-banco-nombre'), { state: 'visible', timeout: ESPERA_MS });

    const ddOrigen = await ddPorDt(page, '#transferir-exito-banco dl.exito-detalles', 'Origen');
    const resOrigen = await verificarElementoTexto(ddOrigen, { id: u.corrienteId });

    const ddNumero = await page.$(sel('transferir-banco-numero'));
    const txtNumero = ddNumero ? await ddNumero.evaluate((el) => (el.textContent ?? '').trim()) : '';
    const numOk = txtNumero === NUMERO_VALIDO;

    const fallas = [];
    if (!resOrigen.ok) fallas.push(`origen: ${resOrigen.motivo}`);
    if (!numOk) fallas.push(`número de otro banco modificado: «${txtNumero}» (esperado «${NUMERO_VALIDO}»)`);

    brazo('A4', fallas.length === 0, fallas.length === 0 ? 'origen cumple «Elementos de texto» y número de otro banco tal cual' : fallas.join(' · '));
  });

  // ── A5 · O4: boleta-cuenta y pago-origen cumplen «Elementos de texto» ────────────────
  await correr('A5', async () => {
    const fallas = [];

    // Subcaso 1: boleta-cuenta en Boletas (con seed)
    const s = await sembrarBoletasAfirmado();
    const pageB = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(pageB, s.email, s.password);
    await estadoTerminal(pageB);

    await pageB.click(sel('nav-boletas'));
    await pageB.waitForSelector(
      TERMINAL.map((e) => `${sel('boletas-region')}[data-estado="${e}"]`).join(', '),
      { state: 'visible', timeout: ESPERA_MS }
    );
    const boletaCuentas = await pageB.$$(sel('boleta-cuenta'));
    if (boletaCuentas.length !== 5) {
      fallas.push(`boletas: se encontraron ${boletaCuentas.length} elementos boleta-cuenta, esperado 5`);
    } else {
      for (let i = 0; i < boletaCuentas.length; i++) {
        const res = await verificarElementoTexto(boletaCuentas[i], { id: s.cuentaId, tipoEsperado: 'Corriente' });
        if (!res.ok) {
          fallas.push(`boleta ${i + 1}: ${res.motivo}`);
        }
      }
    }
    await pageB.context().close();

    // Subcaso 2: pago-origen en Pagos (con POST /pagos previo)
    const u = await titularConPagoPrevio('a5');
    const pageP = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(pageP, u.email);
    await estadoTerminal(pageP);

    await pageP.click(sel('nav-pagos'));
    await pageP.waitForSelector(sel('pagos-region'), { state: 'visible', timeout: ESPERA_MS });
    await pageP.waitForSelector(sel('pago-fila'), { state: 'visible', timeout: ESPERA_MS });

    const pagosOrigen = await pageP.$$(sel('pago-origen'));
    if (pagosOrigen.length < 1) {
      fallas.push(`pagos: se encontraron ${pagosOrigen.length} elementos pago-origen, esperado ≥ 1`);
    } else {
      for (let i = 0; i < pagosOrigen.length; i++) {
        const res = await verificarElementoTexto(pagosOrigen[i], { id: u.cuentaId });
        if (!res.ok) {
          fallas.push(`pago ${i + 1}: ${res.motivo}`);
        }
      }
    }
    await pageP.context().close();

    brazo('A5', fallas.length === 0, fallas.length === 0 ? 'boleta-cuenta y pago-origen cumplen «Elementos de texto»' : fallas.join(' · '));
  });

  // ── M1 · Errores: Transferir con monto mayor al saldo (FONDOS_INSUFICIENTES) ─────────
  await correr('M1', async () => {
    const u = await titularDosCuentas('m1');
    const page = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(page, u.email);
    await estadoTerminal(page);

    await page.click(sel('nav-transferir'));
    await page.waitForSelector(sel('transferir-pasos'), { state: 'visible', timeout: ESPERA_MS });

    await page.selectOption(sel('transferir-origen'), u.corrienteId);
    await page.click(sel('transferir-origen-siguiente'));
    await page.waitForSelector(`${sel('transferir-paso-destino')}[aria-selected="true"]`, { timeout: ESPERA_MS });

    await page.check(sel('transferir-destino-modo-propia')).catch(() => page.click(sel('transferir-destino-modo-propia')));
    await page.waitForSelector(sel('transferir-destino-propia'), { state: 'visible', timeout: ESPERA_MS });
    await page.selectOption(sel('transferir-destino-propia'), u.ahorroId);
    await page.fill(sel('transferir-monto'), MONTO_SOBRE_SALDO);
    await page.click(sel('transferir-destino-siguiente'));
    await page.waitForSelector(`${sel('transferir-paso-revisar')}[aria-selected="true"]`, { timeout: ESPERA_MS });

    await page.click(sel('transferir-enviar'));
    const dlg = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: 2000 }).then(() => true, () => false);
    if (dlg) await page.click(sel('confirmar-aceptar'));

    const res = await afirmarZonaError(page, sel('transferir-error'), 'FONDOS_INSUFICIENTES', LITERAL_FONDOS_INSUFICIENTES, {
      esPagos: false,
      cuentaId: u.corrienteId,
    });
    brazo('M1', res.ok, res.ok ? 'FONDOS_INSUFICIENTES con literal de § 3.3 y zona sin cifras' : res.motivo);
  });

  // ── M2 · Errores: Abrir cuenta bajo el mínimo (MONTO_APERTURA_INSUFICIENTE) ──────────
  await correr('M2', async () => {
    const u = await titularDosCuentas('m2');
    const page = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(page, u.email);
    await estadoTerminal(page);

    await page.hover(sel('nav-cuentas'));
    await page.waitForSelector(`${sel('nav-cuentas')}[aria-expanded="true"]`, { state: 'attached', timeout: ESPERA_MS });
    await page.click(sel('nav-abrir-cuenta'));
    await page.waitForSelector(
      TERMINAL.map((e) => `${sel('abrir-cuenta-region')}[data-estado="${e}"]`).join(', '),
      { state: 'visible', timeout: ESPERA_MS }
    );

    await page.selectOption(sel('abrir-cuenta-tipo'), 'CORRIENTE');
    await page.fill(sel('abrir-cuenta-monto'), MONTO_BAJO_MINIMO);
    await page.selectOption(sel('abrir-cuenta-origen'), u.corrienteId);
    await page.click(sel('abrir-cuenta-enviar'));

    const res = await afirmarZonaError(page, sel('abrir-cuenta-codigo-error'), 'MONTO_APERTURA_INSUFICIENTE', LITERAL_MONTO_APERTURA_INSUFICIENTE, {
      esPagos: false,
      cuentaId: u.corrienteId,
    });
    brazo('M2', res.ok, res.ok ? 'MONTO_APERTURA_INSUFICIENTE con literal de § 3.3 y zona sin cifras' : res.motivo);
  });

  // ── M3 · Errores: Transferir a otro banco sobre tope (TOPE_DIARIO_EXCEDIDO) ──────────
  await correr('M3', async () => {
    const u = await titularDosCuentas('m3');
    await topeAgotado(u);

    const page = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(page, u.email);
    await estadoTerminal(page);

    await page.click(sel('nav-transferir'));
    await page.waitForSelector(sel('transferir-pasos'), { state: 'visible', timeout: ESPERA_MS });

    await page.selectOption(sel('transferir-origen'), u.corrienteId);
    await page.click(sel('transferir-origen-siguiente'));
    await page.waitForSelector(`${sel('transferir-paso-destino')}[aria-selected="true"]`, { timeout: ESPERA_MS });

    await page.check(sel('transferir-destino-modo-banco')).catch(() => page.click(sel('transferir-destino-modo-banco')));
    await page.waitForSelector(sel('transferir-destino-banco'), { state: 'visible', timeout: ESPERA_MS });
    await page.selectOption(sel('transferir-destino-banco'), BANCO_FELIZ);
    await page.fill(sel('transferir-destino-numero'), NUMERO_VALIDO);
    await page.selectOption(sel('transferir-destino-tipo'), TIPO_FELIZ);
    await page.fill(sel('transferir-monto'), '0.01');
    await page.click(sel('transferir-destino-siguiente'));
    await page.waitForSelector(`${sel('transferir-paso-revisar')}[aria-selected="true"]`, { timeout: ESPERA_MS });

    await page.click(sel('transferir-enviar'));
    const dlg = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: 2000 }).then(() => true, () => false);
    if (dlg) await page.click(sel('confirmar-aceptar'));

    const res = await afirmarZonaError(page, sel('transferir-error'), 'TOPE_DIARIO_EXCEDIDO', LITERAL_TOPE_DIARIO_EXCEDIDO, {
      esPagos: false,
      cuentaId: u.corrienteId,
    });
    brazo('M3', res.ok, res.ok ? 'TOPE_DIARIO_EXCEDIDO con literal de § 3.3 y zona sin cifras' : res.motivo);
  });

  // ── M4 · Errores: Pagos con monto mayor al saldo (FONDOS_INSUFICIENTES) ──────────────
  await correr('M4', async () => {
    const u = await titularDosCuentas('m4');
    const page = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(page, u.email);
    await estadoTerminal(page);

    await page.click(sel('nav-pagos'));
    await page.waitForSelector(sel('pagos-region'), { state: 'visible', timeout: ESPERA_MS });
    await page.waitForSelector(sel('pagos-form'), { state: 'visible', timeout: ESPERA_MS });
    await page.selectOption(sel('pagos-origen'), u.corrienteId);

    await page.fill(sel('pagos-monto'), MONTO_SOBRE_SALDO);
    await page.fill(sel('pagos-beneficiario-nombre'), BENEF_REF.beneficiarioNombre);
    await page.fill(sel('pagos-beneficiario-direccion'), BENEF_REF.beneficiarioDireccion);
    await page.fill(sel('pagos-beneficiario-ciudad'), BENEF_REF.beneficiarioCiudad);
    await page.fill(sel('pagos-beneficiario-estado'), BENEF_REF.beneficiarioEstado);
    await page.fill(sel('pagos-beneficiario-codigo-postal'), BENEF_REF.beneficiarioCodigoPostal);
    await page.fill(sel('pagos-beneficiario-telefono'), BENEF_REF.beneficiarioTelefono);
    await page.fill(sel('pagos-cuenta-beneficiario'), BENEF_REF.cuentaBeneficiario);

    await page.click(sel('pagos-enviar'));
    const dlg = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    if (dlg) await page.click(sel('confirmar-aceptar'));

    const res = await afirmarZonaError(page, sel('pagos-error'), 'FONDOS_INSUFICIENTES', LITERAL_FONDOS_INSUFICIENTES, {
      esPagos: true,
      cuentaId: u.corrienteId,
    });
    brazo('M4', res.ok, res.ok ? 'FONDOS_INSUFICIENTES en Pagos con literal de § 3.3 y zona sin cifras' : res.motivo);
  });

  // ── M5 · Errores: Transferir modo otra con origen tecleado (MISMA_CUENTA) ────────────
  await correr('M5', async () => {
    const u = await titularDosCuentas('m5');
    const page = await paginaNueva({ viewport: ESCRITORIO });
    await entrarUI(page, u.email);
    await estadoTerminal(page);

    await page.click(sel('nav-transferir'));
    await page.waitForSelector(sel('transferir-pasos'), { state: 'visible', timeout: ESPERA_MS });

    await page.selectOption(sel('transferir-origen'), u.corrienteId);
    await page.click(sel('transferir-origen-siguiente'));
    await page.waitForSelector(`${sel('transferir-paso-destino')}[aria-selected="true"]`, { timeout: ESPERA_MS });

    await page.check(sel('transferir-destino-modo-otra')).catch(() => page.click(sel('transferir-destino-modo-otra')));
    await page.waitForSelector(sel('transferir-destino-id'), { state: 'visible', timeout: ESPERA_MS });
    await page.fill(sel('transferir-destino-id'), u.corrienteId);
    await page.fill(sel('transferir-monto'), '10.00');
    await page.click(sel('transferir-destino-siguiente'));
    await page.waitForSelector(`${sel('transferir-paso-revisar')}[aria-selected="true"]`, { timeout: ESPERA_MS });

    await page.click(sel('transferir-enviar'));
    const dlg = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: 2000 }).then(() => true, () => false);
    if (dlg) await page.click(sel('confirmar-aceptar'));

    const res = await afirmarZonaError(page, sel('transferir-error'), 'MISMA_CUENTA', LITERAL_MISMA_CUENTA, {
      esPagos: false,
      cuentaId: u.corrienteId,
    });
    brazo('M5', res.ok, res.ok ? 'MISMA_CUENTA con literal de § 3.3 y zona sin id completo ni cifras' : res.motivo);
  });

  // ── S1 · Estático: 0 ocurrencias de err.mensaje fuera de textoError( ─────────────────
  await correr('S1', async () => {
    const rutaHtml = 'web/src/app/app.html';
    const html = readFileSync(rutaHtml, 'utf8');

    // Quitar toda llamada a textoError(...)
    const sinTextoError = html.replace(/textoError\s*\([\s\S]*?\)/g, '');

    // Contar ocurrencias de err.mensaje no amparadas por textoError(
    const ocurrencias = sinTextoError.match(/err\.mensaje/g) || [];
    const count = ocurrencias.length;

    if (count === 0) {
      brazo('S1', true, '0 ocurrencias de err.mensaje fuera de una llamada a textoError(');
    } else {
      brazo('S1', false, `${count} ocurrencia(s) de err.mensaje fuera de textoError(`);
    }
  });

} finally {
  await relojBackendDesfijar().catch(() => {});
  await navegador.close().catch(() => {});
}

const verdes = resultados.filter((r) => r.ok).length;
console.log(`\nverificar:ux-b1: ${verdes}/${BRAZOS_TOTAL}`);
process.exit(verdes === BRAZOS_TOTAL ? 0 : 1);
