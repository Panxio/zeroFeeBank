import { createHmac, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/prisma.service.js';
import { AppModule } from '../src/app.module.js';

/**
 * Arnés de S-16 · préstamo. Ver specs/S-16-prestamo.md. ESTE ARCHIVO NO SE TOCA (specs/_CANDADO.md).
 *
 * ─── Lo que mide: que la plata cuadre, no que el endpoint diga que cuadra ──────────────
 * El ledger, la cuenta nueva y los saldos se leen con Prisma (ORÁCULO INDEPENDIENTE), nunca
 * preguntándole al servicio auditado.
 *
 * ─── La advertencia: el acto previo debe haber salido bien ────────────────────────────
 * Todo brazo que compare un ANTES con un DESPUÉS exige que el acto del medio haya tenido éxito
 * (`pedirOk` revienta si no hubo 201). Y todo brazo que mide que un RECHAZO no escribe nada
 * exige el 4xx CONCRETO con su código: un 404 de enrutado también «no escribe nada».
 *
 * ─── Por qué monta AppModule ──────────────────────────────────────────────────────────
 * PrestamosModule no existe al escribir este archivo; nombrarlo mataría la importación y la
 * calibración por ausencia correría cero casos en vez de N rojos.
 *
 * ─── Los montos de preparación salen de la regla, no a ojo ────────────────────────────
 * Un arnés puede ser IMPOSIBLE, no sólo ciego: cada escenario declara fondos, monto y pie,
 * y `montoMaximo(fondos)` es la regla N1 (fondos × 100 / 20) calculada, no un número tipeado.
 */

const prisma = new PrismaService();
let app: INestApplication;
let base = '';

const SECRETO = 'arnes-s16-secreto-de-pruebas-32-min-ok';
const PASSWORD = 'clave-de-prueba-larga';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONCEPTO = 'OTORGAMIENTO_PRESTAMO';
const CODIGO_SISTEMA = 'PRESTAMOS';
/** El mínimo de apertura de S-12 (P2): la primera cuenta nace con esto. */
const APERTURA_MINIMA_CENTAVOS = 100000n;

/** N1: el monto máximo aprobable con estos fondos (fondos ≥ 20 % del monto). */
const montoMaximo = (fondosCentavos: bigint): bigint => (fondosCentavos * 100n) / 20n;
/** Centavos → string decimal de dos decimales, como viaja por JSON (D1). */
const dec = (c: bigint): string => {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`;
};

// ─── utilidades HTTP ──────────────────────────────────────────────────────────────────

type Respuesta = { estado: number; cuerpo: Record<string, unknown>; texto: string };

async function pedir(
  metodo: string,
  ruta: string,
  o: { cuerpo?: unknown; autorizacion?: string; clave?: string; cuerpoCrudo?: string } = {},
): Promise<Respuesta> {
  const headers: Record<string, string> = {};
  if (o.cuerpo !== undefined || o.cuerpoCrudo !== undefined) headers['content-type'] = 'application/json';
  if (o.autorizacion !== undefined) headers['authorization'] = o.autorizacion;
  if (o.clave !== undefined) headers['idempotency-key'] = o.clave;
  const init: RequestInit = { method: metodo, headers };
  if (o.cuerpoCrudo !== undefined) init.body = o.cuerpoCrudo;
  else if (o.cuerpo !== undefined) init.body = JSON.stringify(o.cuerpo);
  const r = await fetch(`${base}${ruta}`, init);
  const texto = await r.text();
  let cuerpo: unknown = {};
  try {
    cuerpo = texto === '' ? {} : JSON.parse(texto);
  } catch {
    cuerpo = { _crudo: texto };
  }
  return { estado: r.status, cuerpo: (cuerpo ?? {}) as Record<string, unknown>, texto };
}

function forjarToken(sub: string, exp: number, secreto = SECRETO): string {
  const carga = Buffer.from(JSON.stringify({ sub, exp })).toString('base64url');
  const firma = createHmac('sha256', secreto).update(carga).digest().toString('base64url');
  return `${carga}.${firma}`;
}

interface Titular {
  id: string;
  auth: string;
}

async function nuevoTitular(): Promise<Titular> {
  const email = `prestamo-${randomUUID()}@ejemplo.cl`;
  const reg = await pedir('POST', '/auth/registro', { cuerpo: { email, password: PASSWORD } });
  expect(reg.estado, `registro: ${reg.texto}`).toBe(201);
  const login = await pedir('POST', '/auth/login', { cuerpo: { email, password: PASSWORD } });
  expect(login.estado, `login: ${login.texto}`).toBe(200);
  return { id: String(reg.cuerpo['id']), auth: `Bearer ${String(login.cuerpo['token'])}` };
}

/** Un titular con UNA cuenta corriente fondeada desde la CAJA (S-12) con `fondos` centavos. */
async function conFondos(fondos = APERTURA_MINIMA_CENTAVOS): Promise<[Titular, string]> {
  const t = await nuevoTitular();
  const r = await pedir('POST', '/cuentas', {
    cuerpo: { tipo: 'CORRIENTE', monto: dec(fondos) },
    autorizacion: t.auth,
    clave: `s16-apertura-${randomUUID()}`,
  });
  expect(r.estado, `apertura de preparación: ${r.texto}`).toBe(201);
  return [t, String(r.cuerpo['id'])];
}

/** Segunda cuenta del titular, fondeada DESDE `origen` (S-12). Los fondos totales no cambian. */
async function segundaCuenta(t: Titular, origen: string, monto: bigint): Promise<string> {
  const r = await pedir('POST', '/cuentas', {
    cuerpo: { tipo: 'CORRIENTE', cuentaOrigenId: origen, monto: dec(monto) },
    autorizacion: t.auth,
    clave: `s16-apertura2-${randomUUID()}`,
  });
  expect(r.estado, `segunda apertura: ${r.texto}`).toBe(201);
  return String(r.cuerpo['id']);
}

const solicitar = (t: Titular, cuerpo: unknown, clave = `s16-${randomUUID()}`): Promise<Respuesta> =>
  pedir('POST', '/prestamos', { cuerpo, autorizacion: t.auth, clave });

/** EL GUARDIÁN DEL ACTO PREVIO: si no hubo 201, el brazo muere en vez de medir la nada. */
async function solicitarOk(t: Titular, cuerpo: unknown, clave?: string): Promise<Record<string, unknown>> {
  const r = await solicitar(t, cuerpo, clave);
  expect(r.estado, `el préstamo debía aprobarse y respondió ${r.estado}: ${r.texto}`).toBe(201);
  return r.cuerpo;
}

/** Exige el rechazo CONCRETO: estado y código. «No fue 201» no basta. */
function exigir(r: Respuesta, estado: number, codigo: string): void {
  expect(r.estado, `se esperaba ${estado} ${codigo}: ${r.texto}`).toBe(estado);
  expect(r.cuerpo['codigo'], r.texto).toBe(codigo);
}

// ─── el oráculo independiente ─────────────────────────────────────────────────────────

async function saldoDe(cuentaId: string): Promise<bigint> {
  const r = await prisma.movimiento.aggregate({ where: { cuentaId }, _sum: { montoCentavos: true } });
  return r._sum.montoCentavos ?? 0n;
}

async function cuentaSistema(codigo: string): Promise<string | null> {
  const c = await prisma.cuenta.findUnique({ where: { codigo }, select: { id: true } });
  return c?.id ?? null;
}

async function movimientosDe(transaccionId: string) {
  return prisma.movimiento.findMany({
    where: { transaccionId },
    select: { cuentaId: true, montoCentavos: true, creadoEn: true },
  });
}

/** Lo que un rechazo NO debe tocar: cuentas del titular, asientos de préstamo, claves. */
async function censo(titularId: string, clave?: string): Promise<Record<string, number>> {
  return {
    cuentas: await prisma.cuenta.count({ where: { titularId } }),
    transacciones: await prisma.transaccion.count({ where: { concepto: CONCEPTO } }),
    movimientos: await prisma.movimiento.count({ where: { transaccion: { concepto: CONCEPTO } } }),
    claves: clave === undefined ? 0 : await prisma.claveIdempotencia.count({ where: { clave } }),
  };
}

/** Corre `acto` y exige que ni el censo ni el saldo de `cuenta` cambien. */
async function sinEscribir(t: Titular, cuenta: string, clave: string, acto: () => Promise<void>): Promise<void> {
  const antes = await censo(t.id, clave);
  const saldoAntes = await saldoDe(cuenta);
  await acto();
  expect(await censo(t.id, clave)).toEqual(antes);
  expect(await saldoDe(cuenta)).toBe(saldoAntes);
}

beforeAll(async () => {
  process.env['ZFB_AUTH_SECRET'] = SECRETO;
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  base = (await app.getUrl()).replace('[::1]', 'localhost');
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

// ═══ A · el camino feliz y el contrato ═══════════════════════════════════════════════

describe('A · el préstamo se otorga', () => {
  it('A1 · 201 con EXACTAMENTE las seis claves de specs/S-16 § 3', async () => {
    const [t, c] = await conFondos();
    const r = await solicitarOk(t, { cuentaOrigenId: c, monto: '5000.00', pie: '500.00' });
    expect(Object.keys(r).sort()).toEqual(
      ['cuentaOrigenId', 'cuentaPrestamoId', 'monto', 'otorgadoEn', 'pie', 'transaccionId'].sort(),
    );
    expect(String(r['cuentaPrestamoId'])).toMatch(UUID_REGEX);
    expect(String(r['transaccionId'])).toMatch(UUID_REGEX);
    expect(r['cuentaOrigenId']).toBe(c);
    expect(r['monto']).toBe('5000.00');
    expect(r['pie']).toBe('500.00');
    expect(new Date(String(r['otorgadoEn'])).toISOString()).toBe(r['otorgadoEn']);
  });

  it('A2 · monto y pie vuelven normalizados a dos decimales', async () => {
    const [t, c] = await conFondos();
    const r = await solicitarOk(t, { cuentaOrigenId: c, monto: '5000', pie: '0' });
    expect(r['monto']).toBe('5000.00');
    expect(r['pie']).toBe('0.00');
  });

  it('A3 · la cuenta nueva es PRESTAMO, del titular del token, límite 0, sin código', async () => {
    const [t, c] = await conFondos();
    const r = await solicitarOk(t, { cuentaOrigenId: c, monto: '5000.00', pie: '0.00' });
    const cuenta = await prisma.cuenta.findUnique({ where: { id: String(r['cuentaPrestamoId']) } });
    expect(cuenta?.tipo).toBe('PRESTAMO');
    expect(cuenta?.titularId).toBe(t.id);
    expect(cuenta?.limiteSobregiroCentavos).toBe(0n);
    expect(cuenta?.codigo).toBeNull();
  });

  it('A4 · cuenta, transacción y movimientos comparten el instante de otorgadoEn (C2)', async () => {
    const [t, c] = await conFondos();
    const r = await solicitarOk(t, { cuentaOrigenId: c, monto: '5000.00', pie: '100.00' });
    const en = String(r['otorgadoEn']);
    const cuenta = await prisma.cuenta.findUnique({ where: { id: String(r['cuentaPrestamoId']) } });
    const tx = await prisma.transaccion.findUnique({ where: { id: String(r['transaccionId']) } });
    expect(cuenta?.creadaEn.toISOString()).toBe(en);
    expect(tx?.creadaEn.toISOString()).toBe(en);
    for (const m of await movimientosDe(String(r['transaccionId']))) expect(m.creadoEn.toISOString()).toBe(en);
  });

  it('A5 · GET /cuentas muestra la cuenta PRESTAMO con saldo = monto', async () => {
    const [t, c] = await conFondos();
    const r = await solicitarOk(t, { cuentaOrigenId: c, monto: '5000.00', pie: '0.00' });
    const lista = await pedir('GET', '/cuentas', { autorizacion: t.auth });
    expect(lista.estado).toBe(200);
    const fila = (lista.cuerpo['cuentas'] as Array<Record<string, unknown>>).find(
      (x) => x['id'] === r['cuentaPrestamoId'],
    );
    expect(fila?.['tipo']).toBe('PRESTAMO');
    expect(fila?.['saldo']).toBe('5000.00');
  });
});

// ═══ B · el ledger ═══════════════════════════════════════════════════════════════════

describe('B · el asiento (N3, J3)', () => {
  it('B1 · pie > 0: EXACTAMENTE 4 movimientos que suman 0, concepto OTORGAMIENTO_PRESTAMO', async () => {
    const [t, c] = await conFondos();
    const r = await solicitarOk(t, { cuentaOrigenId: c, monto: '5000.00', pie: '500.00' });
    const movs = await movimientosDe(String(r['transaccionId']));
    expect(movs).toHaveLength(4);
    expect(movs.reduce((a, m) => a + m.montoCentavos, 0n)).toBe(0n);
    const tx = await prisma.transaccion.findUnique({ where: { id: String(r['transaccionId']) } });
    expect(tx?.concepto).toBe(CONCEPTO);
  });

  it('B2 · los signos por cuenta: PRESTAMO +monto · sistema −monto y +pie · origen −pie', async () => {
    const [t, c] = await conFondos();
    const r = await solicitarOk(t, { cuentaOrigenId: c, monto: '5000.00', pie: '500.00' });
    const sistema = await cuentaSistema(CODIGO_SISTEMA);
    const movs = await movimientosDe(String(r['transaccionId']));
    const de = (id: string | null) => movs.filter((m) => m.cuentaId === id).map((m) => m.montoCentavos).sort();
    expect(de(String(r['cuentaPrestamoId']))).toEqual([500000n]);
    expect(de(c)).toEqual([-50000n]);
    expect(de(sistema)).toEqual([-500000n, 50000n]);
  });

  it('B3 · pie = 0: EXACTAMENTE 2 movimientos y la cuenta de origen no se toca', async () => {
    const [t, c] = await conFondos();
    const r = await solicitarOk(t, { cuentaOrigenId: c, monto: '5000.00', pie: '0.00' });
    const movs = await movimientosDe(String(r['transaccionId']));
    expect(movs).toHaveLength(2);
    expect(movs.some((m) => m.cuentaId === c)).toBe(false);
    expect(await saldoDe(c)).toBe(APERTURA_MINIMA_CENTAVOS);
  });

  it('B4 · saldos derivados: origen baja el pie, PRESTAMO queda en el monto', async () => {
    const [t, c] = await conFondos();
    const r = await solicitarOk(t, { cuentaOrigenId: c, monto: '4000.00', pie: '250.00' });
    expect(await saldoDe(c)).toBe(APERTURA_MINIMA_CENTAVOS - 25000n);
    expect(await saldoDe(String(r['cuentaPrestamoId']))).toBe(400000n);
  });

  it('B5 · la contrapartida es la cuenta SISTEMA «PRESTAMOS», no la CAJA', async () => {
    const [t, c] = await conFondos();
    const r = await solicitarOk(t, { cuentaOrigenId: c, monto: '5000.00', pie: '0.00' });
    const sistema = await prisma.cuenta.findUnique({ where: { codigo: CODIGO_SISTEMA } });
    expect(sistema?.tipo).toBe('SISTEMA');
    expect(sistema?.titularId).toBeNull();
    const caja = await cuentaSistema('CAJA');
    const movs = await movimientosDe(String(r['transaccionId']));
    expect(movs.some((m) => m.cuentaId === caja)).toBe(false);
    expect(movs.some((m) => m.cuentaId === sistema?.id)).toBe(true);
  });
});

// ═══ C · validación de forma y precedencia ═══════════════════════════════════════════

describe('C · validación (§ 3)', () => {
  const casos: Array<[string, Record<string, unknown>, number, string]> = [
    ['C1 · monto ausente', { pie: '0.00' }, 400, 'MONTO_INVALIDO'],
    ['C2 · monto como number (D1)', { monto: 5000, pie: '0.00' }, 400, 'MONTO_INVALIDO'],
    ['C3 · monto no decimal', { monto: 'cinco mil', pie: '0.00' }, 400, 'MONTO_INVALIDO'],
    ['C4 · monto cero', { monto: '0.00', pie: '0.00' }, 400, 'MONTO_INVALIDO'],
    ['C5 · monto negativo (D6)', { monto: '-5000.00', pie: '0.00' }, 400, 'MONTO_INVALIDO'],
    ['C6 · pie ausente', { monto: '5000.00' }, 400, 'PRESTAMO_PIE_INVALIDO'],
    ['C7 · pie como number', { monto: '5000.00', pie: 0 }, 400, 'PRESTAMO_PIE_INVALIDO'],
    ['C8 · pie negativo', { monto: '5000.00', pie: '-1.00' }, 400, 'PRESTAMO_PIE_INVALIDO'],
    ['C9 · pie igual al monto (N5)', { monto: '500.00', pie: '500.00' }, 400, 'PRESTAMO_PIE_INVALIDO'],
    ['C10 · pie mayor que el monto', { monto: '500.00', pie: '500.01' }, 400, 'PRESTAMO_PIE_INVALIDO'],
    ['C11 · pie no decimal', { monto: '5000.00', pie: 'nada' }, 400, 'PRESTAMO_PIE_INVALIDO'],
    ['C14 · monto malo Y pie malo → gana monto', { monto: '0', pie: '-1' }, 400, 'MONTO_INVALIDO'],
  ];
  for (const [nombre, extra, estado, codigo] of casos) {
    it(`${nombre} → ${estado} ${codigo}, sin escribir nada`, async () => {
      const [t, c] = await conFondos();
      const clave = `s16-c-${randomUUID()}`;
      await sinEscribir(t, c, clave, async () => {
        exigir(await solicitar(t, { cuentaOrigenId: c, ...extra }, clave), estado, codigo);
      });
    });
  }

  it('C12 · cuentaOrigenId ausente → 404 CUENTA_NO_ENCONTRADA', async () => {
    const [t] = await conFondos();
    exigir(await solicitar(t, { monto: '5000.00', pie: '0.00' }), 404, 'CUENTA_NO_ENCONTRADA');
  });

  it('C13 · cuentaOrigenId sin forma de uuid → 404 CUENTA_NO_ENCONTRADA', async () => {
    const [t] = await conFondos();
    exigir(
      await solicitar(t, { cuentaOrigenId: 'no-es-uuid', monto: '5000.00', pie: '0.00' }),
      404,
      'CUENTA_NO_ENCONTRADA',
    );
  });

  it('C15 · pie malo Y cuenta sin forma → gana pie (el pie va antes que la cuenta)', async () => {
    const [t] = await conFondos();
    exigir(
      await solicitar(t, { cuentaOrigenId: 'no-es-uuid', monto: '5000.00', pie: '-1.00' }),
      400,
      'PRESTAMO_PIE_INVALIDO',
    );
  });

  // C15 usa pie NEGATIVO y el motor vuelve a exigir pie < monto,
  // así que un controlador sin ese tope no ponía rojo ningún brazo (defecto H5 de § 8.2).
  it('C17 · pie = monto Y cuenta sin forma → gana pie: el tope de N5 también va antes que la cuenta', async () => {
    const [t] = await conFondos();
    exigir(
      await solicitar(t, { cuentaOrigenId: 'no-es-uuid', monto: '500.00', pie: '500.00' }),
      400,
      'PRESTAMO_PIE_INVALIDO',
    );
  });

  it('C16 · pie = monto − 1 centavo → 201 (el borde de N5 aprueba)', async () => {
    const [t, c] = await conFondos();
    await solicitarOk(t, { cuentaOrigenId: c, monto: '1000.00', pie: '999.99' });
  });
});

// ═══ R · la regla de aprobación (N1, R1, R2, J5) ═════════════════════════════════════

describe('R · la regla de ParaBank', () => {
  it('R1 · fondos exactamente al 20 % del monto → 201', async () => {
    const [t, c] = await conFondos();
    await solicitarOk(t, { cuentaOrigenId: c, monto: dec(montoMaximo(APERTURA_MINIMA_CENTAVOS)), pie: '0.00' });
  });

  it('R2 · un centavo sobre el máximo → 409 PRESTAMO_FONDOS_INSUFICIENTES, sin escribir nada', async () => {
    const [t, c] = await conFondos();
    const clave = `s16-r2-${randomUUID()}`;
    await sinEscribir(t, c, clave, async () => {
      const monto = dec(montoMaximo(APERTURA_MINIMA_CENTAVOS) + 1n);
      exigir(await solicitar(t, { cuentaOrigenId: c, monto, pie: '0.00' }, clave), 409, 'PRESTAMO_FONDOS_INSUFICIENTES');
    });
  });

  it('R3 · pie > fondos (y cociente malo) → 409 PRESTAMO_PIE_SUPERA_FONDOS: esa regla va primero', async () => {
    const [t, c] = await conFondos();
    const clave = `s16-r3-${randomUUID()}`;
    await sinEscribir(t, c, clave, async () => {
      const cuerpo = { cuentaOrigenId: c, monto: '100000.00', pie: dec(APERTURA_MINIMA_CENTAVOS + 1n) };
      exigir(await solicitar(t, cuerpo, clave), 409, 'PRESTAMO_PIE_SUPERA_FONDOS');
    });
  });

  it('R4 · pie igual a los fondos → 201, y la cuenta de origen queda en 0', async () => {
    const [t, c] = await conFondos();
    await solicitarOk(t, { cuentaOrigenId: c, monto: '5000.00', pie: dec(APERTURA_MINIMA_CENTAVOS) });
    expect(await saldoDe(c)).toBe(0n);
  });

  it('R5 · los fondos SUMAN todas las cuentas del titular: con la suma exacta al 20 % → 201', async () => {
    const [t, c1] = await conFondos(300000n);
    const c2 = await segundaCuenta(t, c1, 100000n);
    // Fondos = 2000 + 1000 = 3000. Contando sólo la cuenta de origen (1000) se rechazaría.
    await solicitarOk(t, { cuentaOrigenId: c2, monto: dec(montoMaximo(300000n)), pie: '0.00' });
  });

  it('R6 · ...y un centavo sobre ese máximo → 409 PRESTAMO_FONDOS_INSUFICIENTES', async () => {
    const [t, c1] = await conFondos(300000n);
    const c2 = await segundaCuenta(t, c1, 100000n);
    exigir(
      await solicitar(t, { cuentaOrigenId: c2, monto: dec(montoMaximo(300000n) + 1n), pie: '0.00' }),
      409,
      'PRESTAMO_FONDOS_INSUFICIENTES',
    );
  });

  it('R7 · V3: un préstamo NO financia al siguiente (la cuenta PRESTAMO no suma a los fondos)', async () => {
    const [t, c] = await conFondos();
    await solicitarOk(t, { cuentaOrigenId: c, monto: '5000.00', pie: '0.00' });
    // Si la cuenta PRESTAMO (5000) sumara, los fondos serían 6000 y esto se aprobaría.
    exigir(
      await solicitar(t, { cuentaOrigenId: c, monto: '5000.01', pie: '0.00' }),
      409,
      'PRESTAMO_FONDOS_INSUFICIENTES',
    );
    await solicitarOk(t, { cuentaOrigenId: c, monto: '5000.00', pie: '0.00' });
  });

  it('R8 · R1: pie dentro de los fondos totales pero sobre el saldo de SU cuenta → 409 FONDOS_INSUFICIENTES', async () => {
    const [t, c1] = await conFondos(300000n);
    const c2 = await segundaCuenta(t, c1, 100000n);
    const clave = `s16-r8-${randomUUID()}`;
    await sinEscribir(t, c2, clave, async () => {
      // Fondos 3000 ≥ pie 1500 y 3000 ≥ 20 % de 5000; pero c2 sólo tiene 1000.
      exigir(await solicitar(t, { cuentaOrigenId: c2, monto: '5000.00', pie: '1500.00' }, clave), 409, 'FONDOS_INSUFICIENTES');
    });
    expect(await saldoDe(c1)).toBe(200000n);
  });

  it('R9 · N4: el pie puede salir de una cuenta PRESTAMO si su saldo alcanza', async () => {
    const [t, c] = await conFondos();
    const p1 = await solicitarOk(t, { cuentaOrigenId: c, monto: '5000.00', pie: '0.00' });
    const cp = String(p1['cuentaPrestamoId']);
    await solicitarOk(t, { cuentaOrigenId: cp, monto: '5000.00', pie: '800.00' });
    expect(await saldoDe(cp)).toBe(500000n - 80000n);
  });
});

// ═══ D · idempotencia (D5) ═══════════════════════════════════════════════════════════

describe('D · idempotencia', () => {
  it('D1 · replay: misma clave y cuerpo → el MISMO 201 byte por byte, una sola cuenta y un solo asiento', async () => {
    const [t, c] = await conFondos();
    const clave = `s16-d1-${randomUUID()}`;
    const cuerpo = { cuentaOrigenId: c, monto: '5000.00', pie: '100.00' };
    const r1 = await solicitar(t, cuerpo, clave);
    expect(r1.estado, r1.texto).toBe(201);
    const antes = await censo(t.id, clave);
    const r2 = await solicitar(t, cuerpo, clave);
    expect(r2.estado).toBe(201);
    expect(r2.texto).toBe(r1.texto);
    expect(await censo(t.id, clave)).toEqual(antes);
    expect(await saldoDe(c)).toBe(APERTURA_MINIMA_CENTAVOS - 10000n);
  });

  it('D2 · misma clave con otro pie → 409 IDEMPOTENCY_KEY_REUSADA, sin escribir nada', async () => {
    const [t, c] = await conFondos();
    const clave = `s16-d2-${randomUUID()}`;
    await solicitarOk(t, { cuentaOrigenId: c, monto: '5000.00', pie: '100.00' }, clave);
    await sinEscribir(t, c, clave, async () => {
      exigir(
        await solicitar(t, { cuentaOrigenId: c, monto: '5000.00', pie: '200.00' }, clave),
        409,
        'IDEMPOTENCY_KEY_REUSADA',
      );
    });
  });

  it('D3 · J7: otro titular con la misma clave y el mismo cuerpo NO recibe la respuesta del dueño', async () => {
    const [a, ca] = await conFondos();
    const [b] = await conFondos();
    const clave = `s16-d3-${randomUUID()}`;
    const cuerpo = { cuentaOrigenId: ca, monto: '5000.00', pie: '0.00' };
    const r1 = await solicitarOk(a, cuerpo, clave);
    const r2 = await solicitar(b, cuerpo, clave);
    exigir(r2, 409, 'IDEMPOTENCY_KEY_REUSADA');
    expect(r2.texto).not.toContain(String(r1['cuentaPrestamoId']));
  });

  it('D4 · V2: un rechazo no guarda la clave: la misma clave con un cuerpo válido después → 201', async () => {
    const [t, c] = await conFondos();
    const clave = `s16-d4-${randomUUID()}`;
    exigir(
      await solicitar(t, { cuentaOrigenId: c, monto: '5000.01', pie: '0.00' }, clave),
      409,
      'PRESTAMO_FONDOS_INSUFICIENTES',
    );
    expect(await prisma.claveIdempotencia.count({ where: { clave } })).toBe(0);
    await solicitarOk(t, { cuentaOrigenId: c, monto: '5000.00', pie: '0.00' }, clave);
  });
});

// ═══ E · auth y aislamiento ══════════════════════════════════════════════════════════

describe('E · auth y aislamiento', () => {
  const cuerpoValido = (c: string) => ({ cuentaOrigenId: c, monto: '5000.00', pie: '0.00' });

  it('E1 · sin Authorization → 401 TOKEN_AUSENTE, sin escribir nada', async () => {
    const [t, c] = await conFondos();
    const clave = `s16-e1-${randomUUID()}`;
    await sinEscribir(t, c, clave, async () => {
      exigir(await pedir('POST', '/prestamos', { cuerpo: cuerpoValido(c), clave }), 401, 'TOKEN_AUSENTE');
    });
  });

  it('E2 · token de firma ajena → 401 TOKEN_INVALIDO', async () => {
    const [t, c] = await conFondos();
    const falso = `Bearer ${forjarToken(t.id, Math.floor(Date.now() / 1000) + 3600, 'otro-secreto-de-32-caracteres-min')}`;
    exigir(
      await pedir('POST', '/prestamos', { cuerpo: cuerpoValido(c), autorizacion: falso, clave: `s16-${randomUUID()}` }),
      401,
      'TOKEN_INVALIDO',
    );
  });

  it('E3 · token vencido → 401 TOKEN_EXPIRADO', async () => {
    const [t, c] = await conFondos();
    const vencido = `Bearer ${forjarToken(t.id, Math.floor(Date.now() / 1000) - 60)}`;
    exigir(
      await pedir('POST', '/prestamos', { cuerpo: cuerpoValido(c), autorizacion: vencido, clave: `s16-${randomUUID()}` }),
      401,
      'TOKEN_EXPIRADO',
    );
  });

  it('E4 · sin token Y sin Idempotency-Key → 401, no 400 (el token va primero)', async () => {
    const [, c] = await conFondos();
    exigir(await pedir('POST', '/prestamos', { cuerpo: cuerpoValido(c) }), 401, 'TOKEN_AUSENTE');
  });

  it('E5 · con token y sin Idempotency-Key → 400 IDEMPOTENCY_KEY_AUSENTE', async () => {
    const [t, c] = await conFondos();
    exigir(
      await pedir('POST', '/prestamos', { cuerpo: cuerpoValido(c), autorizacion: t.auth }),
      400,
      'IDEMPOTENCY_KEY_AUSENTE',
    );
  });

  it('E6 · Idempotency-Key de 201 caracteres → 400 IDEMPOTENCY_KEY_INVALIDA', async () => {
    const [t, c] = await conFondos();
    exigir(await solicitar(t, cuerpoValido(c), 'k'.repeat(201)), 400, 'IDEMPOTENCY_KEY_INVALIDA');
  });

  it('E7 · J8: la cuenta ajena responde EXACTAMENTE lo mismo que una inexistente', async () => {
    const [a] = await conFondos();
    const [, cb] = await conFondos();
    const clave = `s16-e7-${randomUUID()}`;
    const ajena = await solicitar(a, cuerpoValido(cb), clave);
    const inexistente = await solicitar(a, cuerpoValido(randomUUID()));
    exigir(ajena, 404, 'CUENTA_NO_ENCONTRADA');
    exigir(inexistente, 404, 'CUENTA_NO_ENCONTRADA');
    expect(Object.keys(ajena.cuerpo).sort()).toEqual(Object.keys(inexistente.cuerpo).sort());
    expect(ajena.cuerpo['mensaje']).toBe(inexistente.cuerpo['mensaje']);
    expect(await prisma.claveIdempotencia.count({ where: { clave } })).toBe(0);
  });

  it('E8 · un titularId en el cuerpo se IGNORA: la cuenta PRESTAMO es del titular del token', async () => {
    const [a, ca] = await conFondos();
    const [b] = await conFondos();
    const r = await solicitarOk(a, { ...cuerpoValido(ca), titularId: b.id });
    const cuenta = await prisma.cuenta.findUnique({ where: { id: String(r['cuentaPrestamoId']) } });
    expect(cuenta?.titularId).toBe(a.id);
  });

  it('E9 · la cuenta de sistema PRESTAMOS como origen → 404 CUENTA_NO_ENCONTRADA', async () => {
    const [t, c] = await conFondos();
    await solicitarOk(t, cuerpoValido(c));
    const sistema = await cuentaSistema(CODIGO_SISTEMA);
    expect(sistema).not.toBeNull();
    exigir(
      await solicitar(t, { cuentaOrigenId: sistema, monto: '10.00', pie: '1.00' }),
      404,
      'CUENTA_NO_ENCONTRADA',
    );
  });
});

// ═══ K · concurrencia (D4, J6, V4) ═══════════════════════════════════════════════════

describe('K · concurrencia', () => {
  // Una sola ráfaga cazaba el motor sin FOR UPDATE (M1 de § 8.2) en 4 de 5 corridas: no bastaba.
  // Tres ráfagas independientes: si una se escapa, basta otra.
  it('K1 · 3 ráfagas de 10 préstamos simultáneos con pie 600 sobre fondos 1000 → EXACTAMENTE 1 aprobado en cada una', async () => {
    for (let rafaga = 1; rafaga <= 3; rafaga++) {
      const [t, c] = await conFondos();
      const rs = await Promise.all(
        Array.from({ length: 10 }, () => solicitar(t, { cuentaOrigenId: c, monto: '5000.00', pie: '600.00' })),
      );
      const estados = rs.map((r) => r.estado);
      expect(estados.filter((e) => e === 201), `ráfaga ${rafaga}: ${JSON.stringify(estados)}`).toHaveLength(1);
      // Tras el primero, fondos = 400 < pie 600: los otros nueve caen por la primera regla.
      for (const r of rs.filter((x) => x.estado !== 201)) exigir(r, 409, 'PRESTAMO_PIE_SUPERA_FONDOS');
      expect(await saldoDe(c)).toBe(40000n);
      expect(await prisma.cuenta.count({ where: { titularId: t.id, tipo: 'PRESTAMO' } })).toBe(1);
    }
  });

  it('K2 · préstamos y transferencias cruzadas simultáneas entre dos titulares: ni un 500 (sin deadlock)', async () => {
    const [a, ca] = await conFondos(500000n);
    const [b, cb] = await conFondos(500000n);
    const transferir = (t: Titular, o: string, d: string) =>
      pedir('POST', '/transferencias', {
        cuerpo: { origenId: o, destinoId: d, monto: '1.00' },
        autorizacion: t.auth,
        clave: `s16-k2-${randomUUID()}`,
      });
    const actos: Array<Promise<Respuesta>> = [];
    for (let i = 0; i < 4; i++) {
      actos.push(solicitar(a, { cuentaOrigenId: ca, monto: '100.00', pie: '1.00' }));
      actos.push(solicitar(b, { cuentaOrigenId: cb, monto: '100.00', pie: '1.00' }));
      actos.push(transferir(a, ca, cb));
      actos.push(transferir(b, cb, ca));
    }
    const rs = await Promise.all(actos);
    expect(rs.map((r) => r.estado), rs.map((r) => r.texto).join('\n')).toEqual(rs.map(() => 201));
  });

  // El hueco J6 de D4 (§ 8.2, M5). El préstamo bloquea TODAS las cuentas del titular; la
  // transferencia, sus dos. Sólo comparten candados si el titular tiene dos cuentas, y sólo hay
  // ciclo si el orden de creación (el de `findMany`) difiere del de id. K2 no puede armarlo.
  it('K3 · préstamos en paralelo con transferencias entre dos cuentas del mismo titular cuyo id va al revés de su creación: ni un 500', async () => {
    for (let rafaga = 1; rafaga <= 3; rafaga++) {
      // Se abren cuentas hasta la primera INVERSIÓN: una nueva con id menor que el mayor de las
      // anteriores. Comparar sólo contra la primera fallaba ~21 % con 12 intentos si ésta salía
      // con id bajo; con un par cualquiera, no armarlo en 8 cuentas es 1/8! = 1/40320.
      const [t, primera] = await conFondos(2000000n);
      const abiertas = [primera];
      let x: string | undefined;
      let y: string | undefined;
      while (y === undefined && abiertas.length < 8) {
        const otra = await segundaCuenta(t, primera, APERTURA_MINIMA_CENTAVOS);
        const mayor = abiertas.reduce((m, c) => (c > m ? c : m));
        if (otra < mayor) [x, y] = [mayor, otra];
        abiertas.push(otra);
      }
      // Preparación imposible → rojo, nunca un verde que no armó el ciclo.
      if (x === undefined || y === undefined) {
        throw new Error(`ráfaga ${rafaga}: 8 cuentas sin inversión de id: ${abiertas.join(' ')}`);
      }
      const [cx, cy] = [x, y];
      const transferir = (o: string, d: string) =>
        pedir('POST', '/transferencias', {
          cuerpo: { origenId: o, destinoId: d, monto: '1.00' },
          autorizacion: t.auth,
          clave: `s16-k3-${randomUUID()}`,
        });
      const actos: Array<Promise<Respuesta>> = [];
      for (let i = 0; i < 5; i++) {
        actos.push(solicitar(t, { cuentaOrigenId: cx, monto: '100.00', pie: '1.00' }));
        actos.push(transferir(cx, cy));
        actos.push(transferir(cy, cx));
      }
      const rs = await Promise.all(actos);
      expect(rs.map((r) => r.estado), `ráfaga ${rafaga}:\n${rs.map((r) => r.texto).join('\n')}`).toEqual(
        rs.map(() => 201),
      );
    }
  });
});

// ═══ P · paridad N4: la cuenta PRESTAMO se usa como cualquier otra ═════════════════════

describe('P · paridad', () => {
  it('P1 · se puede transferir desde la cuenta PRESTAMO a una corriente del titular', async () => {
    const [t, c] = await conFondos();
    const r = await solicitarOk(t, { cuentaOrigenId: c, monto: '5000.00', pie: '0.00' });
    const cp = String(r['cuentaPrestamoId']);
    const tr = await pedir('POST', '/transferencias', {
      cuerpo: { origenId: cp, destinoId: c, monto: '1234.56' },
      autorizacion: t.auth,
      clave: `s16-p1-${randomUUID()}`,
    });
    expect(tr.estado, tr.texto).toBe(201);
    expect(await saldoDe(cp)).toBe(500000n - 123456n);
    expect(await saldoDe(c)).toBe(APERTURA_MINIMA_CENTAVOS + 123456n);
  });
});

// ═══ G · controles: deben quedar VERDES sin S-16 ═════════════════════════════════════

describe('G · controles', () => {
  it('G1 · S-12 sigue abriendo la primera cuenta con el saldo pedido', async () => {
    const [, c] = await conFondos(300000n);
    expect(await saldoDe(c)).toBe(300000n);
  });

  it('G2 · POST /cuentas sigue sin abrir cuentas PRESTAMO (P3: sólo CORRIENTE)', async () => {
    const t = await nuevoTitular();
    const r = await pedir('POST', '/cuentas', {
      cuerpo: { tipo: 'PRESTAMO' },
      autorizacion: t.auth,
      clave: `s16-g2-${randomUUID()}`,
    });
    exigir(r, 400, 'TIPO_CUENTA_NO_PERMITIDO');
    expect(await prisma.cuenta.count({ where: { titularId: t.id } })).toBe(0);
  });

  it('G3 · un JSON que no parsea → 400 CUERPO_INVALIDO (lo responde la infraestructura)', async () => {
    const [t] = await conFondos();
    exigir(
      await pedir('POST', '/prestamos', { cuerpoCrudo: '{"monto":', autorizacion: t.auth, clave: `s16-${randomUUID()}` }),
      400,
      'CUERPO_INVALIDO',
    );
  });

  it('G4 · S-18 sigue transfiriendo entre cuentas corrientes (lo usan K2 y P1)', async () => {
    const [t, c1] = await conFondos(300000n);
    const c2 = await segundaCuenta(t, c1, 100000n);
    const tr = await pedir('POST', '/transferencias', {
      cuerpo: { origenId: c1, destinoId: c2, monto: '10.00' },
      autorizacion: t.auth,
      clave: `s16-g4-${randomUUID()}`,
    });
    expect(tr.estado, tr.texto).toBe(201);
    expect(await saldoDe(c2)).toBe(101000n);
  });
});
