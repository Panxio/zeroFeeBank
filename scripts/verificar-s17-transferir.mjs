// Árbitro de S-17 · Transferir (specs/S-17-transferir.md § 5). Corre contra el ARTEFACTO
// servido: el backend (`node dist/main.js`) en :3000 y el build de pruebas de web/ en :4200.
// Lo levanta scripts/verificar-s17-transferir.sh; este archivo sólo mira. No importa código de la
// app y no toca la base de datos (C1: todo estado se siembra por API o por la costura /__test__).
//
// Contiene exactamente los 19 brazos de § 5: TR1–TR3, P1, B1–B8, X1, X2, E1–E4, N1.
//
// ── Enmienda F4: los 12 hallazgos ciertos de la auditoría F3 ─────────
// La auditoría de F3 (22 hallazgos) dejó 12 ciertos en 9 sitios. Regla que
// mandó sobre esta enmienda (REGLA DE ORO y § 6 de la spec): **sólo se refuerza una aserción o se
// reemplaza una inalcanzable por otra alcanzable; ninguna se debilita**, y todo cambio de un caso
// fijado está escrito en specs/S-17-transferir.md § 2.2. Lo que nace acá NACE SIN CALIBRAR: sus
// defectos (K19–K26) están declarados en § 6 y se miden en F6.
//   #1  B8 nuevo   · § 4.2 exige que Revisar muestre banco, número y tipo y NADIE lo miraba.
//   #2  B4         · el DTO del 201 y el del GET traen los mismos campos: comparar contra el GET
//                    no distinguía «releer» de «pintar el formulario». Ahora el árbitro INTERCEPTA
//                    el GET y le cambia un valor testigo: sólo una pantalla que relee lo muestra.
//   #3  B4         · se compara el :id del GET contra el id que devolvió el 201 (antes ni se leía
//                    el cuerpo de la RESPUESTA del POST: obs.posts guardaba el de la petición).
//   #4  E3         · JT4 dice «ningún campo»: entra `transferir-monto` (verificado: hoy no lleva
//                    ninguno de los 7 atributos, app.html:443-451, así que no es un brazo imposible).
//   #5  E3         · `hasAttribute` no ve un binding de Angular ([maxlength]="20" pone la PROPIEDAD):
//                    K15, el defecto que E3 existe para cazar, se le escapaba. Ahora mira las dos.
//   #6/#7 B3       · el check por ausencia de cupo vivía encerrado en `#panel-destino` —que NO es
//                    contrato versionado— y con `.catch(() => '')`: si el id cambiaba medía nada y
//                    decía VERDE. Pasa al testid `transferir-form` (destino + revisar), sin catch.
//   #8/#9/#10 TR3/B2 · `opcionesDe` devolvía el TEXTO como value de un <option> sin atributo value:
//                    un placeholder hacía fallar TR3 sobre app correcta (imposible) y escondía del
//                    conteo y del chequeo R6 una opción con value="".
//   #11 P1         · `filasResumen` no pasaba por `estadoCuentas`: podía leer saldos viejos (recaída
//                    de la lección de F2-v) y dar rojo sobre app correcta.
//   #12 X1/X2      · `relojDesfijar` se tragaba todo fallo: los brazos siguientes podían correr bajo
//                    un reloj congelado sin que nadie se enterara. Ahora afirma `fijado:false` y,
//                    si no lo consigue, ENSUCIA la corrida y los brazos posteriores salen rojos.
//   M1 (el único solape de los dos auditores) · la carrera del `await res.json()` del listener: el
//                    cuerpo del GET se espera por condición (`esperarHasta`), no se lee y se reza.
// Y las tres decisiones de § 2.1: D80-1 (B2 audita las opciones de `transferir-destino-tipo`),
// D80-2 (B1 exige los campos del modo banco OCULTOS en los otros dos modos) y D80-3 (la vuelta del
// 4xx de B7 se afirma por la intención: se vuelve al paso Destino y se comprueba que se puede editar).
//
// ── Dos decisiones tomadas en F2 y declaradas acá ──────
// 1. § 5 encabezaba «19 brazos» y su tabla declaraba 18. Manda la tabla: BRAZOS_TOTAL = 18
//    (en F4 pasó a 19 al nacer B8 — declarado en § 5 y en § 2.2, no en silencio).
//    La línea de la spec se corrigió oportunamente.
// 2. **B7 era un brazo IMPOSIBLE tal como estaba escrito.** Exigía que al terminar el envío el
//    formulario «vuelva a editando», y eso no es alcanzable por el artefacto: con 201 el form se
//    DESMONTA (app.html:265 y :299 — la confirmación va en el @if y el form en el @else), así que
//    no hay elemento al que leerle el atributo; y con 4xx el estado es `error` (app.ts:1259), que
//    es además lo que el candado afirma literalmente en T4 (verificar-s10-t4.mjs:1704). Ponerlo en
//    `editando` habría movido el 78/78 que § 7 declara inamovible. Enmienda aprobada por el humano:
//    B7 mide los dos finales REALES —tras 201, form desmontado y confirmación presente; tras 4xx,
//    data-estado="error" y los tres campos re-habilitados—. Ninguna aserción se debilitó: la de ida
//    (enviando + aria-busy + campos disabled), que es la que caza K13, quedó igual.
// 3. `transferir-banco-numero` lleva `data-numero`. JT7 nombró los atributos de nombre, tipo, monto
//    y fecha, pero no el del número; § 5 B4 dice «por sus atributos», así que se fija acá y
//    en specs/S-17-testids-transferir.txt. Es contrato de pantalla (el CÓMO), no un dato de negocio.
//
// ── Comportamiento del menú: ────────────────────────────────────────────
// El CLICK sobre `nav-cuentas` CIERRA el submenú y navega al Resumen (app.ts:354). Estos brazos
// llegan a Transferir por la vía directa `nav-transferir` (candado V1), que no tiene ese problema.
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
const BRAZOS_TOTAL = 19; // F4: nace B8, el árbitro del paso Revisar (§ 4.2, HU-04 J3)

// ── Constantes de § 3 (todas con origen; ninguna se inventa) ───────────────────────────────
// Catálogo: códigos de src/domain/transferencia/otros-bancos.ts:7, nombres de
// specs/HU-01-tipos-de-transferencia.md:54-63 (aprobados por el humano el 2026-09-14).
const CATALOGO = [
  ['ASERCION', 'Banco Aserción'],
  ['FIXTURE', 'Banco Fixture'],
  ['STUB', 'Banco Stub'],
  ['SANDBOX', 'Banco Sandbox'],
  ['MOCK', 'Banco Mock'],
];
const TIPOS_EXTERNOS = ['CORRIENTE', 'AHORRO']; // TIPOS_CUENTA_EXTERNA (otros-bancos.ts:19)

const MONTO_APERTURA = '2000.00';   // la CORRIENTE se abre desde la caja
const MONTO_AHORRO = '1000.00';     // y la AHORRO se abre DESDE la corriente: quedan 1.000,00 y 1.000,00
const SALDO_BASE = '1000.00';
const MONTO_PROPIA = '100.00';      // distinto de los 250.10 de A6 del candado: un cruce se nota
const SALDO_ORIGEN_TRAS_P1 = '900.00';
const SALDO_DESTINO_TRAS_P1 = '1100.00';
const MONTO_BANCO = '100.00';
const SALDO_TRAS_BANCO = '900.00';

const BANCO_FELIZ = 'SANDBOX';
const NUMERO_VALIDO = '12345678';                    // 8 dígitos, dentro de 1–20 (HU-01 R5)
const NUMERO_LETRAS = '1234ABCD';                    // E1
const NUMERO_21 = '123456789012345678901';           // E2: un dígito sobre el máximo
const TIPO_FELIZ = 'AHORRO';
// F4 · testigo que el árbitro inyecta en la RESPUESTA del GET de confirmación (hallazgo #2). No es
// un dato de negocio inventado: es una respuesta del servidor simulada, como el 400 de B7(b), y
// sirve para distinguir «releer el GET» de «pintar el formulario», que con los DTO idénticos del
// 201 y del GET no se distinguía. Distinto de NUMERO_VALIDO para que el cambio se note.
const NUMERO_TESTIGO = '87654321';

const TOPE_TEXTO = 'Máximo 200,00 USD por día (UTC) por cuenta de origen'; // JT9, literal
const X1_PRIMERA = '150.00';
const X1_SEGUNDA = '50.00';   // 150 + 50 = 200,00 exacto: el borde inclusivo por el lado que pasa
const X1_TERCERA = '0.01';    // 200,01: el borde por el lado que NO pasa
const X2_MONTO = '200.00';

// Check por AUSENCIA · lista de términos versionada junto al resultado (ARNES.md, C3 de AGENTS.md).
// E3 · atributos de validación de cliente que JT4 prohíbe en los tres campos del modo banco:
const ATRIBUTOS_PROHIBIDOS = ['required', 'pattern', 'minlength', 'maxlength', 'min', 'max', 'step'];
// F4 · hallazgo #4: JT4 dice «NINGÚN campo», y E3 sólo miraba los tres del destino. `transferir-monto`
// entra a la lista. Verificado antes de escribirlo (app.html:443-451): hoy es un <input type="text">
// sin ninguno de los 7, así que la aserción es ALCANZABLE y no mueve el candado.
const CAMPOS_SIN_VALIDACION = [
  'transferir-destino-banco', 'transferir-destino-numero', 'transferir-destino-tipo', 'transferir-monto',
];
// B3 · términos con que se delataría un «cupo restante», que JT9 prohíbe mostrar.
// F4 · M3 del veredicto: «disponible» a secas ponía rojo un rótulo legítimo («Saldo disponible»),
// que es un brazo imposible por la puerta de atrás. Se REEMPLAZA por las formas en que un cupo
// restante se escribe de verdad; los otros cuatro términos no se tocan. Lista versionada junto al
// resultado (ARNES.md), y el ÁMBITO donde se aplica pasó de `#panel-destino` a todo el formulario.
const TERMINOS_CUPO = ['cupo', 'restante', 'quedan', 'saldo del tope', 'disponible hoy', 'te queda'];

