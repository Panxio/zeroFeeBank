// Árbitro de M6 · Demo completa (specs/M6-demo-completa.md).
// Corre contra el ARTEFACTO servido: backend en :3000 y web/ en :4200.
// Lo levanta scripts/demo-m6.sh; este archivo sólo mira. No importa código de la app.
// Contiene exactamente los 14 pasos P1–P14 recorridos 3 veces consecutivas.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const API = 'http://localhost:3000';
const APP = 'http://localhost:4200';
const URL_VENTANILLA = 'http://localhost:4200/#ventanilla';
const ESPERA_MS = 8000;
const ESCRITORIO = { width: 1280, height: 800 };
const ZONA_HORARIA = 'America/Santiago';
const INSTANTE_F_ISO = '2026-09-15T01:30:00.000Z';

const ESCENARIO_TITULAR = 'boletas-en-cada-estado';
const ESCENARIO_DESTINO = 'dos-cuentas';
const MONTO_TRANSFERENCIA = '100.00';
const MONTO_TRANSFERENCIA_CENTAVOS = 10000n;
const MONTO_BOLETA = '250.10';
const MONTO_BOLETA_CENTAVOS = 25010n;
const PLAZO_BOLETA = '30';
const RUT_BENEFICIARIO = '12345678-5';
const NOMBRE_BENEFICIARIO = 'Constructora Andes SpA';
const RUT_RETIRADOR = '9876543-3';
const NOMBRE_RETIRADOR = 'Ana Soto';
const GLOSA_BOLETA = 'Fiel cumplimiento contrato 123';

// Salida de las capturas (specs/M6-capturas-fuera-del-arbol.md): por defecto fuera del árbol versionado;
// la referencia aprobada vive por defecto fuera del árbol y sólo se regenera con ZFB_CAPTURAS.
const DIR_CAPTURAS = (process.env.ZFB_CAPTURAS || '').trim() || 'probes/m6-ultima';

const TOTAL_CORRIDAS = 3;
const PASOS_POR_CORRIDA = 14;
const JSON_H = { 'content-type': 'application/json' };
const TERMINAL = ['listo', 'vacio', 'error'];

const sel = (t) => `[data-testid="${t}"]`;
// UX-b1 § 4, D130-4
const abreviar = (id) => (id.length > 6 ? `…${id.slice(-6)}` : id);

function centavosDe(montoStr) {
  const m = /^-?(\d+)(?:\.(\d{1,2}))?$/.exec(String(montoStr ?? ''));
  if (!m) throw new Error(`monto inválido: "${montoStr}"`);
  const enteros = m[1];
  const decimales = (m[2] || '').padEnd(2, '0');
  const centavos = BigInt(`${enteros}${decimales}`);
  return String(montoStr).startsWith('-') ? -centavos : centavos;
}

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

async function relojBackendDesfijar() {
  const r = await pedir('POST', '/__test__/reloj', JSON_H, { instante: null });
  if (r.status !== 200) throw new Error(`reloj desfijar falló con ${r.status}`);
}

async function cuentasApi(token) {
  const r = await pedir('GET', '/cuentas', { authorization: `Bearer ${token}` });
  if (r.status !== 200) throw new Error(`GET /cuentas falló con ${r.status}`);
  return JSON.parse(r.body).cuentas;
}

async function boletasApi(token) {
  const r = await pedir('GET', '/boletas', { authorization: `Bearer ${token}` });
  if (r.status !== 200) throw new Error(`GET /boletas falló con ${r.status}`);
  return JSON.parse(r.body).boletas;
}

const contextosAbiertos = new Set();
async function cerrarContextos() {
  for (const c of contextosAbiertos) await c.close().catch(() => {});
  contextosAbiertos.clear();
}

const navegador = await chromium.launch({ headless: true });

