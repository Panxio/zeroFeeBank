import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { extractText, getDocumentProxy, getMeta } from 'unpdf';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/prisma.service.js';
import { AppModule } from '../src/app.module.js';

/**
 * Arnés de S-19 · comprobantes en PDF. Ver specs/S-19-comprobantes-pdf.md.
 * ESTE ARCHIVO NO SE TOCA (specs/_CANDADO.md).
 *
 * ─── Qué clase de cosa mide ─────────────────────────────────────────────────────────────
 * TEXTO EXTRAÍDO y METADATOS, leídos con unpdf (pdf.js), que no es la librería que genera.
 * Nunca bytes, salvo Q2, cuyo objeto es justamente que los bytes se repitan (J7).
 *
 * ─── Tres instantes, a propósito (J2) ───────────────────────────────────────────────────
 * T = las operaciones · T2 = los cierres · T3 = cuando se sirve el documento. Todos lejos de
 * hoy y distintos: un cuerpo fechado con el reloj (T3 en vez de T), unos metadatos de pared
 * (hoy en vez de T3) o una fecha de cierre tomada de `venceEn` se ven rojos.
 *
 * ─── La advertencia: el acto previo debe haber salido bien ──────────────────────────────
 * Cada preparación pasa por `exigir`: si el acto del medio no dio su 2xx, el caso muere ahí,
 * y no se afirma nada sobre un documento de una operación que nunca ocurrió.
 */

const prisma = new PrismaService();
let app: INestApplication;
let base = '';

const SECRETO = 'arnes-pdf-secreto-de-pruebas-32-min-ok';
const PASSWORD = 'clave-de-prueba-larga';

const T = new Date('2031-03-14T15:09:26.535Z');
/** Cobro y devolución: una hora y 7 ms después de emitir, dentro del plazo de 1 día. */
const T2_VIGENTE = new Date(T.getTime() + 3_600_000 + 7);
/** Vencimiento: dos días y 7 ms después, pasado el plazo de 1 día. */
const T2_VENCIDA = new Date(T.getTime() + 2 * 86_400_000 + 7);
/** Cuando se sirve el documento: después de todo lo anterior y antes de que venza una boleta de 365 días. */
const T3 = new Date('2031-09-30T18:45:12.250Z');

const RUT_BENEFICIARIO = '12345678-5';
const RUT_RETIRADOR = '9876543-3';
/** § 4: texto del usuario que rompe un PDF sin escape (paréntesis, barra invertida) y fuera de ASCII. */
const GLOSA_HOSTIL = 'Fiel cumplimiento (obra Ñuñoa) \\ etapa 2 — año 2031';
const BENEFICIARIO_HOSTIL = 'Constructora Ñandú (Chile) SpA';
const RETIRADOR_HOSTIL = 'José Muñoz Peña';

// ─── utilidades ────────────────────────────────────────────────────────────────────────

type Respuesta = { estado: number; cuerpo: Record<string, unknown> };
type Opciones = { cuerpo?: unknown; autorizacion?: string; clave?: string };

function cabeceras(o: Opciones): Record<string, string> {
  const h: Record<string, string> = {};
  if (o.cuerpo !== undefined) h['content-type'] = 'application/json';
  if (o.autorizacion !== undefined) h['authorization'] = o.autorizacion;
  if (o.clave !== undefined) h['idempotency-key'] = o.clave;
  return h;
}

async function pedir(metodo: string, ruta: string, o: Opciones = {}): Promise<Respuesta> {
  const init: RequestInit = { method: metodo, headers: cabeceras(o) };
  if (o.cuerpo !== undefined) init.body = JSON.stringify(o.cuerpo);
  const r = await fetch(`${base}${ruta}`, init);
  const texto = await r.text();
  let cuerpo: unknown = {};
  try {
    cuerpo = texto === '' ? {} : JSON.parse(texto);
  } catch {
    cuerpo = { _crudo: texto.slice(0, 200) };
  }
  return { estado: r.status, cuerpo: (cuerpo ?? {}) as Record<string, unknown> };
}

async function exigir(estado: number, metodo: string, ruta: string, o: Opciones = {}): Promise<Record<string, unknown>> {
  const r = await pedir(metodo, ruta, o);
  expect(r.estado, `${metodo} ${ruta} debía dar ${estado}: ${JSON.stringify(r.cuerpo)}`).toBe(estado);
  return r.cuerpo;
}

interface Pdf {
  bytes: Buffer;
  tipo: string;
  disposicion: string;
  texto: string;
  creacion: Date;
  modificacion: Date;
}

