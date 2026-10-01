import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { Module, type INestApplication } from '@nestjs/common';
import { APP_FILTER, NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErroresHttpFilter } from '../src/infra/errores-http.filter.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { BoletasModule } from '../src/modules/boletas/boletas.module.js';
import { CosturasModule } from '../src/modules/costuras/costuras.module.js';
import { CuentasModule } from '../src/modules/cuentas/cuentas.module.js';
import { TransferenciasModule } from '../src/modules/transferencias/transferencias.module.js';

/**
 * Arnés de S-09 · la boleta de garantía por API.
 * Ver specs/S-09-boletas.md. ESTE ARCHIVO NO SE TOCA (specs/_CANDADO.md).
 *
 * ─── Por qué habla por HTTP ─────────────────────────────────────────────────────────────
 * La mitad del contrato de esta unidad SON los estados y los códigos tipados (C5): 403 para
 * quien no puede retirar, 404 para lo ajeno, 409 para la transición que no corresponde. Un
 * test contra el servicio vería excepciones, no el contrato.
 *
 * ─── Por qué adelanta el tiempo por la costura de S-07 ──────────────────────────────────
 * Ésta es LA unidad cuyo comportamiento depende del reloj, y es la razón por la que el reloj
 * fijable existe desde S-07 (C2). Un arnés que probara el vencimiento esperando no es un
 * arnés. Se adelanta por `POST /__test__/reloj`, la misma puerta que usará la suite E2E
 * externa: si el módulo llamara a `new Date()` por su cuenta, estos brazos se ponen rojos.
 *
 * ─── Por qué lee la base con Prisma ─────────────────────────────────────────────────────
 * Como ORÁCULO INDEPENDIENTE. El endpoint dice un estado y un saldo; el arnés los contrasta
 * con las filas crudas del ledger. Si le preguntara al mismo código que audita, compararía
 * la consulta consigo misma y no tendría dientes.
 *
 * ─── Por qué NO llama a /__test__/reset ─────────────────────────────────────────────────
 * El ledger es append-only (D3) y borrarlo es la costura de otra unidad. Cada caso usa un
 * titular propio con email único: las corridas no se pisan y el orden no importa. Los brazos
 * de cuadre global (grupo H) están escritos para ser ciertos con cualquier historia previa.
 */

const prisma = new PrismaService();
let app: INestApplication;
let base = '';

const SECRETO = 'arnes-s09-secreto-de-pruebas-32-min-ok';
const PASSWORD = 'clave-de-prueba-larga';

/**
 * RUT reales, con el dígito verificador calculado con el módulo 11 (no inventados).
 * El primer intento de esta lista salió MAL —el generador ciclaba el multiplicador 7→3 en vez
 * de 7→2— y lo destapó calibrar el arnés del dominio contra una implementación de referencia.
 */
const RUT_BENEFICIARIO = '12345678-5';
const RUT_RETIRADOR = '9876543-3';
const RUT_TERCERO = '7654321-6';
const RUT_MAL_DV = '12345678-3';

const GLOSA = 'Fiel cumplimiento contrato 123';
const NOMBRE_BENEFICIARIO = 'Constructora Andes SpA';
const NOMBRE_RETIRADOR = 'Ana Soto';

/** S-12: el mínimo de apertura son 1000 dólares. Las cuentas de este arnés nacen con 5000. */
const SALDO_INICIAL = '5000.00';
const MS_POR_DIA = 86_400_000;

@Module({
  // CosturasModule entra por el reloj: con el flag encendido expone POST /__test__/reloj, y
  // con el flag apagado igual exporta RelojService como global. CuentasModule entra porque
  // las cuentas con saldo se abren por su puerta pública, no sembrando filas a mano: así el
  // arnés mide contra el sistema de verdad y no contra una base que él mismo fabricó.
  imports: [
    CosturasModule.paraEntorno(),
    AuthModule,
    CuentasModule,
    TransferenciasModule,
    BoletasModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ErroresHttpFilter }],
})
class AppBoletas {}

// ─── utilidades ────────────────────────────────────────────────────────────────────────

type Respuesta = { estado: number; cuerpo: Record<string, unknown>; cabeceras: Headers };

async function pedir(
  metodo: string,
  ruta: string,
  opciones: {
    cuerpo?: unknown;
    autorizacion?: string;
    clave?: string;
    cuerpoCrudo?: string;
  } = {},
): Promise<Respuesta> {
  const headers: Record<string, string> = {};
  if (opciones.cuerpo !== undefined || opciones.cuerpoCrudo !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (opciones.autorizacion !== undefined) headers['authorization'] = opciones.autorizacion;
  if (opciones.clave !== undefined) headers['idempotency-key'] = opciones.clave;
  const init: RequestInit = { method: metodo, headers };
  if (opciones.cuerpoCrudo !== undefined) init.body = opciones.cuerpoCrudo;
  else if (opciones.cuerpo !== undefined) init.body = JSON.stringify(opciones.cuerpo);
  const r = await fetch(`${base}${ruta}`, init);
  const texto = await r.text();
  let cuerpo: unknown = null;
  try {
    cuerpo = texto === '' ? {} : JSON.parse(texto);
  } catch {
    cuerpo = { _crudo: texto };
  }
  return { estado: r.status, cuerpo: (cuerpo ?? {}) as Record<string, unknown>, cabeceras: r.headers };
}

interface Titular {
  id: string;
  email: string;
  auth: string;
  cuentaId: string;
}

// Con H1 (S-10 T4) el token vence según el reloj inyectado, no el de pared: tras mover el reloj,
// cada titular de la prueba vuelve a iniciar sesión para que su token nazca a la hora nueva.
// Es sólo preparación: ninguna aserción mira el token, y el registro se vacía antes de cada prueba.
const titularesVivos = new Set<Titular>();
async function renovarSesiones(): Promise<void> {
  for (const t of titularesVivos) {
    const login = await pedir('POST', '/auth/login', { cuerpo: { email: t.email, password: PASSWORD } });
    expect(login.estado, `el re-login falló: ${JSON.stringify(login.cuerpo)}`).toBe(200);
    t.auth = `Bearer ${String(login.cuerpo['token'])}`;
  }
}

/** Un titular registrado, con sesión y una cuenta corriente con saldo, por las puertas reales. */
async function nuevoTitular(saldo = SALDO_INICIAL): Promise<Titular> {
  const email = `boletas-${randomUUID()}@ejemplo.cl`;
  const reg = await pedir('POST', '/auth/registro', { cuerpo: { email, password: PASSWORD } });
  expect(reg.estado, `el registro falló: ${JSON.stringify(reg.cuerpo)}`).toBe(201);
  const login = await pedir('POST', '/auth/login', { cuerpo: { email, password: PASSWORD } });
  expect(login.estado, `el login falló: ${JSON.stringify(login.cuerpo)}`).toBe(200);
  const auth = `Bearer ${String(login.cuerpo['token'])}`;
  const cuenta = await pedir('POST', '/cuentas', {
    cuerpo: { tipo: 'CORRIENTE', monto: saldo },
    autorizacion: auth,
    clave: `s09-cuenta-${randomUUID()}`,
  });
  expect(cuenta.estado, `la apertura falló: ${JSON.stringify(cuenta.cuerpo)}`).toBe(201);
  const t = { id: String(reg.cuerpo['id']), email, auth, cuentaId: String(cuenta.cuerpo['id']) };
  titularesVivos.add(t);
  return t;
}

function cuerpoEmision(t: Titular, sobreescribe: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cuentaOrigenId: t.cuentaId,
    monto: '500.00',
    plazoDias: 30,
    beneficiarioRut: RUT_BENEFICIARIO,
    beneficiarioNombre: NOMBRE_BENEFICIARIO,
    glosa: GLOSA,
    retiradorRut: RUT_RETIRADOR,
    retiradorNombre: NOMBRE_RETIRADOR,
    ...sobreescribe,
  };
}

async function emitir(
  t: Titular,
  sobreescribe: Record<string, unknown> = {},
  clave = `s09-${randomUUID()}`,
): Promise<Respuesta> {
  return pedir('POST', '/boletas', {
    cuerpo: cuerpoEmision(t, sobreescribe),
    autorizacion: t.auth,
    clave,
  });
}

async function emitirOk(
  t: Titular,
  sobreescribe: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const r = await emitir(t, sobreescribe);
  expect(r.estado, `la emisión falló: ${JSON.stringify(r.cuerpo)}`).toBe(201);
  return r.cuerpo;
}

const cobrar = async (
  boletaId: string,
  rutRetirador: string = RUT_RETIRADOR,
  clave = `s09-cobro-${randomUUID()}`,
): Promise<Respuesta> =>
  pedir('POST', `/boletas/${boletaId}/cobrar`, { cuerpo: { rutRetirador }, clave });

const vencer = async (t: Titular, boletaId: string, clave = `s09-vence-${randomUUID()}`): Promise<Respuesta> =>
  pedir('POST', `/boletas/${boletaId}/vencer`, { cuerpo: {}, autorizacion: t.auth, clave });

const devolver = async (t: Titular, boletaId: string, clave = `s09-devol-${randomUUID()}`): Promise<Respuesta> =>
  pedir('POST', `/boletas/${boletaId}/devolver`, { cuerpo: {}, autorizacion: t.auth, clave });

const verUna = async (t: Titular, boletaId: string): Promise<Respuesta> =>
  pedir('GET', `/boletas/${boletaId}`, { autorizacion: t.auth });

const verTodas = async (t: Titular): Promise<Respuesta> =>
  pedir('GET', '/boletas', { autorizacion: t.auth });

// ─── el reloj, por la costura de S-07 ──────────────────────────────────────────────────