async function paginaNueva(opciones = {}, urlDestino = APP) {
  const ctx = await navegador.newContext({
    viewport: ESCRITORIO,
    timezoneId: ZONA_HORARIA,
    ...opciones,
  });
  contextosAbiertos.add(ctx);
  const page = await ctx.newPage();
  page.setDefaultTimeout(ESPERA_MS);
  await page.goto(urlDestino, { waitUntil: 'load' });
  await page.waitForSelector(`${sel('portada')}, ${sel('ventanilla')}`, { state: 'attached', timeout: ESPERA_MS });
  return { ctx, page };
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

async function entrarUI(page, email, password) {
  const f = await abrirPopover(page);
  await f.fill(sel('login-email'), email);
  await f.fill(sel('login-password'), password);
  await f.click(sel('login-enviar'));
  await page.waitForSelector(sel('usuario-email'), { state: 'visible', timeout: ESPERA_MS });
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

let credencialesAnteriores = null;
let corridasVerdes = 0;
let pasosTotalesVerdes = 0;
const pasosRojosGlobal = [];

try {
  // Desfijar reloj preventivamente
  await relojBackendDesfijar().catch(() => {});

  for (let corrida = 1; corrida <= TOTAL_CORRIDAS; corrida++) {
    const t0 = Date.now();
    const dirCapturas = `${DIR_CAPTURAS}/corrida-${corrida}`;
    rmSync(dirCapturas, { recursive: true, force: true });
    mkdirSync(dirCapturas, { recursive: true });

    let pasosOk = 0;
    let titularCredenciales = null;
    let titularCuentaId = null;
    let titularToken = null;
    let saldoInicialCentavos = null;
    let destinoCuentaId = null;
    let boletaEmitidaId = null;
    let pagePrincipal = null;
    let pageVentanilla = null;
    let corridaFallada = false;

    const paso = async (id, fn) => {
      if (corridaFallada) return;
      try {
        await fn();
        pasosOk++;
        pasosTotalesVerdes++;
      } catch (err) {
        corridaFallada = true;
        const motivo = err?.message ? String(err.message).split('\n')[0] : String(err);
        console.log(`  ${id} ROJO: ${motivo}`);
        pasosRojosGlobal.push({ corrida, paso: id, motivo });

        const targetPage = (pageVentanilla && !pageVentanilla.isClosed()) ? pageVentanilla : pagePrincipal;
        if (targetPage && !targetPage.isClosed()) {
          await targetPage.screenshot({
            path: `${dirCapturas}/rojo-${id.toLowerCase()}.png`,
            animations: 'disabled',
          }).catch(() => {});
        }
      }
    };

    try {
      // P1 · reset
      await paso('P1', async () => {
        const r = await pedir('POST', '/__test__/reset');
        if (r.status !== 200) throw new Error(`POST /__test__/reset devolvió ${r.status}`);
        if (corrida > 1 && credencialesAnteriores) {
          const rLogin = await pedir('POST', '/auth/login', JSON_H, {
            email: credencialesAnteriores.email,
            password: credencialesAnteriores.password,
          });
          if (rLogin.status !== 401) {
            throw new Error(`login viejo respondió ${rLogin.status}, esperado 401 (reset no borró)`);
          }
        }
      });

      // P2 · reloj
      await paso('P2', async () => {
        const r = await pedir('POST', '/__test__/reloj', JSON_H, { instante: INSTANTE_F_ISO });
        if (r.status !== 200) throw new Error(`POST /__test__/reloj devolvió ${r.status}`);
      });

      // P3 · seed-titular
      await paso('P3', async () => {
        const r = await pedir('POST', '/__test__/seed', JSON_H, { escenario: ESCENARIO_TITULAR });
        if (r.status !== 200 && r.status !== 201) {
          throw new Error(`POST /__test__/seed titular devolvió ${r.status}`);
        }
        const data = JSON.parse(r.body);
        if (!data.credenciales?.email || !data.credenciales?.password) {
          throw new Error('credenciales ausentes en seed titular');
        }
        if (!data.cuentas || data.cuentas.length === 0) {
          throw new Error('cuentas ausentes en seed titular');
        }
        if (data.cuentas[0].tipo !== 'CORRIENTE') {
          throw new Error(`tipo de cuenta esperado CORRIENTE pero fue ${data.cuentas[0].tipo}`);
        }
        if (data.cuentas[0].saldoCentavos !== '74000') {
          throw new Error(`saldoCentavos esperado 74000 pero fue ${data.cuentas[0].saldoCentavos}`);
        }

        titularCredenciales = data.credenciales;
        credencialesAnteriores = titularCredenciales;
        titularCuentaId = data.cuentas[0].id;
        saldoInicialCentavos = BigInt(data.cuentas[0].saldoCentavos);

        const rLogin = await pedir('POST', '/auth/login', JSON_H, titularCredenciales);
        if (rLogin.status !== 200) throw new Error(`login API titular falló: ${rLogin.status}`);
        titularToken = JSON.parse(rLogin.body).token;
      });

      // P4 · seed-destino
      await paso('P4', async () => {
        const r = await pedir('POST', '/__test__/seed', JSON_H, { escenario: ESCENARIO_DESTINO });
        if (r.status !== 200 && r.status !== 201) {
          throw new Error(`POST /__test__/seed destino devolvió ${r.status}`);
        }
        const data = JSON.parse(r.body);
        if (!data.cuentas || data.cuentas.length === 0 || !data.cuentas[0].id) {
          throw new Error('sin cuenta destino en seed dos-cuentas');
        }
        destinoCuentaId = data.cuentas[0].id;
      });

      // P5 · portada
      await paso('P5', async () => {
        const res = await paginaNueva();
        pagePrincipal = res.page;
        await pagePrincipal.waitForSelector(sel('portada'), { state: 'visible', timeout: ESPERA_MS });
        await pagePrincipal.screenshot({ path: `${dirCapturas}/p5-portada.png`, animations: 'disabled' });
      });

      // P6 · login
      await paso('P6', async () => {
        await entrarUI(pagePrincipal, titularCredenciales.email, titularCredenciales.password);
        const emailEl = await pagePrincipal.waitForSelector(sel('usuario-email'), { state: 'visible', timeout: ESPERA_MS });
        const emailTxt = (await emailEl.textContent())?.trim();
        if (!emailTxt || !emailTxt.includes(titularCredenciales.email)) {
          throw new Error(`usuario-email mostró «${emailTxt}», esperado «${titularCredenciales.email}»`);
        }
      });

      // P7 · resumen
      await paso('P7', async () => {
        await pagePrincipal.waitForSelector(
          TERMINAL.map((e) => `${sel('cuentas-region')}[data-estado="${e}"]`).join(', '),
          { state: 'attached', timeout: ESPERA_MS },
        );
        await pagePrincipal.waitForSelector(sel('cuentas-tabla'), { state: 'visible', timeout: ESPERA_MS });
        const filas = await pagePrincipal.$$(sel('cuenta-fila'));
        if (filas.length !== 1) {
          throw new Error(`cuentas-tabla tiene ${filas.length} filas, esperada 1`);
        }
        const cidEl = await pagePrincipal.waitForSelector(sel('cuenta-id'), { state: 'visible', timeout: ESPERA_MS });
        // enmendado en F4a de UX-b1 (D130-1|O5)
        const fallas = [];
        const cidAttr = await cidEl.getAttribute('data-cuenta-id');
        if (cidAttr !== titularCuentaId) fallas.push(`data-cuenta-id «${cidAttr}» ≠ «${titularCuentaId}»`);
        const esperadoCorto = abreviar(titularCuentaId);
        const cortoEl = await cidEl.$('[aria-hidden="true"]');
        const cortoTxt = cortoEl ? ((await cortoEl.textContent())?.trim() ?? null) : null;
        if (cortoTxt === null) fallas.push(`sin hijo aria-hidden (esperado «${esperadoCorto}»)`);
        else if (cortoTxt !== esperadoCorto) fallas.push(`aria-hidden «${cortoTxt}» ≠ «${esperadoCorto}»`);
        const largoEl = await cidEl.$('.sr-only');
        const largoTxt = largoEl ? ((await largoEl.textContent())?.trim() ?? null) : null;
        if (largoTxt === null) fallas.push(`sin hijo .sr-only (esperado «${titularCuentaId}»)`);
        else if (largoTxt !== titularCuentaId) fallas.push(`.sr-only «${largoTxt}» ≠ «${titularCuentaId}»`);
        if (fallas.length) throw new Error(`cuenta-id: ${fallas.join(' · ')}`);
        await pagePrincipal.screenshot({ path: `${dirCapturas}/p7-resumen.png`, animations: 'disabled' });
      });

      // P8 · transferir
      await paso('P8', async () => {
        await pagePrincipal.click(sel('nav-transferir'));
        await pagePrincipal.waitForSelector(sel('transferir-pasos'), { state: 'visible', timeout: ESPERA_MS });

        // Paso Origen
        await pagePrincipal.waitForSelector(sel('transferir-origen'), { state: 'visible', timeout: ESPERA_MS });
        await pagePrincipal.selectOption(sel('transferir-origen'), titularCuentaId);
        await pagePrincipal.click(sel('transferir-origen-siguiente'));

        // Paso Destino
        await pagePrincipal.waitForSelector(`${sel('transferir-paso-destino')}[aria-selected="true"]`, { timeout: ESPERA_MS });
        await pagePrincipal.waitForSelector(sel('transferir-destino-modo-otra'), { state: 'visible', timeout: ESPERA_MS });
        await pagePrincipal.check(sel('transferir-destino-modo-otra')).catch(() => pagePrincipal.click(sel('transferir-destino-modo-otra')));
        await pagePrincipal.waitForSelector(sel('transferir-destino-id'), { state: 'visible', timeout: ESPERA_MS });
        await pagePrincipal.fill(sel('transferir-destino-id'), destinoCuentaId);
        await pagePrincipal.fill(sel('transferir-monto'), MONTO_TRANSFERENCIA);
        await pagePrincipal.click(sel('transferir-destino-siguiente'));

        // Paso Revisar
        await pagePrincipal.waitForSelector(`${sel('transferir-paso-revisar')}[aria-selected="true"]`, { timeout: ESPERA_MS });
        await pagePrincipal.waitForSelector(sel('transferir-enviar'), { state: 'visible', timeout: ESPERA_MS });
        await pagePrincipal.click(sel('transferir-enviar'));

        // Modal Confirmar (dentro de shadow root en zfb-dialogo)
        await pagePrincipal.waitForSelector(sel('confirmar-dialogo'), { state: 'visible', timeout: ESPERA_MS });
        await pagePrincipal.click(sel('confirmar-aceptar'));

        // Éxito
        await pagePrincipal.waitForSelector(sel('transferir-exito'), { state: 'visible', timeout: ESPERA_MS });
        await pagePrincipal.waitForFunction((s) => {
          const el = document.querySelector(s);
          return !!el && el.textContent.trim().length > 0;
        }, sel('transferir-transaccion-id'), { timeout: ESPERA_MS });

        await pagePrincipal.screenshot({ path: `${dirCapturas}/p8-transferencia.png`, animations: 'disabled' });

        // Aserción por API: cuenta origen bajó exactamente 10 000 centavos
        const cuentas = await cuentasApi(titularToken);
        const cOrigen = cuentas.find((c) => c.id === titularCuentaId);
        if (!cOrigen) throw new Error(`cuenta origen ${titularCuentaId} no encontrada en GET /cuentas`);
        const saldoActualCentavos = centavosDe(cOrigen.saldo);
        const saldoEsperadoCentavos = saldoInicialCentavos - MONTO_TRANSFERENCIA_CENTAVOS;
        if (saldoActualCentavos !== saldoEsperadoCentavos) {
          throw new Error(`saldo origen tras transferencia fue ${saldoActualCentavos}, esperado ${saldoEsperadoCentavos}`);
        }
      });

      // P9 · emitir
      await paso('P9', async () => {
        await pagePrincipal.click(sel('nav-boletas'));
        // enmendado en F4a de UX-b2 (O2)
        const pestanaEmitirP9 = await pagePrincipal.waitForSelector(sel('boletas-pestana-emitir'), { state: 'visible', timeout: ESPERA_MS })
          .then(() => true, () => false);
        if (!pestanaEmitirP9) throw new Error('boletas-pestana-emitir no aparece (la pestaña no existe)');
        await pagePrincipal.click(sel('boletas-pestana-emitir'));
        await pagePrincipal.waitForSelector(sel('emitir-form'), { state: 'visible', timeout: ESPERA_MS });

        await llenarFormularioEmitir(pagePrincipal, {
          origenId: titularCuentaId,
          monto: MONTO_BOLETA,
          plazo: PLAZO_BOLETA,
          benRut: RUT_BENEFICIARIO,
          benNombre: NOMBRE_BENEFICIARIO,
          retRut: RUT_RETIRADOR,
          retNombre: NOMBRE_RETIRADOR,
          glosa: GLOSA_BOLETA,
        });

        if (await pagePrincipal.isDisabled(sel('emitir-enviar'))) {
          throw new Error('emitir-enviar está deshabilitado');
        }
        await pagePrincipal.click(sel('emitir-enviar'));

        await pagePrincipal.waitForSelector(sel('emitir-exito'), { state: 'visible', timeout: ESPERA_MS });
        const nuevaId = (await pagePrincipal.textContent(sel('emitir-boleta-id')))?.trim();
        if (!nuevaId) throw new Error('emitir-boleta-id vacío');
        boletaEmitidaId = nuevaId;

        // Dos capturas, una por pestaña (D142-1; UX-b2 § 5): con pestañas, el éxito y la fila no
        // caben en una imagen. Cada captura se toma con su elemento traído al viewport, no apenas
        // aparece: antes, con la página scrolleada donde la dejó el último `fill` y el formulario
        // ya reseteado, la imagen mostraba los `placeholder` de la app —que son exactamente los
        // datos felices— y ni el banner de éxito ni la fila. Una captura que no muestra lo que su
        // paso prueba no es evidencia de nada.
        await pagePrincipal.locator(sel('emitir-exito')).scrollIntoViewIfNeeded();
        await pagePrincipal.screenshot({ path: `${dirCapturas}/p9-boleta-exito.png`, animations: 'disabled' });

        await pagePrincipal.click(sel('boletas-pestana-lista'));
        await pagePrincipal.waitForSelector(
          `${sel('boleta-fila')}[data-boleta-id="${nuevaId}"][data-estado="VIGENTE"]`,
          { state: 'visible', timeout: ESPERA_MS },
        );
        await pagePrincipal.locator(`${sel('boleta-fila')}[data-boleta-id="${nuevaId}"]`).scrollIntoViewIfNeeded();
        await pagePrincipal.screenshot({ path: `${dirCapturas}/p9-boleta-fila.png`, animations: 'disabled' });

        // Aserción por API: cuenta bajó exactamente 25 010 centavos más
        const cuentas = await cuentasApi(titularToken);
        const cOrigen = cuentas.find((c) => c.id === titularCuentaId);
        if (!cOrigen) throw new Error(`cuenta origen ${titularCuentaId} no encontrada en GET /cuentas`);
        const saldoActualCentavos = centavosDe(cOrigen.saldo);
        const saldoEsperadoCentavos = saldoInicialCentavos - MONTO_TRANSFERENCIA_CENTAVOS - MONTO_BOLETA_CENTAVOS;
        if (saldoActualCentavos !== saldoEsperadoCentavos) {
          throw new Error(`saldo origen tras emisión fue ${saldoActualCentavos}, esperado ${saldoEsperadoCentavos}`);
        }
      });

      // P10 · salir
      await paso('P10', async () => {
        await pagePrincipal.click(sel('nav-usuario'));
        await pagePrincipal.waitForSelector(sel('salir'), { state: 'visible', timeout: ESPERA_MS });
        await pagePrincipal.click(sel('salir'));
        await pagePrincipal.waitForSelector(sel('login-abrir'), { state: 'visible', timeout: ESPERA_MS });
        await pagePrincipal.waitForSelector(sel('portada'), { state: 'visible', timeout: ESPERA_MS });
        await pagePrincipal.waitForSelector(sel('usuario-email'), { state: 'detached', timeout: ESPERA_MS });
      });

      // P11 · ventanilla (en página/contexto nuevo)
      await paso('P11', async () => {
        const resV = await paginaNueva({}, URL_VENTANILLA);
        const vCtx = resV.ctx;
        pageVentanilla = resV.page;
        try {
          await pageVentanilla.waitForSelector(sel('ventanilla'), { state: 'visible', timeout: ESPERA_MS });
          await pageVentanilla.fill(sel('ventanilla-boleta-id'), boletaEmitidaId);
          await pageVentanilla.fill(sel('ventanilla-rut'), RUT_RETIRADOR);
          await pageVentanilla.click(sel('ventanilla-cobrar'));

          await pageVentanilla.waitForSelector(`${sel('ventanilla-exito')}[data-estado="COBRADA"]`, { state: 'visible', timeout: ESPERA_MS });
          await pageVentanilla.screenshot({ path: `${dirCapturas}/p11-ventanilla.png`, animations: 'disabled' });

          const montoEl = await pageVentanilla.waitForSelector(`${sel('ventanilla-exito')} ${sel('ventanilla-monto')}`, { state: 'visible', timeout: ESPERA_MS });
          const mAttr = await montoEl.getAttribute('data-monto');
          if (mAttr !== MONTO_BOLETA) {
            throw new Error(`ventanilla-monto data-monto="${mAttr}", esperado "${MONTO_BOLETA}"`);
          }
        } finally {
          await vCtx.close().catch(() => {});
          contextosAbiertos.delete(vCtx);
          pageVentanilla = null;
        }
      });

      // P12 · cuadre
      await paso('P12', async () => {
        const cuentas = await cuentasApi(titularToken);
        const cOrigen = cuentas.find((c) => c.id === titularCuentaId);
        if (!cOrigen) throw new Error(`cuenta origen ${titularCuentaId} no encontrada en GET /cuentas`);
        const saldoActualCentavos = centavosDe(cOrigen.saldo);
        const saldoEsperadoCentavos = saldoInicialCentavos - MONTO_TRANSFERENCIA_CENTAVOS - MONTO_BOLETA_CENTAVOS;
        if (saldoActualCentavos !== saldoEsperadoCentavos) {
          throw new Error(`cuadre saldo API = ${saldoActualCentavos}, esperado ${saldoEsperadoCentavos}`);
        }

        const boletas = await boletasApi(titularToken);
        const bEmitida = boletas.find((b) => b.id === boletaEmitidaId);
        if (!bEmitida) throw new Error(`boleta emitida ${boletaEmitidaId} no encontrada en GET /boletas`);
        if (bEmitida.estado !== 'COBRADA') {
          throw new Error(`boleta emitida en estado ${bEmitida.estado}, esperado COBRADA`);
        }
      });

      // P13 · invariantes (INV_SEMBRAR=0 npm run invariantes)
      await paso('P13', async () => {
        const res = spawnSync('npm', ['run', 'invariantes'], {
          env: { ...process.env, INV_SEMBRAR: '0' },
          encoding: 'utf8',
        });
        // § 4.2: la demo no hace transferencias interbancarias, así que I7 sale SIN POBLACIÓN.
        // Con D04c el resumen dice 6/6 y no 5/5: I6 SÍ se audita, porque el escenario
        // de boletas deja VIGENTES en la base. Se exige el resumen COMPLETO —el 6/6 y el trozo de
        // I7— para que un árbitro que deje de auditar I6 (`I6 SIN POBLACIÓN` daría 5/5) o
        // cualquier otro no pueda colarse como verde.
        const resumenOk = res.stdout.includes('6/6 invariantes en verde · I7 SIN POBLACIÓN');
        if (res.status !== 0 || !resumenOk) {
          const match = res.stdout?.match(/S-11: (\d+) de \d+ invariantes en ROJO/);
          const pMatch = res.stdout?.match(/abortado en la compuerta de población/);
          let det = `exit ${res.status}`;
          if (match) det = `${match[1]} invariantes en rojo`;
          else if (pMatch) det = 'abortado en compuerta de población';
          else if (res.status === 0) det = 'exit 0 pero sin el resumen esperado de § 4.2';
          throw new Error(`invariantes falló (${det})`);
        }
      });

      // P14 · reloj-libre
      await paso('P14', async () => {
        const r = await pedir('POST', '/__test__/reloj', JSON_H, { instante: null });
        if (r.status !== 200) throw new Error(`desfijar reloj devolvió ${r.status}`);
      });
    } finally {
      if (corridaFallada) {
        await relojBackendDesfijar().catch(() => {});
      }
      await cerrarContextos();
      const duracionS = Math.round((Date.now() - t0) / 1000);
      console.log(`corrida ${corrida} · ${pasosOk}/${PASOS_POR_CORRIDA} pasos · ${duracionS} s`);
      if (pasosOk === PASOS_POR_CORRIDA) {
        corridasVerdes++;
      }
    }
  }
} finally {
  await relojBackendDesfijar().catch(() => {});
  await cerrarContextos();
  await navegador.close().catch(() => {});
}

// Salida final exacta (§ 5)
if (corridasVerdes === TOTAL_CORRIDAS) {
  console.log(`M6: ${corridasVerdes}/${TOTAL_CORRIDAS} corridas · ${pasosTotalesVerdes}/${TOTAL_CORRIDAS * PASOS_POR_CORRIDA} pasos`);
  process.exit(0);
} else {
  console.log(`M6: ${corridasVerdes}/${TOTAL_CORRIDAS} corridas · ${pasosTotalesVerdes}/${TOTAL_CORRIDAS * PASOS_POR_CORRIDA} pasos`);
  for (const r of pasosRojosGlobal) {
    console.log(`  ${r.paso} ROJO (corrida ${r.corrida}): ${r.motivo}`);
  }
  process.exit(1);
}