const normalizar = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * Fecha PDF (ISO 32000-1 § 7.9.4): D:AAAAMMDDHHmmSS seguido de Z o de ±HH'mm'. Se EXIGE la zona:
 * sin ella el instante no se puede determinar, y «coincide con T3» sería una adivinanza.
 */
function fechaPdf(crudo: unknown): Date {
  const m = /^D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}'?\d{2}'?)/.exec(String(crudo));
  expect(m, `fecha PDF sin forma D:AAAAMMDDHHmmSS+zona: ${String(crudo)}`).not.toBeNull();
  const [, a, mes, d, h, mi, s, zona] = m!;
  const utc = Date.UTC(+a!, +mes! - 1, +d!, +h!, +mi!, +s!);
  if (zona === 'Z') return new Date(utc);
  const signo = zona!.startsWith('-') ? -1 : 1;
  const dig = zona!.replace(/[^0-9]/g, '');
  const offsetMin = +dig.slice(0, 2) * 60 + +dig.slice(2, 4);
  return new Date(utc - signo * offsetMin * 60_000);
}

/** El instante al segundo: la precisión del formato de fecha PDF. */
const alSegundo = (d: Date): string => new Date(Math.floor(d.getTime() / 1000) * 1000).toISOString();
const iso = (d: Date): string => d.toISOString();

/** Pide un PDF que DEBE salir 200 y lo abre con un lector independiente. */
async function bajarPdf(ruta: string, autorizacion: string): Promise<Pdf> {
  const r = await fetch(`${base}${ruta}`, { headers: { authorization: autorizacion } });
  const bytes = Buffer.from(await r.arrayBuffer());
  expect(r.status, `GET ${ruta} debía dar 200: ${bytes.subarray(0, 200).toString()}`).toBe(200);
  expect(bytes.subarray(0, 5).toString('latin1'), 'un PDF empieza por %PDF-').toBe('%PDF-');
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true });
  const { info } = await getMeta(await getDocumentProxy(new Uint8Array(bytes)));
  const meta = info as Record<string, unknown>;
  return {
    bytes,
    tipo: r.headers.get('content-type') ?? '',
    disposicion: r.headers.get('content-disposition') ?? '',
    texto: normalizar(text),
    creacion: fechaPdf(meta['CreationDate']),
    modificacion: fechaPdf(meta['ModDate']),
  };
}

function exigirTexto(pdf: Pdf, valores: Record<string, string>): void {
  for (const [nombre, valor] of Object.entries(valores)) {
    expect(pdf.texto.includes(normalizar(valor)), `falta ${nombre} = «${valor}» en el texto: «${pdf.texto}»`).toBe(true);
  }
}

function exigirMetadatosT3(pdf: Pdf): void {
  expect(iso(pdf.creacion), 'CreationDate = reloj al servir').toBe(alSegundo(T3));
  expect(iso(pdf.modificacion), 'ModDate = reloj al servir').toBe(alSegundo(T3));
}

async function resetear(): Promise<void> {
  await exigir(200, 'POST', '/__test__/reset', { cuerpo: {} });
}

// Con H1 (S-10 T4) el token vence según el reloj inyectado, no el de pared: tras mover el reloj,
// cada titular de la prueba vuelve a iniciar sesión para que su token nazca a la hora nueva.
// Es sólo preparación: ninguna aserción mira el token, y el registro se vacía antes de cada prueba.
const titularesVivos = new Set<Titular>();
async function renovarSesiones(): Promise<void> {
  for (const t of titularesVivos) {
    const login = await exigir(200, 'POST', '/auth/login', { cuerpo: { email: t.email, password: PASSWORD } });
    t.auth = `Bearer ${String(login['token'])}`;
  }
}

async function fijarReloj(instante: Date): Promise<void> {
  await exigir(200, 'POST', '/__test__/reloj', { cuerpo: { instante: instante.toISOString() } });
  await renovarSesiones();
}

interface Titular {
  email: string;
  auth: string;
  cuentaId: string;
}

/** Un titular con su primera cuenta (S-12 la fondea desde la CAJA). */
async function nuevoTitular(): Promise<Titular> {
  const email = `pdf-${randomUUID()}@ejemplo.cl`;
  await exigir(201, 'POST', '/auth/registro', { cuerpo: { email, password: PASSWORD } });
  const login = await exigir(200, 'POST', '/auth/login', { cuerpo: { email, password: PASSWORD } });
  const auth = `Bearer ${String(login['token'])}`;
  const c = await exigir(201, 'POST', '/cuentas', {
    cuerpo: { tipo: 'CORRIENTE', monto: '5000.00' },
    autorizacion: auth,
    clave: `pdf-apertura-${randomUUID()}`,
  });
  const t = { email, auth, cuentaId: String(c['id']) };
  titularesVivos.add(t);
  return t;
}