async function fijarReloj(instante: Date): Promise<void> {
  const r = await pedir('POST', '/__test__/reloj', { cuerpo: { instante: instante.toISOString() } });
  expect(r.estado, `no se pudo fijar el reloj: ${JSON.stringify(r.cuerpo)}`).toBe(200);
  await renovarSesiones();
}
async function avanzarReloj(ms: number): Promise<void> {
  const r = await pedir('POST', '/__test__/reloj', { cuerpo: { avanzarMs: ms } });
  expect(r.estado, `no se pudo avanzar el reloj: ${JSON.stringify(r.cuerpo)}`).toBe(200);
  await renovarSesiones();
}
async function soltarReloj(): Promise<void> {
  const r = await pedir('POST', '/__test__/reloj', { cuerpo: { instante: null } });
  expect(r.estado).toBe(200);
  await renovarSesiones();
}

// ─── oráculos independientes: la base cruda, sin pasar por el código auditado ──────────

async function saldoSegunElLedger(cuentaId: string): Promise<bigint> {
  const r = await prisma.movimiento.aggregate({ where: { cuentaId }, _sum: { montoCentavos: true } });
  return r._sum.montoCentavos ?? 0n;
}

async function cuentaDeSistema(codigo: string): Promise<string | null> {
  const c = await prisma.cuenta.findUnique({ where: { codigo } });
  return c?.id ?? null;
}

async function saldoDeGarantia(): Promise<bigint> {
  const id = await cuentaDeSistema('GARANTIA');
  return id === null ? 0n : saldoSegunElLedger(id);
}

async function filasDelLedger(): Promise<{ movimientos: number; transacciones: number }> {
  return {
    movimientos: await prisma.movimiento.count(),
    transacciones: await prisma.transaccion.count(),
  };
}

async function boletaEnBase(id: string): Promise<{
  estado: string;
  montoCentavos: bigint;
  transaccionCierreId: string | null;
  beneficiarioRut: string;
  retiradorRut: string;
} | null> {
  const b = await prisma.boleta.findUnique({ where: { id } });
  if (b === null) return null;
  return {
    estado: b.estado,
    montoCentavos: b.montoCentavos,
    transaccionCierreId: b.transaccionCierreId,
    beneficiarioRut: b.beneficiarioRut,
    retiradorRut: b.retiradorRut,
  };
}

async function movimientosDe(transaccionId: string): Promise<Array<{ cuentaId: string; monto: bigint }>> {
  const filas = await prisma.movimiento.findMany({ where: { transaccionId } });
  return filas.map((f) => ({ cuentaId: f.cuentaId, monto: f.montoCentavos }));
}

