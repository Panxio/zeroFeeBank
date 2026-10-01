// Árbitro de S-17 · Movimientos (specs/S-17-movimientos.md § 5). Corre contra el ARTEFACTO
// servido: el backend (`node dist/main.js`) en :3000 y el build de pruebas de web/ en :4200.
// Lo levanta scripts/verificar-s17-movimientos.sh; este archivo sólo mira. No importa código de
// la app y no toca la base de datos: todo estado entra por las costuras /__test__/ y por el API
// público (perfil SUT, § 5 de la spec).
//
// Contiene exactamente los 23 brazos de § 5: N1–N3, C1–C3, B1–B9, F1–F6, A1–A2.
//
// ── Decisiones tomadas al escribir este arnés (F2) ─────────────────────
// 1. **Una sola preparación de oráculo por corrida.** `POST /__test__/reset` borra la base, así
//    que un reset por brazo dejaría sin datos a los brazos ya corridos si alguno se reordenara,
//    y multiplicaría por 23 la siembra de 128 movimientos. El reset + seed se hace UNA vez,
//    antes del primer brazo, y ningún brazo vuelve a resetear. B9 construye su propio titular
//    por API (registro + 2 cuentas + 1 transferencia) SIN resetear, así que no pisa el oráculo.
//    Si la preparación falla, el arnés muere con un mensaje que dice qué costura se rompió
//    (§ 4.4): eso es un arnés que no pudo medir, no 23 brazos rojos.
// 2. **La trampa de los centavos (§ 4.1), obligatoria:** el oráculo del seed entrega
//    `montoCentavos` en CENTAVOS (`"100000"`) y el API de pantalla decimal con signo
//    (`"1000.00"`). Comparar uno contra otro da rojo sobre una app correcta. Acá el oráculo se
//    usa SÓLO para ids, `transaccionId` y conteos; lo que se pinta se compara contra lo que
//    devuelve `GET /movimientos` (D90-4). `ORACULO_ESPERADO` existe únicamente para que la
//    preparación afirme sus propios límites, y está en centavos a propósito.
// 3. **`buscar()` espera la RESPUESTA antes que el estado terminal.** Esperar `data-estado` a
//    secas tras el click puede casar con el terminal ANTERIOR (la segunda búsqueda de B7 y C3).
//    La app pone `cargando` antes de emitir la petición (JM8), así que cuando la respuesta llegó
//    el estado viejo ya no está: la espera deja de ser una carrera. Si no hubo petición
//    (K10), `resp` viene en null y el brazo lo declara — es justo lo que F6 mide.
// 4. **El click forzado de C1 es `click({force:true})`, no `dispatchEvent`.** `dispatchEvent`
//    invoca al listener de Angular aunque el botón esté deshabilitado, así que una app CORRECTA
//    podría emitir la segunda petición: sería un brazo IMPOSIBLE (BITÁCORA § El patrón, forma 9).
//    `force:true` salta la comprobación de actionability pero sigue siendo un click real: sobre
//    un botón deshabilitado el navegador no dispara nada, y con K12 (no se deshabilita) sí.
//
// ── NACE SIN LA PANTALLA (F2, declarado antes de medir) ────────────────────────────────────
// La vista de Movimientos todavía no existe (F4 la implementa), así que los 23 brazos nacen en
// ROJO por diseño: el número fijado ANTES de correrlo es **0/23 verdes**, y lo que esta primera
// corrida verifica es otra cosa: que la PREPARACIÓN funciona contra el artefacto real (seed,
// credencial de S-28, login, oráculo de 10) y que cada brazo cae con un motivo propio, no con
// una excepción de preparación. Los 19 defectos de § 6 se miden en F5, con la pantalla puesta.
//
// ── Enmiendas de candado (§ 5.1) ───────────────────────────────────────────────────────────
// Los seis candados de testids se pondrán rojos al montar la pantalla. Sus enmiendas de una
// línea NO van en este archivo: requieren la aprobación del humano y se aplican al entregar F4.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const API = 'http://localhost:3000';
const APP = 'http://localhost:4200';
const HOSTS_PERMITIDOS = new Set(['localhost:3000', 'localhost:4200']);
const ESPERA_MS = 8000; // tope de cada espera por CONDICIÓN (no es un sleep): un rojo, no un cuelgue
const ESCRITORIO = { width: 1280, height: 800 }; // § 4
const BRAZOS_TOTAL = 23; // § 5: N1–N3 · C1–C3 · B1–B9 · F1–F6 · A1–A2

// ── Constantes de § 4 (todas con origen; ninguna se inventa) ───────────────────────────────
const ESCENARIO = 'movimientos-buscables';      // costuras.service.ts:453
const CLAVE_B9 = 'Clave-Arnes-2026';            // sólo para el titular que B9 crea por API
const CONCEPTO_SIEMBRA = 'SIEMBRA_BUSQUEDA';    // costuras.service.ts:179, FUERA del mapa de J2
const CONCEPTO_MAPEADO = 'TRANSFERENCIA';       // HU-03 J2
const ROTULO_MAPEADO = 'Transferencia';         // HU-03 J2, ancla de texto DECLARADA (B9)
const TOPE_MOVIMIENTOS = 50;                    // movimientos.constants.ts:5
const TOPE_CANTIDAD = 51;                       // costuras.service.ts:176
const MONTO_SIN_RESULTADOS = '777.77';          // § 4.2, el caso `vacio` de C3
// B9 · el mínimo de apertura son 1.000,00 (MONTO_APERTURA_MINIMO_CENTAVOS = 100000n,
// cuentas.constants.ts:18). La CORRIENTE se abre desde la caja con 2.000,00 y la AHORRO desde
// ella con 1.000,00, así que quedan 1.000,00 en el origen para la transferencia. Lo cazó la
// propia preparación en la primera corrida de F2-v (400 MONTO_APERTURA_INSUFICIENTE con 500,00):
// es la defensa de § 4.4 funcionando — un arnés que no pudo medir, no un brazo rojo.
const MONTO_APERTURA_B9 = '2000.00';
const MONTO_AHORRO_B9 = '1000.00';
const MONTO_TRANSFERENCIA_B9 = '100.00';

// § 4.1 · el oráculo tal como lo devuelve el seed: CENTAVOS, ascendente por fecha. Sólo lo usa
// la preparación para afirmar sus propios límites. Ningún brazo compara esto con la pantalla.
const ORACULO_ESPERADO = [
  ['2026-03-01T00:00:00.000Z', '100000'],
  ['2026-03-01T12:00:00.000Z', '-2500'],
  ['2026-03-01T23:59:59.999Z', '7500'],
  ['2026-03-02T00:00:00.000Z', '-2500'],
  ['2026-03-02T09:30:00.000Z', '50000'],
  ['2026-03-02T18:45:00.000Z', '-12345'],
  ['2026-03-03T00:00:00.000Z', '7500'],
  ['2026-03-03T06:15:00.000Z', '-99999'],
  ['2026-03-03T23:59:59.999Z', '2500'],
  ['2026-03-04T00:00:00.000Z', '-1'],
];

// § 4.2 · qué devuelve cada filtro, por ÍNDICE de § 4.1 (1-based).
const DIA_01 = [3, 2, 1];
const RANGO_01_02 = [6, 5, 4, 3, 2, 1];
const MONTO_25 = [9, 4, 2];
const DIA_01_Y_MONTO_25 = [2];
const SIGNO_DE_MONTO_25 = { 9: 'CREDITO', 4: 'DEBITO', 2: 'DEBITO' }; // B4, § 4.1
const INDICE_TRANSACCION = 6; // B6, el `transaccionId` del índice 6

// § 4.3 · las entradas que provocan cada rechazo (CA7). Cada brazo deja LIMPIOS los demás
// campos: el controlador tiene precedencia fija y llenar dos campos malos mediría otra cosa.
const RECHAZOS = [
  ['F2', { desde: '2026-02-30' }, 'FECHA_INVALIDA'],
  ['F3', { desde: '2026-03-02', hasta: '2026-03-01' }, 'RANGO_INVALIDO'],
  ['F4', { monto: '-25.00' }, 'MONTO_INVALIDO'],
  ['F5', { transaccionId: 'no-es-un-uuid' }, 'TRANSACCION_ID_INVALIDO'],
];

