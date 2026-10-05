// Árbitro de S-17 · Contacto (specs/S-17-contacto.md § 5). Corre contra el ARTEFACTO servido:
// el backend (`node dist/main.js`) en :3000 y el build de pruebas de web/ en :4200. Lo levanta
// scripts/verificar-s17-contacto.sh; este archivo sólo mira. No importa código de la app y no toca
// la base de datos: todo estado entra por `POST /__test__/reset` y por el API público (perfil SUT).
//
// Contiene exactamente los 19 brazos de § 5: N1–N3, C1–C3, V1, G1–G4, B1–B5, E1, I1, A1.
//
// ── Decisiones de implementación al escribir este arnés ─────────────────────────────────────────────────────────────
// 1. **Un solo reset por corrida, y un titular NUEVO por brazo.** Como en Pagos (decisión 1). El
//    reset va antes del primer brazo; después, cada brazo arma su titular por API (§ 4.1) con un
//    correo único. Así ningún brazo hereda datos de otro, y el orden de los brazos no cambia un
//    veredicto.
// 2. **Defensa contra el brazo imposible: preparación afirmada (§ 4.1).** Titular nuevo afirma
//    email y los 7 campos en `null` por `GET /contacto`. Titular con contacto previo afirma `PUT`
//    con 200 y `GET /contacto` con los 7 campos guardados. Si la preparación falla, el arnés muere
//    con `exit 2` diciendo qué paso se rompió, no con un brazo en rojo.
// 3. **Se espera la RESPUESTA del PUT antes del estado terminal** de `contacto-form` (decisión 3 de
//    Pagos/Movimientos): en rechazos sucesivos (B2/B3) el formulario ya está en `error` por el
//    sub-caso anterior, y esperar `data-estado` a secas casaría con ese terminal viejo. Si la red
//    pierde la respuesta (I1), se espera `requestfailed`.
// 4. **Vigilancia de estados con MutationObserver.** Se vigila `data-estado` de `contacto-form`
//    registrando cada transición (`oldValue` y `addedNodes`), exigiendo que todo guardado pase por
//    `guardando` (JC7 / CA7).
// 5. **Espera de desaparición efímera por CONDICIÓN con tope (JC9).** `contacto-guardado` dura
//    `AVISO_MS = 4000 ms`. Se afirma su presencia inmediata dentro de `contacto-aviso`
//    (`role="status"`), que se puede escribir mientras se muestra, y se espera su desaparición con
//    el tope de 8000 ms, sin ningún `sleep`.
// 6. **El click forzado de C2 es `click({ force: true })`** sobre `contacto-guardar` mientras está en
//    `guardando` y deshabilitado. La ausencia de un segundo `PUT` se mide esperando
//    `ESPERA_AUSENCIA_MS = 1500 ms` por la condición contraria.
// 7. **Intercepciones de red por host y pathname.** Casan `u.host === 'localhost:3000' && u.pathname === '/contacto'`,
//    diferenciando método `GET` y `PUT`. Todo intento fuera de `HOSTS_PERMITIDOS` se recolecta en `fuera`.
// 8. **Sin diálogo de confirmación (R5).** A diferencia de Pagos, Contacto no mueve plata y no abre
//    diálogo de confirmación; `contacto-guardar` envía directamente el `PUT`.
// 9. **N3 al final:** recolecta los testids renderizados en todos los recorridos y valida contra
//    `S-17-testids-contacto.txt`, `UNION` y los repetidos (ninguno en contacto se repite).
//
// ── Preparación y verificación inicial ───────────────────────────────────────────────────
// La verificación comprueba que la PREPARACIÓN de § 4.1 funciona contra el artefacto real
// (reset, registro, titular nuevo con 7 nulls, titular con contacto previo por API) y que
// cada brazo reporta su estado adecuadamente. Los defectos (K1-K18) de § 6 se miden en calibración.
//
// ── Enmiendas de candado (§ 5.1) ───────────────────────────────────────────────────────────
// Son una línea en cada uno de los ocho candados y se calibran 8/8.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const API = 'http://localhost:3000';
const APP = 'http://localhost:4200';
const HOSTS_PERMITIDOS = new Set(['localhost:3000', 'localhost:4200']);
const ESPERA_MS = 8000;          // § 4: tope de cada espera por CONDICIÓN; un rojo, no un cuelgue
const ESPERA_AUSENCIA_MS = 1500; // § 4: espera de ausencia (un segundo PUT que no debe salir)
const AVISO_MS = 4000;           // § 4 y JC9: confirmación efímera; bajo el tope de 8000 ms
const ESCRITORIO = { width: 1280, height: 800 }; // § 4: viewport del arnés
const BRAZOS_TOTAL = 19; // § 5: N1–N3 · C1–C3 · V1 · G1–G4 · B1–B5 · E1 · I1 · A1

// ── Constantes de § 4 (todas con origen; ninguna se inventa) ───────────────────────────────
const CLAVE = 'Clave-Arnes-2026'; // contraseña de los titulares de arnés S-17

// § 4 · los siete campos EN ORDEN DE PRECEDENCIA (src/modules/contacto/contacto.service.ts:96-102),
// con su testid, su máximo R1 y su código de error (status 400 en src/infra/errores-http.filter.ts:169-177).
const CAMPOS = [
  ['nombre', 'contacto-nombre', 50, 'CONTACTO_NOMBRE_INVALIDO'],
  ['apellido', 'contacto-apellido', 50, 'CONTACTO_APELLIDO_INVALIDO'],
  ['direccion', 'contacto-direccion', 100, 'CONTACTO_DIRECCION_INVALIDA'],
  ['ciudad', 'contacto-ciudad', 50, 'CONTACTO_CIUDAD_INVALIDA'],
  ['estado', 'contacto-estado', 50, 'CONTACTO_ESTADO_INVALIDO'],
  ['codigoPostal', 'contacto-codigo-postal', 20, 'CONTACTO_CODIGO_POSTAL_INVALIDO'],
  ['telefono', 'contacto-telefono', 20, 'CONTACTO_TELEFONO_INVALIDO'],
];

// § 4 · contacto de referencia (cada valor bajo su máximo; afirmado abajo).
const CONTACTO_REF = {
  nombre: 'Ana',
  apellido: 'Pérez',
  direccion: 'Av. Siempre Viva 742',
  ciudad: 'Santiago',
  estado: 'RM',
  codigoPostal: '8320000',
  telefono: '+56 2 2345 6789',
};

// § 4 · contacto previo (preparación; distinto del de referencia en los 7 campos; afirmado abajo).
const CONTACTO_PREVIO = {
  nombre: 'Previo',
  apellido: 'Dato',
  direccion: 'Calle Uno 1',
  ciudad: 'Valparaíso',
  estado: 'V',
  codigoPostal: '2340000',
  telefono: '322000000',
};

// Afirmaciones sobre las constantes de referencia y previa
for (const [campo, , max] of CAMPOS) {
  const ref = CONTACTO_REF[campo];
  if (!(ref.trim().length >= 1 && ref.trim().length <= max)) {
    throw new Error(`CONTACTO_REF.${campo} fuera de su máximo ${max}`);
  }
  const prev = CONTACTO_PREVIO[campo];
  if (!(prev.trim().length >= 1 && prev.trim().length <= max)) {
    throw new Error(`CONTACTO_PREVIO.${campo} fuera de su máximo ${max}`);
  }
  if (ref === prev) {
    throw new Error(`CONTACTO_PREVIO.${campo} no es distinto de CONTACTO_REF.${campo}`);
  }
}