async function conceptoDe(transaccionId: string): Promise<string | null> {
  const t = await prisma.transaccion.findUnique({ where: { id: transaccionId } });
  return t?.concepto ?? null;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CLAVES_DTO = [
  'id',
  'estado',
  'monto',
  'cuentaOrigenId',
  'beneficiarioRut',
  'beneficiarioNombre',
  'glosa',
  'retiradorRut',
  'retiradorNombre',
  'emitidaEn',
  'venceEn',
  // S-23 (J1): aditivo y AL FINAL. Los brazos A1, D1, D3 y E1 comparan las claves en orden.
  'fondosLiberados',
];

beforeAll(async () => {
  process.env['ZFB_AUTH_SECRET'] = SECRETO;
  process.env['ZFB_COSTURAS_PRUEBA'] = '1';
  app = await NestFactory.create(AppBoletas, { logger: false });
  await app.listen(0);
  base = (await app.getUrl()).replace('[::1]', 'localhost');
});

beforeEach(() => titularesVivos.clear());

afterAll(async () => {
  titularesVivos.clear();
  await soltarReloj().catch(() => undefined);
  await app?.close();
  await prisma.$disconnect();
});

// ═══ A · emisión: el documento y la inmovilización ═════════════════════════════════════

describe('A · emitir una boleta', () => {
  it('A1 · devuelve 201 con las trece claves del contrato, en orden', async () => {
    const t = await nuevoTitular();
    const r = await emitir(t);
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(201);
    expect(Object.keys(r.cuerpo)).toEqual([...CLAVES_DTO, 'transaccionId']);
    expect(String(r.cuerpo['id'])).toMatch(UUID_REGEX);
    expect(r.cuerpo['estado']).toBe('VIGENTE');
    expect(r.cuerpo['monto']).toBe('500.00');
    expect(r.cuerpo['cuentaOrigenId']).toBe(t.cuentaId);
    expect(r.cuerpo['glosa']).toBe(GLOSA);
    expect(String(r.cuerpo['transaccionId'])).toMatch(UUID_REGEX);
  });

  it('A2 · INMOVILIZA: la cuenta baja y la garantía sube exactamente lo mismo', async () => {
    const t = await nuevoTitular();
    const antesCuenta = await saldoSegunElLedger(t.cuentaId);
    const antesGarantia = await saldoDeGarantia();
    await emitirOk(t);
    expect(await saldoSegunElLedger(t.cuentaId)).toBe(antesCuenta - 50000n);
    expect(await saldoDeGarantia()).toBe(antesGarantia + 50000n);
  });

  it('A3 · el asiento tiene DOS movimientos que suman cero (D2) y el concepto versionado', async () => {
    const t = await nuevoTitular();
    const b = await emitirOk(t);
    const movs = await movimientosDe(String(b['transaccionId']));
    expect(movs).toHaveLength(2);
    expect(movs.reduce((s, m) => s + m.monto, 0n)).toBe(0n);
    expect(await conceptoDe(String(b['transaccionId']))).toBe('EMISION_BOLETA');
    const garantiaId = await cuentaDeSistema('GARANTIA');
    expect(movs.find((m) => m.cuentaId === t.cuentaId)?.monto).toBe(-50000n);
    expect(movs.find((m) => m.cuentaId === garantiaId)?.monto).toBe(50000n);
  });

  it('A4 · la fila guardada lleva el documento completo y su traza al ledger', async () => {
    const t = await nuevoTitular();
    const b = await emitirOk(t);
    const enBase = await prisma.boleta.findUniqueOrThrow({ where: { id: String(b['id']) } });
    expect(enBase.estado).toBe('VIGENTE');
    expect(enBase.montoCentavos).toBe(50000n);
    expect(enBase.beneficiarioNombre).toBe(NOMBRE_BENEFICIARIO);
    expect(enBase.glosa).toBe(GLOSA);
    expect(enBase.retiradorNombre).toBe(NOMBRE_RETIRADOR);
    expect(enBase.transaccionEmisionId).toBe(String(b['transaccionId']));
    expect(enBase.transaccionCierreId).toBeNull();
  });

  it('A5 · el RUT se guarda NORMALIZADO, venga como venga', async () => {
    const t = await nuevoTitular();
    const b = await emitirOk(t, { beneficiarioRut: ' 12.345.678-5 ', retiradorRut: '9876543-3' });
    expect(b['beneficiarioRut']).toBe(RUT_BENEFICIARIO);
    const enBase = await boletaEnBase(String(b['id']));
    expect(enBase?.beneficiarioRut).toBe(RUT_BENEFICIARIO);
  });

  it('A6 · emitidaEn y venceEn salen del RELOJ INYECTADO, no del reloj de pared', async () => {
    const t = await nuevoTitular();
    const t0 = new Date('2030-03-01T12:00:00.000Z');
    await fijarReloj(t0);
    try {
      const b = await emitirOk(t, { plazoDias: 10 });
      expect(b['emitidaEn']).toBe(t0.toISOString());
      expect(b['venceEn']).toBe(new Date(t0.getTime() + 10 * MS_POR_DIA).toISOString());
    } finally {
      await soltarReloj();
    }
  });

  it('A7 · los fondos inmovilizados NO están disponibles para la boleta siguiente', async () => {
    // 5000 de saldo, dos boletas de 3000: la segunda tiene que rebotar. Es el corazón de
    // "inmoviliza": si la primera sólo hubiera anotado algo, la segunda pasaría.
    const t = await nuevoTitular();
    await emitirOk(t, { monto: '3000.00' });
    const r = await emitir(t, { monto: '3000.00' });
    expect(r.estado).toBe(409);
    expect(r.cuerpo['codigo']).toBe('FONDOS_INSUFICIENTES');
  });

  it('A8 · sin fondos no hay boleta, y no queda NADA escrito', async () => {
    const t = await nuevoTitular();
    const antes = await filasDelLedger();
    const boletasAntes = await prisma.boleta.count();
    const r = await emitir(t, { monto: '9000.00' });
    expect(r.estado).toBe(409);
    expect(r.cuerpo['codigo']).toBe('FONDOS_INSUFICIENTES');
    expect(await filasDelLedger()).toEqual(antes);
    expect(await prisma.boleta.count()).toBe(boletasAntes);
  });

  it('A9 · plazoDias 1 y 365 son válidos: el rango es inclusivo', async () => {
    const t = await nuevoTitular();
    const t0 = new Date('2031-01-01T00:00:00.000Z');
    await fijarReloj(t0);
    try {
      const uno = await emitirOk(t, { monto: '100.00', plazoDias: 1 });
      expect(uno['venceEn']).toBe(new Date(t0.getTime() + MS_POR_DIA).toISOString());
      const anno = await emitirOk(t, { monto: '100.00', plazoDias: 365 });
      expect(anno['venceEn']).toBe(new Date(t0.getTime() + 365 * MS_POR_DIA).toISOString());
    } finally {
      await soltarReloj();
    }
  });
});

// ═══ B · el borde: lo que se rechaza sin tocar la base ═════════════════════════════════

describe('B · validación del cuerpo', () => {
  it('B1 · plazoDias fuera de rango, no entero o string → 400 PLAZO_INVALIDO', async () => {
    const t = await nuevoTitular();
    for (const plazoDias of [0, 366, -5, 1.5, '30', null]) {
      const r = await emitir(t, { plazoDias });
      expect(r.estado, `plazoDias=${JSON.stringify(plazoDias)} devolvió ${r.estado}`).toBe(400);
      expect(r.cuerpo['codigo']).toBe('PLAZO_INVALIDO');
    }
    const sinPlazo = await emitir(t, { plazoDias: undefined });
    expect(sinPlazo.estado).toBe(400);
    expect(sinPlazo.cuerpo['codigo']).toBe('PLAZO_INVALIDO');
  });

  it('B2 · monto cero, negativo, no parseable o number → 400 MONTO_INVALIDO (D6)', async () => {
    const t = await nuevoTitular();
    for (const monto of ['0.00', '-100.00', 'mucho', '', 500, null]) {
      const r = await emitir(t, { monto });
      expect(r.estado, `monto=${JSON.stringify(monto)} devolvió ${r.estado}`).toBe(400);
      expect(r.cuerpo['codigo']).toBe('MONTO_INVALIDO');
    }
  });

  it('B3 · RUT con dígito verificador que no cuadra → 400 RUT_INVALIDO', async () => {
    // El caso que separa validar de mirar el formato: la forma es correcta, el DV no.
    const t = await nuevoTitular();
    const ben = await emitir(t, { beneficiarioRut: RUT_MAL_DV });
    expect(ben.estado).toBe(400);
    expect(ben.cuerpo['codigo']).toBe('RUT_INVALIDO');
    const ret = await emitir(t, { retiradorRut: RUT_MAL_DV });
    expect(ret.estado).toBe(400);
    expect(ret.cuerpo['codigo']).toBe('RUT_INVALIDO');
  });

  it('B4 · RUT ausente, vacío, sin guion o no string → 400 RUT_INVALIDO', async () => {
    const t = await nuevoTitular();
    for (const rut of [undefined, '', '   ', '123456785', 12345678, null, 'abcd-5']) {
      const r = await emitir(t, { beneficiarioRut: rut });
      expect(r.estado, `rut=${JSON.stringify(rut)} devolvió ${r.estado}`).toBe(400);
      expect(r.cuerpo['codigo']).toBe('RUT_INVALIDO');
    }
  });

  it('B5 · nombres ausentes, vacíos o demasiado largos → 400 NOMBRE_INVALIDO', async () => {
    const t = await nuevoTitular();
    for (const nombre of [undefined, '', '   ', 'x'.repeat(121), 42, null]) {
      const r = await emitir(t, { beneficiarioNombre: nombre });
      expect(r.estado, `beneficiarioNombre=${JSON.stringify(nombre)}`).toBe(400);
      expect(r.cuerpo['codigo']).toBe('NOMBRE_INVALIDO');
      const r2 = await emitir(t, { retiradorNombre: nombre });
      expect(r2.estado, `retiradorNombre=${JSON.stringify(nombre)}`).toBe(400);
      expect(r2.cuerpo['codigo']).toBe('NOMBRE_INVALIDO');
    }
  });

  it('B6 · glosa ausente, vacía o demasiado larga → 400 GLOSA_INVALIDA', async () => {
    const t = await nuevoTitular();
    for (const glosa of [undefined, '', '   ', 'x'.repeat(201), 42, null]) {
      const r = await emitir(t, { glosa });
      expect(r.estado, `glosa=${JSON.stringify(glosa)}`).toBe(400);
      expect(r.cuerpo['codigo']).toBe('GLOSA_INVALIDA');
    }
  });

  it('B7 · el nombre de 120 y la glosa de 200 SÍ pasan: el límite es inclusivo', async () => {
    const t = await nuevoTitular();
    const b = await emitirOk(t, {
      beneficiarioNombre: 'x'.repeat(120),
      retiradorNombre: 'y'.repeat(120),
      glosa: 'z'.repeat(200),
    });
    expect(String(b['beneficiarioNombre'])).toHaveLength(120);
    expect(String(b['glosa'])).toHaveLength(200);
  });

  it('B8 · cuentaOrigenId inexistente, ajena o no-UUID → 404 CUENTA_NO_ENCONTRADA', async () => {
    const t = await nuevoTitular();
    const otro = await nuevoTitular();
    for (const cuentaOrigenId of [randomUUID(), otro.cuentaId, 'x', '']) {
      const r = await emitir(t, { cuentaOrigenId });
      expect(r.estado, `cuentaOrigenId=${cuentaOrigenId} devolvió ${r.estado}`).toBe(404);
      expect(r.cuerpo['codigo']).toBe('CUENTA_NO_ENCONTRADA');
    }
    // y la cuenta ajena no se movió ni un centavo
    expect(await saldoSegunElLedger(otro.cuentaId)).toBe(500000n);
  });

  it('B9 · un cuerpo rechazado no deja NI UNA fila, tampoco la clave de idempotencia', async () => {
    const t = await nuevoTitular();
    const antes = await filasDelLedger();
    const clave = `s09-rechazo-${randomUUID()}`;
    const r = await emitir(t, { plazoDias: 0 }, clave);
    expect(r.estado).toBe(400);
    expect(await filasDelLedger()).toEqual(antes);
    expect(await prisma.claveIdempotencia.findUnique({ where: { clave } })).toBeNull();
    // y el cliente que corrige el cuerpo con la MISMA clave no recibe un 409
    const corregido = await emitir(t, {}, clave);
    expect(corregido.estado, JSON.stringify(corregido.cuerpo)).toBe(201);
  });

  it('B10 · cuerpo que no es JSON → 400 CUERPO_INVALIDO', async () => {
    const t = await nuevoTitular();
    const r = await pedir('POST', '/boletas', {
      cuerpoCrudo: '{roto',
      autorizacion: t.auth,
      clave: `s09-${randomUUID()}`,
    });
    expect(r.estado).toBe(400);
    expect(r.cuerpo['codigo']).toBe('CUERPO_INVALIDO');
  });
});

// ═══ C · token e idempotencia ══════════════════════════════════════════════════════════

describe('C · token e idempotencia en la emisión', () => {
  it('C1 · sin token → 401 TOKEN_AUSENTE; token roto → 401 TOKEN_INVALIDO', async () => {
    const t = await nuevoTitular();
    const sin = await pedir('POST', '/boletas', {
      cuerpo: cuerpoEmision(t),
      clave: `s09-${randomUUID()}`,
    });
    expect(sin.estado).toBe(401);
    expect(sin.cuerpo['codigo']).toBe('TOKEN_AUSENTE');
    const roto = await pedir('POST', '/boletas', {
      cuerpo: cuerpoEmision(t),
      autorizacion: 'Bearer no.es.un.token',
      clave: `s09-${randomUUID()}`,
    });
    expect(roto.estado).toBe(401);
    expect(roto.cuerpo['codigo']).toBe('TOKEN_INVALIDO');
  });

  it('C2 · sin Idempotency-Key → 400, y con una de 201 caracteres → 400', async () => {
    const t = await nuevoTitular();
    const sin = await pedir('POST', '/boletas', { cuerpo: cuerpoEmision(t), autorizacion: t.auth });
    expect(sin.estado).toBe(400);
    expect(sin.cuerpo['codigo']).toBe('IDEMPOTENCY_KEY_AUSENTE');
    const larga = await emitir(t, {}, 'k'.repeat(201));
    expect(larga.estado).toBe(400);
    expect(larga.cuerpo['codigo']).toBe('IDEMPOTENCY_KEY_INVALIDA');
  });

  it('C3 · la misma clave con el mismo cuerpo devuelve el REPLAY, y una sola boleta', async () => {
    const t = await nuevoTitular();
    const clave = `s09-replay-${randomUUID()}`;
    const primera = await emitir(t, {}, clave);
    expect(primera.estado).toBe(201);
    const antes = await filasDelLedger();
    const segunda = await emitir(t, {}, clave);
    expect(segunda.estado).toBe(201);
    expect(segunda.cabeceras.get('idempotency-replayed')).toBe('true');
    expect(segunda.cuerpo).toEqual(primera.cuerpo);
    expect(await filasDelLedger()).toEqual(antes);
    expect(await prisma.boleta.count({ where: { cuentaId: t.cuentaId } })).toBe(1);
  });

  it('C4 · la misma clave con otro cuerpo → 409 IDEMPOTENCY_KEY_REUSADA', async () => {
    const t = await nuevoTitular();
    const clave = `s09-reuso-${randomUUID()}`;
    expect((await emitir(t, {}, clave)).estado).toBe(201);
    const otra = await emitir(t, { monto: '600.00' }, clave);
    expect(otra.estado).toBe(409);
    expect(otra.cuerpo['codigo']).toBe('IDEMPOTENCY_KEY_REUSADA');
  });

  it('C5 · dos titulares con la misma clave no se roban la boleta', async () => {
    const a = await nuevoTitular();
    const b = await nuevoTitular();
    const clave = `s09-compartida-${randomUUID()}`;
    const deA = await emitir(a, {}, clave);
    expect(deA.estado).toBe(201);
    const deB = await emitir(b, {}, clave);
    expect(deB.estado, 'B recibió la boleta de A: el titular no está en la huella').toBe(409);
    expect(deB.cuerpo['codigo']).toBe('IDEMPOTENCY_KEY_REUSADA');
  });
});

// ═══ D · lectura, y el estado que lo decide el reloj ═══════════════════════════════════

describe('D · leer boletas', () => {
  it('D1 · GET /boletas devuelve sólo las del titular, ordenadas y sin transaccionId', async () => {
    const t = await nuevoTitular();
    const ajeno = await nuevoTitular();
    await emitirOk(ajeno, { monto: '100.00' });
    const b1 = await emitirOk(t, { monto: '100.00' });
    const b2 = await emitirOk(t, { monto: '200.00' });
    const r = await verTodas(t);
    expect(r.estado).toBe(200);
    const lista = r.cuerpo['boletas'] as Array<Record<string, unknown>>;
    expect(lista.map((b) => b['id'])).toEqual([b1['id'], b2['id']]);
    expect(Object.keys(lista[0]!)).toEqual(CLAVES_DTO);
  });

  it('D2 · un titular sin boletas recibe 200 con la lista vacía, no un 404', async () => {
    const t = await nuevoTitular();
    const r = await verTodas(t);
    expect(r.estado).toBe(200);
    expect(r.cuerpo['boletas']).toEqual([]);
  });

  it('D3 · GET /boletas/{id} devuelve el DTO; ajena e inexistente responden IDÉNTICO', async () => {
    const t = await nuevoTitular();
    const otro = await nuevoTitular();
    const b = await emitirOk(t);
    const mia = await verUna(t, String(b['id']));
    expect(mia.estado).toBe(200);
    expect(Object.keys(mia.cuerpo)).toEqual(CLAVES_DTO);

    const ajena = await verUna(otro, String(b['id']));
    const inexistente = await verUna(otro, randomUUID());
    expect(ajena.estado).toBe(404);
    expect(inexistente.estado).toBe(404);
    expect(ajena.cuerpo).toEqual(inexistente.cuerpo);
    expect(ajena.cuerpo['codigo']).toBe('BOLETA_NO_ENCONTRADA');
  });

  it('D4 · un id que no es UUID da 404, nunca un 500 de la base', async () => {
    const t = await nuevoTitular();
    const r = await verUna(t, 'no-soy-un-uuid');
    expect(r.estado, `devolvió ${r.estado}: ${JSON.stringify(r.cuerpo)}`).toBe(404);
    expect(r.cuerpo['codigo']).toBe('BOLETA_NO_ENCONTRADA');
  });

  it('D5 · pasado el vencimiento se lee VENCIDA aunque la columna siga en VIGENTE', async () => {
    const t = await nuevoTitular();
    await fijarReloj(new Date('2032-05-01T00:00:00.000Z'));
    try {
      const b = await emitirOk(t, { plazoDias: 1 });
      expect((await verUna(t, String(b['id']))).cuerpo['estado']).toBe('VIGENTE');
      await avanzarReloj(MS_POR_DIA);
      const despues = await verUna(t, String(b['id']));
      expect(despues.cuerpo['estado'], 'el estado expuesto no salió de estadoEn()').toBe('VENCIDA');
      // ...y NADIE lo materializó: la columna sigue como estaba y el ledger no se movió
      expect((await boletaEnBase(String(b['id'])))?.estado).toBe('VIGENTE');
    } finally {
      await soltarReloj();
    }
  });

  it('D6 · GET no exige Idempotency-Key pero sí token', async () => {
    const t = await nuevoTitular();
    const b = await emitirOk(t);
    expect((await verUna(t, String(b['id']))).estado).toBe(200);
    const sinToken = await pedir('GET', `/boletas/${String(b['id'])}`);
    expect(sinToken.estado).toBe(401);
    expect(sinToken.cuerpo['codigo']).toBe('TOKEN_AUSENTE');
  });
});

// ═══ E · cobro: el instrumento se presenta, no se pide permiso ═════════════════════════

describe('E · cobrar', () => {
  it('E1 · cobra SIN token y devuelve el DTO en COBRADA más el asiento', async () => {
    const t = await nuevoTitular();
    const b = await emitirOk(t);
    const r = await cobrar(String(b['id']));
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(200);
    expect(Object.keys(r.cuerpo)).toEqual([...CLAVES_DTO, 'transaccionId']);
    expect(r.cuerpo['estado']).toBe('COBRADA');
    expect(await conceptoDe(String(r.cuerpo['transaccionId']))).toBe('COBRO_BOLETA');
  });

  it('E2 · el dinero sale de la garantía hacia la caja, y NO vuelve al tomador', async () => {
    const t = await nuevoTitular();
    const b = await emitirOk(t);
    const cuentaTrasEmitir = await saldoSegunElLedger(t.cuentaId);
    const garantiaAntes = await saldoDeGarantia();
    const cajaId = await cuentaDeSistema('CAJA');
    expect(cajaId, 'la caja tiene que existir: las cuentas se abren desde ella').not.toBeNull();
    const cajaAntes = await saldoSegunElLedger(cajaId!);

    const r = await cobrar(String(b['id']));
    expect(r.estado).toBe(200);

    expect(await saldoDeGarantia()).toBe(garantiaAntes - 50000n);
    expect(await saldoSegunElLedger(cajaId!)).toBe(cajaAntes + 50000n);
    expect(await saldoSegunElLedger(t.cuentaId), 'el cobro le devolvió la plata al tomador').toBe(
      cuentaTrasEmitir,
    );
    const movs = await movimientosDe(String(r.cuerpo['transaccionId']));
    expect(movs).toHaveLength(2);
    expect(movs.reduce((s, m) => s + m.monto, 0n)).toBe(0n);
  });

  it('E3 · la fila queda COBRADA y con su transacción de cierre', async () => {
    const t = await nuevoTitular();
    const b = await emitirOk(t);
    const r = await cobrar(String(b['id']));
    const enBase = await boletaEnBase(String(b['id']));
    expect(enBase?.estado).toBe('COBRADA');
    expect(enBase?.transaccionCierreId).toBe(String(r.cuerpo['transaccionId']));
  });

  it('E4 · con el RUT del beneficiario (no el del retirador) → 403 y nada se mueve', async () => {
    const t = await nuevoTitular();
    const b = await emitirOk(t);
    const garantiaAntes = await saldoDeGarantia();
    const filasAntes = await filasDelLedger();
    const r = await cobrar(String(b['id']), RUT_BENEFICIARIO);
    expect(r.estado).toBe(403);
    expect(r.cuerpo['codigo']).toBe('RETIRADOR_NO_AUTORIZADO');
    expect(await saldoDeGarantia()).toBe(garantiaAntes);
    expect(await filasDelLedger()).toEqual(filasAntes);
    expect((await boletaEnBase(String(b['id'])))?.estado).toBe('VIGENTE');
  });

  it('E5 · con un RUT de tercero → 403; con un RUT inválido → 400', async () => {
    const t = await nuevoTitular();
    const b = await emitirOk(t);
    const tercero = await cobrar(String(b['id']), RUT_TERCERO);
    expect(tercero.estado).toBe(403);
    expect(tercero.cuerpo['codigo']).toBe('RETIRADOR_NO_AUTORIZADO');
    const malo = await cobrar(String(b['id']), RUT_MAL_DV);
    expect(malo.estado).toBe(400);
    expect(malo.cuerpo['codigo']).toBe('RUT_INVALIDO');
  });

  it('E6 · el RUT del retirador se compara NORMALIZADO: con puntos también cobra', async () => {
    const t = await nuevoTitular();
    const b = await emitirOk(t);
    const r = await cobrar(String(b['id']), ' 9.876.543-3 ');
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(200);
  });

  it('E7 · cobrar dos veces: la segunda es 409 y el ledger no cambia', async () => {
    const t = await nuevoTitular();
    const b = await emitirOk(t);
    expect((await cobrar(String(b['id']))).estado).toBe(200);
    const filasAntes = await filasDelLedger();
    const segunda = await cobrar(String(b['id']));
    expect(segunda.estado).toBe(409);
    expect(segunda.cuerpo['codigo']).toBe('TRANSICION_INVALIDA');
    expect(await filasDelLedger()).toEqual(filasAntes);
  });

  it('E8 · cobrar una boleta cuyo plazo ya venció → 409, aunque nadie la haya vencido', async () => {
    const t = await nuevoTitular();
    await fijarReloj(new Date('2033-01-01T00:00:00.000Z'));
    try {
      const b = await emitirOk(t, { plazoDias: 2 });
      await avanzarReloj(2 * MS_POR_DIA);
      const filasAntes = await filasDelLedger();
      const r = await cobrar(String(b['id']));
      expect(r.estado, 'el estado derivado no manda: cobró una boleta vencida').toBe(409);
      expect(r.cuerpo['codigo']).toBe('TRANSICION_INVALIDA');
      expect(await filasDelLedger()).toEqual(filasAntes);
    } finally {
      await soltarReloj();
    }
  });

  it('E9 · cobrar una boleta inexistente → 404, y sin Idempotency-Key → 400', async () => {
    const inexistente = await cobrar(randomUUID());
    expect(inexistente.estado).toBe(404);
    expect(inexistente.cuerpo['codigo']).toBe('BOLETA_NO_ENCONTRADA');
    const t = await nuevoTitular();
    const b = await emitirOk(t);
    const sinClave = await pedir('POST', `/boletas/${String(b['id'])}/cobrar`, {
      cuerpo: { rutRetirador: RUT_RETIRADOR },
    });
    expect(sinClave.estado).toBe(400);
    expect(sinClave.cuerpo['codigo']).toBe('IDEMPOTENCY_KEY_AUSENTE');
  });

  it('E10 · el replay del cobro no paga dos veces', async () => {
    const t = await nuevoTitular();
    const b = await emitirOk(t);
    const clave = `s09-cobro-replay-${randomUUID()}`;
    const primera = await cobrar(String(b['id']), RUT_RETIRADOR, clave);
    expect(primera.estado).toBe(200);
    const filasAntes = await filasDelLedger();
    const segunda = await cobrar(String(b['id']), RUT_RETIRADOR, clave);
    expect(segunda.estado).toBe(200);
    expect(segunda.cabeceras.get('idempotency-replayed')).toBe('true');
    expect(segunda.cuerpo).toEqual(primera.cuerpo);
    expect(await filasDelLedger()).toEqual(filasAntes);
  });
});

// ═══ F · vencimiento: el acto explícito que libera ═════════════════════════════════════

describe('F · vencer', () => {
  it('F1 · una boleta todavía vigente no se puede vencer → 409 BOLETA_NO_VENCIDA', async () => {
    const t = await nuevoTitular();
    const b = await emitirOk(t, { plazoDias: 30 });
    const filasAntes = await filasDelLedger();
    const r = await vencer(t, String(b['id']));
    expect(r.estado).toBe(409);
    expect(r.cuerpo['codigo']).toBe('BOLETA_NO_VENCIDA');
    expect(await filasDelLedger()).toEqual(filasAntes);
  });

  it('F2 · pasado el plazo, vencer devuelve 200 y DEVUELVE los fondos al tomador', async () => {
    const t = await nuevoTitular();
    await fijarReloj(new Date('2034-06-01T00:00:00.000Z'));
    try {
      const antesDeTodo = await saldoSegunElLedger(t.cuentaId);
      const b = await emitirOk(t, { plazoDias: 7 });
      const garantiaTrasEmitir = await saldoDeGarantia();
      await avanzarReloj(7 * MS_POR_DIA);

      const r = await vencer(t, String(b['id']));
      expect(r.estado, JSON.stringify(r.cuerpo)).toBe(200);
      expect(r.cuerpo['estado']).toBe('VENCIDA');
      expect(await conceptoDe(String(r.cuerpo['transaccionId']))).toBe('VENCIMIENTO_BOLETA');
      expect(await saldoSegunElLedger(t.cuentaId)).toBe(antesDeTodo);
      expect(await saldoDeGarantia()).toBe(garantiaTrasEmitir - 50000n);
      expect((await boletaEnBase(String(b['id'])))?.estado).toBe('VENCIDA');
    } finally {
      await soltarReloj();
    }
  });

  it('F3 · el borde es exclusivo: justo en venceEn ya está vencida (S-03)', async () => {
    const t = await nuevoTitular();
    const t0 = new Date('2035-02-02T00:00:00.000Z');
    await fijarReloj(t0);
    try {
      const b = await emitirOk(t, { plazoDias: 1 });
      await avanzarReloj(MS_POR_DIA - 1);
      expect((await vencer(t, String(b['id']))).estado, 'un ms antes ya la venció').toBe(409);
      await avanzarReloj(1);
      expect((await vencer(t, String(b['id']))).estado, 'justo en venceEn no la venció').toBe(200);
    } finally {
      await soltarReloj();
    }
  });

  it('F4 · vencer dos veces → 409 TRANSICION_INVALIDA y el ledger intacto', async () => {
    const t = await nuevoTitular();
    await fijarReloj(new Date('2036-03-03T00:00:00.000Z'));
    try {
      const b = await emitirOk(t, { plazoDias: 1 });
      await avanzarReloj(MS_POR_DIA);
      expect((await vencer(t, String(b['id']))).estado).toBe(200);
      const filasAntes = await filasDelLedger();
      const segunda = await vencer(t, String(b['id']));
      expect(segunda.estado).toBe(409);
      expect(segunda.cuerpo['codigo']).toBe('TRANSICION_INVALIDA');
      expect(await filasDelLedger()).toEqual(filasAntes);
    } finally {
      await soltarReloj();
    }
  });

  it('F5 · una boleta ya cobrada no se vence: 409 TRANSICION_INVALIDA, no BOLETA_NO_VENCIDA', async () => {
    const t = await nuevoTitular();
    await fijarReloj(new Date('2037-04-04T00:00:00.000Z'));
    try {
      const b = await emitirOk(t, { plazoDias: 1 });
      expect((await cobrar(String(b['id']))).estado).toBe(200);
      await avanzarReloj(MS_POR_DIA);
      const r = await vencer(t, String(b['id']));
      expect(r.estado).toBe(409);
      expect(r.cuerpo['codigo']).toBe('TRANSICION_INVALIDA');
    } finally {
      await soltarReloj();
    }
  });

  it('F6 · vencer una boleta ajena → 404, idéntico a una inexistente', async () => {
    const t = await nuevoTitular();
    const otro = await nuevoTitular();
    await fijarReloj(new Date('2038-05-05T00:00:00.000Z'));
    try {
      const b = await emitirOk(t, { plazoDias: 1 });
      await avanzarReloj(MS_POR_DIA);
      const ajena = await vencer(otro, String(b['id']));
      const inexistente = await vencer(otro, randomUUID());
      expect(ajena.estado).toBe(404);
      expect(ajena.cuerpo).toEqual(inexistente.cuerpo);
      expect((await boletaEnBase(String(b['id'])))?.estado).toBe('VIGENTE');
    } finally {
      await soltarReloj();
    }
  });

  it('F7 · vencer sin token → 401', async () => {
    const t = await nuevoTitular();
    const b = await emitirOk(t);
    const r = await pedir('POST', `/boletas/${String(b['id'])}/vencer`, {
      cuerpo: {},
      clave: `s09-${randomUUID()}`,
    });
    expect(r.estado).toBe(401);
    expect(r.cuerpo['codigo']).toBe('TOKEN_AUSENTE');
  });
});

// ═══ G · devolución ════════════════════════════════════════════════════════════════════

describe('G · devolver', () => {
  it('G1 · devolver una vigente: 200, fondos de vuelta y concepto propio', async () => {
    const t = await nuevoTitular();
    const antes = await saldoSegunElLedger(t.cuentaId);
    const b = await emitirOk(t);
    const r = await devolver(t, String(b['id']));
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(200);
    expect(r.cuerpo['estado']).toBe('DEVUELTA');
    expect(await conceptoDe(String(r.cuerpo['transaccionId']))).toBe('DEVOLUCION_BOLETA');
    expect(await saldoSegunElLedger(t.cuentaId)).toBe(antes);
    expect((await boletaEnBase(String(b['id'])))?.estado).toBe('DEVUELTA');
  });

  it('G2 · una boleta devuelta ya no se cobra ni se devuelve otra vez', async () => {
    const t = await nuevoTitular();
    const b = await emitirOk(t);
    expect((await devolver(t, String(b['id']))).estado).toBe(200);
    const filasAntes = await filasDelLedger();
    const cobro = await cobrar(String(b['id']));
    expect(cobro.estado).toBe(409);
    expect(cobro.cuerpo['codigo']).toBe('TRANSICION_INVALIDA');
    const otra = await devolver(t, String(b['id']));
    expect(otra.estado).toBe(409);
    expect(await filasDelLedger()).toEqual(filasAntes);
  });

  it('G3 · una boleta cobrada no se devuelve', async () => {
    const t = await nuevoTitular();
    const b = await emitirOk(t);
    expect((await cobrar(String(b['id']))).estado).toBe(200);
    const r = await devolver(t, String(b['id']));
    expect(r.estado).toBe(409);
    expect(r.cuerpo['codigo']).toBe('TRANSICION_INVALIDA');
  });

  it('G4 · una boleta con el plazo cumplido no se devuelve: hay que vencerla', async () => {
    const t = await nuevoTitular();
    await fijarReloj(new Date('2039-06-06T00:00:00.000Z'));
    try {
      const b = await emitirOk(t, { plazoDias: 1 });
      await avanzarReloj(MS_POR_DIA);
      const r = await devolver(t, String(b['id']));
      expect(r.estado).toBe(409);
      expect(r.cuerpo['codigo']).toBe('TRANSICION_INVALIDA');
    } finally {
      await soltarReloj();
    }
  });

  it('G5 · devolver una boleta ajena → 404 y la boleta sigue vigente', async () => {
    const t = await nuevoTitular();
    const otro = await nuevoTitular();
    const b = await emitirOk(t);
    const r = await devolver(otro, String(b['id']));
    expect(r.estado).toBe(404);
    expect(r.cuerpo['codigo']).toBe('BOLETA_NO_ENCONTRADA');
    expect((await boletaEnBase(String(b['id'])))?.estado).toBe('VIGENTE');
  });
});

// ═══ H · concurrencia y cuadre ═════════════════════════════════════════════════════════

describe('H · el doble gasto y el cuadre de la garantía', () => {
  it('H1 · 3 rondas de 32 cobros simultáneos: pasa EXACTAMENTE uno por ronda', async () => {
    // D4 aplicado a esta unidad. Sin el SELECT ... FOR UPDATE sobre la boleta, varios cobros
    // leen VIGENTE a la vez, pasan todos, y la garantía se paga varias veces.
    //
    // ⚠️ ESTE BRAZO NACIÓ CIEGO Y SE ENDURECIÓ CON EL NÚMERO MEDIDO. La primera
    // versión lanzaba OCHO cobros en UNA ronda y daba VERDE sobre el código sin bloqueo,
    // 3 corridas de 3: ocho peticiones no alcanzan a solaparse en la ventana crítica. Con 32
    // el defecto aparece (10 éxitos de 32), pero no siempre. Tasa de detección MEDIDA contra
    // el código sin FOR UPDATE, el 2026-09-07:
    //     8 cobros × 1 ronda   → 0 de 3 corridas en rojo   (CIEGO)
    //    32 cobros × 1 ronda   → 2 de 3 rondas en rojo
    //    32 cobros × 3 rondas  → 3 de 3 corridas en rojo
    // Un árbitro probabilístico declara su tasa junto al resultado.
    //
    // Y el COLCHÓN no es decoración: sin una boleta ajena vigente, la garantía se queda en
    // cero tras el primer cobro y los demás rebotan por FONDOS_INSUFICIENTES. El brazo se
    // pondría verde por el mecanismo equivocado, que es cómo nació ciego la primera vez.
    const RONDAS = 3;
    const COBROS = 32;
    for (let ronda = 1; ronda <= RONDAS; ronda++) {
      const colchon = await nuevoTitular();
      await emitirOk(colchon, { monto: '2000.00' });

      const t = await nuevoTitular();
      const b = await emitirOk(t);
      const garantiaAntes = await saldoDeGarantia();

      const resultados = await Promise.all(
        Array.from({ length: COBROS }, () => cobrar(String(b['id']))),
      );
      const exitos = resultados.filter((r) => r.estado === 200);
      const estados = resultados.map((r) => r.estado).join(' ');

      expect(exitos.length, `ronda ${ronda} · estados devueltos: ${estados}`).toBe(1);
      expect(
        resultados.filter((r) => r.estado === 409).length,
        `ronda ${ronda} · alguien rebotó por algo que no es la transición: ${estados}`,
      ).toBe(COBROS - 1);
      expect(
        await saldoDeGarantia(),
        `ronda ${ronda} · la garantía se pagó más de una vez`,
      ).toBe(garantiaAntes - 50000n);
      const movs = await prisma.movimiento.count({
        where: { transaccion: { concepto: 'COBRO_BOLETA' }, cuentaId: t.cuentaId },
      });
      expect(movs, `ronda ${ronda} · el cobro le devolvió plata al tomador`).toBe(0);
    }
  });

  it('H2 · emisión y devolución simultáneas no dejan la cuenta en descubierto', async () => {
    // Cuatro emisiones de 2000 sobre un saldo de 5000: como mucho dos pueden pasar.
    const t = await nuevoTitular();
    const resultados = await Promise.all(
      Array.from({ length: 4 }, () => emitir(t, { monto: '2000.00' })),
    );
    const exitos = resultados.filter((r) => r.estado === 201).length;
    const estados = resultados.map((r) => r.estado).join(' ');
    // Las dos mitades. Sin el techo, cuatro emisiones dejarían la cuenta en -3000; sin el
    // piso, un módulo que rechazara TODO pasaría este brazo sin hacer nada (y de hecho lo
    // hacía: con BoletasModule vacío los cuatro daban 404 y el brazo se ponía verde).
    expect(exitos, `estados: ${estados}`).toBeLessThanOrEqual(2);
    expect(exitos, `no pasó ninguna emisión: ${estados}`).toBeGreaterThanOrEqual(1);
    expect(await saldoSegunElLedger(t.cuentaId)).toBeGreaterThanOrEqual(0n);
  });

  it('H3 · V3 · el saldo de la garantía es la suma exacta de las boletas VIGENTES', async () => {
    // El cuadre propio de esta unidad, y es GLOBAL: cierto con cualquier historia previa.
    // Si una boleta se cerrara sin liberar, o liberara sin cerrarse, este número deja de dar.
    const t = await nuevoTitular();
    await emitirOk(t, { monto: '700.00' });
    const b = await emitirOk(t, { monto: '300.00' });
    await devolver(t, String(b['id']));

    expect(await prisma.boleta.count({ where: { estado: 'VIGENTE' } })).toBeGreaterThanOrEqual(1);
    const vigentes = await prisma.boleta.aggregate({
      where: { estado: 'VIGENTE' },
      _sum: { montoCentavos: true },
    });
    expect(await saldoDeGarantia()).toBe(vigentes._sum.montoCentavos ?? 0n);
  });

  it('H4 · I1 · toda transacción de boleta suma exactamente cero', async () => {
    // Con población propia: un invariante global sobre una base sin boletas es verdadero por
    // vacuidad, y un brazo que no puede fallar es decoración (ARNES.md R1).
    const t = await nuevoTitular();
    const viva = await emitirOk(t, { monto: '400.00' });
    const cerrada = await emitirOk(t, { monto: '250.00' });
    expect((await cobrar(String(cerrada['id']))).estado).toBe(200);
    const contadas = await prisma.transaccion.count({
      where: { concepto: { in: ['EMISION_BOLETA', 'COBRO_BOLETA'] } },
    });
    expect(contadas, 'no hay asientos de boleta que auditar').toBeGreaterThanOrEqual(3);
    expect(String(viva['estado'])).toBe('VIGENTE');

    const descuadradas = await prisma.$queryRaw<Array<{ id: string; suma: bigint }>>`
      SELECT t.id, SUM(m.monto_centavos)::bigint AS suma
      FROM transaccion t JOIN movimiento m ON m.transaccion_id = t.id
      WHERE t.concepto IN ('EMISION_BOLETA','COBRO_BOLETA','VENCIMIENTO_BOLETA','DEVOLUCION_BOLETA')
      GROUP BY t.id HAVING SUM(m.monto_centavos) <> 0`;
    expect(descuadradas).toEqual([]);
  });

  it('H5 · toda boleta cerrada tiene su asiento de cierre, y toda vigente no lo tiene', async () => {
    // También con población propia, y de los dos lados: una vigente y una cerrada. Sin esto
    // el brazo se pone verde sobre una base vacía, que es lo que hacía antes de endurecerlo.
    const t = await nuevoTitular();
    await emitirOk(t, { monto: '150.00' });
    const cerrada = await emitirOk(t, { monto: '150.00' });
    expect((await devolver(t, String(cerrada['id']))).estado).toBe(200);
    expect(await prisma.boleta.count({ where: { estado: 'VIGENTE' } })).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.boleta.count({ where: { estado: { in: ['COBRADA', 'VENCIDA', 'DEVUELTA'] } } }),
      'no hay boletas cerradas que auditar',
    ).toBeGreaterThanOrEqual(1);

    const cerradasSinAsiento = await prisma.boleta.count({
      where: { estado: { in: ['COBRADA', 'VENCIDA', 'DEVUELTA'] }, transaccionCierreId: null },
    });
    const vigentesConAsiento = await prisma.boleta.count({
      where: { estado: 'VIGENTE', NOT: { transaccionCierreId: null } },
    });
    expect(cerradasSinAsiento, 'hay boletas cerradas sin asiento de cierre').toBe(0);
    expect(vigentesConAsiento, 'hay boletas vigentes con asiento de cierre').toBe(0);
  });
});

