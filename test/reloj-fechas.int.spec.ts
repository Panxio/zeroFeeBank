import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/prisma.service.js';
import { AppModule } from '../src/app.module.js';

/**
 * Arnés de DEUDA-reloj · las fechas de negocio salen del reloj inyectado.
 * Ver specs/DEUDA-reloj.md. ESTE ARCHIVO NO SE TOCA (specs/_CANDADO.md).
 *
 * ─── Qué mide ───────────────────────────────────────────────────────────────────────────
 * R1: con el reloj fijado en T, toda fila de usuario, cuenta, transaccion, movimiento y pago
 * que escribe una operación lleva EXACTAMENTE T, al milisegundo. T está lejos de hoy y con
 * milisegundos ≠ 0: un `now()` de Postgres no coincide por azar, y un truncado a segundos se ve.
 *
 * ─── La advertencia: el acto previo debe haber salido bien ──────────────────────────────
 * Cada caso exige que el acto del medio haya devuelto su 2xx antes de mirar la base: un brazo
 * que lee fechas de una operación que falló no mide nada, y en verde se ve igual.
 *
 * ─── Por qué SÍ llama a /__test__/reset ─────────────────────────────────────────────────
 * F6 necesita ver nacer las cuentas de sistema: sólo nacen en la primera operación después
 * de un reset. `fileParallelism: false` garantiza que ningún otro archivo corre a la vez.
 * El reset suelta el reloj (S-07), así que se fija DESPUÉS.
 */

const prisma = new PrismaService();
let app: INestApplication;
let base = '';

const SECRETO = 'arnes-reloj-secreto-de-pruebas-32-min-ok';
const PASSWORD = 'clave-de-prueba-larga';

/** § 4: lejos de hoy y con milisegundos ≠ 0. */
const T = new Date('2031-03-14T15:09:26.535Z');
/** Cierre de una boleta todavía vigente (emitida con plazo 1 día): una hora y 7 ms después. */
const T2_VIGENTE = new Date(T.getTime() + 3_600_000 + 7);
/** Cierre por vencimiento: dos días y 7 ms después, pasado el plazo de 1 día. */
const T2_VENCIDA = new Date(T.getTime() + 2 * 86_400_000 + 7);

const RUT_BENEFICIARIO = '12345678-5';
const RUT_RETIRADOR = '9876543-3';

// ─── utilidades ────────────────────────────────────────────────────────────────────────

type Respuesta = { estado: number; cuerpo: Record<string, unknown> };

async function pedir(
  metodo: string,
  ruta: string,
  opciones: { cuerpo?: unknown; autorizacion?: string; clave?: string } = {},
): Promise<Respuesta> {
  const headers: Record<string, string> = {};
  if (opciones.cuerpo !== undefined) headers['content-type'] = 'application/json';
  if (opciones.autorizacion !== undefined) headers['authorization'] = opciones.autorizacion;
  if (opciones.clave !== undefined) headers['idempotency-key'] = opciones.clave;
  const init: RequestInit = { method: metodo, headers };
  if (opciones.cuerpo !== undefined) init.body = JSON.stringify(opciones.cuerpo);
  const r = await fetch(`${base}${ruta}`, init);
  const texto = await r.text();
  let cuerpo: unknown = {};
  try {
    cuerpo = texto === '' ? {} : JSON.parse(texto);
  } catch {
    cuerpo = { _crudo: texto };
  }
  return { estado: r.status, cuerpo: (cuerpo ?? {}) as Record<string, unknown> };
}

/** El guardián del acto previo: si el acto no devolvió el estado esperado, el caso muere. */
async function exigir(
  estado: number,
  metodo: string,
  ruta: string,
  opciones: { cuerpo?: unknown; autorizacion?: string; clave?: string } = {},
): Promise<Record<string, unknown>> {
  const r = await pedir(metodo, ruta, opciones);
  expect(r.estado, `${metodo} ${ruta} debía dar ${estado}: ${JSON.stringify(r.cuerpo)}`).toBe(estado);
  return r.cuerpo;
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
  id: string;
  email: string;
  auth: string;
  creadoEn: string;
}

async function nuevoTitular(): Promise<Titular> {
  const email = `reloj-${randomUUID()}@ejemplo.cl`;
  const reg = await exigir(201, 'POST', '/auth/registro', { cuerpo: { email, password: PASSWORD } });
  const login = await exigir(200, 'POST', '/auth/login', { cuerpo: { email, password: PASSWORD } });
  const t = {
    id: String(reg['id']),
    email,
    auth: `Bearer ${String(login['token'])}`,
    creadoEn: String(reg['creadoEn']),
  };
  titularesVivos.add(t);
  return t;
}