async function transferir(de: Titular, a: Titular, monto: string): Promise<string> {
  const r = await exigir(201, 'POST', '/transferencias', {
    cuerpo: { origenId: de.cuentaId, destinoId: a.cuentaId, monto },
    autorizacion: de.auth,
    clave: `pdf-transf-${randomUUID()}`,
  });
  return String(r['transaccionId']);
}

async function emitirBoleta(t: Titular, plazoDias: number): Promise<Record<string, unknown>> {
  return exigir(201, 'POST', '/boletas', {
    cuerpo: {
      cuentaOrigenId: t.cuentaId,
      monto: '1234.56',
      plazoDias,
      beneficiarioRut: RUT_BENEFICIARIO,
      beneficiarioNombre: BENEFICIARIO_HOSTIL,
      glosa: GLOSA_HOSTIL,
      retiradorRut: RUT_RETIRADOR,
      retiradorNombre: RETIRADOR_HOSTIL,
    },
    autorizacion: t.auth,
    clave: `pdf-boleta-${randomUUID()}`,
  });
}

async function cerrar(t: Titular, id: string, como: 'cobrar' | 'vencer' | 'devolver'): Promise<void> {
  const cuerpo = como === 'cobrar' ? { rutRetirador: RUT_RETIRADOR } : {};
  const o: Opciones = { cuerpo, clave: `pdf-${como}-${randomUUID()}` };
  if (como !== 'cobrar') o.autorizacion = t.auth;
  await exigir(200, 'POST', `/boletas/${id}/${como}`, o);
}

/** Todas las variantes deben dar el MISMO estado y el MISMO cuerpo (I-dueño). */
async function exigirMismo404(codigo: string, variantes: Record<string, { ruta: string; auth: string }>): Promise<void> {
  const cuerpos: Record<string, unknown>[] = [];
  for (const [nombre, v] of Object.entries(variantes)) {
    const r = await pedir('GET', v.ruta, { autorizacion: v.auth });
    expect(r.estado, `${nombre}: debía dar 404, dio ${r.estado} ${JSON.stringify(r.cuerpo)}`).toBe(404);
    expect(r.cuerpo['codigo'], `${nombre}: código`).toBe(codigo);
    cuerpos.push(r.cuerpo);
  }
  for (const c of cuerpos.slice(1)) expect(c, 'lo ajeno responde igual que lo inexistente').toEqual(cuerpos[0]);
}

// ─── ciclo de vida ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  process.env['ZFB_AUTH_SECRET'] = SECRETO;
  process.env['ZFB_COSTURAS_PRUEBA'] = '1';
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  base = (await app.getUrl()).replace('[::1]', 'localhost');
});

beforeEach(async () => {
  titularesVivos.clear();
  await resetear();
  await fijarReloj(T);
});

afterAll(async () => {
  await pedir('POST', '/__test__/reloj', { cuerpo: { instante: null } });
  await app?.close();
  await prisma.$disconnect();
});

// ═══ Q · transferencia ═════════════════════════════════════════════════════════════════