// ═══ I · S-23 · fondosLiberados: la VENCIDA por liberar y la ya liberada no se confunden ═══
//
// Ver specs/S-23-boletas-seed.md. El campo sale del asiento de cierre (J2), NO del estado
// calculado: `estadoEn` dice VENCIDA antes y después de liberar, y ése es el hueco de HU-02 § 6.
// Cada brazo mira las TRES lecturas del mismo dato (la respuesta del POST, GET /:id y la lista):
// un contrato que se cumple en una sola puerta no se cumple.

/** Las dos lecturas GET de una boleta, reducidas a lo que el grupo I compara. */
async function leidaPorLosDosGet(
  t: Titular,
  boletaId: string,
): Promise<{ una: unknown; enLista: unknown }> {
  const una = await verUna(t, boletaId);
  const todas = await verTodas(t);
  const fila = (todas.cuerpo['boletas'] as Array<Record<string, unknown>>).find((b) => b['id'] === boletaId);
  return {
    una: { estado: una.cuerpo['estado'], fondosLiberados: una.cuerpo['fondosLiberados'] },
    enLista: fila === undefined ? 'NO ESTÁ EN LA LISTA' : { estado: fila['estado'], fondosLiberados: fila['fondosLiberados'] },
  };
}

describe('I · S-23 · el campo fondosLiberados', () => {
  it('I1 · una VIGENTE recién emitida dice false en el POST y en los dos GET', async () => {
    const t = await nuevoTitular();
    const r = await emitir(t);
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(201);
    const id = String(r.cuerpo['id']);
    expect({
      post: { estado: r.cuerpo['estado'], fondosLiberados: r.cuerpo['fondosLiberados'] },
      ...(await leidaPorLosDosGet(t, id)),
    }).toEqual({
      post: { estado: 'VIGENTE', fondosLiberados: false },
      una: { estado: 'VIGENTE', fondosLiberados: false },
      enLista: { estado: 'VIGENTE', fondosLiberados: false },
    });
  });

  it('I2 · pasada de fecha y SIN liberar: VENCIDA con false (la que ofrece «Liberar fondos»)', async () => {
    const t = await nuevoTitular();
    await fijarReloj(new Date('2035-02-01T00:00:00.000Z'));
    try {
      const b = await emitirOk(t, { plazoDias: 1 });
      await avanzarReloj(MS_POR_DIA);
      expect(await leidaPorLosDosGet(t, String(b['id']))).toEqual({
        una: { estado: 'VENCIDA', fondosLiberados: false },
        enLista: { estado: 'VENCIDA', fondosLiberados: false },
      });
    } finally {
      await soltarReloj();
    }
  });

  it('I3 · después de vencer: VENCIDA con true, en el POST y en los dos GET', async () => {
    const t = await nuevoTitular();
    await fijarReloj(new Date('2035-03-01T00:00:00.000Z'));
    try {
      const b = await emitirOk(t, { plazoDias: 1 });
      await avanzarReloj(MS_POR_DIA);
      const r = await vencer(t, String(b['id']));
      expect(r.estado, JSON.stringify(r.cuerpo)).toBe(200);
      expect({
        post: { estado: r.cuerpo['estado'], fondosLiberados: r.cuerpo['fondosLiberados'] },
        ...(await leidaPorLosDosGet(t, String(b['id']))),
      }).toEqual({
        post: { estado: 'VENCIDA', fondosLiberados: true },
        una: { estado: 'VENCIDA', fondosLiberados: true },
        enLista: { estado: 'VENCIDA', fondosLiberados: true },
      });
    } finally {
      await soltarReloj();
    }
  });

  it('I4 · después de cobrar: COBRADA con true, en el POST y en los dos GET', async () => {
    const t = await nuevoTitular();
    const b = await emitirOk(t);
    const r = await cobrar(String(b['id']));
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(200);
    expect({
      post: { estado: r.cuerpo['estado'], fondosLiberados: r.cuerpo['fondosLiberados'] },
      ...(await leidaPorLosDosGet(t, String(b['id']))),
    }).toEqual({
      post: { estado: 'COBRADA', fondosLiberados: true },
      una: { estado: 'COBRADA', fondosLiberados: true },
      enLista: { estado: 'COBRADA', fondosLiberados: true },
    });
  });

  it('I5 · después de devolver: DEVUELTA con true, en el POST y en los dos GET', async () => {
    const t = await nuevoTitular();
    const b = await emitirOk(t);
    const r = await devolver(t, String(b['id']));
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(200);
    expect({
      post: { estado: r.cuerpo['estado'], fondosLiberados: r.cuerpo['fondosLiberados'] },
      ...(await leidaPorLosDosGet(t, String(b['id']))),
    }).toEqual({
      post: { estado: 'DEVUELTA', fondosLiberados: true },
      una: { estado: 'DEVUELTA', fondosLiberados: true },
      enLista: { estado: 'DEVUELTA', fondosLiberados: true },
    });
  });

  it('I6 · el replay de una clave guardada ANTES de S-23 (sin el campo) da 200, no 500 (J3)', async () => {
    const t = await nuevoTitular();
    const clave = `s23-replay-viejo-${randomUUID()}`;
    const primera = await emitir(t, {}, clave);
    expect(primera.estado, JSON.stringify(primera.cuerpo)).toBe(201);

    // La fila tal como la habría dejado el código anterior: la misma respuesta, sin el campo.
    const fila = await prisma.claveIdempotencia.findUnique({ where: { clave } });
    expect(fila, 'la emisión no guardó su clave').not.toBeNull();
    const guardada = { ...(fila!.respuesta as Record<string, unknown>) };
    delete guardada['fondosLiberados'];
    await prisma.claveIdempotencia.update({ where: { clave }, data: { respuesta: guardada as Prisma.InputJsonObject } });

    const antes = await filasDelLedger();
    const replay = await emitir(t, {}, clave);
    expect({
      estado: replay.estado,
      replayed: replay.cabeceras.get('idempotency-replayed'),
      id: replay.cuerpo['id'],
      fondosLiberados: replay.cuerpo['fondosLiberados'],
      ledgerIntacto: JSON.stringify(await filasDelLedger()) === JSON.stringify(antes),
    }).toEqual({
      estado: 201,
      replayed: 'true',
      id: primera.cuerpo['id'],
      fondosLiberados: false,
      ledgerIntacto: true,
    });
  });

  it('I7 · el replay de un CIERRE guardado antes de S-23 completa el campo en true, no en false (J3)', async () => {
    // I6 sólo miraba la rama de la emisión. Una reconstrucción que
    // completara SIEMPRE con false pasaba, y la pantalla ofrecería «Liberar fondos» de más.
    const t = await nuevoTitular();
    const b = await emitirOk(t);
    const clave = `s23-replay-cierre-${randomUUID()}`;
    const primera = await devolver(t, String(b['id']), clave);
    expect(primera.estado, JSON.stringify(primera.cuerpo)).toBe(200);

    const fila = await prisma.claveIdempotencia.findUnique({ where: { clave } });
    expect(fila, 'la devolución no guardó su clave').not.toBeNull();
    const guardada = { ...(fila!.respuesta as Record<string, unknown>) };
    delete guardada['fondosLiberados'];
    await prisma.claveIdempotencia.update({ where: { clave }, data: { respuesta: guardada as Prisma.InputJsonObject } });

    const replay = await devolver(t, String(b['id']), clave);
    expect({
      estado: replay.estado,
      replayed: replay.cabeceras.get('idempotency-replayed'),
      estadoBoleta: replay.cuerpo['estado'],
      fondosLiberados: replay.cuerpo['fondosLiberados'],
    }).toEqual({ estado: 200, replayed: 'true', estadoBoleta: 'DEVUELTA', fondosLiberados: true });
  });
});