// § 4.1 · la fecha visible de la fila del índice 1 (A2), con el formateador ya instalado
// (`formatearFechaUtc`, web/src/app/app.ts:705-708) — JM13, CA9.
const FECHA_ISO_I1 = '2026-03-01T00:00:00.000Z';
const FECHA_VISIBLE_I1 = '2026-03-01 00:00 UTC';

// Checks por AUSENCIA · listas de términos VERSIONADAS junto al resultado (ARNES.md).
// F1 · JM2: el cliente no valida nada. Ninguno de los cinco campos lleva estos atributos.
const ATRIBUTOS_PROHIBIDOS = ['required', 'pattern', 'minlength', 'maxlength', 'min', 'max', 'step'];
// E11 (F3d, hallazgo #7 de OC2 con el diagnóstico corregido): el nombre del atributo NO es el
// nombre de la propiedad del DOM para estos dos. `e['maxlength']` es SIEMPRE undefined, así que
// sin este mapa el brazo de la propiedad está muerto justo para los dos casos que el comentario
// de abajo dice cubrir (el binding de Angular `[maxlength]="20"`, que no deja atributo).
const PROP_DE_ATRIBUTO = { minlength: 'minLength', maxlength: 'maxLength' };
const CAMPOS_FORM = [
  'movimientos-cuenta', 'movimientos-transaccion', 'movimientos-desde',
  'movimientos-hasta', 'movimientos-monto',
];
// JM3 · los cuatro campos de texto: un type="date" o un type="number" volvería INALCANZABLE
// desde la pantalla el código que F2 y F4 miden.
const CAMPOS_TEXTO = [
  'movimientos-desde', 'movimientos-hasta', 'movimientos-transaccion', 'movimientos-monto',
];
// B7 · JM11 (HU-03 R2): no hay control de paginación. Se busca sólo en elementos INTERACTIVOS
// dentro de la región, para no poner rojo un texto legítimo que hable de resultados.
const TERMINOS_PAGINACION = ['ver más', 'ver mas', 'cargar más', 'cargar mas', 'más resultados', 'mas resultados', 'siguiente', 'ver siguientes'];