describe('S-19 · comprobante de transferencia', () => {
  it('Q1 · 200, inline, los 5 valores, fecha de la operación T y metadatos T3', async () => {
    const origen = await nuevoTitular();
    const destino = await nuevoTitular();
    const txId = await transferir(origen, destino, '1234.56');
    await fijarReloj(T3);

    const pdf = await bajarPdf(`/transferencias/${txId}/comprobante.pdf`, origen.auth);
    expect(pdf.tipo).toMatch(/^application\/pdf/);
    expect(pdf.disposicion).toBe(`inline; filename="transferencia-${txId}-comprobante.pdf"`);
    exigirTexto(pdf, {
      id: txId,
      fecha: iso(T),
      origen: origen.cuentaId,
      destino: destino.cuentaId,
      monto: '1234.56',
    });
    exigirMetadatosT3(pdf);
  });

  it('Q2 · el mismo pedido con el mismo reloj da los mismos bytes', async () => {
    const origen = await nuevoTitular();
    const destino = await nuevoTitular();
    const txId = await transferir(origen, destino, '10.00');
    await fijarReloj(T3);
    const a = await bajarPdf(`/transferencias/${txId}/comprobante.pdf`, origen.auth);
    const b = await bajarPdf(`/transferencias/${txId}/comprobante.pdf`, origen.auth);
    expect(a.bytes.equals(b.bytes), 'dos descargas idénticas difieren en bytes').toBe(true);
  });

  it('Q3 · 404 TRANSFERENCIA_NO_ENCONTRADA con cuerpo idéntico en las 5 variantes', async () => {
    const origen = await nuevoTitular();
    const destino = await nuevoTitular();
    const tercero = await nuevoTitular();
    const txId = await transferir(origen, destino, '10.00');
    const emision = String((await emitirBoleta(origen, 30))['transaccionId']);
    expect(emision, 'la emisión devolvió su transaccionId').toMatch(/^[0-9a-f-]{36}$/);
    await fijarReloj(T3);

    const ruta = (id: string): string => `/transferencias/${id}/comprobante.pdf`;
    await exigirMismo404('TRANSFERENCIA_NO_ENCONTRADA', {
      malformado: { ruta: ruta('no-es-uuid'), auth: origen.auth },
      inexistente: { ruta: ruta(randomUUID()), auth: origen.auth },
      'otro concepto (emisión de boleta propia)': { ruta: ruta(emision), auth: origen.auth },
      ajena: { ruta: ruta(txId), auth: tercero.auth },
      'recibida (P-b)': { ruta: ruta(txId), auth: destino.auth },
    });
  });

  it('Q4 · sin token → 401 TOKEN_AUSENTE y token malo → 401 TOKEN_INVALIDO, en las tres rutas', async () => {
    const t = await nuevoTitular();
    const destino = await nuevoTitular();
    const txId = await transferir(t, destino, '10.00');
    const boletaId = String((await emitirBoleta(t, 1))['id']);
    for (const ruta of [
      `/transferencias/${txId}/comprobante.pdf`,
      `/boletas/${boletaId}/comprobante.pdf`,
      `/boletas/${boletaId}/resumen.pdf`,
    ]) {
      const sin = await pedir('GET', ruta);
      expect([sin.estado, sin.cuerpo['codigo']], `${ruta} sin token`).toEqual([401, 'TOKEN_AUSENTE']);
      const malo = await pedir('GET', ruta, { autorizacion: 'Bearer no.es.un-token' });
      expect([malo.estado, malo.cuerpo['codigo']], `${ruta} token malo`).toEqual([401, 'TOKEN_INVALIDO']);
    }
  });
});

// ═══ Q · boleta ════════════════════════════════════════════════════════════════════════