// ═══ J · S-23 · seed 'boletas-en-cada-estado': una boleta por estado, con credencial ════
//
// La tabla de la spec (§ Constantes), escrita acá A MANO y no leída del seed: si el arnés
// comparara el seed consigo mismo no tendría dientes. F = el reloj al sembrar; d = un día.

const ETIQUETAS = ['VIGENTE', 'VENCIDA_POR_LIBERAR', 'VENCIDA_LIBERADA', 'COBRADA', 'DEVUELTA'] as const;
type Etiqueta = (typeof ETIQUETAS)[number];

const TABLA_S23: Record<
  Etiqueta,
  {
    montoCentavos: string;
    emitidaDias: number;
    venceDias: number;
    cierre: { concepto: string; dias: number } | null;
    estado: string;
    estadoPersistido: string;
    fondosLiberados: boolean;
  }
> = {
  VIGENTE: { montoCentavos: '16000', emitidaDias: -1, venceDias: 29, cierre: null, estado: 'VIGENTE', estadoPersistido: 'VIGENTE', fondosLiberados: false },
  VENCIDA_POR_LIBERAR: { montoCentavos: '8000', emitidaDias: -31, venceDias: -1, cierre: null, estado: 'VENCIDA', estadoPersistido: 'VIGENTE', fondosLiberados: false },
  VENCIDA_LIBERADA: { montoCentavos: '4000', emitidaDias: -32, venceDias: -2, cierre: { concepto: 'SIEMBRA_BOLETA_VENCIMIENTO', dias: -1 }, estado: 'VENCIDA', estadoPersistido: 'VENCIDA', fondosLiberados: true },
  COBRADA: { montoCentavos: '2000', emitidaDias: -20, venceDias: 10, cierre: { concepto: 'SIEMBRA_BOLETA_COBRO', dias: -10 }, estado: 'COBRADA', estadoPersistido: 'COBRADA', fondosLiberados: true },
  DEVUELTA: { montoCentavos: '1000', emitidaDias: -15, venceDias: 15, cierre: { concepto: 'SIEMBRA_BOLETA_DEVOLUCION', dias: -5 }, estado: 'DEVUELTA', estadoPersistido: 'DEVUELTA', fondosLiberados: true },
};