/** La primera cuenta de un titular: S-12 la fondea desde la CAJA. */
async function abrirCuenta(t: Titular, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return exigir(201, 'POST', '/cuentas', {
    cuerpo: { tipo: 'CORRIENTE', monto: '5000.00', ...extra },
    autorizacion: t.auth,
    clave: `reloj-apertura-${randomUUID()}`,
  });
}

async function emitirBoleta(t: Titular, cuentaId: string): Promise<string> {
  const b = await exigir(201, 'POST', '/boletas', {
    cuerpo: {
      cuentaOrigenId: cuentaId,
      monto: '100.00',
      plazoDias: 1,
      beneficiarioRut: RUT_BENEFICIARIO,
      beneficiarioNombre: 'Constructora Andes SpA',
      glosa: 'Fiel cumplimiento contrato 123',
      retiradorRut: RUT_RETIRADOR,
      retiradorNombre: 'Ana Soto',
    },
    autorizacion: t.auth,
    clave: `reloj-boleta-${randomUUID()}`,
  });
  return String(b['id']);
}

// ─── el oráculo independiente: la base cruda ───────────────────────────────────────────

/**
 * La fecha de una transacción y la de CADA uno de sus movimientos. Exige exactamente 2
 * movimientos: con 0, «todos llevan T» sería verdad sin haber mirado nada.
 */
async function fechasDelAsiento(transaccionId: string): Promise<string[]> {
  const tx = await prisma.transaccion.findUnique({
    where: { id: transaccionId },
    select: { creadaEn: true, movimientos: { select: { creadoEn: true } } },
  });
  expect(tx, `la transacción ${transaccionId} no existe`).not.toBeNull();
  expect(tx!.movimientos, 'un asiento de este sistema tiene 2 movimientos').toHaveLength(2);
  return [tx!.creadaEn, ...tx!.movimientos.map((m) => m.creadoEn)].map((d) => d.toISOString());
}

const iso = (d: Date): string => d.toISOString();

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

// ═══ F · cada operación fecha con el reloj inyectado ══════════════════════════════════