// § 4 · cadenas de borde y casos especiales
const NOMBRE_CON_ESPACIOS = '  Ana  '; // CA4 (G2)
const TELEFONO_CON_LETRAS = 'fono-ABC'; // CA5 (G3)
if (TELEFONO_CON_LETRAS.length > 20) throw new Error('TELEFONO_CON_LETRAS supera el máximo de 20');

// E1 · checks por AUSENCIA: lista de términos VERSIONADA junto al resultado (ARNES.md).
const ATRIBUTOS_PROHIBIDOS = ['required', 'pattern', 'minlength', 'maxlength', 'min', 'max', 'step'];
const PROP_DE_ATRIBUTO = { minlength: 'minLength', maxlength: 'maxLength' };

const leerLista = (archivo) => readFileSync(new URL(`../specs/${archivo}`, import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const LISTA_S17C = leerLista('S-17-testids-contacto.txt');
const UNION = new Set([
  ...leerLista('S-10-testids-T4.txt'),
  ...leerLista('S-17-testids-boletas.txt'),
  ...leerLista('S-17-testids-abrir-cuenta.txt'),
  ...leerLista('S-17-testids-transferir.txt'),
  ...leerLista('S-17-testids-movimientos.txt'),
  ...leerLista('S-17-testids-pagos.txt'),
  ...LISTA_S17C,
  ...leerLista('S-35-testids-idioma.txt'), // enmienda C3 de S-35
]);

// Testids de otras vistas que pueden repetirse legítimamente al navegar por el Resumen
const DE_REPETIDOS = new Set([
  'cuenta-fila', 'cuenta-id', 'cuenta-copiar-id', 'cuenta-saldo', 'cuenta-tipo',
  'pago-fila', 'pago-fecha', 'pago-origen', 'pago-beneficiario', 'pago-cuenta-beneficiario', 'pago-monto',
]);

const JSON_H = { 'content-type': 'application/json' };
const resultados = [];
function brazo(id, ok, motivo = '') {
  resultados.push({ id, ok });
  console.log(`  ${id} ${ok ? 'OK' : `ROJO: ${motivo}`}`);
}

// Cierre de contextos por brazo (BITÁCORA #184)
const contextosAbiertos = new Set();
async function cerrarContextos() {
  for (const c of contextosAbiertos) {
    for (const p of c.pages()) await p.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    await c.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    await c.close().catch(() => {});
  }
  contextosAbiertos.clear();
}

// Filtro de diagnóstico: ZFB_BRAZOS=B1,B4 corre sólo esos brazos.
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

// ── HTTP crudo con reintento ante error de red ─────────────────────────────────────────────
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
async function contactoApi(token) {
  const r = await pedir('GET', '/contacto', auth(token));
  if (r.status !== 200) throw new Error(`GET /contacto → ${r.status} ${r.body}`);
  return JSON.parse(r.body);
}
async function actualizarContactoApi(token, cuerpo) {
  const r = await pedir('PUT', '/contacto', { ...JSON_H, ...auth(token) }, cuerpo);
  if (r.status !== 200) throw new Error(`PUT /contacto → ${r.status} ${r.body}`);
  return JSON.parse(r.body);
}
const emailNuevo = (p) => `s17c-${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@arnes.local`;

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
// Si algo de acá falla, el arnés muere con exit 2: un arnés que no pudo armar el dato,
// no un veredicto sobre la pantalla.

/** Registro + login. Afirma que GET /contacto devuelve el email y los 7 campos en null. */
async function titularNuevo(p) {
  const email = emailNuevo(p);
  await registrar(email);
  const token = await tokenDe(email);
  const contacto = await contactoApi(token);
  if (contacto.email !== email) {
    throw new Error(`preparación: GET /contacto devuelve email ${contacto.email}, se esperaba ${email}`);
  }
  for (const [campo] of CAMPOS) {
    if (contacto[campo] !== null) {
      throw new Error(`preparación: el titular nuevo tiene ${campo}=«${contacto[campo]}», se esperaba null`);
    }
  }
  return { email, token };
}

/** Lo anterior + PUT /contacto con CONTACTO_PREVIO. Afirma 200 y que GET /contacto lo devuelve igual. */
async function titularConContactoPrevio(p) {
  const u = await titularNuevo(p);
  await actualizarContactoApi(u.token, CONTACTO_PREVIO);
  const contacto = await contactoApi(u.token);
  for (const [campo] of CAMPOS) {
    if (contacto[campo] !== CONTACTO_PREVIO[campo]) {
      throw new Error(`preparación: tras guardar previo, GET /contacto tiene ${campo}=«${contacto[campo]}», se esperaba «${CONTACTO_PREVIO[campo]}»`);
    }
  }
  return u;
}

/** Cadenas de borde: afirman su largo antes de escribirse (§ 4.1). */
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
const esContacto = (req) => { try { return new URL(req.url()).pathname === '/contacto'; } catch { return false; } };
const rutaContacto = (u) => u.host === 'localhost:3000' && u.pathname === '/contacto';
const putsDe = new WeakMap(); // page → los PUT /contacto que salieron del navegador
const getsDe = new WeakMap(); // page → los GET que salieron, en orden

async function paginaNueva() {
  const ctx = await navegador.newContext({ viewport: ESCRITORIO });
  contextosAbiertos.add(ctx);
  const page = await ctx.newPage();
  putsDe.set(page, []);
  getsDe.set(page, []);
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (!['data:', 'blob:'].includes(u.protocol) && !HOSTS_PERMITIDOS.has(u.host)) fuera.push(req.url());
    if (u.host !== 'localhost:3000') return;
    if (req.method() === 'PUT' && u.pathname === '/contacto') {
      let cuerpo = null;
      try { cuerpo = req.postDataJSON(); } catch { /* cuerpo no JSON queda en null */ }
      putsDe.get(page).push({ cuerpo, headers: req.headers() });
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

const visible = (page, t) => page.isVisible(sel(t)).catch(() => false);

/** Pulsa nav-contacto y espera la región. */
async function irAContacto(page) {
  if (!(await page.$(sel('nav-contacto')))) throw new Error('nav-contacto no existe en el DOM renderizado');
  await page.click(sel('nav-contacto'));
  await page.waitForSelector(sel('contacto-region'), { state: 'visible', timeout: ESPERA_MS });
}

/** Sesión abierta, en Contacto, con contacto-region en listo y el formulario montado. */
async function entrarYContacto(page, email) {
  await entrarUI(page, email);
  await irAContacto(page);
  await page.waitForSelector(`${sel('contacto-region')}[data-estado="listo"]`, { state: 'attached', timeout: ESPERA_MS });
  await page.waitForSelector(sel('contacto-form'), { state: 'visible', timeout: ESPERA_MS });
}

/** El PUT /contacto que viene: su respuesta, {fallo:true} si la red la perdió, o null si no salió. */
function esperarPut(page, ms = ESPERA_MS) {
  const respuesta = page.waitForResponse((r) => r.request().method() === 'PUT' && esContacto(r.request()), { timeout: ms })
    .then(async (r) => ({ status: r.status(), body: await r.text().catch(() => ''), headers: r.headers() }))
    .catch(() => null);
  const fallo = page.waitForEvent('requestfailed', { predicate: (q) => q.method() === 'PUT' && esContacto(q), timeout: ms })
    .then(() => ({ fallo: true }))
    .catch(() => null);
  return Promise.race([
    respuesta.then((x) => x ?? fallo),
    fallo.then((x) => x ?? respuesta),
  ]);
}

const TERMINAL_FORM = ['guardado', 'error', 'sin-respuesta'];
async function esperarTerminalForm(page) {
  const h = await page.waitForSelector(TERMINAL_FORM.map((e) => `${sel('contacto-form')}[data-estado="${e}"]`).join(', '),
    { state: 'attached', timeout: ESPERA_MS }).catch(() => null);
  return h ? h.getAttribute('data-estado') : null;
}

/** Escribe los 7 campos tal como vienen (JC4: sin trim; un "" se escribe como vacío). */
async function llenar(page, datos = CONTACTO_REF) {
  for (const [campo, testid] of CAMPOS) {
    if (campo in datos) {
      await page.fill(sel(testid), datos[campo]);
    }
  }
}

/** Lee los valores actuales de los 7 campos del formulario. */
async function valoresForm(page) {
  const out = {};
  for (const [campo, testid] of CAMPOS) {
    out[campo] = await page.$eval(sel(testid), (e) => e.value).catch(() => null);
  }
  return out;
}

/**
 * MutationObserver sobre contacto-form: registra cada transición de data-estado (JC7 / CA7).
 */
function vigilarEstadosForm(page) {
  return page.evaluate(() => {
    window.__zfbEstadosForm?.obs.disconnect();
    const vistos = [];
    const q = '[data-testid="contacto-form"]';
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
    const actual = document.querySelector('[data-testid="contacto-form"]')?.getAttribute('data-estado') ?? null;
    return [...v.vistos, actual];
  }).catch(() => []);
}

/**
 * Guarda por UI: escribe los datos si se pasan, pulsa contacto-guardar, vigila estados,
 * espera la respuesta del PUT y el estado terminal del formulario.
 */
async function guardarUI(page, datos = null) {
  if (datos) await llenar(page, datos);
  const puts = putsDe.get(page);
  const antes = puts.length;
  await vigilarEstadosForm(page);
  const r = esperarPut(page);
  await page.click(sel('contacto-guardar'));
  const resp = await r;
  const estado = await esperarTerminalForm(page);
  const estados = await estadosVistosForm(page);
  return { resp, estado, estados, puts: puts.slice(antes) };
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
    for (const [i, n] of cuenta) if (n > 1 && !DE_REPETIDOS.has(i)) repetidos.add(i);
  }
}

/**
 * Afirmaciones de rechazo de § 5 (B): el PUT salió (D80-3), HTTP 400, data-codigo y
 * contacto-codigo-error con el código esperado, contacto-form en error, campos conservan
 * lo tecleado (JC10), y GET /contacto por API sigue igual a CONTACTO_PREVIO.
 */
async function afirmarRechazo(page, u, putInfo, codigo, datosTecleados) {
  const fallas = [];
  if (putInfo.puts.length !== 1) fallas.push(`salieron ${putInfo.puts.length} PUT (se esperaba 1)`);
  const api = putInfo.resp?.status ? `${putInfo.resp.status} ${codigoDe(putInfo.resp.body)}` : 'sin respuesta';
  if (putInfo.resp?.status !== 400) fallas.push(`HTTP status ${putInfo.resp?.status ?? 'sin respuesta'} (se esperaba 400)`);
  const dataCodigo = await page.$eval(sel('contacto-error'), (e) => e.getAttribute('data-codigo')).catch(() => null);
  const textoCodigo = await page.$eval(sel('contacto-codigo-error'), (e) => (e.textContent ?? '').trim()).catch(() => null);
  if (dataCodigo !== codigo) fallas.push(`data-codigo=«${dataCodigo}» (API: ${api})`);
  if (textoCodigo !== codigo) fallas.push(`contacto-codigo-error=«${textoCodigo}»`);
  if (putInfo.estado !== 'error') fallas.push(`contacto-form en «${putInfo.estado}» (se esperaba error)`);
  if (!putInfo.estados?.includes('guardando')) {
    fallas.push(`contacto-form no pasó por «guardando» (JC7; vistos: [${(putInfo.estados ?? []).join(', ')}])`);
  }
  // JC10: tras un rechazo los campos conservan lo tecleado, para corregirlo
  for (const [campo, testid] of CAMPOS) {
    if (campo in datosTecleados) {
      const val = await page.$eval(sel(testid), (e) => e.value).catch(() => null);
      if (val !== datosTecleados[campo]) {
        fallas.push(`campo ${campo} tiene «${val}», se esperaba lo tecleado «${datosTecleados[campo]}»`);
      }
    }
  }
  // GET /contacto por API sigue igual al contacto previo
  const apiContacto = await contactoApi(u.token);
  for (const [campo] of CAMPOS) {
    if (apiContacto[campo] !== CONTACTO_PREVIO[campo]) {
      fallas.push(`API ${campo}=«${apiContacto[campo]}», debía seguir en «${CONTACTO_PREVIO[campo]}»`);
    }
  }
  return fallas;
}

console.log(`verificar:s17-contacto · ${BRAZOS_TOTAL} brazos (specs/S-17-contacto.md § 5)\n`);

// El reset va ANTES del primer brazo y FUERA de `correr`: si la costura no está, el arnés muere
// con exit 2 diciendo cuál. Un arnés que no pudo medir no es 19 brazos rojos (§ 4.1).
try {
  const r = await pedir('POST', '/__test__/reset');
  if (r.status !== 200) throw new Error(`costura /__test__/reset → ${r.status} ${r.body}`);
  const u = await titularConContactoPrevio('humo');
  console.log(`  preparación OK · reset · titular de humo ${u.email} con contacto previo verificado\n`);
} catch (e) {
  console.log(`\nPREPARACIÓN ROTA: ${String(e?.message ?? e)}`);
  console.log('El arnés NO pudo medir. Esto no es un veredicto sobre la pantalla.');
  await navegador.close().catch(() => {});
  process.exit(2);
}

try {
  // ── N · Navegación y contrato ────────────────────────────────────────────────────────────

  // N1 · Entrada de primer nivel dentro de nav-panel, a continuación de nav-boletas, fuera de
  // nav-cuentas-menu y de nav-usuario-menu. Una vista a la vez, y al pulsarla sale GET /contacto.
  await correr('N1', async () => {
    const u = await titularNuevo('n1');
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    const visibleSinHover = await visible(page, 'nav-contacto');
    const pos = await page.$eval(sel('nav-contacto'), (e) => ({
      enPanel: e.closest('[data-testid="nav-panel"]') !== null,
      enSubmenuCuentas: e.closest('[data-testid="nav-cuentas-menu"]') !== null,
      enSubmenuUsuario: e.closest('[data-testid="nav-usuario-menu"]') !== null,
      hermanoDeBoletas: e.parentElement === document.querySelector('[data-testid="nav-boletas"]')?.parentElement,
      // D119-2: JC1 «a continuación de nav-boletas» — el hermano anterior es nav-boletas.
      trasBoletas: e.previousElementSibling?.getAttribute('data-testid') === 'nav-boletas',
    })).catch(() => null);
    if (!pos) { brazo('N1', false, 'nav-contacto no existe en el DOM renderizado'); return; }
    const gets = getsDe.get(page);
    const desde = gets.length;
    await page.click(sel('nav-contacto'));
    const region = await page.waitForSelector(sel('contacto-region'), { state: 'visible', timeout: ESPERA_MS }).then(() => true, () => false);
    const pidio = await esperarHasta(() => gets.slice(desde).includes('/contacto'), 'GET /contacto al entrar');
    const resumenMontado = await page.$(sel('cuentas-tabla'));
    await recolectar(page);
    const fallas = [];
    if (!visibleSinHover) fallas.push('no está visible sin hover ni despliegue previo');
    if (!pos.enPanel) fallas.push('no cuelga de nav-panel');
    if (pos.enSubmenuCuentas) fallas.push('está DENTRO de nav-cuentas-menu (contra JC1)');
    if (pos.enSubmenuUsuario) fallas.push('está DENTRO de nav-usuario-menu (contra JC1)');
    if (!pos.hermanoDeBoletas) fallas.push('no es hermano de nav-boletas');
    if (!pos.trasBoletas) fallas.push('no va inmediatamente después de nav-boletas (JC1, D119-2)');
    if (!region) fallas.push('al pulsarlo no se montó contacto-region');
    if (resumenMontado) fallas.push('cuentas-tabla SIGUE montada (JC1: una vista a la vez)');
    if (!pidio) fallas.push(`al entrar salieron [${gets.slice(desde).join(', ')}], se esperaba /contacto`);
    brazo('N1', fallas.length === 0, fallas.join(' · '));
  });

  // N2 · Alcanzable por teclado y con rol + nombre accesible correctos (JC13).
  await correr('N2', async () => {
    const u = await titularNuevo('n2');
    const page = await paginaNueva();
    await entrarUI(page, u.email);
    const item = await page.waitForSelector(sel('nav-contacto'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null);
    if (!item) { brazo('N2', false, 'nav-contacto no está visible en la barra'); return; }
    const info = await item.evaluate((e) => ({
      rol: e.getAttribute('role') ?? e.tagName.toLowerCase(),
      nombre: (e.getAttribute('aria-label') ?? e.textContent ?? '').trim(),
      tabindex: e.tabIndex,
    }));
    const llegaPorTeclado = async (tecla) => {
      await page.focus(sel('nav-cuentas'));
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press(tecla);
        if (await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'nav-contacto')) return true;
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

  // C1 · Con GET /contacto retenido en el navegador: contacto-region en cargando, aria-busy="true",
  // contacto-cargando presente y contacto-form no montado. Al soltarlo, listo, sin aria-busy="true"
  // y con el formulario montado (JC6).
  await correr('C1', async () => {
    const u = await titularNuevo('c1');
    const page = await paginaNueva();
    let reanudarGet;
    const promesaReanudar = new Promise((resolve) => { reanudarGet = resolve; });
    let retenido = false;
    await page.route(rutaContacto, async (route) => {
      if (route.request().method() === 'GET' && !retenido) {
        retenido = true;
        await promesaReanudar;
        return route.continue();
      }
      return route.continue();
    });
    await entrarUI(page, u.email);
    if (!(await page.$(sel('nav-contacto')))) {
      brazo('C1', false, 'nav-contacto no existe en el DOM renderizado');
      reanudarGet?.();
      return;
    }
    await page.click(sel('nav-contacto'));
    const fueRetenido = await esperarHasta(() => retenido, 'GET /contacto retenido');
    const fallas = [];
    if (!fueRetenido) {
      fallas.push('GET /contacto no fue interceptado al entrar');
    } else {
      const estadoCargando = await page.$eval(sel('contacto-region'), (e) => e.getAttribute('data-estado')).catch(() => null);
      const ariaBusy = await page.$eval(sel('contacto-region'), (e) => e.getAttribute('aria-busy')).catch(() => null);
      const cargandoVisible = await visible(page, 'contacto-cargando');
      const formMontado = await page.$(sel('contacto-form'));
      await recolectar(page);
      if (estadoCargando !== 'cargando') fallas.push(`contacto-region data-estado=«${estadoCargando}» (se esperaba cargando)`);
      if (ariaBusy !== 'true') fallas.push(`contacto-region aria-busy=«${ariaBusy}» (se esperaba true)`);
      if (!cargandoVisible) fallas.push('contacto-cargando no visible durante cargando');
      if (formMontado) fallas.push('contacto-form montado prematuramente durante cargando (JC6)');
      reanudarGet();
      const listo = await page.waitForSelector(`${sel('contacto-region')}[data-estado="listo"]`, { state: 'attached', timeout: ESPERA_MS }).catch(() => null);
      if (!listo) {
        fallas.push('contacto-region no pasó a listo tras soltar GET');
      } else {
        const estadoListo = await page.$eval(sel('contacto-region'), (e) => e.getAttribute('data-estado')).catch(() => null);
        const ariaBusyListo = await page.$eval(sel('contacto-region'), (e) => e.getAttribute('aria-busy')).catch(() => null);
        const formVisible = await visible(page, 'contacto-form');
        const cargandoSigue = await visible(page, 'contacto-cargando');
        if (estadoListo !== 'listo') fallas.push(`contacto-region data-estado=«${estadoListo}»`);
        if (ariaBusyListo === 'true') fallas.push('contacto-region conserva aria-busy="true" en listo');
        if (!formVisible) fallas.push('contacto-form no visible en listo');
        if (cargandoSigue) fallas.push('contacto-cargando sigue visible en listo');
      }
    }
    await recolectar(page);
    brazo('C1', fallas.length === 0, fallas.join(' · '));
  });

  // C2 · Con PUT /contacto retenido: contacto-form en guardando, aria-busy="true", contacto-guardando presente,
  // contacto-guardar con disabled, y un clic forzado no genera un segundo PUT (decisión 6).
  await correr('C2', async () => {
    const u = await titularNuevo('c2');
    const page = await paginaNueva();
    let reanudarPut;
    const promesaReanudar = new Promise((resolve) => { reanudarPut = resolve; });
    let retenido = false;
    await page.route(rutaContacto, async (route) => {
      if (route.request().method() === 'PUT') {
        retenido = true;
        await promesaReanudar;
        return route.continue();
      }
      return route.continue();
    });
    await entrarYContacto(page, u.email);
    await llenar(page, CONTACTO_REF);
    const puts = putsDe.get(page);
    await page.click(sel('contacto-guardar'));
    const fueRetenido = await esperarHasta(() => retenido, 'PUT /contacto retenido');
    const fallas = [];
    if (!fueRetenido) {
      fallas.push('PUT /contacto no fue interceptado al guardar');
    } else {
      const estado = await page.$eval(sel('contacto-form'), (e) => e.getAttribute('data-estado')).catch(() => null);
      const ariaBusy = await page.$eval(sel('contacto-form'), (e) => e.getAttribute('aria-busy')).catch(() => null);
      const guardandoVisible = await visible(page, 'contacto-guardando');
      const guardarDisabled = await page.$eval(sel('contacto-guardar'), (e) => e.disabled || e.hasAttribute('disabled')).catch(() => false);
      await recolectar(page);
      if (estado !== 'guardando') fallas.push(`contacto-form data-estado=«${estado}» (se esperaba guardando)`);
      if (ariaBusy !== 'true') fallas.push(`contacto-form aria-busy=«${ariaBusy}» (se esperaba true)`);
      if (!guardandoVisible) fallas.push('contacto-guardando no visible durante guardando');
      if (!guardarDisabled) fallas.push('contacto-guardar no está deshabilitado durante guardando');
      // Clic forzado
      const antesPuts = puts.length;
      await page.click(sel('contacto-guardar'), { force: true });
      const salioSegundo = await esperarHasta(() => puts.length > antesPuts, 'segundo PUT tras clic forzado', ESPERA_AUSENCIA_MS, true);
      if (salioSegundo) fallas.push(`un clic forzado emitió un segundo PUT (${puts.length - antesPuts} de más)`);
      reanudarPut();
      const fin = await esperarTerminalForm(page);
      if (fin !== 'guardado') fallas.push(`tras soltar PUT, contacto-form en «${fin}» (se esperaba guardado)`);
    }
    await recolectar(page);
    brazo('C2', fallas.length === 0, fallas.join(' · '));
  });

  // C3 · GET /contacto forzado a 500 → contacto-region en error, contacto-carga-error y contacto-carga-reintentar,
  // sin contacto-form. El reintento (ya sin forzar) deja listo con los campos llenos del GET (JC12; titular previo).
  await correr('C3', async () => {
    const u = await titularConContactoPrevio('c3');
    const page = await paginaNueva();
    let forzar500 = true;
    await page.route(rutaContacto, async (route) => {
      if (route.request().method() === 'GET' && forzar500) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ codigo: 'ERROR_INTERNO', mensaje: 'Error interno forzado' }),
        });
      }
      return route.continue();
    });
    await entrarUI(page, u.email);
    if (!(await page.$(sel('nav-contacto')))) {
      brazo('C3', false, 'nav-contacto no existe en el DOM renderizado');
      return;
    }
    await page.click(sel('nav-contacto'));
    const fallas = [];
    const errorRegion = await page.waitForSelector(`${sel('contacto-region')}[data-estado="error"]`, { state: 'attached', timeout: ESPERA_MS }).catch(() => null);
    if (!errorRegion) {
      fallas.push('contacto-region no pasó a error tras GET 500');
    } else {
      const cargaErrorVis = await visible(page, 'contacto-carga-error');
      const reintentarVis = await visible(page, 'contacto-carga-reintentar');
      const formMontado = await page.$(sel('contacto-form'));
      await recolectar(page);
      if (!cargaErrorVis) fallas.push('contacto-carga-error no visible');
      if (!reintentarVis) fallas.push('contacto-carga-reintentar no visible');
      if (formMontado) fallas.push('contacto-form montado durante error de carga (JC12)');
      forzar500 = false;
      await page.click(sel('contacto-carga-reintentar'));
      const listo = await page.waitForSelector(`${sel('contacto-region')}[data-estado="listo"]`, { state: 'attached', timeout: ESPERA_MS }).catch(() => null);
      if (!listo) {
        fallas.push('contacto-region no pasó a listo tras pulsar reintentar');
      } else {
        const formVis = await visible(page, 'contacto-form');
        if (!formVis) fallas.push('contacto-form no visible tras reintento');
        const vals = await valoresForm(page);
        for (const [campo] of CAMPOS) {
          if (vals[campo] !== CONTACTO_PREVIO[campo]) {
            fallas.push(`tras reintentar ${campo}=«${vals[campo]}», se esperaba previo «${CONTACTO_PREVIO[campo]}»`);
          }
        }
      }
    }
    await recolectar(page);
    brazo('C3', fallas.length === 0, fallas.join(' · '));
  });

  // ── V · Ver (CA1) ────────────────────────────────────────────────────────────────────────

  // V1 · Titular nuevo → los 7 campos con value === "" (ninguno "null"), contacto-email con value igual al email
  // del registro y con atributo readonly, y contacto-email fuera de contacto-form (JC3, JC5).
  await correr('V1', async () => {
    const u = await titularNuevo('v1');
    const page = await paginaNueva();
    await entrarYContacto(page, u.email);
    await recolectar(page);
    const fallas = [];
    const vals = await valoresForm(page);
    for (const [campo, testid] of CAMPOS) {
      if (vals[campo] === 'null') fallas.push(`${testid} tiene el texto «null» literal (JC5)`);
      else if (vals[campo] !== '') fallas.push(`${testid} tiene value=«${vals[campo]}» (se esperaba vacío)`);
    }
    const emailVal = await page.$eval(sel('contacto-email'), (e) => e.value).catch(() => null);
    const readonlyAttr = await page.$eval(sel('contacto-email'), (e) => e.hasAttribute('readonly')).catch(() => false);
    const fueraDeForm = await page.$eval(sel('contacto-email'), (e) => e.closest('[data-testid="contacto-form"]') === null).catch(() => false);
    if (emailVal !== u.email) fallas.push(`contacto-email value=«${emailVal}», se esperaba «${u.email}»`);
    if (!readonlyAttr) fallas.push('contacto-email sin atributo readonly (JC3)');
    if (!fueraDeForm) fallas.push('contacto-email está DENTRO de contacto-form (JC3)');
    brazo('V1', fallas.length === 0, fallas.join(' · '));
  });

  // ── G · Guardar (CA2, CA4, CA5) ──────────────────────────────────────────────────────────

  // G1 · CA2 · Titular nuevo, se escriben los 7 datos de referencia y se pulsa contacto-guardar → un PUT,
  // cuerpo con exactamente las 7 claves de JC3 (sin email) y los valores tecleados; 200; contacto-form
  // en guardado; contacto-guardado aparece dentro de contacto-aviso (role="status") y, mientras está,
  // un campo acepta lo que se teclea (no bloquea); desaparece solo antes del tope, sin que nadie lo cierre.
  // Por el API, GET /contacto trae los 7. Tras recargar la página y volver a entrar, los 7 campos muestran los datos guardados.
  await correr('G1', async () => {
    const u = await titularNuevo('g1');
    const page = await paginaNueva();
    await entrarYContacto(page, u.email);
    const fallas = [];
    const putInfo = await guardarUI(page, CONTACTO_REF);
    // El aviso vive AVISO_MS; se lee ANTES de recolectar, para no
    // gastar su ventana en recorrer el DOM y que N3 vea contacto-guardado mientras está montado.
    const avisoVis = await visible(page, 'contacto-guardado');
    await recolectar(page);
    if (putInfo.puts.length !== 1) fallas.push(`salieron ${putInfo.puts.length} PUT (se esperaba 1)`);
    const cuerpo = putInfo.puts[0]?.cuerpo ?? {};
    const claves = Object.keys(cuerpo).sort();
    const clavesEsperadas = CAMPOS.map(([c]) => c).sort();
    if (JSON.stringify(claves) !== JSON.stringify(clavesEsperadas)) {
      fallas.push(`cuerpo PUT con claves [${claves.join(', ')}], se esperaban exactamente [${clavesEsperadas.join(', ')}] (JC3)`);
    }
    if ('email' in cuerpo) fallas.push('cuerpo PUT contiene email (JC3: no debe viajar)');
    for (const [campo] of CAMPOS) {
      if (cuerpo[campo] !== CONTACTO_REF[campo]) {
        fallas.push(`cuerpo PUT ${campo}=«${cuerpo[campo]}», se esperaba «${CONTACTO_REF[campo]}»`);
      }
    }
    if (putInfo.resp?.status !== 200) fallas.push(`HTTP status ${putInfo.resp?.status ?? 'sin respuesta'} (se esperaba 200)`);
    if (putInfo.estado !== 'guardado') fallas.push(`contacto-form en «${putInfo.estado}» (se esperaba guardado)`);
    if (!putInfo.estados?.includes('guardando')) {
      fallas.push(`contacto-form no pasó por «guardando» (JC7; vistos: [${(putInfo.estados ?? []).join(', ')}])`);
    }
    // Aviso efímero (su visibilidad se leyó justo tras guardarUI)
    if (!avisoVis) {
      fallas.push('contacto-guardado no visible tras 200');
    } else {
      const enAviso = await page.$eval(sel('contacto-guardado'), (e) => e.closest('[data-testid="contacto-aviso"]') !== null).catch(() => false);
      const rolAviso = await page.$eval(sel('contacto-aviso'), (e) => e.getAttribute('role')).catch(() => null);
      if (!enAviso) fallas.push('contacto-guardado no está DENTRO de contacto-aviso (JC9)');
      if (rolAviso !== 'status') fallas.push(`contacto-aviso role=«${rolAviso}» (se esperaba status)`);
      // D119-3: no roba el foco. Se lee ANTES del fill, que re-enfoca el campo y taparía el robo.
      // No se exige que el foco siga en contacto-guardar: al deshabilitarse, el navegador lo suelta.
      const focoEnAviso = await page.evaluate(() =>
        document.activeElement?.closest('[data-testid="contacto-aviso"]') != null).catch(() => true);
      if (focoEnAviso) fallas.push('el foco quedó dentro de contacto-aviso: el aviso roba el foco (JC9, D119-3)');
      // Mientras está, un campo acepta lo que se teclea (no bloquea)
      await page.fill(sel('contacto-nombre'), 'Ana Modificada');
      const valModificado = await page.$eval(sel('contacto-nombre'), (e) => e.value).catch(() => '');
      if (valModificado !== 'Ana Modificada') fallas.push('el campo no aceptó edición mientras se veía contacto-guardado');
      // Desaparece solo antes del tope
      const desaparecio = await page.waitForSelector(sel('contacto-guardado'), { state: 'hidden', timeout: ESPERA_MS }).then(() => true, () => false);
      if (!desaparecio) fallas.push('contacto-guardado no desapareció solo antes del tope (JC9)');
    }
    // Por API, GET /contacto trae los 7
    const api = await contactoApi(u.token);
    for (const [campo] of CAMPOS) {
      if (api[campo] !== CONTACTO_REF[campo]) {
        fallas.push(`API ${campo}=«${api[campo]}», se esperaba «${CONTACTO_REF[campo]}»`);
      }
    }
    // Tras recargar la página y volver a entrar
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector(sel('portada'), { state: 'attached', timeout: ESPERA_MS });
    await entrarYContacto(page, u.email);
    const postRecarga = await valoresForm(page);
    for (const [campo, testid] of CAMPOS) {
      if (postRecarga[campo] !== CONTACTO_REF[campo]) {
        fallas.push(`tras recargar, ${testid}=«${postRecarga[campo]}», se esperaba «${CONTACTO_REF[campo]}»`);
      }
    }
    await recolectar(page);
    brazo('G1', fallas.length === 0, fallas.join(' · '));
  });

  // G2 · CA4 · nombre = "  Ana  " → el cuerpo del PUT lleva "  Ana  " sin recortar (JC4);
  // tras el 200 el campo muestra Ana (JC8) y el API devuelve Ana.
  await correr('G2', async () => {
    const u = await titularNuevo('g2');
    const page = await paginaNueva();
    await entrarYContacto(page, u.email);
    const datos = { ...CONTACTO_REF, nombre: NOMBRE_CON_ESPACIOS };
    const putInfo = await guardarUI(page, datos);
    await recolectar(page);
    const fallas = [];
    if (putInfo.resp?.status !== 200) fallas.push(`HTTP status ${putInfo.resp?.status ?? 'sin respuesta'} (se esperaba 200)`);
    const cuerpoNombre = putInfo.puts[0]?.cuerpo?.nombre;
    if (cuerpoNombre !== NOMBRE_CON_ESPACIOS) {
      fallas.push(`cuerpo PUT nombre=«${cuerpoNombre}» (JC4: no debe recortar en cliente)`);
    }
    const campoNombre = await page.$eval(sel('contacto-nombre'), (e) => e.value).catch(() => null);
    if (campoNombre !== 'Ana') {
      fallas.push(`campo contacto-nombre muestra «${campoNombre}», se esperaba «Ana» de la respuesta del PUT (JC8)`);
    }
    const api = await contactoApi(u.token);
    if (api.nombre !== 'Ana') {
      fallas.push(`API nombre=«${api.nombre}», se esperaba «Ana»`);
    }
    brazo('G2', fallas.length === 0, fallas.join(' · '));
  });

  // G3 · CA5 · teléfono = fono-ABC → 200, el API guarda fono-ABC y el campo lo muestra igual.
  await correr('G3', async () => {
    const u = await titularNuevo('g3');
    const page = await paginaNueva();
    await entrarYContacto(page, u.email);
    const datos = { ...CONTACTO_REF, telefono: TELEFONO_CON_LETRAS };
    const putInfo = await guardarUI(page, datos);
    await recolectar(page);
    const fallas = [];
    if (putInfo.resp?.status !== 200) fallas.push(`HTTP status ${putInfo.resp?.status ?? 'sin respuesta'}`);
    const cuerpoTelefono = putInfo.puts[0]?.cuerpo?.telefono;
    if (cuerpoTelefono !== TELEFONO_CON_LETRAS) fallas.push(`cuerpo PUT telefono=«${cuerpoTelefono}»`);
    const campoTelefono = await page.$eval(sel('contacto-telefono'), (e) => e.value).catch(() => null);
    if (campoTelefono !== TELEFONO_CON_LETRAS) fallas.push(`campo contacto-telefono=«${campoTelefono}»`);
    const api = await contactoApi(u.token);
    if (api.telefono !== TELEFONO_CON_LETRAS) fallas.push(`API telefono=«${api.telefono}»`);
    brazo('G3', fallas.length === 0, fallas.join(' · '));
  });

  // G4 · Titular con contacto previo → al entrar los 7 campos muestran el contacto previo.
  // Se cambia sólo la ciudad y se guarda → el PUT lleva los 7 valores (los otros 6 con el valor previo)
  // y el API devuelve el previo con la ciudad nueva.
  await correr('G4', async () => {
    const u = await titularConContactoPrevio('g4');
    const page = await paginaNueva();
    await entrarYContacto(page, u.email);
    const fallas = [];
    const iniciales = await valoresForm(page);
    for (const [campo, testid] of CAMPOS) {
      if (iniciales[campo] !== CONTACTO_PREVIO[campo]) {
        fallas.push(`al entrar, ${testid}=«${iniciales[campo]}», se esperaba previo «${CONTACTO_PREVIO[campo]}»`);
      }
    }
    const CIUDAD_NUEVA = 'Concepción';
    await page.fill(sel('contacto-ciudad'), CIUDAD_NUEVA);
    const putInfo = await guardarUI(page);
    await recolectar(page);
    if (putInfo.resp?.status !== 200) fallas.push(`HTTP status ${putInfo.resp?.status ?? 'sin respuesta'}`);
    const cuerpo = putInfo.puts[0]?.cuerpo ?? {};
    if (cuerpo.ciudad !== CIUDAD_NUEVA) fallas.push(`cuerpo PUT ciudad=«${cuerpo.ciudad}», se esperaba «${CIUDAD_NUEVA}»`);
    for (const [campo] of CAMPOS) {
      if (campo !== 'ciudad' && cuerpo[campo] !== CONTACTO_PREVIO[campo]) {
        fallas.push(`cuerpo PUT ${campo}=«${cuerpo[campo]}», se esperaba el previo «${CONTACTO_PREVIO[campo]}»`);
      }
    }
    const api = await contactoApi(u.token);
    if (api.ciudad !== CIUDAD_NUEVA) fallas.push(`API ciudad=«${api.ciudad}», se esperaba «${CIUDAD_NUEVA}»`);
    for (const [campo] of CAMPOS) {
      if (campo !== 'ciudad' && api[campo] !== CONTACTO_PREVIO[campo]) {
        fallas.push(`API ${campo}=«${api[campo]}», debía seguir en «${CONTACTO_PREVIO[campo]}»`);
      }
    }
    brazo('G4', fallas.length === 0, fallas.join(' · '));
  });

  // ── B · Borde y errores (CA3) ─────────────────────────────────────────────────────────────

  // B1 · Los 7 campos a la vez en su máximo exacto → 200 y el API los devuelve (CA3).
  await correr('B1', async () => {
    const u = await titularConContactoPrevio('b1');
    const page = await paginaNueva();
    await entrarYContacto(page, u.email);
    const datosMax = {};
    for (const [campo, , max] of CAMPOS) {
      datosMax[campo] = cadena(max);
    }
    const putInfo = await guardarUI(page, datosMax);
    await recolectar(page);
    const fallas = [];
    if (putInfo.resp?.status !== 200) fallas.push(`HTTP status ${putInfo.resp?.status ?? 'sin respuesta'} (se esperaba 200)`);
    if (putInfo.estado !== 'guardado') fallas.push(`contacto-form en «${putInfo.estado}» (se esperaba guardado)`);
    const api = await contactoApi(u.token);
    for (const [campo, , max] of CAMPOS) {
      if (api[campo] !== datosMax[campo]) {
        fallas.push(`API ${campo} length ${api[campo]?.length ?? 0}, se esperaba máximo ${max}`);
      }
    }
    brazo('B1', fallas.length === 0, fallas.join(' · '));
  });

  // B2 · Cada campo en máximo + 1, con los otros 6 válidos → su código propio (7 sub-casos).
  await correr('B2', async () => {
    const u = await titularConContactoPrevio('b2');
    const page = await paginaNueva();
    await entrarYContacto(page, u.email);
    const fallas = [];
    for (const [campo, , max, codigo] of CAMPOS) {
      const datos = { ...CONTACTO_REF, [campo]: cadena(max + 1) };
      const putInfo = await guardarUI(page, datos);
      await recolectar(page);
      const f = await afirmarRechazo(page, u, putInfo, codigo, datos);
      if (f.length) fallas.push(`[${campo}=max+1] ${f.join(', ')}`);
    }
    brazo('B2', fallas.length === 0, fallas.join(' · '));
  });

  // B3 · Cada campo vacío (""), con los otros 6 válidos → su código propio (7 sub-casos); el cuerpo lleva la clave con "" (JC4).
  await correr('B3', async () => {
    const u = await titularConContactoPrevio('b3');
    const page = await paginaNueva();
    await entrarYContacto(page, u.email);
    const fallas = [];
    for (const [campo, , , codigo] of CAMPOS) {
      const datos = { ...CONTACTO_REF, [campo]: '' };
      const putInfo = await guardarUI(page, datos);
      await recolectar(page);
      if (putInfo.puts[0]?.cuerpo?.[campo] !== '') {
        fallas.push(`[${campo}=""] cuerpo PUT lleva «${putInfo.puts[0]?.cuerpo?.[campo]}», se esperaba clave con "" (JC4)`);
      }
      const f = await afirmarRechazo(page, u, putInfo, codigo, datos);
      if (f.length) fallas.push(`[${campo}=""] ${f.join(', ')}`);
    }
    brazo('B3', fallas.length === 0, fallas.join(' · '));
  });

  // B4 · nombre = sólo espacios → CONTACTO_NOMBRE_INVALIDO (CA3).
  await correr('B4', async () => {
    const u = await titularConContactoPrevio('b4');
    const page = await paginaNueva();
    await entrarYContacto(page, u.email);
    const datos = { ...CONTACTO_REF, nombre: SOLO_ESPACIOS };
    const putInfo = await guardarUI(page, datos);
    await recolectar(page);
    const fallas = [];
    if (putInfo.puts[0]?.cuerpo?.nombre !== SOLO_ESPACIOS) {
      fallas.push(`cuerpo PUT nombre=«${putInfo.puts[0]?.cuerpo?.nombre}», se esperaba «${SOLO_ESPACIOS}» sin trim (JC4)`);
    }
    const f = await afirmarRechazo(page, u, putInfo, 'CONTACTO_NOMBRE_INVALIDO', datos);
    if (f.length) fallas.push(f.join(' · '));
    brazo('B4', fallas.length === 0, fallas.join(' · '));
  });

  // B5 · Precedencia: dirección vacía y teléfono en máximo + 1 a la vez → CONTACTO_DIRECCION_INVALIDA (CA3).
  await correr('B5', async () => {
    const u = await titularConContactoPrevio('b5');
    const page = await paginaNueva();
    await entrarYContacto(page, u.email);
    const datos = { ...CONTACTO_REF, direccion: '', telefono: cadena(20 + 1) };
    const putInfo = await guardarUI(page, datos);
    await recolectar(page);
    const fallas = [];
    if (putInfo.puts[0]?.cuerpo?.direccion !== '') fallas.push('cuerpo PUT no lleva direccion=""');
    if (putInfo.puts[0]?.cuerpo?.telefono !== cadena(21)) fallas.push('cuerpo PUT no lleva telefono de 21 caracteres');
    const f = await afirmarRechazo(page, u, putInfo, 'CONTACTO_DIRECCION_INVALIDA', datos);
    if (f.length) fallas.push(f.join(' · '));
    brazo('B5', fallas.length === 0, fallas.join(' · '));
  });

  // ── E · Cliente sin validación (CA6) ─────────────────────────────────────────────────────

  // E1 · Sobre el DOM renderizado: contacto-form lleva novalidate; ninguno de sus 7 campos trae
  // required, pattern, minlength ni maxlength (ni como atributo ni como propiedad > -1);
  // los 7 tienen atributo type="text" (CA6, JC2).
  await correr('E1', async () => {
    const u = await titularNuevo('e1');
    const page = await paginaNueva();
    await entrarYContacto(page, u.email);
    await recolectar(page);
    const fallas = [];
    const novalidate = await page.$eval(sel('contacto-form'), (e) => e.hasAttribute('novalidate')).catch(() => null);
    if (novalidate !== true) fallas.push('contacto-form sin atributo novalidate');
    for (const [, testid] of CAMPOS) {
      const info = await page.$eval(sel(testid), (e, [attrs, props]) => ({
        tipo: e.getAttribute('type'),
        attrs: attrs.filter((a) => e.hasAttribute(a)),
        props: attrs.filter((a) => {
          const p = props[a] ?? a;
          if (p === 'required') return e.required === true;
          if (p === 'minLength' || p === 'maxLength') return e[p] >= 0;
          return false;
        }),
      }), [ATRIBUTOS_PROHIBIDOS, PROP_DE_ATRIBUTO]).catch(() => null);
      if (!info) { fallas.push(`${testid} no existe`); continue; }
      if (info.tipo !== 'text') fallas.push(`${testid} type=«${info.tipo}» (se esperaba atributo type="text")`);
      if (info.attrs.length) fallas.push(`${testid} con atributos prohibidos [${info.attrs.join(', ')}]`);
      if (info.props.length) fallas.push(`${testid} con propiedades prohibidas [${info.props.join(', ')}]`);
    }
    brazo('E1', fallas.length === 0, `${fallas.join(' · ')} (lista versionada: ${ATRIBUTOS_PROHIBIDOS.join('|')})`);
  });

  // ── I · Sin respuesta (JC11) ─────────────────────────────────────────────────────────────

  // I1 · El PUT llega al backend (route.fetch) y su respuesta se pierde (route.abort):
  // contacto-sin-respuesta visible, contacto-form en sin-respuesta, sin contacto-error ni data-codigo,
  // contacto-guardar habilitado. Volver a pulsarlo → otro PUT → guardado, y el API trae los datos (JC11).
  await correr('I1', async () => {
    const u = await titularNuevo('i1');
    const page = await paginaNueva();
    let intentos = 0;
    await page.route(rutaContacto, async (route) => {
      if (route.request().method() === 'PUT' && ++intentos === 1) {
        await route.fetch();
        return route.abort('failed');
      }
      return route.continue();
    });
    await entrarYContacto(page, u.email);
    await llenar(page, CONTACTO_REF);
    const puts = putsDe.get(page);
    const antes = puts.length;
    await vigilarEstadosForm(page);
    const r1 = esperarPut(page);
    await page.click(sel('contacto-guardar'));
    const resp1 = await r1;
    const estado1 = await esperarTerminalForm(page);
    await recolectar(page);
    const fallas = [];
    if (!resp1?.fallo) fallas.push(`la primera respuesta no se perdió (${resp1?.status ?? 'sin PUT'})`);
    if (estado1 !== 'sin-respuesta') fallas.push(`contacto-form en «${estado1}», se esperaba sin-respuesta`);
    if (!(await visible(page, 'contacto-sin-respuesta'))) fallas.push('contacto-sin-respuesta no visible');
    if (await page.$(sel('contacto-error'))) fallas.push('contacto-error presente sin respuesta de red');
    if (await page.$(`${sel('contacto-region')} [data-codigo]`)) fallas.push('hay un data-codigo sin respuesta de red');
    const guardarHabilitado = await page.$eval(sel('contacto-guardar'), (e) => !e.disabled && !e.hasAttribute('disabled')).catch(() => false);
    if (!guardarHabilitado) fallas.push('contacto-guardar no está habilitado para reintentar (JC11)');
    // Volver a pulsarlo
    await vigilarEstadosForm(page);
    const r2 = esperarPut(page);
    await page.click(sel('contacto-guardar'));
    const resp2 = await r2;
    const estado2 = await esperarTerminalForm(page);
    await recolectar(page);
    if (resp2?.status !== 200) fallas.push(`el reintento → ${resp2?.status ?? 'sin respuesta'} (se esperaba 200)`);
    if (estado2 !== 'guardado') fallas.push(`tras reintentar, contacto-form en «${estado2}» (se esperaba guardado)`);
    if (puts.length - antes !== 2) fallas.push(`salieron ${puts.length - antes} PUT (se esperaban 2)`);
    const api = await contactoApi(u.token);
    for (const [campo] of CAMPOS) {
      if (api[campo] !== CONTACTO_REF[campo]) {
        fallas.push(`API ${campo}=«${api[campo]}», se esperaba «${CONTACTO_REF[campo]}»`);
      }
    }
    brazo('I1', fallas.length === 0, fallas.join(' · '));
  });

  // ── A · Accesibilidad (JC13) ─────────────────────────────────────────────────────────────

  // A1 · Los 8 campos (7 + email) tienen <label for> que apunta a un id que existe;
  // contacto-error y contacto-sin-respuesta tienen role="alert";
  // contacto-aviso tiene role="status" y está montado antes de guardar (JC13, JC9, JC10, JC11).
  await correr('A1', async () => {
    const u = await titularConContactoPrevio('a1');
    const page = await paginaNueva();
    await entrarYContacto(page, u.email);
    const fallas = [];
    // 1. contacto-aviso montado antes de guardar y con role="status"
    const aviso = await page.$(sel('contacto-aviso'));
    if (!aviso) fallas.push('contacto-aviso no está montado antes de guardar (JC9)');
    else {
      const rolAviso = await aviso.getAttribute('role');
      if (rolAviso !== 'status') fallas.push(`contacto-aviso role=«${rolAviso}» (se esperaba status)`);
    }
    // 2. Los 8 campos con <label for> a un id que existe
    const OCHO_CAMPOS = ['contacto-email', ...CAMPOS.map((c) => c[1])];
    for (const t of OCHO_CAMPOS) {
      const ok = await page.$eval(sel(t), (e) => !!e.id && document.getElementById(e.id) === e
        && !!document.querySelector(`label[for="${CSS.escape(e.id)}"]`)).catch(() => false);
      if (!ok) fallas.push(`${t} sin <label for> a un id que existe`);
    }
    // 3. contacto-error con role="alert"
    await page.fill(sel('contacto-nombre'), '');
    await guardarUI(page);
    await recolectar(page);
    const rolError = await page.$eval(sel('contacto-error'), (e) => e.getAttribute('role')).catch(() => null);
    if (rolError !== 'alert') fallas.push(`contacto-error role=«${rolError}» (se esperaba alert)`);
    // 4. contacto-sin-respuesta con role="alert"
    await page.route(rutaContacto, async (route) => {
      if (route.request().method() === 'PUT') return route.abort('failed');
      return route.continue();
    });
    await llenar(page, CONTACTO_REF);
    await guardarUI(page);
    await recolectar(page);
    const rolSinResp = await page.$eval(sel('contacto-sin-respuesta'), (e) => e.getAttribute('role')).catch(() => null);
    if (rolSinResp !== 'alert') fallas.push(`contacto-sin-respuesta role=«${rolSinResp}» (se esperaba alert)`);
    brazo('A1', fallas.length === 0, fallas.join(' · '));
  });

  // ── N3 · Contrato de testids sobre el ARTEFACTO RENDERIZADO ──────────────────────────────
  // Va al final: mide lo que se recolectó en los 18 recorridos de arriba (RESTRICCIONES § 2).
  await correr('N3', async () => {
    const faltan = LISTA_S17C.filter((t) => !vistos.has(t));
    const sobran = [...vistos].filter((t) => !UNION.has(t));
    const rojosPrevios = resultados.filter((r) => !r.ok).map((r) => r.id);
    const arrastre = rojosPrevios.length > 0 ? ` · ⚠ CAUSA POSIBLEMENTE ARRASTRADA: ya venían rojos [${rojosPrevios.join(' ')}]` : '';
    brazo('N3', faltan.length === 0 && sobran.length === 0 && repetidos.size === 0 && fuera.length === 0,
      `faltan [${faltan.join(', ')}] · sobran [${sobran.join(', ')}] · repetidos [${[...repetidos].join(', ')}] · fuera [${[...new Set(fuera)].slice(0, 3).join(', ')}] (lista de ${LISTA_S17C.length})${arrastre}`);
  });
} finally {
  await navegador.close().catch(() => {});
}

const verdes = resultados.filter((r) => r.ok).length;
const rojos = resultados.filter((r) => !r.ok).map((r) => r.id);
console.log(`\nverificar:s17-contacto → ${verdes}/${resultados.length} brazos verdes${rojos.length ? ` · rojos: ${rojos.join(' ')}` : ''}`);
if (SOLO.length > 0) console.log(`⚠ CORRIDA PARCIAL (ZFB_BRAZOS=${SOLO.join(',')}): ${resultados.length} de ${BRAZOS_TOTAL} brazos. NO sirve para declarar el número de la unidad.`);
process.exit(rojos.length === 0 && resultados.length === BRAZOS_TOTAL ? 0 : 1);