interface Sembrado {
  estado: number;
  cuerpo: Record<string, unknown>;
  cuentaId: string;
  email: string;
  password: string;
  ids: Record<Etiqueta, string>;
}

async function sembrarBoletas(): Promise<Sembrado> {
  const r = await pedir('POST', '/__test__/seed', { cuerpo: { escenario: 'boletas-en-cada-estado' } });
  const cuentas = (r.cuerpo['cuentas'] ?? []) as Array<Record<string, unknown>>;
  const credenciales = (r.cuerpo['credenciales'] ?? {}) as Record<string, unknown>;
  const boletas = (r.cuerpo['boletas'] ?? []) as Array<Record<string, unknown>>;
  const ids = {} as Record<Etiqueta, string>;
  for (const b of boletas) ids[String(b['etiqueta']) as Etiqueta] = String(b['id']);
  return {
    estado: r.estado,
    cuerpo: r.cuerpo,
    cuentaId: String(cuentas[0]?.['id']),
    email: String(credenciales['email']),
    password: String(credenciales['password']),
    ids,
  };
}

/** Entra con la credencial que devolvió el seed: la misma puerta que usará la suite E2E. */
async function entrarComoSembrado(s: Sembrado): Promise<{ estado: number; titular: Titular }> {
  const login = await pedir('POST', '/auth/login', { cuerpo: { email: s.email, password: s.password } });
  return {
    estado: login.estado,
    titular: { id: '', email: s.email, auth: `Bearer ${String(login.cuerpo['token'])}`, cuentaId: s.cuentaId },
  };
}