const leerLista = (archivo) => readFileSync(new URL(`../specs/${archivo}`, import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const LISTA_S17M = leerLista('S-17-testids-movimientos.txt');
const UNION = new Set([
  ...leerLista('S-10-testids-T4.txt'),
  ...leerLista('S-17-testids-boletas.txt'),
  ...leerLista('S-17-testids-abrir-cuenta.txt'),
  ...leerLista('S-17-testids-transferir.txt'),
  ...LISTA_S17M,
  // enmienda § 5.1 de S-17-pagos: los testids de la pantalla de Pagos entran en la unión
  // contra la que se mide lo que SOBRA. Lo que FALTA se sigue midiendo contra LISTA_S17M, y un
  // testid ajeno sigue poniendo N3 rojo.
  ...leerLista('S-17-testids-pagos.txt'),
  ...leerLista('S-17-testids-contacto.txt'), // enmienda § 5.1 de S-17-contacto
]);
// Testids que se repiten legítimamente: los de fila de esta unidad y los del Resumen (T4), que
// también se recorren al entrar. N3 no los cuenta como duplicados.
const DE_FILA = new Set([
  'movimiento-fila', 'movimiento-concepto', 'movimiento-monto', 'movimiento-signo', 'movimiento-fecha',
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
async function cerrarContextos() {
  for (const c of contextosAbiertos) await c.close().catch(() => {});
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
    // El mensaje de Playwright pone el selector en su «call log», no en la primera línea.
    const texto = String(e?.stack ?? e?.message ?? e);
    const pista = texto.split('\n').find((l) => /waiting for|locator\(|getByTestId/.test(l))?.trim();
    brazo(id, false, `excepción: ${texto.split('\n')[0]}${pista ? ` ← ${pista}` : ''}`);
  } finally {
    await cerrarContextos();
  }
}

// ── HTTP crudo, con reintento ante error de red ────────────────────────────────────────────
// Resiliencia ante error de red: un ECONNRESET tumbó el proceso entero y dejó brazos sin resumen. Acá el
// error de red se reintenta una vez y, si vuelve a fallar, se propaga como excepción del BRAZO.
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

async function tokenDe(email, password) {
  const r = await pedir('POST', '/auth/login', JSON_H, { email, password });
  if (r.status !== 200) throw new Error(`login → ${r.status} ${r.body}`);
  return JSON.parse(r.body).token;
}

async function movimientosApi(token, params) {
  const q = new URLSearchParams(params).toString();
  const r = await pedir('GET', `/movimientos?${q}`, { authorization: `Bearer ${token}` });
  if (r.status !== 200) throw new Error(`GET /movimientos → ${r.status} ${codigoDe(r.body) ?? r.body}`);
  return JSON.parse(r.body);
}

/** Lo que la pantalla DEBE pintar para un movimiento del API (JM6). El árbitro deriva el signo
 *  y el valor absoluto del `monto` del API; jamás de los centavos del oráculo. */
const esperadoDe = (m) => ({
  monto: m.monto.startsWith('-') ? m.monto.slice(1) : m.monto,
  signo: m.monto.startsWith('-') ? 'DEBITO' : 'CREDITO',
  fecha: m.fecha,
  concepto: m.concepto,
});

/** Espera por CONDICIÓN (no es un sleep): un rojo al vencer el tope, nunca un cuelgue. */
async function esperarHasta(cond, motivo, ms = ESPERA_MS) {
  const hasta = Date.now() + ms;
  while (Date.now() < hasta) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log(`    ⏱ espera vencida (${ms} ms): ${motivo}`);
  return false;
}

// ── Preparación con los límites del propio contrato AFIRMADOS (§ 4.4) ──────────────────────
// Regla del proyecto: todo dato de preparación se construye con una función que afirma sus
// propios límites. Es la defensa contra el brazo IMPOSIBLE, que ninguna calibración caza porque
// en rojo se ve igual que uno correcto.

async function sembrarOraculo() {
  const rReset = await pedir('POST', '/__test__/reset');
  if (rReset.status !== 200) throw new Error(`costura /__test__/reset → ${rReset.status} ${rReset.body}`);
  const r = await pedir('POST', '/__test__/seed', JSON_H, { escenario: ESCENARIO });
  if (r.status !== 201) throw new Error(`costura /__test__/seed «${ESCENARIO}» → ${r.status} ${r.body}`);
  const s = JSON.parse(r.body);

  // S-28: sin credencial usable, TODO brazo de pantalla sobre este escenario sería imposible.
  const email = s?.credenciales?.email;
  const password = s?.credenciales?.password;
  if (typeof email !== 'string' || !email || typeof password !== 'string' || !password) {
    throw new Error('el seed no devolvió credenciales usables (S-28)');
  }
  if (!Array.isArray(s.movimientos) || s.movimientos.length !== 10) {
    throw new Error(`el oráculo trae ${s?.movimientos?.length} movimientos y se esperaban 10`);
  }
  for (const campo of ['cuentaTopeId', 'cuentaAjenaId']) {
    if (typeof s[campo] !== 'string' || !s[campo]) throw new Error(`el seed no devolvió ${campo}`);
  }
  // El oráculo, verbatim contra § 4.1 (en CENTAVOS: es la trampa declarada).
  s.movimientos.forEach((m, i) => {
    const [iso, centavos] = ORACULO_ESPERADO[i];
    if (m.creadoEn !== iso || String(m.montoCentavos) !== centavos) {
      throw new Error(`el oráculo cambió en i=${i + 1}: ${m.creadoEn}/${m.montoCentavos} ≠ ${iso}/${centavos}`);
    }
    if (typeof m.id !== 'string' || typeof m.transaccionId !== 'string') {
      throw new Error(`el movimiento i=${i + 1} no trae id/transaccionId`);
    }
  });
  const cuentaId = s.movimientos[0].cuentaId;
  if (s.movimientos.some((m) => m.cuentaId !== cuentaId)) {
    throw new Error('los 10 movimientos del oráculo no son de la misma cuenta');
  }
  if (s.cuentas?.[0]?.id !== cuentaId) {
    throw new Error(`cuentas[0].id (${s.cuentas?.[0]?.id}) no es la cuenta del oráculo (${cuentaId})`);
  }

  const token = await tokenDe(email, password);
  // Los límites del API que los brazos dan por ciertos, afirmados acá y no en un brazo:
  const base = await movimientosApi(token, { cuentaId });
  if (base.devueltos !== 10 || base.hayMas !== false) {
    throw new Error(`GET /movimientos de la cuenta del oráculo devolvió ${base.devueltos} (hayMas=${base.hayMas})`);
  }
  const tope = await movimientosApi(token, { cuentaId: s.cuentaTopeId });
  if (tope.devueltos !== TOPE_MOVIMIENTOS || tope.hayMas !== true) {
    throw new Error(`la cuenta de ${TOPE_CANTIDAD} devolvió ${tope.devueltos} (hayMas=${tope.hayMas})`);
  }
  if (base.movimientos.some((m) => m.concepto !== CONCEPTO_SIEMBRA)) {
    throw new Error(`el concepto sembrado dejó de ser ${CONCEPTO_SIEMBRA}`);
  }
  return { email, password, token, cuentaId, cuentaTopeId: s.cuentaTopeId, oraculo: s.movimientos };
}

/**
 * B9 · titular con un movimiento de concepto MAPEADO (HU-03 J2). Ningún escenario del seed
 * siembra uno, así que se construye por API: registro + 2 cuentas + 1 transferencia propia.
 * La función AFIRMA que la transferencia dejó un movimiento con concepto TRANSFERENCIA en la
 * cuenta de origen antes de devolver nada; si no, el brazo sería imposible.
 */
async function titularConConceptoMapeado() {
  const email = `s17m-b9-${Date.now()}-${Math.floor(Math.random() * 1e6)}@arnes.local`;
  const rReg = await pedir('POST', '/auth/registro', JSON_H, { email, password: CLAVE_B9 });
  if (rReg.status !== 201) throw new Error(`preparación B9: registro → ${rReg.status} ${rReg.body}`);
  const token = await tokenDe(email, CLAVE_B9);
  const abrir = async (cuerpo) => {
    const r = await pedir('POST', '/cuentas',
      { ...JSON_H, authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() }, cuerpo);
    if (r.status !== 201) throw new Error(`preparación B9: POST /cuentas → ${r.status} ${codigoDe(r.body) ?? r.body}`);
    return JSON.parse(r.body);
  };
  const origen = await abrir({ tipo: 'CORRIENTE', monto: MONTO_APERTURA_B9 });
  const destino = await abrir({ tipo: 'AHORRO', monto: MONTO_AHORRO_B9, cuentaOrigenId: origen.id });
  const rTr = await pedir('POST', '/transferencias',
    { ...JSON_H, authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() },
    { origenId: origen.id, destinoId: destino.id, monto: MONTO_TRANSFERENCIA_B9 });
  if (rTr.status !== 201) throw new Error(`preparación B9: POST /transferencias → ${rTr.status} ${codigoDe(rTr.body) ?? rTr.body}`);
  const transaccionId = JSON.parse(rTr.body).transaccionId;
  if (typeof transaccionId !== 'string' || !transaccionId) {
    throw new Error('preparación B9: la transferencia no devolvió transaccionId');
  }
  const lista = await movimientosApi(token, { cuentaId: origen.id });
  const mov = lista.movimientos.find((m) => m.concepto === CONCEPTO_MAPEADO);
  if (!mov) {
    throw new Error(`preparación B9: ningún movimiento con concepto ${CONCEPTO_MAPEADO} (hay ${lista.movimientos.map((m) => m.concepto).join(',')})`);
  }
  return { email, password: CLAVE_B9, token, cuentaId: origen.id, movId: mov.id };
}

// ── Navegador y ayudantes de UI ────────────────────────────────────────────────────────────
const navegador = await chromium.launch({ headless: true });
const fuera = [];
const vistos = new Set();
const repetidos = new Set();
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

async function entrarUI(page, email, password) {
  await page.click(sel('login-abrir'));
  await page.waitForSelector(`${sel('login-popover')}[data-estado="listo"]`, { state: 'attached', timeout: ESPERA_MS });
  const f = await marcoDe(page);
  await f.fill(sel('login-email'), email);
  await f.fill(sel('login-password'), password);
  await f.click(sel('login-enviar'));
  await page.waitForSelector(sel('cuentas-region'), { state: 'attached', timeout: ESPERA_MS });
}

const TERMINAL_CUENTAS = ['listo', 'vacio', 'error'];
async function estadoCuentas(page) {
  const h = await page.waitForSelector(TERMINAL_CUENTAS.map((e) => `${sel('cuentas-region')}[data-estado="${e}"]`).join(', '),
    { state: 'attached', timeout: ESPERA_MS });
  return h.getAttribute('data-estado');
}

/** Sesión abierta y ya en la vista de Movimientos (JM1). */
async function entrarYMovimientos(page, email, password) {
  await entrarUI(page, email, password);
  await estadoCuentas(page);
  await page.click(sel('nav-movimientos'));
  await page.waitForSelector(sel('movimientos-region'), { state: 'visible', timeout: ESPERA_MS });
}

const estadoMovimientos = (page) => page.$eval(sel('movimientos-region'), (e) => e.getAttribute('data-estado')).catch(() => null);

const TERMINAL_MOV = ['listo', 'vacio', 'error'];
async function esperarTerminal(page) {
  const h = await page.waitForSelector(TERMINAL_MOV.map((e) => `${sel('movimientos-region')}[data-estado="${e}"]`).join(', '),
    { state: 'attached', timeout: ESPERA_MS });
  return h.getAttribute('data-estado');
}

/**
 * E13 / D97-2 (F3d) · el `value` de cada `<option>` es el id de la cuenta. Es un CONTRATO
 * versionado en la spec (JM4), no una suposición del arnés: ~16 brazos entran por acá y un
 * `<option>` sin `value=id` los tumbaría a todos por excepción (hallazgo #8 de OC2, pendiente
 * J9). El mensaje nombra la decisión para que el rojo diga qué contrato se rompió, no «timeout».
 */
async function elegirCuenta(page, cuentaId) {
  await page.waitForSelector(sel('movimientos-cuenta'), { state: 'visible', timeout: ESPERA_MS });
  try {
    await page.selectOption(sel('movimientos-cuenta'), cuentaId, { timeout: ESPERA_MS });
  } catch {
    const values = await page.$$eval(`${sel('movimientos-cuenta')} option`, (os) => os.map((o) => o.value));
    throw new Error(`movimientos-cuenta no tiene una opción con value=«${cuentaId}» (D97-2); hay [${values.join(', ')}]`);
  }
}

/** Escribe los filtros. Un campo que no venga en `f` se deja VACÍO a propósito: la precedencia
 *  del controlador (§ 4.3) haría que un segundo campo malo tapara el código que el brazo mide. */
async function llenarFiltros(page, f = {}) {
  const campos = [
    ['movimientos-transaccion', f.transaccionId],
    ['movimientos-desde', f.desde],
    ['movimientos-hasta', f.hasta],
    ['movimientos-monto', f.monto],
  ];
  for (const [testid, valor] of campos) await page.fill(sel(testid), valor ?? '');
}

/**
 * Pulsa Buscar y espera la RESPUESTA del API antes del estado terminal (decisión 3 de la
 * cabecera). Devuelve `{ resp, estado }`; `resp` en null significa que la pantalla NO llamó al
 * API, que es exactamente lo que F6 mide y lo que K10 rompe.
 */
async function buscar(page) {
  const espera = page.waitForResponse(
    (r) => { try { return new URL(r.url()).pathname === '/movimientos'; } catch { return false; } },
    { timeout: ESPERA_MS }).catch(() => null);
  await page.click(sel('movimientos-buscar'));
  const resp = await espera;
  const estado = await esperarTerminal(page).catch(() => null);
  return { resp, estado };
}

/** Las filas pintadas, con los cuatro atributos de JM6 leídos del nodo que lleva cada testid. */
function filasDe(page) {
  return page.$$eval(`${sel('movimiento-fila')}`, (filas) => filas.map((f) => {
    const q = (t) => f.querySelector(`[data-testid="${t}"]`);
    const concepto = q('movimiento-concepto');
    const fecha = q('movimiento-fecha');
    return {
      movId: f.getAttribute('data-mov-id'),
      transaccionId: f.getAttribute('data-transaccion-id'),
      monto: q('movimiento-monto')?.getAttribute('data-monto') ?? null,
      signo: q('movimiento-signo')?.getAttribute('data-signo') ?? null,
      fecha: fecha?.getAttribute('data-fecha') ?? null,
      concepto: concepto?.getAttribute('data-concepto') ?? null,
      conceptoTexto: (concepto?.textContent ?? '').trim(),
      fechaTexto: (fecha?.textContent ?? '').trim(),
    };
  }));
}

const idsDe = (oraculo, indices) => indices.map((i) => oraculo[i - 1].id);
const mismoConjunto = (a, b) => a.length === b.length && new Set([...a, ...b]).size === new Set(a).size && a.every((x) => b.includes(x));

/** Un brazo de conjunto (B2–B5): N filas y sus data-mov-id son exactamente los esperados. */
function compararConjunto(filas, esperados) {
  const fallas = [];
  if (filas.length !== esperados.length) fallas.push(`se pintaron ${filas.length} filas y se esperaban ${esperados.length}`);
  const vistosIds = filas.map((f) => f.movId);
  if (!mismoConjunto(vistosIds, esperados)) {
    const faltan = esperados.filter((i) => !vistosIds.includes(i));
    const sobran = vistosIds.filter((i) => !esperados.includes(i));
    fallas.push(`ids distintos · faltan [${faltan.map((i) => String(i).slice(0, 8)).join(', ')}] · sobran [${sobran.map((i) => String(i ?? 'null').slice(0, 8)).join(', ')}]`);
  }
  return fallas;
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

console.log(`verificar:s17-movimientos · ${BRAZOS_TOTAL} brazos (specs/S-17-movimientos.md § 5)\n`);

// La preparación va ANTES del primer brazo y FUERA de `correr`: si se rompe una costura, el
// arnés muere diciendo cuál. Un arnés que no pudo medir no es 23 brazos rojos (§ 4.4).
let O;
try {
  O = await sembrarOraculo();
  console.log(`  preparación OK · titular ${O.email} · cuenta del oráculo ${O.cuentaId.slice(0, 8)} · cuenta de ${TOPE_CANTIDAD} ${O.cuentaTopeId.slice(0, 8)}\n`);
} catch (e) {
  console.log(`\nPREPARACIÓN ROTA: ${String(e?.message ?? e)}`);
  console.log('El arnés NO pudo medir. Esto no es un veredicto sobre la pantalla.');
  await navegador.close().catch(() => {});
  process.exit(2);
}

try {
  // ── N · Navegación y contrato ────────────────────────────────────────────────────────────

  // N1 · Entrada de PRIMER NIVEL de la barra (D90-2) y una vista a la vez (JM1). La posición se
  // lee del DOM RENDERIZADO con `closest`, no del código fuente.
  await correr('N1', async () => {
    const page = await paginaNueva();
    await entrarUI(page, O.email, O.password);
    await estadoCuentas(page);
    const visibleSinHover = await page.isVisible(sel('nav-movimientos'));
    const pos = await page.$eval(sel('nav-movimientos'), (e) => ({
      enPanel: e.closest('[data-testid="nav-panel"]') !== null,
      enSubmenu: e.closest('[data-testid="nav-cuentas-menu"]') !== null,
      hermanoDeTransferir: e.parentElement === document.querySelector('[data-testid="nav-transferir"]')?.parentElement,
    })).catch(() => null);
    if (!pos) { brazo('N1', false, 'nav-movimientos no existe en el DOM renderizado'); return; }
    await page.click(sel('nav-movimientos'));
    const region = await page.waitForSelector(sel('movimientos-region'), { state: 'visible', timeout: ESPERA_MS }).then(() => true, () => false);
    const resumenMontado = await page.$(sel('cuentas-tabla'));
    await recolectar(page);
    const fallas = [];
    if (!visibleSinHover) fallas.push('no está visible sin hover ni despliegue previo');
    if (!pos.enPanel) fallas.push('no cuelga de nav-panel');
    if (pos.enSubmenu) fallas.push('está DENTRO de nav-cuentas-menu (contra D90-2)');
    if (!pos.hermanoDeTransferir) fallas.push('no es hermano de nav-transferir');
    if (!region) fallas.push('al pulsarlo no se montó movimientos-region');
    if (resumenMontado) fallas.push('el Resumen SIGUE montado (JM1: una vista a la vez)');
    brazo('N1', fallas.length === 0, fallas.join(' · '));
  });

  // N2 · Alcanzable por teclado y con nombre accesible correcto (rol + etiqueta). NO se abre el
  // submenú de Cuentas a propósito: siendo entrada de primer nivel, el foco tiene que llegar sin
  // desplegar nada. Es lo que pone rojo a K16.
  await correr('N2', async () => {
    const page = await paginaNueva();
    await entrarUI(page, O.email, O.password);
    await estadoCuentas(page);
    const item = await page.waitForSelector(sel('nav-movimientos'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null);
    if (!item) { brazo('N2', false, 'nav-movimientos no está visible en la barra'); return; }
    const info = await item.evaluate((e) => ({
      rol: e.getAttribute('role') ?? e.tagName.toLowerCase(),
      nombre: (e.getAttribute('aria-label') ?? e.textContent ?? '').trim(),
      href: e.hasAttribute('href'),
      tabindex: e.tabIndex,
    }));
    // E7 (F3d) · el recorrido arrancaba en `nav-cuentas` y sólo avanzaba. Ni la spec ni D90-2
    // fijan el ORDEN de la barra —D90-2 sólo pide que sea hermana de `nav-transferir`—, así que
    // una barra correcta con Movimientos ANTES de Cuentas quedaba inalcanzable por ese gesto y
    // N2 nacía IMPOSIBLE. Se recorre en las dos direcciones:
    // lo que se exige sigue siendo llegar por teclado, no llegar en un orden concreto.
    const llegaPorTeclado = async (tecla) => {
      await page.focus(sel('nav-cuentas'));
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press(tecla);
        const ok = await page.evaluate(
          () => document.activeElement?.getAttribute('data-testid') === 'nav-movimientos');
        if (ok) return true;
      }
      return false;
    };
    const enfocadoDeVerdad = (await llegaPorTeclado('Tab')) || (await llegaPorTeclado('Shift+Tab'));
    const rolValido = ['link', 'a', 'menuitem', 'button'].includes(info.rol);
    await recolectar(page);
    brazo('N2', info.nombre.length > 0 && rolValido && enfocadoDeVerdad,
      `rol=${info.rol} (válido=${rolValido}) · nombre="${info.nombre}" · href=${info.href} · tabIndex=${info.tabindex} · el foco llegó por teclado=${enfocadoDeVerdad}`);
  });

  // ── C · Carga y estados (costura C4, CA8) ────────────────────────────────────────────────

  // C1 · Durante la carga: cargando + aria-busy + testid, y Buscar NO dispara una segunda
  // consulta. El conteo va en la intercepción: un brazo que sólo mire [disabled] es ciego (K16
  // de la 63, y la ceguera de la 85).
  await correr('C1', async () => {
    const page = await paginaNueva();
    let peticiones = 0;
    // E8 (F3d) · el MISMO predicado de función que usa `buscar()`. El glob `**/movimientos?**`
    // trataba el `?` como comodín de UN carácter, no como literal: medido con sonda sobre la
    // playwright-core del repo (hallazgo #9 de OC2). Hoy casaba por accidente, porque
    // `elegirCuenta` garantiza query; el día que la pantalla consulte sin query, la
    // intercepción no cuenta ni retrasa nada y el brazo comete un silencio sin saberlo.
    const esMovimientos = (url) => url.pathname === '/movimientos';
    await page.route(esMovimientos, async (route) => {
      peticiones += 1;
      await new Promise((r) => setTimeout(r, 2000));
      await route.continue();
    });
    await entrarYMovimientos(page, O.email, O.password);
    await elegirCuenta(page, O.cuentaId);
    // E12 / D97-1 · la consulta sale SÓLO con `movimientos-buscar`. Sin esta cuenta aparte, el
    // contador le atribuía al click forzado cualquier petición de la ventana —incluida una
    // búsqueda automática al cambiar el `<select>`— y el brazo daba rojo con el motivo
    // equivocado (hallazgo #6 de OC2).
    const antesDeBuscar = peticiones;
    await page.click(sel('movimientos-buscar'));
    const enVuelo = await page.waitForSelector(`${sel('movimientos-region')}[data-estado="cargando"]`,
      { state: 'attached', timeout: ESPERA_MS }).then(() => true, () => false);
    const marcas = await page.$eval(sel('movimientos-region'), (e) => e.getAttribute('aria-busy')).catch(() => null);
    const cargandoVisible = await page.isVisible(sel('movimientos-cargando')).catch(() => false);
    const deshabilitado = await page.$eval(sel('movimientos-buscar'),
      (e) => e.hasAttribute('disabled') || e.disabled === true).catch(() => null);
    // E1 (F3d) · `movimientos-cargando` es EFÍMERO: si se recolecta después del estado terminal
    // nunca entra en `vistos` y N3 nace IMPOSIBLE. Se recolecta acá, con el nodo montado.
    await recolectar(page);
    const antesDelForzado = peticiones;
    await page.click(sel('movimientos-buscar'), { force: true, timeout: 2000 }).catch(() => {});
    // E6 (F3d) · leer el contador justo después del click no espera al despacho asíncrono: con
    // K12 inyectado la segunda petición podía no haber llegado al `route` todavía y el brazo
    // daba VERDE FALSO justo donde calibra K12. Esto no es un sleep: es esperar la CONDICIÓN
    // que el defecto haría verdadera, y que venza es exactamente el verde.
    await esperarHasta(() => peticiones > antesDelForzado,
      'una segunda petición tras el click forzado — que venza es el resultado esperado', 1500);
    const porElForzado = peticiones - antesDelForzado;
    const estadoFinal = await esperarTerminal(page).catch(() => null);
    // E5 (F3d) · JM8 dice `aria-busy="true"` SÓLO en `cargando`, y ningún brazo miraba que se
    // RETIRE: una app que lo dejara puesto para siempre pasaba verde. Ciego con cláusula de
    // spec y sin árbitro.
    const busyAlFinal = await page.$eval(sel('movimientos-region'), (e) => e.getAttribute('aria-busy')).catch(() => null);
    await recolectar(page);
    const fallas = [];
    if (!enVuelo) fallas.push('data-estado nunca fue «cargando»');
    if (marcas !== 'true') fallas.push(`aria-busy=«${marcas}» y se esperaba «true»`);
    if (!cargandoVisible) fallas.push('movimientos-cargando no estaba visible');
    if (deshabilitado !== true) fallas.push(`movimientos-buscar no estaba deshabilitado (${deshabilitado})`);
    if (antesDeBuscar !== 0) fallas.push(`salieron ${antesDeBuscar} consultas ANTES de pulsar Buscar y D97-1 exige que la consulta salga sólo con el botón`);
    if (porElForzado !== 0) fallas.push(`el click forzado disparó ${porElForzado} consulta(s) más`);
    if (estadoFinal === 'cargando' || estadoFinal === null) fallas.push(`la carga no terminó en un estado terminal (data-estado=«${estadoFinal}»)`);
    if (busyAlFinal === 'true') fallas.push('aria-busy siguió en «true» con la carga ya terminada (JM8 lo pide SÓLO en «cargando»)');
    brazo('C1', fallas.length === 0, fallas.join(' · '));
  });

  // C2 · Si falla GET /cuentas: error propio + reintento que carga bien el selector (JM10). La
  // falla se provoca en el NAVEGADOR, sin tocar el backend (perfil SUT).
  await correr('C2', async () => {
    const page = await paginaNueva();
    await entrarUI(page, O.email, O.password);
    await estadoCuentas(page);
    // E14 (F3d) · predicado de función en vez del glob `**/cuentas`, que no casaría con una URL
    // con query. La pantalla no existe todavía y nada en la spec fija la forma de esa llamada:
    // un `?` en la URL volvería este brazo un silencio.
    const esCuentas = (url) => url.pathname === '/cuentas';
    await page.route(esCuentas, (route) => route.fulfill({
      status: 500, contentType: 'application/json', body: JSON.stringify({ codigo: 'ERROR_INTERNO' }),
    }));
    await page.click(sel('nav-movimientos'));
    await page.waitForSelector(sel('movimientos-region'), { state: 'visible', timeout: ESPERA_MS });
    const hayError = await page.waitForSelector(sel('movimientos-cuentas-error'), { state: 'visible', timeout: ESPERA_MS }).then(() => true, () => false);
    const hayReintento = await page.isVisible(sel('movimientos-reintentar')).catch(() => false);
    // E1 (F3d) · `movimientos-cuentas-error` y `movimientos-reintentar` sólo están montados
    // AHORA: JM10 exige que el reintento exitoso los quite, así que recolectar después del
    // reintento hacía que N3 los reclamara para siempre.
    await recolectar(page);
    await page.unroute(esCuentas);
    let opciones = -1;
    if (hayReintento) {
      await page.click(sel('movimientos-reintentar'));
      await esperarHasta(async () => (await page.$$(`${sel('movimientos-cuenta')} option`)).length > 1,
        'el selector no se llenó tras el reintento');
      opciones = (await page.$$(`${sel('movimientos-cuenta')} option`)).length;
    }
    const errorSigue = await page.isVisible(sel('movimientos-cuentas-error')).catch(() => false);
    await recolectar(page);
    const fallas = [];
    if (!hayError) fallas.push('no apareció movimientos-cuentas-error');
    if (!hayReintento) fallas.push('no apareció movimientos-reintentar');
    if (opciones <= 1) fallas.push(`tras el reintento el selector tiene ${opciones} opciones (se esperaban la vacía + las cuentas)`);
    if (errorSigue) fallas.push('el error del selector sigue visible tras el reintento exitoso');
    brazo('C2', fallas.length === 0, fallas.join(' · '));
  });

  // C3 · `inicial` y `vacio` son DISTINTOS (JM8). Los dos en un brazo porque lo que se afirma es
  // justamente que no son el mismo estado.
  await correr('C3', async () => {
    const page = await paginaNueva();
    await entrarYMovimientos(page, O.email, O.password);
    // E9 (F3d) · `data-estado` se leía apenas la región se hacía visible, en carrera con la
    // carga del selector de cuentas (hallazgo #10/J6). El ancla pasa a ser una CONDICIÓN
    // observable —el selector ya cargado— y lo que se exige se vuelve más fuerte, no más débil:
    // con `GET /cuentas` ya respondido el estado TIENE que seguir siendo `inicial`.
    const selectorCargado = await esperarHasta(
      async () => (await page.$$(`${sel('movimientos-cuenta')} option`)).length > 1,
      'el selector de cuentas nunca se llenó al entrar a Movimientos');
    const alLlegar = await estadoMovimientos(page);
    const vacioAlLlegar = await page.isVisible(sel('movimientos-vacio')).catch(() => false);
    await elegirCuenta(page, O.cuentaId);
    await llenarFiltros(page, { monto: MONTO_SIN_RESULTADOS });
    const { estado } = await buscar(page);
    const vacioPresente = await page.isVisible(sel('movimientos-vacio')).catch(() => false);
    const filas = await filasDe(page);
    await recolectar(page);
    const fallas = [];
    if (!selectorCargado) fallas.push('el selector de cuentas no se llenó al entrar (JM1 pide el GET /cuentas de entrada)');
    if (alLlegar !== 'inicial') fallas.push(`al llegar data-estado=«${alLlegar}» y se esperaba «inicial»`);
    if (vacioAlLlegar) fallas.push('movimientos-vacio estaba presente ANTES de buscar');
    if (estado !== 'vacio') fallas.push(`tras buscar ${MONTO_SIN_RESULTADOS} data-estado=«${estado}» y se esperaba «vacio»`);
    if (!vacioPresente) fallas.push('no apareció movimientos-vacio');
    if (filas.length !== 0) fallas.push(`se pintaron ${filas.length} filas y se esperaban 0`);
    brazo('C3', fallas.length === 0, fallas.join(' · '));
  });

  // ── B · Búsqueda (CA1 a CA6 y CA11) ──────────────────────────────────────────────────────

  // B1 · CA1 y D90-4 · las 10 filas × 4 campos, EN ORDEN, contra lo que el propio brazo le pide
  // a GET /movimientos, y `devueltos` === filas pintadas. Es el brazo que cierra el hueco
  // K5/K16 que quedó abierto en boletas, abrir-cuenta y transferir.
  await correr('B1', async () => {
    const page = await paginaNueva();
    await entrarYMovimientos(page, O.email, O.password);
    await elegirCuenta(page, O.cuentaId);
    const { estado } = await buscar(page);
    const filas = await filasDe(page);
    const api = await movimientosApi(O.token, { cuentaId: O.cuentaId });
    await recolectar(page);
    const fallas = [];
    if (estado !== 'listo') fallas.push(`data-estado=«${estado}»`);
    if (filas.length !== api.devueltos) fallas.push(`la pantalla pintó ${filas.length} filas y el API devolvió ${api.devueltos}`);
    const n = Math.min(filas.length, api.movimientos.length);
    for (let i = 0; i < n; i++) {
      const e = esperadoDe(api.movimientos[i]);
      const v = filas[i];
      for (const campo of ['monto', 'signo', 'fecha', 'concepto']) {
        if (v[campo] !== e[campo]) fallas.push(`fila ${i + 1}: data-${campo}=«${v[campo]}» y el API dice «${e[campo]}»`);
      }
    }
    brazo('B1', fallas.length === 0, `${fallas.slice(0, 8).join(' · ')}${fallas.length > 8 ? ` (+${fallas.length - 8} más)` : ''}`);
  });

  // B2–B5 · los filtros, por CONJUNTO de data-mov-id (el orden lo afirma B1, y así K1 caza sólo
  // a B1). Los conteos vienen medidos en § 4.2.
  const casosFiltro = [
    ['B2', { desde: '2026-03-01', hasta: '2026-03-01' }, DIA_01],
    ['B3', { desde: '2026-03-01', hasta: '2026-03-02' }, RANGO_01_02],
    ['B4', { monto: '25.00' }, MONTO_25],
    ['B5', { desde: '2026-03-01', hasta: '2026-03-01', monto: '25.00' }, DIA_01_Y_MONTO_25],
  ];
  for (const [id, filtros, indices] of casosFiltro) {
    await correr(id, async () => {
      const page = await paginaNueva();
      await entrarYMovimientos(page, O.email, O.password);
      await elegirCuenta(page, O.cuentaId);
      await llenarFiltros(page, filtros);
      const { estado } = await buscar(page);
      const filas = await filasDe(page);
      await recolectar(page);
      const fallas = compararConjunto(filas, idsDe(O.oraculo, indices));
      if (estado !== 'listo') fallas.unshift(`data-estado=«${estado}»`);
      // B4 · el valor absoluto (R4): el signo no confunde al filtro pero sí se pinta.
      if (id === 'B4') {
        for (const [indice, signo] of Object.entries(SIGNO_DE_MONTO_25)) {
          const f = filas.find((x) => x.movId === O.oraculo[Number(indice) - 1].id);
          if (f && f.signo !== signo) fallas.push(`i=${indice}: data-signo=«${f.signo}» y se esperaba «${signo}»`);
        }
      }
      brazo(id, fallas.length === 0, fallas.join(' · '));
    });
  }

  // B6 · CA11 (D90-3) · el transaccionId del índice 6 → 1 fila, y es la correcta.
  await correr('B6', async () => {
    const mov = O.oraculo[INDICE_TRANSACCION - 1];
    const page = await paginaNueva();
    await entrarYMovimientos(page, O.email, O.password);
    await elegirCuenta(page, O.cuentaId);
    await llenarFiltros(page, { transaccionId: mov.transaccionId });
    const { estado } = await buscar(page);
    const filas = await filasDe(page);
    await recolectar(page);
    const fallas = compararConjunto(filas, [mov.id]);
    if (estado !== 'listo') fallas.unshift(`data-estado=«${estado}»`);
    if (filas[0] && filas[0].transaccionId !== mov.transaccionId) {
      fallas.push(`data-transaccion-id=«${filas[0].transaccionId}» y se esperaba «${mov.transaccionId}»`);
    }
    brazo('B6', fallas.length === 0, fallas.join(' · '));
  });

  // B7 · CA6 · la cuenta de 51: 50 filas iguales campo por campo al API (técnica de B1) y aviso
  // de tope con texto no vacío; de vuelta en la cuenta de 10, el aviso NO está en el DOM y no
  // hay control de paginación (JM11, HU-03 R2). 50 de los 51 comparten instante (y 1 es 1 h más
  // nueva, D15): escribir la lista a mano sería un brazo intermitente, así que el orden lo decide
  // el API; la fila más nueva es la que hace que un re-orden ascendente de la pantalla se note.
  await correr('B7', async () => {
    const page = await paginaNueva();
    await entrarYMovimientos(page, O.email, O.password);
    await elegirCuenta(page, O.cuentaTopeId);
    const r1 = await buscar(page);
    const filasTope = await filasDe(page);
    const apiTope = await movimientosApi(O.token, { cuentaId: O.cuentaTopeId });
    const avisoTope = await page.isVisible(sel('movimientos-aviso-tope')).catch(() => false);
    const textoAviso = await page.$eval(sel('movimientos-aviso-tope'), (e) => (e.textContent ?? '').trim()).catch(() => '');
    const controles = await page.$$eval(`${sel('movimientos-region')} button, ${sel('movimientos-region')} a, ${sel('movimientos-region')} [role="button"]`,
      (els) => els.map((e) => (e.textContent ?? '').trim().toLowerCase()));
    const fallas = [];
    if (r1.estado !== 'listo') fallas.push(`data-estado=«${r1.estado}» con la cuenta de ${TOPE_CANTIDAD}`);
    if (filasTope.length !== TOPE_MOVIMIENTOS) fallas.push(`se pintaron ${filasTope.length} filas y el tope es ${TOPE_MOVIMIENTOS}`);
    if (apiTope.devueltos !== filasTope.length) fallas.push(`el API devolvió ${apiTope.devueltos} y la pantalla pintó ${filasTope.length}`);
    const n = Math.min(filasTope.length, apiTope.movimientos.length);
    for (let i = 0; i < n; i++) {
      const e = esperadoDe(apiTope.movimientos[i]);
      const v = filasTope[i];
      for (const campo of ['monto', 'signo', 'fecha', 'concepto']) {
        if (v[campo] !== e[campo]) fallas.push(`fila ${i + 1}: data-${campo}=«${v[campo]}» y el API dice «${e[campo]}»`);
      }
    }
    if (!avisoTope) fallas.push('no apareció movimientos-aviso-tope con hayMas=true');
    if (textoAviso.length === 0) fallas.push('movimientos-aviso-tope tiene texto vacío');
    const paginacion = controles.filter((t) => TERMINOS_PAGINACION.some((x) => t.includes(x)));
    if (paginacion.length > 0) fallas.push(`hay control de paginación: [${paginacion.join(', ')}]`);
    // E1 (F3d) · `movimientos-aviso-tope` sólo existe en ESTE tramo: el propio brazo exige más
    // abajo que con `hayMas:false` no esté en el DOM, así que recolectar al final lo dejaba
    // «faltando» para siempre y N3 nacía IMPOSIBLE.
    await recolectar(page);
    // Vuelta a la cuenta de 10: el aviso no debe estar en el DOM (K7 lo rompe).
    await elegirCuenta(page, O.cuentaId);
    const r2 = await buscar(page);
    const avisoDespues = await page.$(sel('movimientos-aviso-tope'));
    if (r2.estado !== 'listo') fallas.push(`data-estado=«${r2.estado}» con la cuenta del oráculo`);
    if (avisoDespues) fallas.push('movimientos-aviso-tope SIGUE en el DOM con hayMas=false');
    await recolectar(page);
    brazo('B7', fallas.length === 0, `${fallas.slice(0, 8).join(' · ')}${fallas.length > 8 ? ` (+${fallas.length - 8} más)` : ''}`);
  });

  // B8 · JM7 · un concepto FUERA del mapa de J2 se muestra crudo y sin error, y el texto vive en
  // el MISMO nodo que lleva data-concepto (hallazgo JA7 de abrir-cuenta).
  await correr('B8', async () => {
    const page = await paginaNueva();
    await entrarYMovimientos(page, O.email, O.password);
    await elegirCuenta(page, O.cuentaId);
    const { estado } = await buscar(page);
    const filas = await filasDe(page);
    await recolectar(page);
    const fallas = [];
    if (estado !== 'listo') fallas.push(`data-estado=«${estado}»`);
    if (filas.length !== 10) fallas.push(`se pintaron ${filas.length} filas y se esperaban 10`);
    const malAtributo = filas.filter((f) => f.concepto !== CONCEPTO_SIEMBRA).length;
    const malTexto = filas.filter((f) => !f.conceptoTexto.includes(CONCEPTO_SIEMBRA)).length;
    if (malAtributo > 0) fallas.push(`${malAtributo} filas con data-concepto ≠ ${CONCEPTO_SIEMBRA} (p.ej. «${filas.find((f) => f.concepto !== CONCEPTO_SIEMBRA)?.concepto}»)`);
    if (malTexto > 0) fallas.push(`${malTexto} filas cuyo texto visible no contiene ${CONCEPTO_SIEMBRA} (p.ej. «${filas.find((f) => !f.conceptoTexto.includes(CONCEPTO_SIEMBRA))?.conceptoTexto}»)`);
    brazo('B8', fallas.length === 0, fallas.join(' · '));
  });

  // B9 · HU-03 J2 · el rótulo TRADUCIDO de un concepto del mapa. Ancla de texto DELIBERADA y
  // declarada en § 5: es lo único que prueba que la persona ve el concepto traducido. B8 no lo
  // cubre (K13 y K14 lo demuestran). Si el rótulo cambia, B9 se enmienda en la spec.
  await correr('B9', async () => {
    const u = await titularConConceptoMapeado();
    const page = await paginaNueva();
    await entrarYMovimientos(page, u.email, u.password);
    await elegirCuenta(page, u.cuentaId);
    const { estado } = await buscar(page);
    const filas = await filasDe(page);
    await recolectar(page);
    const fila = filas.find((f) => f.movId === u.movId);
    const fallas = [];
    if (estado !== 'listo') fallas.push(`data-estado=«${estado}»`);
    if (!fila) {
      fallas.push(`no se pintó el movimiento de la transferencia (${filas.length} filas: [${filas.map((f) => f.concepto).join(', ')}])`);
    } else {
      if (fila.concepto !== CONCEPTO_MAPEADO) fallas.push(`data-concepto=«${fila.concepto}» y se esperaba «${CONCEPTO_MAPEADO}»`);
      if (fila.conceptoTexto !== ROTULO_MAPEADO) fallas.push(`el rótulo visible es «${fila.conceptoTexto}» y se esperaba «${ROTULO_MAPEADO}»`);
    }
    brazo('B9', fallas.length === 0, fallas.join(' · '));
  });

  // ── F · Formulario y errores de negocio (CA7, JM2/JM3) ───────────────────────────────────

  // F1 · El cliente no valida nada (JM2) y los cuatro filtros son type="text" (JM3), comprobado
  // sobre el DOM RENDERIZADO. Es lo que hace alcanzables F2–F5 desde la UI. Se miran el ATRIBUTO
  // y la PROPIEDAD: un binding de Angular ([maxlength]="20") no deja atributo (hallazgo F3 de
  // transferir, #5).
  await correr('F1', async () => {
    const page = await paginaNueva();
    await entrarYMovimientos(page, O.email, O.password);
    const novalidate = await page.$eval(sel('movimientos-form'),
      (e) => e.hasAttribute('novalidate') || e.noValidate === true).catch(() => null);
    const info = await page.evaluate(({ campos, prohibidos, mapa }) => campos.map((t) => {
      const e = document.querySelector(`[data-testid="${t}"]`);
      if (!e) return { t, falta: true };
      return {
        t,
        tipo: e.getAttribute('type'),
        con: prohibidos.filter((a) => {
          if (e.hasAttribute(a)) return true;
          const v = e[mapa[a] ?? a];
          if (v === undefined || v === '' || v === false || v === null) return false;
          // -1 es «ausente» en maxLength/minLength. El 0 NO: un maxLength=0 es un campo donde
          // no se puede teclear, o sea la prohibición más fuerte de todas (E11).
          return !(typeof v === 'number' && v === -1);
        }),
      };
    }), { campos: CAMPOS_FORM, prohibidos: ATRIBUTOS_PROHIBIDOS, mapa: PROP_DE_ATRIBUTO });
    await recolectar(page);
    const fallas = [];
    if (novalidate !== true) fallas.push(`movimientos-form sin novalidate (${novalidate})`);
    for (const c of info) {
      if (c.falta) { fallas.push(`${c.t} no está en el DOM`); continue; }
      if (c.con.length > 0) fallas.push(`${c.t} trae [${c.con.join(', ')}]`);
      if (CAMPOS_TEXTO.includes(c.t) && c.tipo !== 'text') fallas.push(`${c.t} es type="${c.tipo}" y JM3 exige "text"`);
    }
    brazo('F1', fallas.length === 0, `${fallas.join(' · ')} (lista versionada: ${ATRIBUTOS_PROHIBIDOS.join('|')})`);
  });

  // F2–F5 · los cuatro rechazos de § 4.3: el CÓDIGO, no la prosa (JM9). Cada uno deja limpios
  // los campos que no está probando (precedencia fija del controlador).
  for (const [id, filtros, codigo] of RECHAZOS) {
    await correr(id, async () => {
      const page = await paginaNueva();
      await entrarYMovimientos(page, O.email, O.password);
      await elegirCuenta(page, O.cuentaId);
      await llenarFiltros(page, filtros);
      const { estado } = await buscar(page);
      const attr = await page.$eval(sel('movimientos-error'), (e) => e.getAttribute('data-codigo')).catch(() => null);
      const texto = await page.$eval(sel('movimientos-codigo-error'), (e) => (e.textContent ?? '').trim()).catch(() => null);
      const rol = await page.$eval(sel('movimientos-error'), (e) => e.getAttribute('role')).catch(() => null);
      const filas = await filasDe(page);
      await recolectar(page);
      const fallas = [];
      if (estado !== 'error') fallas.push(`data-estado=«${estado}» y se esperaba «error»`);
      if (attr !== codigo) fallas.push(`data-codigo=«${attr}» y se esperaba «${codigo}»`);
      if (texto !== codigo) fallas.push(`movimientos-codigo-error dice «${texto}» y se esperaba «${codigo}»`);
      if (rol !== 'alert') fallas.push(`movimientos-error tiene role=«${rol}» y se esperaba «alert» (JM9)`);
      if (filas.length !== 0) fallas.push(`se pintaron ${filas.length} filas y se esperaban 0`);
      brazo(id, fallas.length === 0, fallas.join(' · '));
    });
  }

  // F6 · La opción vacía elegida → SÍ se llama al API y vuelve CUENTA_ID_REQUERIDO. Afirma la
  // INTENCIÓN (la petición salió), no un `disabled`: es la decisión D80-3 de transferir, y es el
  // brazo que justifica la opción vacía de JM4. K10 lo rompe.
  await correr('F6', async () => {
    const page = await paginaNueva();
    await entrarYMovimientos(page, O.email, O.password);
    // No se elige cuenta: la opción vacía es la que nace elegida (JM4).
    const elegido = await page.$eval(sel('movimientos-cuenta'), (e) => e.value).catch(() => null);
    const { resp, estado } = await buscar(page);
    const attr = await page.$eval(sel('movimientos-error'), (e) => e.getAttribute('data-codigo')).catch(() => null);
    // E10 (F3d) · F6 no afirmaba ni `role="alert"` ni el texto del código, que JM9 exige para
    // TODO error de negocio y que F2–F5 sí afirman: un error sin rol de alerta y sin código
    // visible pasaba verde justo en el brazo que justifica la opción vacía (hallazgo #7).
    const texto = await page.$eval(sel('movimientos-codigo-error'), (e) => (e.textContent ?? '').trim()).catch(() => null);
    const rol = await page.$eval(sel('movimientos-error'), (e) => e.getAttribute('role')).catch(() => null);
    const filas = await filasDe(page);
    await recolectar(page);
    const fallas = [];
    if (elegido) fallas.push(`el selector nace con «${elegido}» elegido y JM4 pide la opción vacía`);
    if (!resp) fallas.push('la pantalla NO llamó al API (el cliente validó por su cuenta: contra JM2/JM4)');
    if (estado !== 'error') fallas.push(`data-estado=«${estado}» y se esperaba «error»`);
    if (attr !== 'CUENTA_ID_REQUERIDO') fallas.push(`data-codigo=«${attr}» y se esperaba «CUENTA_ID_REQUERIDO»`);
    if (texto !== 'CUENTA_ID_REQUERIDO') fallas.push(`movimientos-codigo-error dice «${texto}» y se esperaba «CUENTA_ID_REQUERIDO»`);
    if (rol !== 'alert') fallas.push(`movimientos-error tiene role=«${rol}» y se esperaba «alert» (JM9)`);
    if (filas.length !== 0) fallas.push(`se pintaron ${filas.length} filas y se esperaban 0`);
    brazo('F6', fallas.length === 0, fallas.join(' · '));
  });

  // ── A · Formato y accesibilidad (CA9, CA10, JM12) ────────────────────────────────────────

  // A1 · caption con texto, todos los th con scope="col", y cada campo con su <label for> que
  // apunta a un id QUE EXISTE. El `for` colgado es el defecto que un check de presencia no ve.
  await correr('A1', async () => {
    const page = await paginaNueva();
    await entrarYMovimientos(page, O.email, O.password);
    await elegirCuenta(page, O.cuentaId);
    await buscar(page);
    const tabla = await page.$eval(sel('movimientos-tabla'), (t) => ({
      caption: (t.querySelector('caption')?.textContent ?? '').trim(),
      hayCaption: t.querySelector('caption') !== null,
      ths: [...t.querySelectorAll('th')].map((th) => ({ texto: (th.textContent ?? '').trim(), scope: th.getAttribute('scope') })),
    })).catch(() => null);
    const labels = await page.evaluate((campos) => {
      const form = document.querySelector('[data-testid="movimientos-form"]');
      const colgados = form
        ? [...form.querySelectorAll('label[for]')].filter((l) => document.getElementById(l.getAttribute('for')) === null).map((l) => l.getAttribute('for'))
        : ['(no hay movimientos-form)'];
      const sinEtiqueta = campos.filter((t) => {
        const e = document.querySelector(`[data-testid="${t}"]`);
        if (!e) return true;
        return !e.id || document.querySelector(`label[for="${e.id}"]`) === null;
      });
      return { colgados, sinEtiqueta };
    }, CAMPOS_FORM);
    await recolectar(page);
    const fallas = [];
    if (!tabla) fallas.push('movimientos-tabla no está en el DOM');
    else {
      if (!tabla.hayCaption || tabla.caption.length === 0) fallas.push('movimientos-tabla sin <caption> con texto');
      const sinScope = tabla.ths.filter((th) => th.scope !== 'col');
      if (tabla.ths.length === 0) fallas.push('la tabla no tiene ningún <th>');
      if (sinScope.length > 0) fallas.push(`${sinScope.length} <th> sin scope="col" (p.ej. «${sinScope[0].texto}» scope=${sinScope[0].scope})`);
    }
    if (labels.colgados.length > 0) fallas.push(`<label for> colgados: [${labels.colgados.join(', ')}]`);
    if (labels.sinEtiqueta.length > 0) fallas.push(`campos sin <label for>: [${labels.sinEtiqueta.join(', ')}]`);
    brazo('A1', fallas.length === 0, fallas.join(' · '));
  });

  // A2 · CA9 y R7 (JM13) · la fecha visible rotulada UTC, con el ISO crudo en data-fecha. Es el
  // segundo ancla de texto declarada: el rótulo UTC es una regla del humano.
  await correr('A2', async () => {
    const page = await paginaNueva();
    await entrarYMovimientos(page, O.email, O.password);
    await elegirCuenta(page, O.cuentaId);
    await buscar(page);
    const filas = await filasDe(page);
    await recolectar(page);
    const fila = filas.find((f) => f.movId === O.oraculo[0].id);
    const fallas = [];
    if (!fila) fallas.push(`no se pintó la fila del índice 1 (${filas.length} filas)`);
    else {
      if (fila.fecha !== FECHA_ISO_I1) fallas.push(`data-fecha=«${fila.fecha}» y se esperaba el ISO crudo «${FECHA_ISO_I1}»`);
      if (fila.fechaTexto !== FECHA_VISIBLE_I1) fallas.push(`el texto visible es «${fila.fechaTexto}» y se esperaba «${FECHA_VISIBLE_I1}»`);
      if (!fila.fechaTexto.endsWith('UTC')) fallas.push('la fecha visible no termina en «UTC»');
    }
    brazo('A2', fallas.length === 0, fallas.join(' · '));
  });

  // ── N3 · Contrato de testids sobre el ARTEFACTO RENDERIZADO ──────────────────────────────
  // Va al final a propósito: mide lo que se recolectó en los 22 recorridos de arriba. Un grep
  // del código fuente pasa en verde con un componente que nunca se monta (RESTRICCIONES § 2).
  await correr('N3', async () => {
    const faltan = LISTA_S17M.filter((t) => !vistos.has(t));
    const sobran = [...vistos].filter((t) => !UNION.has(t));
    // Si un brazo cayó antes de recolectar, sus testids no entran y N3 diría «faltan» por culpa
    // de OTRO brazo. El veredicto NO se relaja —sigue rojo—, pero el motivo deja de mentir sobre
    // la causa.
    const rojosPrevios = resultados.filter((r) => !r.ok).map((r) => r.id);
    const arrastre = rojosPrevios.length > 0
      ? ` · ⚠ CAUSA POSIBLEMENTE ARRASTRADA: ya venían rojos [${rojosPrevios.join(' ')}]`
      : '';
    brazo('N3', faltan.length === 0 && sobran.length === 0 && repetidos.size === 0 && fuera.length === 0,
      `faltan [${faltan.join(', ')}] · sobran [${sobran.join(', ')}] · repetidos [${[...repetidos].join(', ')}] · fuera [${[...new Set(fuera)].slice(0, 3).join(', ')}] (lista de ${LISTA_S17M.length})${arrastre}`);
  });
} finally {
  await navegador.close().catch(() => {});
}

const verdes = resultados.filter((r) => r.ok).length;
const rojos = resultados.filter((r) => !r.ok).map((r) => r.id);
console.log(`\nverificar:s17-movimientos → ${verdes}/${resultados.length} brazos verdes${rojos.length ? ` · rojos: ${rojos.join(' ')}` : ''}`);
if (SOLO.length > 0) console.log(`⚠ CORRIDA PARCIAL (ZFB_BRAZOS=${SOLO.join(',')}): ${resultados.length} de ${BRAZOS_TOTAL} brazos. NO sirve para declarar el número de la unidad.`);
process.exit(rojos.length === 0 && resultados.length === BRAZOS_TOTAL ? 0 : 1);