describe('S-19 · comprobante y resumen de boleta', () => {
  it('Q5 · comprobante: attachment, los 9 valores con texto hostil intacto, metadatos T3', async () => {
    const t = await nuevoTitular();
    const b = await emitirBoleta(t, 365);
    const id = String(b['id']);
    await fijarReloj(T3);

    const pdf = await bajarPdf(`/boletas/${id}/comprobante.pdf`, t.auth);
    expect(pdf.tipo).toMatch(/^application\/pdf/);
    expect(pdf.disposicion).toBe(`attachment; filename="boleta-${id}-comprobante.pdf"`);
    exigirTexto(pdf, {
      id,
      cuenta: t.cuentaId,
      monto: '1234.56',
      emitidaEn: iso(T),
      venceEn: String(b['venceEn']),
      beneficiarioRut: RUT_BENEFICIARIO,
      beneficiarioNombre: BENEFICIARIO_HOSTIL,
      glosa: GLOSA_HOSTIL,
      retiradorRut: RUT_RETIRADOR,
    });
    exigirTexto(pdf, { retiradorNombre: RETIRADOR_HOSTIL });
    exigirMetadatosT3(pdf);
  });

  it('Q6 · el comprobante de emisión se sigue sirviendo después del cobro (J5)', async () => {
    const t = await nuevoTitular();
    const id = String((await emitirBoleta(t, 1))['id']);
    await fijarReloj(T2_VIGENTE);
    await cerrar(t, id, 'cobrar');
    await fijarReloj(T3);
    const pdf = await bajarPdf(`/boletas/${id}/comprobante.pdf`, t.auth);
    exigirTexto(pdf, { id, emitidaEn: iso(T) });
  });

  it('Q7 · resumen sin asiento de cierre → 409 BOLETA_NO_CERRADA (VIGENTE y vencida por tiempo)', async () => {
    const t = await nuevoTitular();
    const vigente = String((await emitirBoleta(t, 365))['id']);
    const vencidaSinAsiento = String((await emitirBoleta(t, 1))['id']);
    await fijarReloj(T3);
    const consulta = await exigir(200, 'GET', `/boletas/${vencidaSinAsiento}`, { autorizacion: t.auth });
    expect(consulta['estado'], 'la API ya la ve VENCIDA: es el borde de J4').toBe('VENCIDA');

    for (const id of [vigente, vencidaSinAsiento]) {
      const r = await pedir('GET', `/boletas/${id}/resumen.pdf`, { autorizacion: t.auth });
      expect([r.estado, r.cuerpo['codigo']], `resumen de ${id}`).toEqual([409, 'BOLETA_NO_CERRADA']);
    }
  });

  it('Q8 · resumen de COBRADA, VENCIDA y DEVUELTA: estado, cierre T2 del asiento y metadatos T3', async () => {
    const t = await nuevoTitular();
    const casos = [
      { como: 'cobrar', estado: 'COBRADA', cierre: T2_VIGENTE },
      { como: 'devolver', estado: 'DEVUELTA', cierre: T2_VIGENTE },
      { como: 'vencer', estado: 'VENCIDA', cierre: T2_VENCIDA },
    ] as const;
    const ids: string[] = [];
    for (let i = 0; i < casos.length; i++) ids.push(String((await emitirBoleta(t, 1))['id']));
    for (const [i, c] of casos.entries()) {
      await fijarReloj(c.cierre);
      await cerrar(t, ids[i]!, c.como);
    }
    await fijarReloj(T3);

    for (const [i, c] of casos.entries()) {
      const id = ids[i]!;
      const pdf = await bajarPdf(`/boletas/${id}/resumen.pdf`, t.auth);
      expect(pdf.tipo).toMatch(/^application\/pdf/);
      expect(pdf.disposicion).toBe(`attachment; filename="boleta-${id}-resumen.pdf"`);
      exigirTexto(pdf, {
        id,
        estado: c.estado,
        cierre: iso(c.cierre),
        emitidaEn: iso(T),
        monto: '1234.56',
        glosa: GLOSA_HOSTIL,
        beneficiarioNombre: BENEFICIARIO_HOSTIL,
      });
      for (const otro of casos.filter((o) => o.estado !== c.estado)) {
        expect(pdf.texto.includes(otro.estado), `el resumen ${c.estado} no debe decir ${otro.estado}`).toBe(false);
      }
      exigirMetadatosT3(pdf);
    }
  });

  it('Q9 · boleta ajena, inexistente o malformada → 404 BOLETA_NO_ENCONTRADA idéntico, en las dos rutas', async () => {
    const t = await nuevoTitular();
    const tercero = await nuevoTitular();
    const id = String((await emitirBoleta(t, 1))['id']);
    await fijarReloj(T2_VIGENTE);
    await cerrar(t, id, 'cobrar');
    await fijarReloj(T3);
    for (const doc of ['comprobante', 'resumen']) {
      const ruta = (x: string): string => `/boletas/${x}/${doc}.pdf`;
      await exigirMismo404('BOLETA_NO_ENCONTRADA', {
        [`${doc} malformada`]: { ruta: ruta('no-es-uuid'), auth: t.auth },
        [`${doc} inexistente`]: { ruta: ruta(randomUUID()), auth: t.auth },
        [`${doc} ajena`]: { ruta: ruta(id), auth: tercero.auth },
      });
    }
  });
});

// ═══ Q10 · I-lectura ═══════════════════════════════════════════════════════════════════

describe('S-19 · servir un PDF no escribe', () => {
  it('Q10 · los tres documentos no cambian las filas de transaccion ni de movimiento', async () => {
    const t = await nuevoTitular();
    const destino = await nuevoTitular();
    const txId = await transferir(t, destino, '10.00');
    const id = String((await emitirBoleta(t, 1))['id']);
    await fijarReloj(T2_VIGENTE);
    await cerrar(t, id, 'cobrar');
    await fijarReloj(T3);

    const antes = [await prisma.transaccion.count(), await prisma.movimiento.count()];
    expect(antes[0], 'hay asientos que contar').toBeGreaterThan(0);
    await bajarPdf(`/transferencias/${txId}/comprobante.pdf`, t.auth);
    await bajarPdf(`/boletas/${id}/comprobante.pdf`, t.auth);
    await bajarPdf(`/boletas/${id}/resumen.pdf`, t.auth);
    expect([await prisma.transaccion.count(), await prisma.movimiento.count()]).toEqual(antes);
  });
});