const F_S23 = new Date('2031-03-10T12:00:00.000Z');
const enDias = (dias: number): string => new Date(F_S23.getTime() + dias * MS_POR_DIA).toISOString();

describe('J · S-23 · seed boletas-en-cada-estado', () => {
  it('J1 · 201 con la forma de la spec: 5 boletas en orden, sus montos, y cada id existe en la base', async () => {
    const s = await sembrarBoletas();
    expect(s.estado, JSON.stringify(s.cuerpo)).toBe(201);
    const boletas = s.cuerpo['boletas'] as Array<Record<string, unknown>>;
    const enBase: Array<unknown> = [];
    for (const b of boletas) {
      const fila = await prisma.boleta.findUnique({ where: { id: String(b['id']) } });
      // También el estado PERSISTIDO y si tiene asiento de cierre.
      // Sin esto, una VENCIDA_POR_LIBERAR persistida VENCIDA y sin asiento se leía igual en J2.
      enBase.push(
        fila === null
          ? 'NO EXISTE'
          : {
              cuentaId: fila.cuentaId,
              montoCentavos: String(fila.montoCentavos),
              estadoPersistido: fila.estado,
              conCierre: fila.transaccionCierreId !== null,
            },
      );
    }
    expect({
      escenario: s.cuerpo['escenario'],
      etiquetas: boletas.map((b) => b['etiqueta']),
      montos: boletas.map((b) => b['montoCentavos']),
      enBase,
      credencial: { email: typeof s.cuerpo['credenciales'] === 'object' && s.email.includes('@'), password: s.password.length >= 8 },
    }).toEqual({
      escenario: 'boletas-en-cada-estado',
      etiquetas: [...ETIQUETAS],
      montos: ETIQUETAS.map((e) => TABLA_S23[e].montoCentavos),
      enBase: ETIQUETAS.map((e) => ({
        cuentaId: s.cuentaId,
        montoCentavos: TABLA_S23[e].montoCentavos,
        estadoPersistido: TABLA_S23[e].estadoPersistido,
        conCierre: TABLA_S23[e].cierre !== null,
      })),
      credencial: { email: true, password: true },
    });
  });

  it('J2 · la credencial sembrada SIRVE para entrar, y GET /boletas muestra cada una en su estado', async () => {
    const s = await sembrarBoletas();
    expect(s.estado, JSON.stringify(s.cuerpo)).toBe(201);
    const { estado, titular } = await entrarComoSembrado(s);
    expect(estado, 'la credencial que devolvió el seed no sirve para entrar').toBe(200);
    const lista = (await verTodas(titular)).cuerpo['boletas'] as Array<Record<string, unknown>>;
    const porId = new Map(lista.map((b) => [String(b['id']), b]));
    expect({
      cuantas: lista.length,
      estados: ETIQUETAS.map((e) => {
        const b = porId.get(s.ids[e]);
        return b === undefined ? `${e}: NO ESTÁ` : { etiqueta: e, estado: b['estado'], fondosLiberados: b['fondosLiberados'], monto: b['monto'] };
      }),
    }).toEqual({
      cuantas: 5,
      estados: ETIQUETAS.map((e) => ({
        etiqueta: e,
        estado: TABLA_S23[e].estado,
        fondosLiberados: TABLA_S23[e].fondosLiberados,
        monto: (Number(TABLA_S23[e].montoCentavos) / 100).toFixed(2),
      })),
    });
  });

  it('J3 · los saldos del ledger: cuenta 740,00, GARANTIA +240,00, CAJA +20,00, y el declarado es el derivado', async () => {
    const garantiaAntes = await saldoDeGarantia();
    const cajaIdAntes = await cuentaDeSistema('CAJA');
    const cajaAntes = cajaIdAntes === null ? 0n : await saldoSegunElLedger(cajaIdAntes);

    const s = await sembrarBoletas();
    expect(s.estado, JSON.stringify(s.cuerpo)).toBe(201);
    const cajaId = await cuentaDeSistema('CAJA');
    const cuentas = s.cuerpo['cuentas'] as Array<Record<string, unknown>>;

    expect({
      cuenta: String(await saldoSegunElLedger(s.cuentaId)),
      declarado: cuentas[0]?.['saldoCentavos'],
      deltaGarantia: String((await saldoDeGarantia()) - garantiaAntes),
      deltaCaja: cajaId === null ? 'NO HAY CAJA' : String((await saldoSegunElLedger(cajaId)) - cajaAntes),
    }).toEqual({ cuenta: '74000', declarado: '74000', deltaGarantia: '24000', deltaCaja: '2000' });
  });

  it('J4 · cada asiento sembrado suma 0 y cada boleta cerrada apunta a su asiento con el concepto correcto', async () => {
    const s = await sembrarBoletas();
    expect(s.estado, JSON.stringify(s.cuerpo)).toBe(201);
    const garantiaId = await cuentaDeSistema('GARANTIA');
    const cajaId = await cuentaDeSistema('CAJA');

    const porEtiqueta: Array<unknown> = [];
    for (const e of ETIQUETAS) {
      const b = await prisma.boleta.findUnique({ where: { id: s.ids[e] } });
      if (b === null) {
        porEtiqueta.push(`${e}: NO EXISTE`);
        continue;
      }
      const emision = await movimientosDe(b.transaccionEmisionId);
      const cierre = b.transaccionCierreId === null ? null : await movimientosDe(b.transaccionCierreId);
      const quien = (id: string): string =>
        id === s.cuentaId ? 'cuenta' : id === garantiaId ? 'GARANTIA' : id === cajaId ? 'CAJA' : 'OTRA';
      // Cada pata con su monto, no sólo su signo.
      const lados = (movs: Array<{ cuentaId: string; monto: bigint }>): string[] =>
        movs.map((m) => `${quien(m.cuentaId)} ${String(m.monto)}`).sort();
      porEtiqueta.push({
        etiqueta: e,
        emision: { concepto: await conceptoDe(b.transaccionEmisionId), lados: lados(emision), suma: String(emision.reduce((a, m) => a + m.monto, 0n)) },
        cierre:
          cierre === null
            ? null
            : { concepto: await conceptoDe(b.transaccionCierreId!), lados: lados(cierre), suma: String(cierre.reduce((a, m) => a + m.monto, 0n)) },
      });
    }

    const ladosCierre = (concepto: string, m: string): string[] =>
      concepto === 'SIEMBRA_BOLETA_COBRO' ? [`CAJA ${m}`, `GARANTIA -${m}`] : [`GARANTIA -${m}`, `cuenta ${m}`];
    expect(porEtiqueta).toEqual(
      ETIQUETAS.map((e) => {
        const c = TABLA_S23[e].cierre;
        const m = TABLA_S23[e].montoCentavos;
        return {
          etiqueta: e,
          emision: { concepto: 'SIEMBRA_BOLETA_EMISION', lados: [`GARANTIA ${m}`, `cuenta -${m}`], suma: '0' },
          cierre: c === null ? null : { concepto: c.concepto, lados: ladosCierre(c.concepto, m), suma: '0' },
        };
      }),
    );

    // TODA transacción que toca la cuenta sembrada, fondeo
    // incluido. El fondeo sale de la cuenta SISTEMA propia del escenario (`cuentaSistemaId`), con
    // concepto SIEMBRA, como en los otros cuatro escenarios; no de CAJA (spec § Constantes).
    const sistemaId = String(s.cuerpo['cuentaSistemaId']);
    const tocan = await prisma.movimiento.findMany({ where: { cuentaId: s.cuentaId }, select: { transaccionId: true } });
    const transacciones = [...new Set(tocan.map((x) => x.transaccionId))];
    const resumen: Array<{ concepto: string | null; suma: string }> = [];
    let fondeo: unknown = 'NO HAY FONDEO';
    for (const id of transacciones) {
      const movs = await movimientosDe(id);
      const concepto = await conceptoDe(id);
      resumen.push({ concepto, suma: String(movs.reduce((a, x) => a + x.monto, 0n)) });
      if (concepto === 'SIEMBRA') {
        fondeo = movs.map((x) => `${x.cuentaId === s.cuentaId ? 'cuenta' : x.cuentaId === sistemaId ? 'SISTEMA' : 'OTRA'} ${String(x.monto)}`).sort();
      }
    }
    expect({
      cuantas: transacciones.length,
      descuadradas: resumen.filter((x) => x.suma !== '0'),
      fondeo,
    }).toEqual({
      // 1 fondeo + 5 emisiones + vencimiento de VENCIDA_LIBERADA + devolución de DEVUELTA (el cobro no toca la cuenta)
      cuantas: 8,
      descuadradas: [],
      fondeo: ['SISTEMA -100000', 'cuenta 100000'],
    });
  });

  it('J5 · con el reloj fijado, las fechas son EXACTAMENTE las de la tabla (salen del reloj inyectado)', async () => {
    await fijarReloj(F_S23);
    try {
      const s = await sembrarBoletas();
      expect(s.estado, JSON.stringify(s.cuerpo)).toBe(201);
      const { titular } = await entrarComoSembrado(s);
      const vistas: Array<unknown> = [];
      for (const e of ETIQUETAS) {
        const una = await verUna(titular, s.ids[e]);
        const fila = await prisma.boleta.findUnique({ where: { id: s.ids[e] } });
        const cierre =
          fila?.transaccionCierreId == null
            ? null
            : (await prisma.transaccion.findUnique({ where: { id: fila.transaccionCierreId } }))?.creadaEn.toISOString();
        vistas.push({ etiqueta: e, emitidaEn: una.cuerpo['emitidaEn'], venceEn: una.cuerpo['venceEn'], cierre });
      }
      expect(vistas).toEqual(
        ETIQUETAS.map((e) => {
          const t = TABLA_S23[e];
          return {
            etiqueta: e,
            emitidaEn: enDias(t.emitidaDias),
            venceEn: enDias(t.venceDias),
            cierre: t.cierre === null ? null : enDias(t.cierre.dias),
          };
        }),
      );
    } finally {
      await soltarReloj();
    }
  });

  it('J6 · lo sembrado se comporta como lo emitido: reloj +30 días vence la VIGENTE; la liberada no se libera dos veces', async () => {
    await fijarReloj(F_S23);
    try {
      const s = await sembrarBoletas();
      expect(s.estado, JSON.stringify(s.cuerpo)).toBe(201);
      await avanzarReloj(30 * MS_POR_DIA);
      // El token vence según el reloj inyectado (S-10 T4, H1): se entra DESPUÉS de moverlo.
      const { titular } = await entrarComoSembrado(s);

      const antesDeLiberar = await verUna(titular, s.ids.VIGENTE);
      const liberar = await vencer(titular, s.ids.VIGENTE);
      const despuesDeLiberar = await verUna(titular, s.ids.VIGENTE);

      const filasAntes = await filasDelLedger();
      const segundaVez = await vencer(titular, s.ids.VENCIDA_LIBERADA);
      const ledgerIntacto = JSON.stringify(await filasDelLedger()) === JSON.stringify(filasAntes);

      expect({
        antes: { estado: antesDeLiberar.cuerpo['estado'], fondosLiberados: antesDeLiberar.cuerpo['fondosLiberados'] },
        liberar: liberar.estado,
        despues: { estado: despuesDeLiberar.cuerpo['estado'], fondosLiberados: despuesDeLiberar.cuerpo['fondosLiberados'] },
        segundaVez: { estado: segundaVez.estado, codigo: segundaVez.cuerpo['codigo'] },
        ledgerIntacto,
      }).toEqual({
        antes: { estado: 'VENCIDA', fondosLiberados: false },
        liberar: 200,
        despues: { estado: 'VENCIDA', fondosLiberados: true },
        segundaVez: { estado: 409, codigo: 'TRANSICION_INVALIDA' },
        ledgerIntacto: true,
      });
    } finally {
      await soltarReloj();
    }
  });

  it('J7 · dos seed seguidos: titulares, credenciales e ids distintos; los mismos montos', async () => {
    const uno = await sembrarBoletas();
    const dos = await sembrarBoletas();
    expect([uno.estado, dos.estado]).toEqual([201, 201]);
    const montos = (x: Sembrado): unknown => (x.cuerpo['boletas'] as Array<Record<string, unknown>>).map((b) => b['montoCentavos']);
    const todosLosIds = [...Object.values(uno.ids), ...Object.values(dos.ids)];
    expect({
      usuarios: uno.cuerpo['usuarioId'] !== dos.cuerpo['usuarioId'],
      emails: uno.email !== dos.email,
      passwords: uno.password !== dos.password,
      idsDistintos: new Set(todosLosIds).size,
      mismosMontos: JSON.stringify(montos(uno)) === JSON.stringify(montos(dos)),
    }).toEqual({ usuarios: true, emails: true, passwords: true, idsDistintos: 10, mismosMontos: true });
  });
});