const leerLista = (archivo) => readFileSync(new URL(`../specs/${archivo}`, import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const LISTA_S17T = leerLista('S-17-testids-transferir.txt');
const UNION = new Set([
  ...leerLista('S-10-testids-T4.txt'),
  ...leerLista('S-17-testids-boletas.txt'),
  ...leerLista('S-17-testids-abrir-cuenta.txt'),
  // Enmienda de specs/S-17-movimientos.md § 5.1: los testids de la pantalla de
  // Movimientos entran en la unión contra la que se mide lo que SOBRA. Lo que FALTA se sigue
  // midiendo contra LISTA_S17T, y un testid ajeno sigue poniendo N1 rojo.
  ...leerLista('S-17-testids-movimientos.txt'),
  // enmienda § 5.1 de S-17-pagos: los testids de la pantalla de Pagos entran en la unión
  // contra la que se mide lo que SOBRA. Lo que FALTA se sigue midiendo contra LISTA_S17T, y un
  // testid ajeno sigue poniendo N1 rojo.
  ...leerLista('S-17-testids-pagos.txt'),
  ...leerLista('S-17-testids-contacto.txt'), // enmienda § 5.1 de S-17-contacto
  ...leerLista('S-35-testids-idioma.txt'),   // enmienda C3 de S-35
  ...LISTA_S17T,
]);

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
// Filtro de diagnóstico (F2-v): ZFB_BRAZOS=P1,B4 corre sólo esos brazos. Existe para
// diagnosticar y para calibrar defecto por defecto sin pagar los 18 recorridos. NO puede
// producir un verde de la unidad: el `process.exit` del final exige `resultados.length ===
// BRAZOS_TOTAL`, así que una corrida parcial siempre sale 1, y el resumen lo declara.
const SOLO = (process.env.ZFB_BRAZOS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

async function correr(id, fn) {
  if (SOLO.length > 0 && !SOLO.includes(id)) return;
  // F4 · #12: si el reloj quedó fijado, lo que midan los brazos siguientes no es de fiar. Se
  // declara rojo, no se omite el brazo ni se sigue como si nada.
  if (RELOJ_SUCIO) { brazo(id, false, `el reloj quedó FIJADO y no se pudo liberar (${RELOJ_SUCIO}): esta medición no es de fiar`); return; }
  try {
    await fn();
  } catch (e) {
    // El mensaje de Playwright pone el selector en su «call log», no en la primera línea: sin él
    // un timeout dice «page.click: Timeout 8000ms» y no se sabe QUÉ click (hallazgo de F2-v).
    const texto = String(e?.stack ?? e?.message ?? e);
    const pista = texto.split('\n').find((l) => /waiting for|locator\(|getByTestId/.test(l))?.trim();
    brazo(id, false, `excepción: ${texto.split('\n')[0]}${pista ? ` ← ${pista}` : ''}`);
  } finally {
    await cerrarContextos();
  }
}

// ── HTTP crudo, con reintento ante error de red ────────────────────────────────────────────
// Resiliencia ante error de red (docs/deudas-arnes.md): un ECONNRESET tumbó el proceso entero y dejó brazos
// sin resumen. Acá el error de red se reintenta una vez y, si vuelve a fallar, se propaga como
// excepción del BRAZO —no del proceso—, que es lo que `correr` convierte en un rojo con motivo.
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

const JSON_H = { 'content-type': 'application/json' };
const codigoDe = (body) => { try { return JSON.parse(body).codigo ?? null; } catch { return null; } };

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

/** Costura del reloj (C2). Sólo la usan X1 y X2, y siempre la devuelven al reloj de pared. */
async function relojFijar(iso) {
  const r = await pedir('POST', '/__test__/reloj', JSON_H, { instante: iso });
  if (r.status !== 200) throw new Error(`preparación: POST /__test__/reloj → ${r.status} ${r.body}`);
  return JSON.parse(r.body).ahora;
}
/**
 * F4 · hallazgo #12: acá había un `.catch(() => {})` que se tragaba TODO fallo. Si el
 * desfijado fallaba, E1–E4 y N1 seguían corriendo bajo un reloj congelado sin que nadie se
 * enterara: el árbitro no miraba algo y decía VERDE. Ahora afirma la respuesta de la costura
 * (`{fijado:false}`, costuras.service.ts:230-235) y, si no lo consigue, ENSUCIA la corrida:
 * `correr` pone rojo todo brazo posterior con ese motivo. No se reclasifica el rojo.
 */
let RELOJ_SUCIO = null;
async function relojDesfijar() {
  for (const intento of [1, 2]) {
    try {
      const r = await pedir('POST', '/__test__/reloj', JSON_H, { instante: null });
      if (r.status === 200 && JSON.parse(r.body).fijado === false) { RELOJ_SUCIO = null; return; }
      if (intento === 2) RELOJ_SUCIO = `la costura respondió ${r.status} ${r.body}`;
    } catch (e) {
      if (intento === 2) RELOJ_SUCIO = `excepción al desfijar: ${String(e?.message ?? e)}`;
    }
  }
}

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

const saldoDe = (cuentas, id) => cuentas.find((c) => c.id === id)?.saldo ?? null;
const emailNuevo = (p) => `s17t-${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@arnes.local`;

// ── Preparación con los límites del propio contrato AFIRMADOS ──────────────────────────────
// Regla del proyecto: todo dato de preparación se construye con una función que
// afirma sus propios límites. Es la defensa contra el brazo imposible, que ninguna calibración
// caza porque en rojo se ve igual que uno correcto.

/**
 * Titular con UNA CORRIENTE y UNA AHORRO, las dos en 1.000,00 (§ 3). Se necesitan de tipos
 * distintos para CA5 y CA6. NO se usa un escenario del `seed`: sólo 'boletas-en-cada-estado'
 * devuelve credenciales (costuras.service.ts:822) y deja una sola cuenta, y sin credenciales no
 * se puede entrar por la UI, lo que dejaría imposible todo brazo de esta unidad.
 */
async function titularDosCuentas(prefijo) {
  const email = emailNuevo(prefijo);
  await registrar(email);
  const token = await tokenDe(email);
  const corriente = await abrirCuentaApi(token, { tipo: 'CORRIENTE', monto: MONTO_APERTURA });
  const ahorro = await abrirCuentaApi(token, { tipo: 'AHORRO', monto: MONTO_AHORRO, origenId: corriente.id });
  const cuentas = await cuentasApi(token);
  if (cuentas.length !== 2) throw new Error(`preparación: se esperaban 2 cuentas y hay ${cuentas.length}`);
  const c = cuentas.find((x) => x.id === corriente.id);
  const a = cuentas.find((x) => x.id === ahorro.id);
  if (c?.tipo !== 'CORRIENTE' || a?.tipo !== 'AHORRO') {
    throw new Error(`preparación: tipos inesperados (${c?.tipo} / ${a?.tipo})`);
  }
  if (c.saldo !== SALDO_BASE || a.saldo !== SALDO_BASE) {
    throw new Error(`preparación: se esperaban ${SALDO_BASE} y ${SALDO_BASE}, hay ${c.saldo} y ${a.saldo}`);
  }
  return { email, token, corrienteId: corriente.id, ahorroId: ahorro.id };
}

/**
 * Deja el tope diario de la CORRIENTE agotado EXACTO (200,00) por API, y lo AFIRMA: un centavo
 * más tiene que dar TOPE_DIARIO_EXCEDIDO. Sin esa afirmación, X2 podría pasar en verde sobre un
 * sistema sin tope: estaría midiendo nada.
 */
async function topeAgotado(u) {
  const r1 = await otroBancoApi(u.token, {
    cuentaOrigenId: u.corrienteId, monto: X2_MONTO, banco: BANCO_FELIZ,
    numeroCuenta: NUMERO_VALIDO, tipoCuenta: TIPO_FELIZ,
  });
  if (r1.status !== 201) throw new Error(`preparación: el consumo del tope → ${r1.status} ${codigoDe(r1.body)}`);
  const r2 = await otroBancoApi(u.token, {
    cuentaOrigenId: u.corrienteId, monto: '0.01', banco: BANCO_FELIZ,
    numeroCuenta: NUMERO_VALIDO, tipoCuenta: TIPO_FELIZ,
  });
  if (codigoDe(r2.body) !== 'TOPE_DIARIO_EXCEDIDO') {
    throw new Error(`preparación: el tope NO quedó agotado (0.01 → ${r2.status} ${codigoDe(r2.body)})`);
  }
}

// ── Navegador y ayudantes de UI ────────────────────────────────────────────────────────────
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

/** Sesión abierta y ya en el paso Origen de Transferir. */
async function entrarYTransferir(page, email) {
  await entrarUI(page, email);
  await estadoCuentas(page);
  await page.click(sel('nav-transferir'));
  await page.waitForSelector(sel('transferir-pasos'), { state: 'visible', timeout: ESPERA_MS });
}

async function elegirOrigen(page, cuentaId) {
  await page.waitForSelector(sel('transferir-origen'), { state: 'visible', timeout: ESPERA_MS });
  await page.selectOption(sel('transferir-origen'), cuentaId);
}

async function irAPasoDestino(page) {
  await page.click(sel('transferir-origen-siguiente'));
  await page.waitForSelector(`${sel('transferir-paso-destino')}[aria-selected="true"]`, { timeout: ESPERA_MS });
}

/** Cambia de modo por el radio del grupo `modoDestino` (JT1) y espera su control propio. */
async function elegirModo(page, modo) {
  const radio = { propia: 'transferir-destino-modo-propia', otra: 'transferir-destino-modo-otra', banco: 'transferir-destino-modo-banco' }[modo];
  await page.waitForSelector(sel(radio), { state: 'visible', timeout: ESPERA_MS });
  await page.check(sel(radio)).catch(() => page.click(sel(radio)));
  const control = { propia: 'transferir-destino-propia', otra: 'transferir-destino-id', banco: 'transferir-destino-banco' }[modo];
  await page.waitForSelector(sel(control), { state: 'visible', timeout: ESPERA_MS });
}

async function llenarBanco(page, { banco = BANCO_FELIZ, numero = NUMERO_VALIDO, tipo = TIPO_FELIZ } = {}) {
  await elegirModo(page, 'banco');
  await page.selectOption(sel('transferir-destino-banco'), banco);
  await page.fill(sel('transferir-destino-numero'), numero);
  await page.selectOption(sel('transferir-destino-tipo'), tipo);
}

async function montoYRevisar(page, monto) {
  await page.fill(sel('transferir-monto'), monto);
  await page.click(sel('transferir-destino-siguiente'));
  await page.waitForSelector(`${sel('transferir-paso-revisar')}[aria-selected="true"]`, { timeout: ESPERA_MS });
}

/**
 * Envía desde Revisar. El diálogo de confirmación NO es contrato de esta unidad —lo afirma el
 * candado en D1/D2—, así que acá se atraviesa si aparece y no se afirma nada sobre él: un árbitro
 * que afirmara de más sobre algo que su spec no fija produce rojos que no son defectos.
 */
async function enviarYConfirmar(page) {
  await page.click(sel('transferir-enviar'));
  const dlg = await page.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: 2000 })
    .then(() => true, () => false);
  if (dlg) await page.click(sel('confirmar-aceptar'));
}

const codigoError = (page) => page.$eval(sel('transferir-error'),
  (e) => e.getAttribute('data-codigo') ?? (e.textContent ?? '').trim()).catch(() => null);

/**
 * Opciones de un <select>, con su atributo y su rótulo visible por separado.
 * F4 · hallazgos #8, #9 y #10: acá decía `value: o.value || o.getAttribute('value') || ''`, y el
 * `o.value` del DOM de un `<option>` SIN atributo value es su TEXTO. Un placeholder
 * («Seleccione banco») se colaba entonces como si fuera un id o un código de banco, y hacía fallar
 * TR3 y B2 sobre una app correcta: un brazo IMPOSIBLE. Ahora el value crudo (el contrato) y la
 * condición de placeholder viajan por separado, y cada brazo decide qué hace con ellos.
 */
const opcionesDe = (page, testid) => page.$$eval(`${sel(testid)} option`, (os) => os.map((o) => {
  const texto = (o.textContent ?? '').trim();
  // OJO (medido sobre app.html:358, :414 y :872): las opciones de cuenta usan `[value]="c.id"`,
  // que es un binding de PROPIEDAD y no escribe el atributo. Por eso el value que vale es la
  // propiedad `o.value` —la que el navegador envía— y no `getAttribute('value')`: leer el atributo
  // habría puesto rojas TR1–TR3 sobre la app correcta, que es el mismo defecto del hallazgo #5.
  // Un `<option>` SIN value ni binding devuelve su texto en `o.value`: eso es un placeholder, no
  // un id ni un código de banco, y ése era el hallazgo #9.
  const sinValuePropio = o.getAttribute('value') === null && o.value === texto;
  return {
    value: o.value,
    placeholder: o.value === '' || sinValuePropio,
    disabled: o.disabled === true,
    tipo: o.getAttribute('data-tipo'),
    texto,
  };
}));

/**
 * Filas del Resumen tal como las ve la persona: atributos primero, texto aparte.
 * F4 · hallazgo #11 (recaída de la lección de F2-v): faltaba pasar por `estadoCuentas`. Tras
 * navegar al Resumen la tabla YA está visible con los datos viejos, así que esperar a que esté
 * visible no espera nada: se podían leer los saldos rancios y dar rojo sobre app correcta.
 */
async function filasResumen(page) {
  await estadoCuentas(page);
  await page.waitForSelector(sel('cuentas-tabla'), { state: 'visible', timeout: ESPERA_MS });
  return page.$$eval(sel('cuenta-fila'), (filas) => filas.map((f) => ({
    cuentaId: f.getAttribute('data-cuenta-id'),
    monto: f.querySelector('[data-testid="cuenta-saldo"]')?.getAttribute('data-monto') ?? null,
  })));
}

/**
 * Cuenta las llamadas del navegador a la API de otros bancos y guarda el CUERPO del GET de
 * confirmación. Sin contar la llamada, una pantalla que pintara el formulario pasaría igual: es
 * exactamente el defecto K7, y es la razón de que B4 mire la red y no sólo el DOM.
 */
function observarOtrosBancos(page) {
  // F4 · hallazgo #3: `posts` guardaba el cuerpo de la PETICIÓN, así que el árbitro no tenía el id
  // que devolvió el 201 y nunca podía comparar el `:id` del GET contra él (un GET a un id fijo o
  // viejo pasaba en verde). Ahora también se lee el cuerpo de la RESPUESTA del POST.
  // M1 · el `await res.json()` es asíncrono: `cuerpoGet`/`idPost` pueden no estar resueltos cuando
  // el brazo los lee. Los brazos los esperan por condición (`esperarHasta`), no los leen y rezan.
  const obs = { posts: [], gets: [], cuerpoGet: null, idPost: null };
  const esBase = (u) => new URL(u).pathname === '/transferencias/otros-bancos';
  const esDetalle = (u) => /^\/transferencias\/otros-bancos\/[^/]+$/.test(new URL(u).pathname);
  page.on('response', async (res) => {
    const req = res.request();
    const url = res.url();
    if (!HOSTS_PERMITIDOS.has(new URL(url).host)) return;
    if (req.method() === 'POST' && esBase(url)) {
      obs.posts.push({ status: res.status(), cuerpo: req.postDataJSON?.() ?? null });
      if (res.status() === 201) {
        const j = await res.json().catch(() => null);
        if (j?.id) obs.idPost = j.id;
      }
    }
    if (req.method() === 'GET' && esDetalle(url)) {
      obs.gets.push({ status: res.status(), url, id: new URL(url).pathname.split('/').pop() });
      const j = await res.json().catch(() => null);
      if (j && res.status() === 200) obs.cuerpoGet = j;
    }
  });
  return obs;
}

/** Atributos del elemento de confirmación: el código en el atributo, el rótulo en el texto (JT7). */
const confirmacion = (page) => page.evaluate(() => {
  const leer = (tid, attr) => {
    const e = document.querySelector(`[data-testid="${tid}"]`);
    return e ? { attr: e.getAttribute(attr), texto: (e.textContent ?? '').trim() } : null;
  };
  return {
    nombre: leer('transferir-banco-nombre', 'data-banco'),
    numero: leer('transferir-banco-numero', 'data-numero'),
    tipo: leer('transferir-banco-tipo', 'data-tipo'),
    monto: leer('transferir-banco-monto', 'data-monto'),
    fecha: leer('transferir-banco-fecha', 'data-realizada-en'),
  };
});

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

console.log('verificar:s17-transferir · 19 brazos (specs/S-17-transferir.md § 5)\n');

try {
  // ── TR · El tipo real en los dos selectores (CA5, HU-04 J1) ──────────────────────────────

  // TR1 · El ATRIBUTO del tipo, contra lo que devuelve GET /cuentas.
  await correr('TR1', async () => {
    const u = await titularDosCuentas('tr1');
    const page = await paginaNueva();
    await entrarYTransferir(page, u.email);
    const api = await cuentasApi(u.token);
    const ops = await opcionesDe(page, 'transferir-origen');
    await recolectar(page);
    const fallas = [];
    for (const c of api) {
      const o = ops.find((x) => x.value === c.id);
      if (!o) { fallas.push(`la cuenta ${c.id.slice(0, 8)} (${c.tipo}) no está en transferir-origen`); continue; }
      if (o.tipo !== c.tipo) fallas.push(`${c.id.slice(0, 8)}: data-tipo=«${o.tipo}», API dice «${c.tipo}»`);
    }
    brazo('TR1', fallas.length === 0, `${fallas.join(' · ')} (opciones=${ops.length})`);
  });

  // TR2 · El RÓTULO VISIBLE. Ancla de texto deliberada y declarada (§ 5): es lo único que prueba
  // que la persona ve el tipo. TR1 sigue verde ante K2 y K3, y por eso TR2 existe.
  await correr('TR2', async () => {
    const u = await titularDosCuentas('tr2');
    const page = await paginaNueva();
    await entrarYTransferir(page, u.email);
    const api = await cuentasApi(u.token);
    const ops = await opcionesDe(page, 'transferir-origen');
    await recolectar(page);
    const humano = { CORRIENTE: 'Corriente', AHORRO: 'Ahorro' };
    const fallas = [];
    for (const c of api) {
      const o = ops.find((x) => x.value === c.id);
      if (!o) { fallas.push(`la cuenta ${c.id.slice(0, 8)} no está en transferir-origen`); continue; }
      if (!o.texto.includes(humano[c.tipo])) fallas.push(`${c.tipo}: el rótulo «${o.texto}» no dice «${humano[c.tipo]}»`);
      if (o.texto.includes(c.tipo)) fallas.push(`${c.tipo}: el rótulo «${o.texto}» muestra el enum crudo`);
    }
    brazo('TR2', fallas.length === 0, fallas.join(' · '));
  });

  // TR3 · Lo mismo en transferir-destino-propia: son dos lugares distintos del artefacto
  // (app.html:359 y :415) y un solo brazo dejaría la mitad ciega. El selector de destino excluye
  // la cuenta de origen, así que se recorre con cada una de las dos como origen: de otro modo
  // sólo se vería uno de los dos tipos y el brazo mediría la mitad de lo que dice medir.
  await correr('TR3', async () => {
    const u = await titularDosCuentas('tr3');
    const api = await cuentasApi(u.token);
    const humano = { CORRIENTE: 'Corriente', AHORRO: 'Ahorro' };
    const fallas = [];
    let vistas = 0;
    for (const origen of [u.corrienteId, u.ahorroId]) {
      const page = await paginaNueva();
      await entrarYTransferir(page, u.email);
      await elegirOrigen(page, origen);
      await irAPasoDestino(page);
      await elegirModo(page, 'propia');
      // F4 · hallazgo #8 (incoherencia interna del árbitro): B2 filtraba el placeholder y TR3 no,
      // así que un `<option value="">Seleccione…</option>` caía en `api.find` → undefined → «ofrece
      // un id ajeno» sobre una app correcta. Un brazo IMPOSIBLE. El placeholder no es un destino:
      // se excluye acá igual que en B2, y el resto de la aserción no se toca.
      const ops = (await opcionesDe(page, 'transferir-destino-propia')).filter((o) => !o.placeholder);
      await recolectar(page);
      for (const o of ops) {
        const c = api.find((x) => x.id === o.value);
        if (!c) { fallas.push(`transferir-destino-propia ofrece un id ajeno: ${o.value.slice(0, 8)}`); continue; }
        vistas++;
        if (o.tipo !== c.tipo) fallas.push(`${c.tipo}: data-tipo=«${o.tipo}»`);
        if (!o.texto.includes(humano[c.tipo])) fallas.push(`${c.tipo}: el rótulo «${o.texto}» no dice «${humano[c.tipo]}»`);
        if (o.texto.includes(c.tipo)) fallas.push(`${c.tipo}: el rótulo «${o.texto}» muestra el enum crudo`);
      }
    }
    if (vistas !== 2) fallas.push(`se esperaba ver las 2 cuentas como destino propio y se vieron ${vistas}`);
    brazo('TR3', fallas.length === 0, fallas.join(' · '));
  });

  // ── P · Transferencia propia (CA6) ───────────────────────────────────────────────────────

  // P1 · Los dos saldos se mueven exactamente el monto (R9, sin comisión), leídos del API Y del
  // data-monto del Resumen: si sólo se leyera la pantalla, un saldo calculado en el cliente pasaría.
  await correr('P1', async () => {
    const u = await titularDosCuentas('p1');
    const page = await paginaNueva();
    await entrarYTransferir(page, u.email);
    await elegirOrigen(page, u.corrienteId);
    await irAPasoDestino(page);
    await elegirModo(page, 'propia');
    await page.selectOption(sel('transferir-destino-propia'), u.ahorroId);
    await montoYRevisar(page, MONTO_PROPIA);
    await enviarYConfirmar(page);
    const exito = await page.waitForSelector(sel('transferir-exito'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    const fallas = [];
    if (!exito) fallas.push(`transferir-exito no apareció (error=${await codigoError(page)})`);
    const api = await cuentasApi(u.token);
    if (saldoDe(api, u.corrienteId) !== SALDO_ORIGEN_TRAS_P1) fallas.push(`API origen=«${saldoDe(api, u.corrienteId)}», esperado ${SALDO_ORIGEN_TRAS_P1}`);
    if (saldoDe(api, u.ahorroId) !== SALDO_DESTINO_TRAS_P1) fallas.push(`API destino=«${saldoDe(api, u.ahorroId)}», esperado ${SALDO_DESTINO_TRAS_P1}`);
    // F2-v: acá había `click(nav-resumen)` y P1 caía con «page.click: Timeout 8000ms»
    // aunque la app está correcta: `nav-resumen` vive DENTRO de `nav-cuentas-menu`, que sólo se
    // despliega al posarse en `nav-cuentas` (el candado hace `hover` antes, verificar-s10-t4:694).
    // Se usa la vía que la cabecera de este archivo ya declaraba: el CLICK en `nav-cuentas`
    // navega al Resumen y recarga las cuentas (`alActivarCuentas`, app.ts), sin depender del hover.
    await page.click(sel('nav-cuentas'));
    // F4 · hallazgo #11 · la tabla del Resumen YA estaba visible con los saldos de antes de la
    // transferencia, así que esperar a que esté visible no esperaba nada y el brazo podía leer los
    // saldos rancios (recaída de la lección de F2-v). Se espera por CONDICIÓN a que el saldo del
    // origen deje de ser el de antes —no a que sea el esperado, que sería auto-cumplirse—, y
    // recién ahí se afirma el valor exacto. Si no se refresca, el brazo cae en rojo con motivo.
    const refrescado = await esperarHasta(async () => {
      const f = await filasResumen(page).catch(() => []);
      return (f.find((x) => x.cuentaId === u.corrienteId)?.monto ?? SALDO_BASE) !== SALDO_BASE;
    }, `el Resumen sigue mostrando el saldo previo (${SALDO_BASE}) del origen`);
    if (!refrescado) fallas.push(`el Resumen no refrescó el saldo del origen tras la transferencia (sigue en ${SALDO_BASE})`);
    const filas = await filasResumen(page);
    await recolectar(page);
    const enPantalla = (id) => filas.find((f) => f.cuentaId === id)?.monto ?? 'AUSENTE';
    if (enPantalla(u.corrienteId) !== SALDO_ORIGEN_TRAS_P1) fallas.push(`Resumen origen=«${enPantalla(u.corrienteId)}»`);
    if (enPantalla(u.ahorroId) !== SALDO_DESTINO_TRAS_P1) fallas.push(`Resumen destino=«${enPantalla(u.ahorroId)}»`);
    brazo('P1', fallas.length === 0, fallas.join(' · '));
  });

  // ── B · Otro banco (CA7, CA8) ────────────────────────────────────────────────────────────

  // B1 · El tercer modo aparece y los controles de los otros dos dejan de estar disponibles (JT1).
  await correr('B1', async () => {
    const u = await titularDosCuentas('b1');
    const page = await paginaNueva();
    await entrarYTransferir(page, u.email);
    await elegirOrigen(page, u.corrienteId);
    await irAPasoDestino(page);
    const fallas = [];
    const radio = await page.$(sel('transferir-destino-modo-banco'));
    if (!radio) { brazo('B1', false, 'transferir-destino-modo-banco no existe'); return; }
    const grupo = await radio.getAttribute('name');
    if (grupo !== 'modoDestino') fallas.push(`el radio está en name=«${grupo}», esperado «modoDestino» (JT1)`);
    const valor = await radio.getAttribute('value');
    if (valor !== 'banco') fallas.push(`value=«${valor}», esperado «banco»`);
    await elegirModo(page, 'banco');
    const CAMPOS_BANCO = ['transferir-destino-banco', 'transferir-destino-numero', 'transferir-destino-tipo'];
    for (const t of CAMPOS_BANCO) {
      if (!(await page.isVisible(sel(t)).catch(() => false))) fallas.push(`${t} no visible en el modo banco`);
    }
    for (const t of ['transferir-destino-propia', 'transferir-destino-id']) {
      if (await page.isVisible(sel(t)).catch(() => false)) fallas.push(`${t} sigue disponible en el modo banco`);
    }
    // D80-2 (§ 2.1) · la otra mitad: B1 sólo comprobaba que los campos del modo
    // banco APARECIERAN. Una implementación que los dejara siempre visibles daba verde, y eso
    // contradice § 4.2 («oculta los controles de los otros dos modos»).
    for (const modo of ['propia', 'otra']) {
      await elegirModo(page, modo);
      for (const t of CAMPOS_BANCO) {
        if (await page.isVisible(sel(t)).catch(() => false)) fallas.push(`${t} sigue visible en el modo «${modo}» (D80-2)`);
      }
    }
    await elegirModo(page, 'banco'); // se recolectan los testids del modo banco, no los de «otra»
    await recolectar(page);
    brazo('B1', fallas.length === 0, fallas.join(' · '));
  });

  // B2 · El catálogo: los cinco códigos son el contrato; los nombres son el ancla de texto que
  // JT3 declara; ZeroFeeBank no puede estar (R6 — un banco no se transfiere a sí mismo por acá).
  await correr('B2', async () => {
    const u = await titularDosCuentas('b2');
    const page = await paginaNueva();
    await entrarYTransferir(page, u.email);
    await elegirOrigen(page, u.corrienteId);
    await irAPasoDestino(page);
    await elegirModo(page, 'banco');
    // F4 · hallazgos #9 y #10: el filtro `o.value !== ''` escondía del conteo Y del chequeo R6 a
    // toda opción con value vacío, así que un «ZeroFeeBank» sin value escapaba a las dos
    // aserciones; y con el `opcionesDe` viejo una opción sin atributo value devolvía su TEXTO como
    // value, lo que hacía fallar «banco ajeno al catálogo» sobre una app correcta.
    // Ahora: R6 y el placeholder se miran sobre TODAS las opciones; el conteo, sobre las reales.
    const todas = await opcionesDe(page, 'transferir-destino-banco');
    const ops = todas.filter((o) => !o.placeholder);
    const marcadores = todas.filter((o) => o.placeholder);
    await recolectar(page);
    const fallas = [];
    if (ops.length !== CATALOGO.length) fallas.push(`${ops.length} opciones de banco, esperadas ${CATALOGO.length}`);
    if (marcadores.length > 1) fallas.push(`${marcadores.length} opciones sin value: se admite a lo sumo un placeholder`);
    for (const [codigo, nombre] of CATALOGO) {
      const o = ops.find((x) => x.value === codigo);
      if (!o) { fallas.push(`falta el banco ${codigo}`); continue; }
      if (!o.texto.includes(nombre)) fallas.push(`${codigo}: el rótulo «${o.texto}» no dice «${nombre}»`);
    }
    const codigos = new Set(CATALOGO.map(([c]) => c));
    for (const o of ops) if (!codigos.has(o.value)) fallas.push(`banco ajeno al catálogo: «${o.value}»`);
    for (const o of todas) if (/zerofeebank/i.test(o.texto) || /zerofeebank/i.test(o.value ?? '')) fallas.push(`el catálogo ofrece ZeroFeeBank («${o.texto}»)`);

    // D80-1 (§ 2.1) · hasta F3 NINGÚN brazo miraba `transferir-destino-tipo`, y
    // todos usaban AHORRO: una pantalla que sólo ofreciera AHORRO —o tipos que el API no acepta—
    // pasaba los 18 brazos en verde. Se audita contra TIPOS_EXTERNOS (otros-bancos.ts:19), que es
    // dato del dominio y no se inventa.
    const tipos = await opcionesDe(page, 'transferir-destino-tipo');
    const tiposReales = tipos.filter((o) => !o.placeholder);
    if (tipos.filter((o) => o.placeholder).length > 1) fallas.push('transferir-destino-tipo: más de un placeholder');
    if (tiposReales.length !== TIPOS_EXTERNOS.length) fallas.push(`transferir-destino-tipo ofrece ${tiposReales.length} tipos, esperados ${TIPOS_EXTERNOS.length} (${TIPOS_EXTERNOS.join('|')})`);
    for (const t of TIPOS_EXTERNOS) if (!tiposReales.some((o) => o.value === t)) fallas.push(`transferir-destino-tipo no ofrece ${t} (D80-1)`);
    for (const o of tiposReales) if (!TIPOS_EXTERNOS.includes(o.value)) fallas.push(`transferir-destino-tipo ofrece un tipo ajeno: «${o.value}»`);
    brazo('B2', fallas.length === 0, fallas.join(' · '));
  });

  // B3 · CA8 · El texto del tope es literal y SÓLO se muestra en el modo banco (K10 y K11), y no
  // aparece ningún cupo restante (JT9). El check por ausencia versiona sus términos arriba.
  await correr('B3', async () => {
    const u = await titularDosCuentas('b3');
    const page = await paginaNueva();
    await entrarYTransferir(page, u.email);
    await elegirOrigen(page, u.corrienteId);
    await irAPasoDestino(page);
    const fallas = [];
    for (const modo of ['propia', 'otra']) {
      await elegirModo(page, modo);
      if (await page.isVisible(sel('transferir-banco-tope')).catch(() => false)) {
        fallas.push(`transferir-banco-tope visible en el modo «${modo}» (JT9: es del modo banco)`);
      }
    }
    await llenarBanco(page);
    const tope = await page.waitForSelector(sel('transferir-banco-tope'), { state: 'visible', timeout: ESPERA_MS })
      .then((h) => h, () => null);
    if (!tope) {
      fallas.push('transferir-banco-tope no visible en el modo banco');
    } else {
      const texto = (await tope.textContent() ?? '').trim();
      if (texto !== TOPE_TEXTO) fallas.push(`texto=«${texto}», esperado exactamente «${TOPE_TEXTO}»`);
    }
    // F4 · hallazgos #6 y #7 · acá decía `page.textContent('#panel-destino').catch(() => '')`, y eso
    // tenía los dos defectos que la ley del arnés nombra: (a) `#panel-destino` es un `id`, NO un
    // testid, así que no es contrato versionado —si lo renombran, el check mide el texto de nada y
    // dice VERDE—, y (b) el ámbito era un solo panel, mientras JT9 habla de la pantalla: un cupo
    // pintado en Revisar quedaba invisible. Se mide sobre `transferir-form` (testid versionado, y
    // contiene los tres pasos), SIN catch: si no está, es rojo con motivo.
    const textoDe = async (testid) => {
      const t = await page.textContent(sel(testid)).catch(() => null);
      if (t === null) { fallas.push(`no se pudo leer el texto de ${testid}: el check por ausencia mediría NADA`); return ''; }
      return t;
    };
    const buscarCupo = (texto, donde) => {
      const delatores = TERMINOS_CUPO.filter((t) => texto.toLowerCase().includes(t));
      if (delatores.length > 0) fallas.push(`${donde} insinúa cupo restante: [${delatores.join(', ')}] (lista versionada de ${TERMINOS_CUPO.length} términos)`);
    };
    buscarCupo(await textoDe('transferir-form'), 'el paso Destino');
    // …y el paso Revisar, que es donde el cupo se escaparía de un check encerrado en Destino.
    await montoYRevisar(page, MONTO_BANCO);
    buscarCupo(await textoDe('transferir-form'), 'el paso Revisar');
    await recolectar(page);
    brazo('B3', fallas.length === 0, fallas.join(' · '));
  });

  // B4 · CA7 · La confirmación se RELEE. Se cuenta la llamada al GET y se compara contra el CUERPO
  // que ese GET devolvió: sin el conteo, una pantalla que pintara el formulario pasaría igual (K7).
  await correr('B4', async () => {
    const u = await titularDosCuentas('b4');
    const page = await paginaNueva();
    const obs = observarOtrosBancos(page);
    // F4 · hallazgo #2 · El DTO del 201 y el del GET traen los MISMOS campos
    // (transferencias-otros-bancos.dto.ts:8-22), así que comparar la pantalla contra el cuerpo del
    // GET no distinguía «releer» (JT6) de «pintar el cuerpo del POST»: las dos daban verde para
    // siempre, y la única señal era `gets.length`, que sólo dice que la llamada ocurrió.
    // El árbitro cambia UN valor en la respuesta del GET —un testigo— igual que B7(b) inyecta su
    // 400: sólo una pantalla que de verdad pinta lo que el GET devolvió muestra el testigo.
    await page.route('**/transferencias/otros-bancos/*', async (route) => {
      if (route.request().method() !== 'GET') { await route.continue(); return; }
      const res = await route.fetch();
      const j = await res.json().catch(() => null);
      if (!j) { await route.fulfill({ response: res }); return; }
      await route.fulfill({ status: res.status(), contentType: 'application/json', body: JSON.stringify({ ...j, numeroCuenta: NUMERO_TESTIGO }) });
    });
    await entrarYTransferir(page, u.email);
    await elegirOrigen(page, u.corrienteId);
    await irAPasoDestino(page);
    await llenarBanco(page);
    await montoYRevisar(page, MONTO_BANCO);
    await enviarYConfirmar(page);
    const llego = await page.waitForSelector(sel('transferir-banco-nombre'), { state: 'visible', timeout: ESPERA_MS })
      .then(() => true, () => false);
    // M1 · el cuerpo del GET y el id del POST se resuelven en el listener de red, que es asíncrono:
    // se esperan por CONDICIÓN antes de leerlos. Leerlos y rezar era la carrera que los dos
    // auditores cazaron a la vez (único solape de F3).
    await esperarHasta(() => obs.cuerpoGet !== null, 'el cuerpo del GET de confirmación');
    await esperarHasta(() => obs.idPost !== null, 'el id devuelto por el POST 201');
    await recolectar(page);
    const fallas = [];
    if (!llego) fallas.push(`la confirmación no apareció (error=${await codigoError(page)})`);
    const post = obs.posts.at(-1);
    if (!post) fallas.push('no salió ningún POST /transferencias/otros-bancos');
    else {
      if (post.status !== 201) fallas.push(`el POST respondió ${post.status}`);
      if (typeof post.cuerpo?.monto !== 'string') fallas.push(`el monto viajó como ${typeof post.cuerpo?.monto}, y D1 exige string decimal`);
    }
    if (obs.gets.length === 0) fallas.push('la pantalla NUNCA llamó a GET /transferencias/otros-bancos/:id (JT6): estaría pintando el formulario');
    // F4 · hallazgo #3 · el brazo sólo miraba `gets.length === 0`: nunca comparaba el `:id` pedido
    // contra el que devolvió el 201, así que un GET a un id fijo o viejo pasaba en verde.
    else if (!obs.idPost) fallas.push('el POST 201 no devolvió `id`: no hay contra qué comparar el GET');
    else if (!obs.gets.some((g2) => g2.id === obs.idPost)) {
      fallas.push(`la pantalla pidió GET /:id con [${obs.gets.map((g2) => g2.id).join(', ')}] y el 201 devolvió «${obs.idPost}»`);
    }
    const g = obs.cuerpoGet;
    if (!g) fallas.push('el GET de confirmación no devolvió 200 con cuerpo');
    else {
      const c = await confirmacion(page);
      const par = [
        ['nombre', 'data-banco', c.nombre, g.banco],
        ['numero', 'data-numero', c.numero, g.numeroCuenta],
        ['tipo', 'data-tipo', c.tipo, g.tipoCuenta],
        ['monto', 'data-monto', c.monto, g.monto],
      ];
      for (const [cual, attr, leido, esperado] of par) {
        if (!leido) fallas.push(`transferir-banco-${cual} no está en el DOM`);
        else if (leido.attr !== esperado) fallas.push(`${cual}: ${attr}=«${leido.attr}», el GET dice «${esperado}»`);
      }
      // JT7 · el rótulo visible va DENTRO del mismo elemento del atributo: sin esa co-ubicación el
      // brazo de texto es imposible (lo demostró la auditoría de robustez).
      const nombreCatalogo = (CATALOGO.find(([cod]) => cod === g.banco) ?? [])[1];
      if (c.nombre && nombreCatalogo && !c.nombre.texto.includes(nombreCatalogo)) {
        fallas.push(`transferir-banco-nombre muestra «${c.nombre.texto}» y no el nombre «${nombreCatalogo}»`);
      }
      // El testigo, dicho con todas sus letras para que el rojo hable (hallazgo #2).
      if (c.numero?.attr === NUMERO_VALIDO) {
        fallas.push(`transferir-banco-numero muestra «${NUMERO_VALIDO}», que es lo ESCRITO en el formulario; el GET devolvió «${NUMERO_TESTIGO}»: la pantalla no relee (JT6)`);
      }
    }
    // JT9 · el cupo restante tampoco puede asomar en la confirmación, que es el tramo que el check
    // de B3 no alcanza a ver (hallazgo #6: «si el cupo se pinta en Revisar o en la confirmación»).
    const textoConf = (await page.textContent('body').catch(() => null)) ?? '';
    const cupoConf = TERMINOS_CUPO.filter((t) => textoConf.toLowerCase().includes(t));
    if (cupoConf.length > 0) fallas.push(`la confirmación insinúa cupo restante: [${cupoConf.join(', ')}]`);
    brazo('B4', fallas.length === 0, fallas.join(' · '));
  });

  // B5 · CA7 · El dinero se movió exactamente el monto y NINGUNA otra cuenta del titular se movió.
  // Leído del API, no de la pantalla (K16: una pantalla puede restar sola sin que el banco lo haga).
  await correr('B5', async () => {
    const u = await titularDosCuentas('b5');
    const page = await paginaNueva();
    await entrarYTransferir(page, u.email);
    await elegirOrigen(page, u.corrienteId);
    await irAPasoDestino(page);
    await llenarBanco(page);
    await montoYRevisar(page, MONTO_BANCO);
    await enviarYConfirmar(page);
    await page.waitForSelector(sel('transferir-banco-nombre'), { state: 'visible', timeout: ESPERA_MS })
      .catch(() => null);
    await recolectar(page);
    const api = await cuentasApi(u.token);
    const fallas = [];
    if (saldoDe(api, u.corrienteId) !== SALDO_TRAS_BANCO) fallas.push(`origen=«${saldoDe(api, u.corrienteId)}», esperado ${SALDO_TRAS_BANCO}`);
    if (saldoDe(api, u.ahorroId) !== SALDO_BASE) fallas.push(`la AHORRO se movió a «${saldoDe(api, u.ahorroId)}», esperado ${SALDO_BASE}`);
    brazo('B5', fallas.length === 0, fallas.join(' · '));
  });

  // B6 · R10 · La fecha: el ISO crudo en el atributo (para la suite) y «UTC» en el texto (para la
  // persona). K12 —hora local sin rótulo— muere acá.
  await correr('B6', async () => {
    const u = await titularDosCuentas('b6');
    const page = await paginaNueva();
    const obs = observarOtrosBancos(page);
    await entrarYTransferir(page, u.email);
    await elegirOrigen(page, u.corrienteId);
    await irAPasoDestino(page);
    await llenarBanco(page);
    await montoYRevisar(page, MONTO_BANCO);
    await enviarYConfirmar(page);
    await page.waitForSelector(sel('transferir-banco-fecha'), { state: 'visible', timeout: ESPERA_MS })
      .catch(() => null);
    // M1 · misma carrera que en B4: el cuerpo del GET llega por el listener de red.
    await esperarHasta(() => obs.cuerpoGet !== null, 'el cuerpo del GET de confirmación (B6)');
    await recolectar(page);
    const c = await confirmacion(page);
    const fallas = [];
    if (!obs.cuerpoGet) fallas.push('el GET de confirmación no devolvió cuerpo: no hay contra qué comparar');
    else if (!c.fecha) fallas.push('transferir-banco-fecha no está en el DOM');
    else {
      if (c.fecha.attr !== obs.cuerpoGet.realizadaEn) fallas.push(`data-realizada-en=«${c.fecha.attr}», el GET dice «${obs.cuerpoGet.realizadaEn}»`);
      if (!c.fecha.texto.endsWith('UTC')) fallas.push(`el texto visible «${c.fecha.texto}» no termina en «UTC» (R10)`);
    }
    brazo('B6', fallas.length === 0, fallas.join(' · '));
  });

  // B7 · C4 · Estados de carga explícitos. Enmendado en F2 con el humano (cabecera, nota 2): la
  // vuelta se mide sobre los dos finales que el artefacto SÍ puede alcanzar.
  //   ida     : POST retenido por el árbitro → enviando + aria-busy + los tres campos disabled
  //   tras 201: el formulario se desmonta y aparece la confirmación
  //   tras 4xx: data-estado="error" (lo que T4 del candado afirma) y los campos re-habilitados
  await correr('B7', async () => {
    const fallas = [];
    const leerCampos = (page) => page.evaluate(() => ['transferir-destino-banco', 'transferir-destino-numero', 'transferir-destino-tipo']
      .map((t) => {
        const e = document.querySelector(`[data-testid="${t}"]`);
        return { t, presente: !!e, disabled: e ? e.disabled === true : null };
      }));

    // (a) ida + final con 201
    {
      const u = await titularDosCuentas('b7a');
      const page = await paginaNueva();
      let vistoPost; const postEnVuelo = new Promise((r) => { vistoPost = r; });
      let soltar; const permiso = new Promise((r) => { soltar = r; });
      await page.route('**/transferencias/otros-bancos', async (route) => {
        if (route.request().method() !== 'POST') { await route.continue(); return; }
        vistoPost();
        await permiso;
        await route.continue();
      });
      await entrarYTransferir(page, u.email);
      await elegirOrigen(page, u.corrienteId);
      await irAPasoDestino(page);
      await llenarBanco(page);
      await montoYRevisar(page, MONTO_BANCO);
      await enviarYConfirmar(page);
      await postEnVuelo;
      await page.waitForSelector(`${sel('transferir-form')}[data-estado="enviando"]`, { timeout: ESPERA_MS })
        .catch(() => fallas.push('el form no llegó a data-estado="enviando" con el POST retenido (C4)'));
      const busy = await page.getAttribute(sel('transferir-form'), 'aria-busy').catch(() => null);
      if (busy !== 'true') fallas.push(`aria-busy=«${busy}», esperado «true» durante el envío`);
      for (const c of await leerCampos(page)) {
        if (!c.presente) fallas.push(`${c.t} desapareció durante el envío`);
        else if (c.disabled !== true) fallas.push(`${c.t} no quedó disabled durante el envío`);
      }
      soltar();
      const conf = await page.waitForSelector(sel('transferir-banco-nombre'), { state: 'visible', timeout: ESPERA_MS })
        .then(() => true, () => false);
      if (!conf) fallas.push('tras el 201 no apareció la confirmación');
      if (await page.$(sel('transferir-form'))) fallas.push('tras el 201 el formulario sigue montado (la confirmación lo reemplaza, app.html:265/:299)');
      await recolectar(page);
    }

    // (b) final con 4xx. El rechazo lo inyecta el árbitro: es una respuesta DEFINITIVA del servidor
    // simulada para medir la vuelta del formulario, y no mueve un centavo.
    {
      const u = await titularDosCuentas('b7b');
      const page = await paginaNueva();
      await page.route('**/transferencias/otros-bancos', async (route) => {
        if (route.request().method() !== 'POST') { await route.continue(); return; }
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ codigo: 'BANCO_NO_PERMITIDO', mensaje: 'rechazo inyectado por el árbitro (B7)' }),
        });
      });
      await entrarYTransferir(page, u.email);
      await elegirOrigen(page, u.corrienteId);
      await irAPasoDestino(page);
      await llenarBanco(page);
      await montoYRevisar(page, MONTO_BANCO);
      await enviarYConfirmar(page);
      const vuelta = await page.waitForSelector(`${sel('transferir-form')}[data-estado="error"]`, { timeout: ESPERA_MS })
        .then(() => true, () => false);
      if (!vuelta) {
        const est = await page.getAttribute(sel('transferir-form'), 'data-estado').catch(() => 'AUSENTE');
        fallas.push(`tras el 4xx el form quedó en data-estado=«${est}», esperado «error» (T4 del candado)`);
      }
      // D80-3 (§ 2.1) · acá se leía `disabled` de los campos de Destino
      // mientras la persona está en REVISAR: si la app renderiza los pasos con `@if`, esos campos
      // no están en el DOM y el brazo daba rojo sobre una app correcta — un brazo IMPOSIBLE.
      // La opción C afirma la INTENCIÓN y es más fuerte: en Revisar se mira el
      // estado del formulario y el error tipado; después se VUELVE al paso Destino y se comprueba
      // que la persona puede de verdad reintentar. No dicta `@if` ni `[hidden]`.
      const busyErr = await page.getAttribute(sel('transferir-form'), 'aria-busy').catch(() => null);
      if (busyErr !== 'false') fallas.push(`tras el 4xx aria-busy=«${busyErr}», esperado «false» (C4: ya no está ocupada)`);
      const codigo = await codigoError(page);
      if (!codigo) fallas.push('tras el 4xx no hay transferir-error[data-codigo]: el error de negocio tiene que salir con código tipado (C5)');
      await page.click(sel('transferir-revisar-volver'));
      await page.waitForSelector(`${sel('transferir-paso-destino')}[aria-selected="true"]`, { timeout: ESPERA_MS })
        .catch(() => fallas.push('tras el 4xx no se pudo volver al paso Destino'));
      for (const c of await leerCampos(page)) {
        if (!c.presente) fallas.push(`${c.t} no está en el paso Destino tras el 4xx`);
        else if (c.disabled !== false) fallas.push(`${c.t} quedó disabled tras el 4xx: la persona no puede corregir`);
      }
      // …y editables de verdad, no sólo «no disabled»: se reescriben los tres y se relee el valor.
      const reintento = await page.evaluate(() => {
        const leer = (t) => document.querySelector(`[data-testid="${t}"]`);
        const n = leer('transferir-destino-numero');
        if (!n) return { ok: false, motivo: 'transferir-destino-numero no está' };
        return { ok: !n.readOnly && !n.disabled, motivo: `readOnly=${n.readOnly} disabled=${n.disabled}` };
      });
      if (!reintento.ok) fallas.push(`tras el 4xx el número no es editable (${reintento.motivo})`);
      else {
        await page.fill(sel('transferir-destino-numero'), NUMERO_TESTIGO).catch(() => fallas.push('tras el 4xx no se pudo escribir en transferir-destino-numero'));
        const v = await page.inputValue(sel('transferir-destino-numero')).catch(() => null);
        if (v !== NUMERO_TESTIGO) fallas.push(`tras el 4xx el número no aceptó la corrección: quedó «${v}»`);
      }
      await recolectar(page);
    }
    brazo('B7', fallas.length === 0, fallas.join(' · '));
  });

  // B8 · NACE EN F4 por el hallazgo #1 de la auditoría: § 4.2 exige
  // literalmente que «el paso Revisar muestra banco (nombre visible), número y tipo antes de
  // enviar» (HU-04 J3) y NINGÚN brazo lo miraba — `montoYRevisar` sólo esperaba que la pestaña
  // quedara `aria-selected`. Un paso Revisar vacío pasaba los 18 brazos: un criterio de aceptación
  // entero sin árbitro. Contrato de pantalla en JT13 (§ 2.2), con el código en el atributo y el
  // rótulo visible DENTRO del mismo elemento, que es la co-ubicación necesaria.
  // NACE SIN CALIBRAR: su defecto es K19 y se mide en F6.
  await correr('B8', async () => {
    const u = await titularDosCuentas('b8');
    const page = await paginaNueva();
    const obs = observarOtrosBancos(page);
    await entrarYTransferir(page, u.email);
    await elegirOrigen(page, u.corrienteId);
    await irAPasoDestino(page);
    await llenarBanco(page);
    await montoYRevisar(page, MONTO_BANCO);
    const visto = await page.evaluate(() => {
      const leer = (tid, attr) => {
        const e = document.querySelector(`[data-testid="${tid}"]`);
        return e ? { attr: e.getAttribute(attr), texto: (e.textContent ?? '').trim() } : null;
      };
      return {
        banco: leer('transferir-revisar-banco', 'data-banco'),
        numero: leer('transferir-revisar-numero', 'data-numero'),
        tipo: leer('transferir-revisar-tipo', 'data-tipo'),
      };
    });
    await recolectar(page);
    const fallas = [];
    const nombreBanco = (CATALOGO.find(([c]) => c === BANCO_FELIZ) ?? [])[1];
    const tipoHumano = { CORRIENTE: 'Corriente', AHORRO: 'Ahorro' }[TIPO_FELIZ];
    const esperado = [
      ['transferir-revisar-banco', 'data-banco', visto.banco, BANCO_FELIZ, nombreBanco],
      ['transferir-revisar-numero', 'data-numero', visto.numero, NUMERO_VALIDO, NUMERO_VALIDO],
      ['transferir-revisar-tipo', 'data-tipo', visto.tipo, TIPO_FELIZ, tipoHumano],
    ];
    for (const [tid, attr, leido, codigo, rotulo] of esperado) {
      if (!leido) { fallas.push(`${tid} no está en el paso Revisar: § 4.2 exige mostrar banco, número y tipo ANTES de enviar`); continue; }
      if (leido.attr !== codigo) fallas.push(`${tid}: ${attr}=«${leido.attr}», se eligió «${codigo}»`);
      if (!leido.texto.includes(rotulo)) fallas.push(`${tid}: el rótulo visible «${leido.texto}» no dice «${rotulo}» (JT13: el código en el atributo, el rótulo dentro del mismo elemento)`);
    }
    // El banco y el tipo se le muestran a la PERSONA: el enum crudo no es un rótulo (misma regla
    // que TR2). El número sí se muestra tal cual, por eso no entra en esta comprobación.
    if (visto.banco && visto.banco.texto.includes(BANCO_FELIZ)) fallas.push(`transferir-revisar-banco muestra el código crudo «${BANCO_FELIZ}» en vez del nombre «${nombreBanco}»`);
    if (visto.tipo && visto.tipo.texto.includes(TIPO_FELIZ)) fallas.push(`transferir-revisar-tipo muestra el enum crudo «${TIPO_FELIZ}»`);
    // «ANTES de enviar»: el paso Revisar no puede haber mandado nada todavía.
    if (obs.posts.length > 0) fallas.push(`el paso Revisar ya había enviado ${obs.posts.length} POST: § 4.2 dice ANTES de enviar`);
    brazo('B8', fallas.length === 0, fallas.join(' · '));
  });

  // ── X · Tope diario (CA9, CA10) ──────────────────────────────────────────────────────────
  // El reloj se FIJA por la costura (C2). Sin ella, «el día siguiente» dependería del reloj de
  // pared y el brazo sería intermitente a medianoche. Las dos ramas desfijan siempre al salir.

  // X1 · CA9 · El borde inclusivo por los DOS lados: 150,00 + 50,00 = 200,00 pasan; 0,01 más, no.
  await correr('X1', async () => {
    const hoy = new Date().toISOString().slice(0, 10);
    try {
      await relojFijar(`${hoy}T12:00:00.000Z`);
      const u = await titularDosCuentas('x1');
      const fallas = [];
      // Los tres envíos van por la UI, cada uno en una página nueva: tras un 201 el formulario se
      // desmonta (app.html:265/:299), así que reusar la misma página mediría otra cosa.
      for (const monto of [X1_PRIMERA, X1_SEGUNDA]) {
        const page = await paginaNueva();
        const obs = observarOtrosBancos(page);
        await entrarYTransferir(page, u.email);
        await elegirOrigen(page, u.corrienteId);
        await irAPasoDestino(page);
        await llenarBanco(page);
        await montoYRevisar(page, monto);
        await enviarYConfirmar(page);
        await page.waitForSelector(sel('transferir-banco-nombre'), { state: 'visible', timeout: ESPERA_MS }).catch(() => null);
        await recolectar(page);
        const st = obs.posts.at(-1)?.status ?? 'sin POST';
        if (st !== 201) fallas.push(`el envío de ${monto} respondió ${st} (${await codigoError(page)})`);
      }
      const antes = saldoDe(await cuentasApi(u.token), u.corrienteId);
      const page = await paginaNueva();
      await entrarYTransferir(page, u.email);
      await elegirOrigen(page, u.corrienteId);
      await irAPasoDestino(page);
      await llenarBanco(page);
      await montoYRevisar(page, X1_TERCERA);
      await enviarYConfirmar(page);
      const err = await page.waitForSelector(`${sel('transferir-error')}[data-codigo="TOPE_DIARIO_EXCEDIDO"]`,
        { state: 'visible', timeout: ESPERA_MS }).then(() => true, () => false);
      if (!err) fallas.push(`el tercer envío no mostró TOPE_DIARIO_EXCEDIDO (código=${await codigoError(page)})`);
      // K17: mostrar el error Y la confirmación a la vez. Una pantalla así miente en verde.
      if (await page.$(sel('transferir-banco-nombre'))) fallas.push('el envío rechazado mostró IGUAL la confirmación de éxito');
      await recolectar(page);
      const despues = saldoDe(await cuentasApi(u.token), u.corrienteId);
      if (antes !== despues) fallas.push(`el saldo se movió en el intento rechazado: ${antes} → ${despues}`);
      brazo('X1', fallas.length === 0, `${fallas.join(' · ')} (saldo ${antes} → ${despues})`);
    } finally {
      await relojDesfijar();
    }
  });

  // X2 · CA10 · Al día UTC siguiente el tope vuelve a estar entero. El tope del día anterior se
  // agota por API y la preparación lo AFIRMA (0,01 más → TOPE_DIARIO_EXCEDIDO): sin esa
  // afirmación, X2 pasaría en verde sobre un sistema que nunca tuvo tope.
  // El token se renueva tras mover el reloj: dura 60 min (auth.service.ts:16) y el salto de día
  // lo dejaría expirado, que es un rojo que no habla del tope.
  await correr('X2', async () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const manana = new Date(`${hoy}T00:00:00.000Z`);
    manana.setUTCDate(manana.getUTCDate() + 1);
    const diaSiguiente = manana.toISOString().slice(0, 10);
    try {
      await relojFijar(`${hoy}T12:00:00.000Z`);
      const u = await titularDosCuentas('x2');
      await topeAgotado(u);
      await relojFijar(`${diaSiguiente}T00:00:00.000Z`);
      const page = await paginaNueva();
      const obs = observarOtrosBancos(page);
      await entrarYTransferir(page, u.email);
      await elegirOrigen(page, u.corrienteId);
      await irAPasoDestino(page);
      await llenarBanco(page);
      await montoYRevisar(page, X2_MONTO);
      await enviarYConfirmar(page);
      const conf = await page.waitForSelector(sel('transferir-banco-nombre'), { state: 'visible', timeout: ESPERA_MS })
        .then(() => true, () => false);
      await recolectar(page);
      const fallas = [];
      const st = obs.posts.at(-1)?.status ?? 'sin POST';
      if (st !== 201) fallas.push(`el envío del día siguiente respondió ${st} (${await codigoError(page)})`);
      if (!conf) fallas.push('no apareció la confirmación en el día siguiente');
      brazo('X2', fallas.length === 0, `${fallas.join(' · ')} (día ${hoy} → ${diaSiguiente})`);
    } finally {
      await relojDesfijar();
    }
  });

  // ── E · Errores y ausencia de validación de cliente (CA11, CA12) ─────────────────────────
  // Nota de medición: S-22 § 7 dejó fuera el listado de transferencias a otros bancos, así que
  // «cero transferencias nuevas» no se puede contar con un GET de lista. Se mide por lo que sí
  // expone el API —el saldo, que es derivado del ledger (D2)— más la ausencia de confirmación.

  const brazoNumeroInvalido = (id, numero) => correr(id, async () => {
    const u = await titularDosCuentas(id.toLowerCase());
    const page = await paginaNueva();
    const obs = observarOtrosBancos(page);
    await entrarYTransferir(page, u.email);
    await elegirOrigen(page, u.corrienteId);
    await irAPasoDestino(page);
    await llenarBanco(page, { numero });
    await montoYRevisar(page, MONTO_BANCO);
    await enviarYConfirmar(page);
    const err = await page.waitForSelector(`${sel('transferir-error')}[data-codigo="NUMERO_CUENTA_EXTERNA_INVALIDO"]`,
      { state: 'visible', timeout: ESPERA_MS }).then(() => true, () => false);
    await recolectar(page);
    const fallas = [];
    if (!err) fallas.push(`no se mostró NUMERO_CUENTA_EXTERNA_INVALIDO (código=${await codigoError(page)})`);
    // El número tiene que llegar ENTERO al API: si el front lo recorta, el rechazo sería de otra cosa.
    const enviado = obs.posts.at(-1)?.cuerpo?.numeroCuenta;
    if (enviado !== undefined && enviado !== numero) fallas.push(`el front envió «${enviado}» en vez de «${numero}»`);
    if (await page.$(sel('transferir-banco-nombre'))) fallas.push('apareció la confirmación pese al rechazo');
    const api = await cuentasApi(u.token);
    if (saldoDe(api, u.corrienteId) !== SALDO_BASE) fallas.push(`el saldo se movió a «${saldoDe(api, u.corrienteId)}»`);
    brazo(id, fallas.length === 0, fallas.join(' · '));
  });

  // E1 · CA11 · Número con letras.
  await brazoNumeroInvalido('E1', NUMERO_LETRAS);
  // E2 · CA11 · Un dígito sobre el máximo. Declarado SIN defecto de calibración propio en § 6
  // (junto con X2 y E4): la auditoría de F3 decide si le nace uno.
  await brazoNumeroInvalido('E2', NUMERO_21);

  // E3 · CA11/JT5 · La ausencia de validación de cliente, sobre el DOM RENDERIZADO. Es lo que hace
  // ALCANZABLES E1 y E2 desde la UI: con un maxlength="20" (K15) el brazo del número de 21 dígitos
  // sería imposible —daría rojo sobre una app correcta—, previniendo falsos positivos.
  await correr('E3', async () => {
    const u = await titularDosCuentas('e3');
    const page = await paginaNueva();
    await entrarYTransferir(page, u.email);
    await elegirOrigen(page, u.corrienteId);
    await irAPasoDestino(page);
    await llenarBanco(page);
    // F4 · hallazgos #4 y #5, el sitio más incómodo del veredicto de F3:
    //  #5 · `hasAttribute` NO ve un binding de Angular. `[maxlength]="20"` escribe la PROPIEDAD y
    //       no el atributo, así que K15 —el defecto que E3 existe para cazar— se le escapaba: un
    //       árbitro ciego a su propio defecto declarado. Ahora mira el atributo Y la propiedad
    //       efectiva, que es lo que el navegador obedece.
    //  #4 · JT4 dice «NINGÚN campo» y E3 sólo miraba los tres del destino: entra `transferir-monto`.
    const hallazgos = await page.evaluate(({ prohibidos, campos }) => {
      // Valor de reposo de cada propiedad: si difiere, la validación está puesta aunque el atributo
      // no exista. `minLength`/`maxLength` valen -1 cuando no se fijaron; el resto, cadena vacía.
      const EN_REPOSO = { required: false, pattern: '', minlength: -1, maxlength: -1, min: '', max: '', step: '' };
      const PROP = { required: 'required', pattern: 'pattern', minlength: 'minLength', maxlength: 'maxLength', min: 'min', max: 'max', step: 'step' };
      const out = { novalidate: null, campos: [] };
      const form = document.querySelector('[data-testid="transferir-form"]');
      // El `novalidate` del form también puede llegar como binding (M2 del veredicto): se miran los dos.
      out.novalidate = form ? (form.hasAttribute('novalidate') || form.noValidate === true) : null;
      for (const t of campos) {
        const e = document.querySelector(`[data-testid="${t}"]`);
        if (!e) { out.campos.push({ t, presente: false, tiene: [] }); continue; }
        const tiene = [];
        for (const a of prohibidos) {
          const porAtributo = e.hasAttribute(a);
          const prop = PROP[a];
          const valor = prop in e ? e[prop] : undefined;
          const porPropiedad = valor !== undefined && valor !== EN_REPOSO[a];
          if (porAtributo || porPropiedad) tiene.push(`${a}${!porAtributo ? ' (binding)' : ''}=${String(valor)}`);
        }
        out.campos.push({ t, presente: true, tiene });
      }
      return out;
    }, { prohibidos: ATRIBUTOS_PROHIBIDOS, campos: CAMPOS_SIN_VALIDACION });
    await recolectar(page);
    const fallas = [];
    if (hallazgos.novalidate === null) fallas.push('transferir-form no está en el DOM');
    else if (!hallazgos.novalidate) fallas.push('transferir-form no lleva novalidate (JT4)');
    for (const c of hallazgos.campos) {
      if (!c.presente) fallas.push(`${c.t} no está en el DOM`);
      else if (c.tiene.length > 0) fallas.push(`${c.t} trae [${c.tiene.join(', ')}]`);
    }
    brazo('E3', fallas.length === 0, `${fallas.join(' · ')} (lista versionada: ${ATRIBUTOS_PROHIBIDOS.join('|')})`);
  });

  // E4 · CA12 · El id de una cuenta de SISTEMA pegado en «Otras cuentas» → CUENTA_NO_ENCONTRADA
  // (HU-01 V4, S-21 C3). El id sale de la costura —SeedRespuesta.cuentaSistemaId,
  // costuras.service.ts:43—, no de la BD ni del DOM (C1). Declarado SIN defecto propio en § 6:
  // lo que podría fallar es el `seed`, y eso ya lo calibra calibrar:s23.
  await correr('E4', async () => {
    const r = await pedir('POST', '/__test__/seed', JSON_H, { escenario: 'cuenta-unica' });
    if (r.status !== 201) throw new Error(`preparación: POST /__test__/seed → ${r.status} ${r.body}`);
    const cuentaSistemaId = JSON.parse(r.body).cuentaSistemaId;
    if (typeof cuentaSistemaId !== 'string' || cuentaSistemaId.length === 0) {
      throw new Error('preparación: el seed no devolvió cuentaSistemaId');
    }
    const u = await titularDosCuentas('e4');
    const page = await paginaNueva();
    await entrarYTransferir(page, u.email);
    await elegirOrigen(page, u.corrienteId);
    await irAPasoDestino(page);
    await elegirModo(page, 'otra');
    await page.fill(sel('transferir-destino-id'), cuentaSistemaId);
    await montoYRevisar(page, MONTO_BANCO);
    await enviarYConfirmar(page);
    const err = await page.waitForSelector(`${sel('transferir-error')}[data-codigo="CUENTA_NO_ENCONTRADA"]`,
      { state: 'visible', timeout: ESPERA_MS }).then(() => true, () => false);
    await recolectar(page);
    const fallas = [];
    if (!err) fallas.push(`no se mostró CUENTA_NO_ENCONTRADA (código=${await codigoError(page)})`);
    const api = await cuentasApi(u.token);
    if (saldoDe(api, u.corrienteId) !== SALDO_BASE) fallas.push(`el saldo se movió a «${saldoDe(api, u.corrienteId)}»`);
    brazo('E4', fallas.length === 0, fallas.join(' · '));
  });

  // ── N1 · Contrato de testids sobre el ARTEFACTO RENDERIZADO ──────────────────────────────
  // Va al final a propósito: mide lo que se recolectó en los 17 recorridos de arriba. Un grep del
  // código fuente pasa en verde con un componente que nunca se monta (RESTRICCIONES.md § 2).
  await correr('N1', async () => {
    const faltan = LISTA_S17T.filter((t) => !vistos.has(t));
    const sobran = [...vistos].filter((t) => !UNION.has(t));
    // `vistos` se llena con los recorridos anteriores: si un brazo cayó antes de recolectar, sus
    // testids no entran y N1 diría «faltan» por culpa de OTRO brazo. El veredicto NO se relaja
    // —sigue rojo—, pero el motivo deja de mentir sobre la causa.
    const rojosPrevios = resultados.filter((r) => !r.ok).map((r) => r.id);
    const arrastre = rojosPrevios.length > 0
      ? ` · ⚠ CAUSA POSIBLEMENTE ARRASTRADA: ya venían rojos [${rojosPrevios.join(' ')}]`
      : '';
    brazo('N1', faltan.length === 0 && sobran.length === 0 && repetidos.size === 0 && fuera.length === 0,
      `faltan [${faltan.join(', ')}] · sobran [${sobran.join(', ')}] · repetidos [${[...repetidos].join(', ')}] · fuera [${[...new Set(fuera)].slice(0, 3).join(', ')}] (lista de ${LISTA_S17T.length})${arrastre}`);
  });
} finally {
  await relojDesfijar();
  await navegador.close().catch(() => {});
}

const verdes = resultados.filter((r) => r.ok).length;
const rojos = resultados.filter((r) => !r.ok).map((r) => r.id);
console.log(`\nverificar:s17-transferir → ${verdes}/${resultados.length} brazos verdes${rojos.length ? ` · rojos: ${rojos.join(' ')}` : ''}`);
if (SOLO.length > 0) console.log(`⚠ CORRIDA PARCIAL (ZFB_BRAZOS=${SOLO.join(',')}): ${resultados.length} de ${BRAZOS_TOTAL} brazos. NO sirve para declarar el número de la unidad.`);
process.exit(rojos.length === 0 && resultados.length === BRAZOS_TOTAL ? 0 : 1);