describe('DEUDA-reloj · las fechas de negocio salen del reloj inyectado', () => {
  it('F1 · el registro: creadoEn de la respuesta y usuario.creado_en son T', async () => {
    const t = await nuevoTitular();
    expect(t.creadoEn).toBe(iso(T));
    const fila = await prisma.usuario.findUnique({ where: { id: t.id }, select: { creadoEn: true } });
    expect(fila?.creadoEn.toISOString()).toBe(iso(T));
  });

  it('F2 · la apertura (desde CAJA y desde una cuenta propia): abiertaEn, asiento y movimientos en T', async () => {
    const t = await nuevoTitular();
    const primera = await abrirCuenta(t);
    const segunda = await abrirCuenta(t, { monto: '1000.00', cuentaOrigenId: String(primera['id']) });

    for (const c of [primera, segunda]) {
      expect(c['abiertaEn']).toBe(iso(T));
      const fila = await prisma.cuenta.findUnique({ where: { id: String(c['id']) }, select: { creadaEn: true } });
      expect(fila?.creadaEn.toISOString()).toBe(iso(T));
      expect(await fechasDelAsiento(String(c['transaccionId']))).toEqual([iso(T), iso(T), iso(T)]);
    }
  });

  it('F3 · la transferencia: asiento y movimientos en T, y /movimientos devuelve fecha T', async () => {
    const origen = await nuevoTitular();
    const destino = await nuevoTitular();
    const cOrigen = String((await abrirCuenta(origen))['id']);
    const cDestino = String((await abrirCuenta(destino))['id']);

    const r = await exigir(201, 'POST', '/transferencias', {
      cuerpo: { origenId: cOrigen, destinoId: cDestino, monto: '12.34' },
      autorizacion: origen.auth,
      clave: `reloj-transf-${randomUUID()}`,
    });
    const txId = String(r['transaccionId']);
    expect(await fechasDelAsiento(txId)).toEqual([iso(T), iso(T), iso(T)]);

    const lista = await exigir(200, 'GET', `/movimientos?cuentaId=${cOrigen}&transaccionId=${txId}`, {
      autorizacion: origen.auth,
    });
    const movimientos = lista['movimientos'] as Array<Record<string, unknown>>;
    expect(movimientos, 'el movimiento de la transferencia debía listarse').toHaveLength(1);
    expect(movimientos[0]!['fecha']).toBe(iso(T));
  });

  it('F4 · el pago: pagadoEn, pago.pagado_en, asiento y movimientos en T', async () => {
    const t = await nuevoTitular();
    const cuenta = String((await abrirCuenta(t))['id']);
    const p = await exigir(201, 'POST', '/pagos', {
      cuerpo: {
        cuentaOrigenId: cuenta,
        monto: '125.50',
        beneficiarioNombre: 'Empresa Electrica SA',
        beneficiarioDireccion: 'Av. Siempre Viva 742',
        beneficiarioCiudad: 'Santiago',
        beneficiarioEstado: 'Region Metropolitana',
        beneficiarioCodigoPostal: '8320000',
        beneficiarioTelefono: '+56 2 2345 6789',
        cuentaBeneficiario: 'SERV-99887766',
      },
      autorizacion: t.auth,
      clave: `reloj-pago-${randomUUID()}`,
    });
    expect(p['pagadoEn']).toBe(iso(T));
    const fila = await prisma.pago.findUnique({ where: { id: String(p['id']) }, select: { pagadoEn: true } });
    expect(fila?.pagadoEn.toISOString()).toBe(iso(T));
    expect(await fechasDelAsiento(String(p['transaccionId']))).toEqual([iso(T), iso(T), iso(T)]);
  });

  it('F5 · la boleta: emisión en T; cobro, devolución y vencimiento en su T2', async () => {
    const t = await nuevoTitular();
    const cuenta = String((await abrirCuenta(t))['id']);
    const aCobrar = await emitirBoleta(t, cuenta);
    const aDevolver = await emitirBoleta(t, cuenta);
    const aVencer = await emitirBoleta(t, cuenta);

    await fijarReloj(T2_VIGENTE);
    await exigir(200, 'POST', `/boletas/${aCobrar}/cobrar`, {
      cuerpo: { rutRetirador: RUT_RETIRADOR },
      clave: `reloj-cobro-${randomUUID()}`,
    });
    await exigir(200, 'POST', `/boletas/${aDevolver}/devolver`, {
      cuerpo: {},
      autorizacion: t.auth,
      clave: `reloj-devol-${randomUUID()}`,
    });
    await fijarReloj(T2_VENCIDA);
    await exigir(200, 'POST', `/boletas/${aVencer}/vencer`, {
      cuerpo: {},
      autorizacion: t.auth,
      clave: `reloj-vence-${randomUUID()}`,
    });

    const esperado: Array<[string, Date]> = [
      [aCobrar, T2_VIGENTE],
      [aDevolver, T2_VIGENTE],
      [aVencer, T2_VENCIDA],
    ];
    for (const [id, cierre] of esperado) {
      const b = await prisma.boleta.findUnique({
        where: { id },
        select: { emitidaEn: true, transaccionEmisionId: true, transaccionCierreId: true },
      });
      expect(b?.emitidaEn.toISOString()).toBe(iso(T));
      expect(await fechasDelAsiento(b!.transaccionEmisionId)).toEqual([iso(T), iso(T), iso(T)]);
      expect(b?.transaccionCierreId, `la boleta ${id} debía tener asiento de cierre`).not.toBeNull();
      expect(await fechasDelAsiento(b!.transaccionCierreId!)).toEqual([iso(cierre), iso(cierre), iso(cierre)]);
    }
  });

  it('F6 · las cuentas de sistema CAJA y GARANTIA nacen en T', async () => {
    const codigos = ['CAJA', 'GARANTIA'];
    const antes = await prisma.cuenta.count({ where: { codigo: { in: codigos } } });
    expect(antes, 'después del reset no debía existir ninguna cuenta de sistema').toBe(0);

    const t = await nuevoTitular();
    const cuenta = String((await abrirCuenta(t))['id']); // crea CAJA
    await emitirBoleta(t, cuenta); // crea GARANTIA

    const sistema = await prisma.cuenta.findMany({
      where: { codigo: { in: codigos } },
      select: { codigo: true, creadaEn: true },
      orderBy: { codigo: 'asc' },
    });
    expect(sistema.map((c) => c.codigo)).toEqual(['CAJA', 'GARANTIA']);
    for (const c of sistema) expect(c.creadaEn.toISOString(), `cuenta ${c.codigo}`).toBe(iso(T));
  });

  it('F7 · R2: el esquema tiene exactamente un @default(now()), en ClaveIdempotencia', () => {
    // Lista de términos versionada con el resultado (ARNÉS): el término buscado y el único
    // modelo donde se admite.
    const TERMINO = '@default(now())';
    const MODELOS_ADMITIDOS = ['ClaveIdempotencia'];

    const esquema = readFileSync('prisma/schema.prisma', 'utf8');
    const hallados: string[] = [];
    for (const bloque of esquema.split(/^model /m).slice(1)) {
      const nombre = bloque.split(/\s/, 1)[0]!;
      const cuerpo = bloque.slice(0, bloque.indexOf('\n}'));
      const lineas = cuerpo.split('\n').filter((l) => !l.trim().startsWith('//'));
      for (const l of lineas) if (l.includes(TERMINO)) hallados.push(nombre);
    }
    expect(hallados).toEqual(MODELOS_ADMITIDOS);
  });
});
