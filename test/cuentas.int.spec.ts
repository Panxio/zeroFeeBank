import { createHmac, randomUUID } from 'node:crypto';
import { Module, type INestApplication } from '@nestjs/common';
import { APP_FILTER, NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroresHttpFilter } from '../src/infra/errores-http.filter.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { CuentasModule } from '../src/modules/cuentas/cuentas.module.js';
import { TransferenciasModule } from '../src/modules/transferencias/transferencias.module.js';

/**
 * Arnés de S-12 · apertura de cuenta y resumen con saldo derivado.
 * Ver specs/S-12-cuentas.md. ESTE ARCHIVO NO SE TOCA (specs/_CANDADO.md).
 * Cambios autorizados: S-20 cambia B2 y agrega el bloque G
 * (specs/S-20-cuenta-ahorro.md, HU-01 R2).
 *
 * ─── Por qué habla por HTTP ─────────────────────────────────────────────────────────────
 * Los códigos tipados (C5) y los estados sólo existen del otro lado del filtro, y la mitad
 * del contrato de esta unidad SON los estados: 404 para lo ajeno, 409 para la clave reusada,
 * 400 para el mínimo. Un test contra el servicio vería excepciones, no el contrato.
 *
 * ─── Por qué lee la base con Prisma ─────────────────────────────────────────────────────
 * Como ORÁCULO INDEPENDIENTE. El endpoint dice un saldo; el arnés lo contrasta con la suma
 * cruda de los movimientos. Si el arnés le preguntara al mismo SaldosRepository que audita,
 * compararía la consulta consigo misma y no tendría dientes.
 *
 * ─── Por qué no borra la base ───────────────────────────────────────────────────────────
 * El ledger es append-only (D3) y el reset es una costura de otra unidad. Cada caso usa un
 * usuario propio con email único, así que las corridas no se pisan y el orden no importa.
 */

const prisma = new PrismaService();
let app: INestApplication;
let base = '';

/** El secreto lo fija el arnés: si dependiera del .env de cada máquina no mediría lo mismo. */
const SECRETO = 'arnes-s12-secreto-de-pruebas-32-min-ok';
const PASSWORD = 'clave-de-prueba-larga';

/** P2: 1000 dólares. Declarado acá A PROPÓSITO. */
const MINIMO = '1000.00';
const MINIMO_CENTAVOS = 100000n;

@Module({
  // TransferenciasModule entra porque F7 mueve plata por la puerta de S-06, que no sabe nada
  // de este módulo: es la forma de comprobar que las dos comparten LA definición de saldo.
  imports: [AuthModule, CuentasModule, TransferenciasModule],
  providers: [{ provide: APP_FILTER, useClass: ErroresHttpFilter }],
})
class AppCuentas {}

// ─── utilidades ────────────────────────────────────────────────────────────────────────

type Respuesta = {
  estado: number;
  cuerpo: Record<string, unknown>;
  cabeceras: Headers;
};

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
  return {
    estado: r.status,
    cuerpo: (cuerpo ?? {}) as Record<string, unknown>,
    cabeceras: r.headers,
  };
}

const b64url = (b: Buffer): string => b.toString('base64url');

/** El formato de token de la Decisión 2 de S-08, reimplementado a mano por el arnés. */
function forjarToken(sub: string, expEpochSegundos: number, secreto = SECRETO): string {
  const carga = b64url(Buffer.from(JSON.stringify({ sub, exp: expEpochSegundos })));
  const firma = b64url(createHmac('sha256', secreto).update(carga).digest());
  return `${carga}.${firma}`;
}

interface Titular {
  id: string;
  email: string;
  token: string;
  auth: string;
}

/** Un titular nuevo, registrado y con sesión abierta por las puertas públicas de S-08. */
async function nuevoTitular(prefijo = 'cuentas'): Promise<Titular> {
  const email = `${prefijo}-${randomUUID()}@ejemplo.cl`;
  const reg = await pedir('POST', '/auth/registro', { cuerpo: { email, password: PASSWORD } });
  expect(reg.estado, `el registro de ${email} falló: ${JSON.stringify(reg.cuerpo)}`).toBe(201);
  const login = await pedir('POST', '/auth/login', { cuerpo: { email, password: PASSWORD } });
  expect(login.estado, `el login de ${email} falló: ${JSON.stringify(login.cuerpo)}`).toBe(200);
  const token = String(login.cuerpo['token']);
  return { id: String(reg.cuerpo['id']), email, token, auth: `Bearer ${token}` };
}

async function abrir(
  titular: Titular,
  cuerpo: Record<string, unknown> = { tipo: 'CORRIENTE' },
  clave = `s12-${randomUUID()}`,
): Promise<Respuesta> {
  return pedir('POST', '/cuentas', { cuerpo, autorizacion: titular.auth, clave });
}

async function abrirOk(
  titular: Titular,
  cuerpo: Record<string, unknown> = { tipo: 'CORRIENTE' },
): Promise<Record<string, unknown>> {
  const r = await abrir(titular, cuerpo);
  expect(r.estado, `la apertura falló: ${JSON.stringify(r.cuerpo)}`).toBe(201);
  return r.cuerpo;
}

async function resumen(titular: Titular): Promise<Respuesta> {
  return pedir('GET', '/cuentas', { autorizacion: titular.auth });
}

/** El oráculo independiente: la suma cruda del ledger, sin pasar por el código auditado. */
async function saldoSegunElLedger(cuentaId: string): Promise<bigint> {
  const r = await prisma.movimiento.aggregate({
    where: { cuentaId },
    _sum: { montoCentavos: true },
  });
  return r._sum.montoCentavos ?? 0n;
}

async function cuentasEnBaseDe(titularId: string): Promise<number> {
  return prisma.cuenta.count({ where: { titularId } });
}

function listaDe(r: Respuesta): Array<Record<string, unknown>> {
  return (r.cuerpo['cuentas'] ?? []) as Array<Record<string, unknown>>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeAll(async () => {
  process.env['ZFB_AUTH_SECRET'] = SECRETO;
  app = await NestFactory.create(AppCuentas, { logger: false });
  await app.listen(0);
  base = (await app.getUrl()).replace('[::1]', 'localhost');
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

// ═══ A · la primera cuenta: fondeada desde la caja ═════════════════════════════════════

describe('A · apertura de la primera cuenta', () => {
  it('A1 · devuelve 201 con el contrato completo y el saldo del mínimo', async () => {
    const t = await nuevoTitular();
    const r = await abrir(t);
    expect(r.estado).toBe(201);
    expect(String(r.cuerpo['id'])).toMatch(UUID_REGEX);
    expect(r.cuerpo['tipo']).toBe('CORRIENTE');
    expect(r.cuerpo['saldo']).toBe(MINIMO);
    expect(String(r.cuerpo['transaccionId'])).toMatch(UUID_REGEX);
    expect(typeof r.cuerpo['abiertaEn']).toBe('string');
    expect(new Date(String(r.cuerpo['abiertaEn'])).getTime()).not.toBeNaN();
  });

  it('A2 · la cuenta creada es del titular del token, nunca de otro', async () => {
    const t = await nuevoTitular();
    const c = await abrirOk(t);
    const enBase = await prisma.cuenta.findUniqueOrThrow({ where: { id: String(c['id']) } });
    expect(enBase.titularId).toBe(t.id);
    expect(enBase.tipo).toBe('CORRIENTE');
  });

  it('A3 · el asiento tiene exactamente 2 movimientos, suma 0 y concepto APERTURA_CUENTA', async () => {
    const t = await nuevoTitular();
    const c = await abrirOk(t);
    const tx = await prisma.transaccion.findUniqueOrThrow({
      where: { id: String(c['transaccionId']) },
      include: { movimientos: true },
    });
    expect(tx.concepto).toBe('APERTURA_CUENTA');
    expect(tx.movimientos).toHaveLength(2);
    const suma = tx.movimientos.reduce((a, m) => a + m.montoCentavos, 0n);
    expect(suma).toBe(0n);
  });

  it('A4 · la contrapartida es LA caja: una cuenta SISTEMA con codigo CAJA y sin titular', async () => {
    const t = await nuevoTitular();
    const c = await abrirOk(t);
    const tx = await prisma.transaccion.findUniqueOrThrow({
      where: { id: String(c['transaccionId']) },
      include: { movimientos: { include: { cuenta: true } } },
    });
    const contraparte = tx.movimientos.find((m) => m.cuentaId !== String(c['id']));
    expect(contraparte, 'el asiento no tiene contrapartida').toBeDefined();
    expect(contraparte?.montoCentavos).toBe(-MINIMO_CENTAVOS);
    expect(contraparte?.cuenta.tipo).toBe('SISTEMA');
    expect(contraparte?.cuenta.codigo).toBe('CAJA');
    expect(contraparte?.cuenta.titularId).toBeNull();
    // Una sola caja en todo el sistema: si cada apertura se fabricara la suya, I2 seguiría
    // en cero y el descuadre sería invisible. Por eso se afirma sobre el CONTEO.
    expect(await prisma.cuenta.count({ where: { codigo: 'CAJA' } })).toBe(1);
  });

  it('A5 · el saldo expuesto es el que dice el ledger (oráculo independiente)', async () => {
    const t = await nuevoTitular();
    const c = await abrirOk(t);
    expect(await saldoSegunElLedger(String(c['id']))).toBe(MINIMO_CENTAVOS);
  });

  it('A6 · un monto mayor al mínimo se respeta, no se recorta al mínimo', async () => {
    const t = await nuevoTitular();
    const c = await abrirOk(t, { tipo: 'CORRIENTE', monto: '2500.50' });
    expect(c['saldo']).toBe('2500.50');
    expect(await saldoSegunElLedger(String(c['id']))).toBe(250050n);
  });

  it('A7 · el monto exactamente igual al mínimo se acepta (el límite es MENOR que)', async () => {
    const t = await nuevoTitular();
    const c = await abrirOk(t, { tipo: 'CORRIENTE', monto: MINIMO });
    expect(c['saldo']).toBe(MINIMO);
  });

  it('A8 · un monto bajo el mínimo se rechaza con 400 y NO escribe nada', async () => {
    const t = await nuevoTitular();
    const r = await abrir(t, { tipo: 'CORRIENTE', monto: '999.99' });
    expect(r.estado).toBe(400);
    expect(r.cuerpo['codigo']).toBe('MONTO_APERTURA_INSUFICIENTE');
    expect(await cuentasEnBaseDe(t.id)).toBe(0);
  });

  it('A9 · un monto negativo es MONTO_INVALIDO, no un mínimo insuficiente (D6)', async () => {
    const t = await nuevoTitular();
    const r = await abrir(t, { tipo: 'CORRIENTE', monto: '-1000.00' });
    expect(r.estado).toBe(400);
    expect(r.cuerpo['codigo']).toBe('MONTO_INVALIDO');
    expect(await cuentasEnBaseDe(t.id)).toBe(0);
  });

  it('A10 · un monto que no se puede parsear es MONTO_INVALIDO, no un 500', async () => {
    const t = await nuevoTitular();
    for (const monto of ['mil', '1000,00', '1000.000', '', 1000]) {
      const r = await abrir(t, { tipo: 'CORRIENTE', monto });
      expect(r.estado, `monto ${JSON.stringify(monto)} no dio 400`).toBe(400);
      expect(r.cuerpo['codigo']).toBe('MONTO_INVALIDO');
    }
    expect(await cuentasEnBaseDe(t.id)).toBe(0);
  });
});

// ═══ B · el tipo de cuenta ═════════════════════════════════════════════════════════════

describe('B · el tipo de cuenta', () => {
  it('B1 · sin tipo se rechaza', async () => {
    const t = await nuevoTitular();
    const r = await abrir(t, {});
    expect(r.estado).toBe(400);
    expect(r.cuerpo['codigo']).toBe('TIPO_CUENTA_NO_PERMITIDO');
    expect(await cuentasEnBaseDe(t.id)).toBe(0);
  });

  // S-20: P3 decía que AHORRO quedaba fuera de la apertura y B2 exigía 400. La regla
  // cambió en HU-01 R2 («Sí, igual a CORRIENTE») y por eso ESTE caso pasa
  // a 201. Es el único brazo existente que se toca; lo nuevo de la ahorro vive en el bloque G.
  it('B2 · AHORRO se abre por la puerta pública igual que CORRIENTE (HU-01 R2)', async () => {
    const t = await nuevoTitular();
    const r = await abrir(t, { tipo: 'AHORRO' });
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(201);
    expect(r.cuerpo['tipo']).toBe('AHORRO');
    expect(await cuentasEnBaseDe(t.id)).toBe(1);
  });

  it('B3 · SISTEMA no se abre por la puerta pública', async () => {
    const t = await nuevoTitular();
    const r = await abrir(t, { tipo: 'SISTEMA' });
    expect(r.estado).toBe(400);
    expect(r.cuerpo['codigo']).toBe('TIPO_CUENTA_NO_PERMITIDO');
    expect(await prisma.cuenta.count({ where: { titularId: t.id, tipo: 'SISTEMA' } })).toBe(0);
  });

  it('B4 · el tipo NO se normaliza: "corriente" en minúscula es un error', async () => {
    const t = await nuevoTitular();
    const r = await abrir(t, { tipo: 'corriente' });
    expect(r.estado).toBe(400);
    expect(r.cuerpo['codigo']).toBe('TIPO_CUENTA_NO_PERMITIDO');
  });
});

// ═══ C · la segunda cuenta: transferencia desde otra del titular ═══════════════════════

describe('C · apertura desde otra cuenta del titular', () => {
  it('C1 · mueve el dinero de verdad: el origen baja y la nueva sube', async () => {
    const t = await nuevoTitular();
    const primera = await abrirOk(t, { tipo: 'CORRIENTE', monto: '3000.00' });
    const segunda = await abrirOk(t, {
      tipo: 'CORRIENTE',
      cuentaOrigenId: primera['id'],
      monto: MINIMO,
    });
    expect(await saldoSegunElLedger(String(primera['id']))).toBe(200000n);
    expect(await saldoSegunElLedger(String(segunda['id']))).toBe(MINIMO_CENTAVOS);
    expect(segunda['saldo']).toBe(MINIMO);
  });

  it('C2 · el asiento de la segunda también es APERTURA_CUENTA y suma 0', async () => {
    const t = await nuevoTitular();
    const primera = await abrirOk(t, { tipo: 'CORRIENTE', monto: '3000.00' });
    const segunda = await abrirOk(t, { tipo: 'CORRIENTE', cuentaOrigenId: primera['id'] });
    const tx = await prisma.transaccion.findUniqueOrThrow({
      where: { id: String(segunda['transaccionId']) },
      include: { movimientos: true },
    });
    expect(tx.concepto).toBe('APERTURA_CUENTA');
    expect(tx.movimientos).toHaveLength(2);
    expect(tx.movimientos.reduce((a, m) => a + m.montoCentavos, 0n)).toBe(0n);
    // Y NO tocó la caja: este dinero ya estaba dentro del sistema.
    const caja = await prisma.cuenta.findFirstOrThrow({ where: { codigo: 'CAJA' } });
    expect(tx.movimientos.some((m) => m.cuentaId === caja.id)).toBe(false);
  });

  it('C3 · teniendo cuentas, omitir el origen es un error explícito', async () => {
    const t = await nuevoTitular();
    await abrirOk(t);
    const r = await abrir(t, { tipo: 'CORRIENTE' });
    expect(r.estado).toBe(400);
    expect(r.cuerpo['codigo']).toBe('CUENTA_ORIGEN_REQUERIDA');
    expect(await cuentasEnBaseDe(t.id)).toBe(1);
  });

  it('C4 · una cuenta AJENA responde igual que una inexistente: 404, y no la toca', async () => {
    const victima = await nuevoTitular('victima');
    const atacante = await nuevoTitular('atacante');
    const deLaVictima = await abrirOk(victima, { tipo: 'CORRIENTE', monto: '5000.00' });
    await abrirOk(atacante);

    const r = await abrir(atacante, {
      tipo: 'CORRIENTE',
      cuentaOrigenId: deLaVictima['id'],
    });
    expect(r.estado).toBe(404);
    expect(r.cuerpo['codigo']).toBe('CUENTA_NO_ENCONTRADA');
    expect(await saldoSegunElLedger(String(deLaVictima['id']))).toBe(500000n);
    expect(await cuentasEnBaseDe(atacante.id)).toBe(1);
  });

  it('C5 · un origen inexistente y uno que ni siquiera es UUID dan 404, nunca 500', async () => {
    const t = await nuevoTitular();
    await abrirOk(t);
    for (const origen of [randomUUID(), 'x', '', '123']) {
      const r = await abrir(t, { tipo: 'CORRIENTE', cuentaOrigenId: origen });
      expect(r.estado, `origen ${JSON.stringify(origen)} no dio 404`).toBe(404);
      expect(r.cuerpo['codigo']).toBe('CUENTA_NO_ENCONTRADA');
    }
    expect(await cuentasEnBaseDe(t.id)).toBe(1);
  });

  it('C6 · sin cuentas propias, cualquier origen que mande no existe para él', async () => {
    const otro = await nuevoTitular('otro');
    const cuentaDeOtro = await abrirOk(otro);
    const nuevo = await nuevoTitular('nuevo');
    const r = await abrir(nuevo, { tipo: 'CORRIENTE', cuentaOrigenId: cuentaDeOtro['id'] });
    expect(r.estado).toBe(404);
    expect(r.cuerpo['codigo']).toBe('CUENTA_NO_ENCONTRADA');
    expect(await cuentasEnBaseDe(nuevo.id)).toBe(0);
  });

  it('C7 · sin fondos suficientes en el origen: 409 y ni una fila escrita', async () => {
    const t = await nuevoTitular();
    const primera = await abrirOk(t, { tipo: 'CORRIENTE', monto: MINIMO });
    const r = await abrir(t, {
      tipo: 'CORRIENTE',
      cuentaOrigenId: primera['id'],
      monto: '1500.00',
    });
    expect(r.estado).toBe(409);
    expect(r.cuerpo['codigo']).toBe('FONDOS_INSUFICIENTES');
    expect(await cuentasEnBaseDe(t.id)).toBe(1);
    expect(await saldoSegunElLedger(String(primera['id']))).toBe(MINIMO_CENTAVOS);
  });
});

// ═══ D · idempotencia (D5) ═════════════════════════════════════════════════════════════

describe('D · idempotencia de POST /cuentas', () => {
  it('D1 · la misma clave con el mismo cuerpo devuelve lo MISMO y crea UNA cuenta', async () => {
    const t = await nuevoTitular();
    const clave = `s12-replay-${randomUUID()}`;
    const cuerpo = { tipo: 'CORRIENTE' };
    const primera = await pedir('POST', '/cuentas', { cuerpo, autorizacion: t.auth, clave });
    const segunda = await pedir('POST', '/cuentas', { cuerpo, autorizacion: t.auth, clave });
    expect(primera.estado).toBe(201);
    expect(segunda.estado).toBe(201);
    expect(segunda.cabeceras.get('idempotency-replayed')).toBe('true');
    expect(segunda.cuerpo).toEqual(primera.cuerpo);
    expect(await cuentasEnBaseDe(t.id)).toBe(1);
  });

  it('D2 · la misma clave con OTRO cuerpo es un 409, no un replay', async () => {
    const t = await nuevoTitular();
    const clave = `s12-reusada-${randomUUID()}`;
    const primera = await pedir('POST', '/cuentas', {
      cuerpo: { tipo: 'CORRIENTE' },
      autorizacion: t.auth,
      clave,
    });
    expect(primera.estado).toBe(201);
    const segunda = await pedir('POST', '/cuentas', {
      cuerpo: { tipo: 'CORRIENTE', monto: '2000.00' },
      autorizacion: t.auth,
      clave,
    });
    expect(segunda.estado).toBe(409);
    expect(segunda.cuerpo['codigo']).toBe('IDEMPOTENCY_KEY_REUSADA');
    expect(await cuentasEnBaseDe(t.id)).toBe(1);
  });

  it('D3 · la clave de otro usuario JAMÁS devuelve su cuenta (el titular va en la huella)', async () => {
    const primero = await nuevoTitular('primero');
    const segundo = await nuevoTitular('segundo');
    const clave = `s12-compartida-${randomUUID()}`;
    const cuerpo = { tipo: 'CORRIENTE' };

    const a = await pedir('POST', '/cuentas', { cuerpo, autorizacion: primero.auth, clave });
    expect(a.estado).toBe(201);

    const b = await pedir('POST', '/cuentas', { cuerpo, autorizacion: segundo.auth, clave });
    expect(b.estado).toBe(409);
    expect(b.cuerpo['codigo']).toBe('IDEMPOTENCY_KEY_REUSADA');
    expect(b.cuerpo['id']).toBeUndefined();
    expect(await cuentasEnBaseDe(segundo.id)).toBe(0);
  });

  it('D4 · sin Idempotency-Key no se abre nada', async () => {
    const t = await nuevoTitular();
    const r = await pedir('POST', '/cuentas', {
      cuerpo: { tipo: 'CORRIENTE' },
      autorizacion: t.auth,
    });
    expect(r.estado).toBe(400);
    expect(r.cuerpo['codigo']).toBe('IDEMPOTENCY_KEY_AUSENTE');
    expect(await cuentasEnBaseDe(t.id)).toBe(0);
  });

  it('D5 · una clave vacía o de más de 200 caracteres se rechaza con su propio código', async () => {
    const t = await nuevoTitular();
    const vacia = await abrir(t, { tipo: 'CORRIENTE' }, '   ');
    expect(vacia.estado).toBe(400);
    expect(vacia.cuerpo['codigo']).toBe('IDEMPOTENCY_KEY_AUSENTE');

    const larga = await abrir(t, { tipo: 'CORRIENTE' }, 'k'.repeat(201));
    expect(larga.estado).toBe(400);
    expect(larga.cuerpo['codigo']).toBe('IDEMPOTENCY_KEY_INVALIDA');
    expect(await cuentasEnBaseDe(t.id)).toBe(0);
  });

  it('D6 · dos aperturas SIMULTÁNEAS con la misma clave crean UNA sola cuenta', async () => {
    const t = await nuevoTitular();
    const clave = `s12-carrera-${randomUUID()}`;
    const cuerpo = { tipo: 'CORRIENTE' };
    const [a, b] = await Promise.all([
      pedir('POST', '/cuentas', { cuerpo, autorizacion: t.auth, clave }),
      pedir('POST', '/cuentas', { cuerpo, autorizacion: t.auth, clave }),
    ]);
    expect([a.estado, b.estado]).toEqual([201, 201]);
    expect(a.cuerpo['id']).toBe(b.cuerpo['id']);
    expect(await cuentasEnBaseDe(t.id)).toBe(1);
  });
});

// ═══ E · autorización ══════════════════════════════════════════════════════════════════

describe('E · quién puede pedir qué', () => {
  it('E1 · POST sin token: 401 y nada escrito', async () => {
    const antes = await prisma.cuenta.count();
    const r = await pedir('POST', '/cuentas', {
      cuerpo: { tipo: 'CORRIENTE' },
      clave: `s12-sin-token-${randomUUID()}`,
    });
    expect(r.estado).toBe(401);
    expect(r.cuerpo['codigo']).toBe('TOKEN_AUSENTE');
    expect(await prisma.cuenta.count()).toBe(antes);
  });

  it('E2 · POST con un token de firma ajena: 401 TOKEN_INVALIDO', async () => {
    const t = await nuevoTitular();
    const falso = forjarToken(t.id, Math.floor(Date.now() / 1000) + 3600, 'otro-secreto-que-no-es');
    const r = await pedir('POST', '/cuentas', {
      cuerpo: { tipo: 'CORRIENTE' },
      autorizacion: `Bearer ${falso}`,
      clave: `s12-falso-${randomUUID()}`,
    });
    expect(r.estado).toBe(401);
    expect(r.cuerpo['codigo']).toBe('TOKEN_INVALIDO');
    expect(await cuentasEnBaseDe(t.id)).toBe(0);
  });

  it('E3 · GET sin token: 401 TOKEN_AUSENTE', async () => {
    const r = await pedir('GET', '/cuentas');
    expect(r.estado).toBe(401);
    expect(r.cuerpo['codigo']).toBe('TOKEN_AUSENTE');
  });

  it('E4 · un token vencido se distingue de uno inválido', async () => {
    const t = await nuevoTitular();
    const vencido = forjarToken(t.id, Math.floor(Date.now() / 1000) - 60);
    const r = await pedir('GET', '/cuentas', { autorizacion: `Bearer ${vencido}` });
    expect(r.estado).toBe(401);
    expect(r.cuerpo['codigo']).toBe('TOKEN_EXPIRADO');
  });
});

// ═══ F · el resumen ════════════════════════════════════════════════════════════════════

describe('F · GET /cuentas, el resumen con saldo derivado', () => {
  it('F1 · un titular sin cuentas recibe 200 y una lista vacía, no un 404', async () => {
    const t = await nuevoTitular();
    const r = await resumen(t);
    expect(r.estado).toBe(200);
    expect(listaDe(r)).toEqual([]);
  });

  it('F2 · devuelve las cuentas del titular con su saldo, en el contrato exacto', async () => {
    const t = await nuevoTitular();
    const primera = await abrirOk(t, { tipo: 'CORRIENTE', monto: '3000.00' });
    const segunda = await abrirOk(t, {
      tipo: 'CORRIENTE',
      cuentaOrigenId: primera['id'],
      monto: MINIMO,
    });

    const r = await resumen(t);
    expect(r.estado).toBe(200);
    const lista = listaDe(r);
    expect(lista).toHaveLength(2);
    for (const c of lista) {
      expect(Object.keys(c).sort()).toEqual(['abiertaEn', 'id', 'saldo', 'tipo']);
      expect(c['tipo']).toBe('CORRIENTE');
    }
    const porId = new Map(lista.map((c) => [String(c['id']), String(c['saldo'])]));
    expect(porId.get(String(primera['id']))).toBe('2000.00');
    expect(porId.get(String(segunda['id']))).toBe(MINIMO);
  });

  it('F3 · cada saldo expuesto coincide con la suma cruda del ledger', async () => {
    const t = await nuevoTitular();
    const primera = await abrirOk(t, { tipo: 'CORRIENTE', monto: '4200.75' });
    await abrirOk(t, { tipo: 'CORRIENTE', cuentaOrigenId: primera['id'], monto: '1200.25' });

    const lista = listaDe(await resumen(t));
    expect(lista.length).toBeGreaterThan(0);
    for (const c of lista) {
      const centavos = await saldoSegunElLedger(String(c['id']));
      const negativo = centavos < 0n;
      const abs = negativo ? -centavos : centavos;
      const esperado = `${negativo ? '-' : ''}${abs / 100n}.${(abs % 100n)
        .toString()
        .padStart(2, '0')}`;
      expect(c['saldo'], `la cuenta ${String(c['id'])} miente sobre su saldo`).toBe(esperado);
    }
  });

  it('F4 · no se ven las cuentas de otro titular', async () => {
    const uno = await nuevoTitular('uno');
    const dos = await nuevoTitular('dos');
    const deUno = await abrirOk(uno);
    await abrirOk(dos);
    const ids = listaDe(await resumen(dos)).map((c) => String(c['id']));
    expect(ids).not.toContain(String(deUno['id']));
    expect(ids).toHaveLength(1);
  });

  it('F5 · la caja del sistema no aparece en el resumen de nadie', async () => {
    const t = await nuevoTitular();
    await abrirOk(t);
    const caja = await prisma.cuenta.findFirstOrThrow({ where: { codigo: 'CAJA' } });
    const lista = listaDe(await resumen(t));
    expect(lista.map((c) => String(c['id']))).not.toContain(caja.id);
    expect(lista.map((c) => String(c['tipo']))).not.toContain('SISTEMA');
  });

  it('F6 · el orden es estable entre llamadas: por abiertaEn y luego por id', async () => {
    const t = await nuevoTitular();
    const primera = await abrirOk(t, { tipo: 'CORRIENTE', monto: '5000.00' });
    await abrirOk(t, { tipo: 'CORRIENTE', cuentaOrigenId: primera['id'] });
    await abrirOk(t, { tipo: 'CORRIENTE', cuentaOrigenId: primera['id'] });

    const a = listaDe(await resumen(t)).map((c) => String(c['id']));
    const b = listaDe(await resumen(t)).map((c) => String(c['id']));
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    expect(a[0]).toBe(String(primera['id']));

    const filas = await prisma.cuenta.findMany({
      where: { titularId: t.id },
      orderBy: [{ creadaEn: 'asc' }, { id: 'asc' }],
    });
    expect(a).toEqual(filas.map((f) => f.id));
  });

  it('F7 · el resumen y el motor de transferencias comparten LA definición de saldo', async () => {
    const t = await nuevoTitular();
    const origen = await abrirOk(t, { tipo: 'CORRIENTE', monto: '3000.00' });
    const destino = await abrirOk(t, { tipo: 'CORRIENTE', cuentaOrigenId: origen['id'] });

    // Se mueve plata por la OTRA puerta, la de S-06, que no sabe nada de este módulo.
    //
    // S-18: esa puerta ahora exige identificarse, así que la petición manda el
    // token de `t`, que es el dueño de las dos cuentas. Es un ENDURECIMIENTO —antes viajaba
    // anónima—, no un ablandamiento: lo que F7 mide (que el resumen y el motor comparten LA
    // definición de saldo) no cambia ni una coma. El cambio de
    // contrato está declarado en specs/S-18-transferencia-autenticada.md § 0.
    //
    // El § 0 de esa spec afirmaba que sólo dos arneses tocaban el endpoint, y se escribió sin
    // barrer test/ entero: faltaba éste.
    const mov = await pedir('POST', '/transferencias', {
      cuerpo: { origenId: origen['id'], destinoId: destino['id'], monto: '500.00' },
      clave: `s12-cruzada-${randomUUID()}`,
      autorizacion: t.auth,
    });
    expect(mov.estado, JSON.stringify(mov.cuerpo)).toBe(201);

    const porId = new Map(
      listaDe(await resumen(t)).map((c) => [String(c['id']), String(c['saldo'])]),
    );
    expect(porId.get(String(origen['id']))).toBe('1500.00');
    expect(porId.get(String(destino['id']))).toBe('1500.00');
  });
});

// ═══ G · la cuenta de ahorro (S-20, HU-01 R1–R2) ═══════════════════════════════════════
//
// R2: AHORRO se abre con LAS MISMAS reglas que CORRIENTE. Cada brazo mide una de las puertas
// por donde una implementación a medias dejaría a la ahorro distinta: la base, el fondeo, el
// origen, el resumen y la idempotencia. Tabla de defectos en specs/S-20-cuenta-ahorro.md.

describe('G · la cuenta de ahorro', () => {
  it('G1 · devuelve 201 con el contrato completo, y es AHORRO también en la base', async () => {
    const t = await nuevoTitular();
    const r = await abrir(t, { tipo: 'AHORRO' });
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(201);
    expect(String(r.cuerpo['id'])).toMatch(UUID_REGEX);
    expect(r.cuerpo['tipo']).toBe('AHORRO');
    expect(r.cuerpo['saldo']).toBe(MINIMO);
    expect(String(r.cuerpo['transaccionId'])).toMatch(UUID_REGEX);
    expect(new Date(String(r.cuerpo['abiertaEn'])).getTime()).not.toBeNaN();
    const enBase = await prisma.cuenta.findUniqueOrThrow({ where: { id: String(r.cuerpo['id']) } });
    expect(enBase.tipo).toBe('AHORRO');
    expect(enBase.titularId).toBe(t.id);
  });

  it('G2 · la primera AHORRO se fondea desde LA caja, como una CORRIENTE', async () => {
    const t = await nuevoTitular();
    const c = await abrirOk(t, { tipo: 'AHORRO' });
    const tx = await prisma.transaccion.findUniqueOrThrow({
      where: { id: String(c['transaccionId']) },
      include: { movimientos: { include: { cuenta: true } } },
    });
    expect(tx.concepto).toBe('APERTURA_CUENTA');
    expect(tx.movimientos).toHaveLength(2);
    expect(tx.movimientos.reduce((a, m) => a + m.montoCentavos, 0n)).toBe(0n);
    const contraparte = tx.movimientos.find((m) => m.cuentaId !== String(c['id']));
    expect(contraparte?.cuenta.codigo).toBe('CAJA');
    expect(contraparte?.montoCentavos).toBe(-MINIMO_CENTAVOS);
    expect(await saldoSegunElLedger(String(c['id']))).toBe(MINIMO_CENTAVOS);
  });

  it('G3 · una AHORRO abierta desde una CORRIENTE propia mueve el dinero y queda AHORRO', async () => {
    const t = await nuevoTitular();
    const corriente = await abrirOk(t, { tipo: 'CORRIENTE', monto: '3000.00' });
    const ahorro = await abrirOk(t, {
      tipo: 'AHORRO',
      cuentaOrigenId: corriente['id'],
      monto: '1200.50',
    });
    expect(ahorro['tipo']).toBe('AHORRO');
    expect(ahorro['saldo']).toBe('1200.50');
    expect(await saldoSegunElLedger(String(corriente['id']))).toBe(179950n);
    expect(await saldoSegunElLedger(String(ahorro['id']))).toBe(120050n);
    const enBase = await prisma.cuenta.findUniqueOrThrow({ where: { id: String(ahorro['id']) } });
    expect(enBase.tipo).toBe('AHORRO');
  });

  it('G4 · una AHORRO propia sirve de origen para abrir una CORRIENTE', async () => {
    const t = await nuevoTitular();
    const ahorro = await abrirOk(t, { tipo: 'AHORRO', monto: '2500.00' });
    const corriente = await abrirOk(t, { tipo: 'CORRIENTE', cuentaOrigenId: ahorro['id'] });
    expect(await saldoSegunElLedger(String(ahorro['id']))).toBe(150000n);
    expect(await saldoSegunElLedger(String(corriente['id']))).toBe(MINIMO_CENTAVOS);
    const enBase = await prisma.cuenta.findUniqueOrThrow({
      where: { id: String(corriente['id']) },
    });
    expect(enBase.tipo).toBe('CORRIENTE');
  });

  it('G5 · PRESTAMO no se abre y AHORRO no se normaliza', async () => {
    const t = await nuevoTitular();
    for (const tipo of ['PRESTAMO', 'ahorro', 'Ahorro', ' AHORRO', 'AHORRO ']) {
      const r = await abrir(t, { tipo });
      expect(r.estado, `tipo ${JSON.stringify(tipo)} no dio 400`).toBe(400);
      expect(r.cuerpo['codigo']).toBe('TIPO_CUENTA_NO_PERMITIDO');
    }
    expect(await cuentasEnBaseDe(t.id)).toBe(0);
  });

  it('G6 · GET /cuentas lista la AHORRO con su tipo y el saldo del ledger', async () => {
    const t = await nuevoTitular();
    const ahorro = await abrirOk(t, { tipo: 'AHORRO', monto: '3000.00' });
    const corriente = await abrirOk(t, { tipo: 'CORRIENTE', cuentaOrigenId: ahorro['id'] });

    const r = await resumen(t);
    expect(r.estado).toBe(200);
    const porId = new Map(listaDe(r).map((c) => [String(c['id']), c]));
    expect(porId.size).toBe(2);
    expect(porId.get(String(ahorro['id']))?.['tipo']).toBe('AHORRO');
    expect(porId.get(String(ahorro['id']))?.['saldo']).toBe('2000.00');
    expect(porId.get(String(corriente['id']))?.['tipo']).toBe('CORRIENTE');
    expect(await saldoSegunElLedger(String(ahorro['id']))).toBe(200000n);
  });

  it('G7 · la misma clave con el mismo cuerpo AHORRO devuelve lo MISMO y crea UNA cuenta', async () => {
    const t = await nuevoTitular();
    const clave = `s20-replay-${randomUUID()}`;
    const cuerpo = { tipo: 'AHORRO' };
    const primera = await pedir('POST', '/cuentas', { cuerpo, autorizacion: t.auth, clave });
    const segunda = await pedir('POST', '/cuentas', { cuerpo, autorizacion: t.auth, clave });
    expect(primera.estado, JSON.stringify(primera.cuerpo)).toBe(201);
    expect(segunda.estado, JSON.stringify(segunda.cuerpo)).toBe(201);
    expect(segunda.cabeceras.get('idempotency-replayed')).toBe('true');
    expect(segunda.cuerpo).toEqual(primera.cuerpo);
    expect(await cuentasEnBaseDe(t.id)).toBe(1);
  });

  it('G8 · la misma clave con otro tipo es un 409, no un replay', async () => {
    const t = await nuevoTitular();
    const clave = `s20-otro-tipo-${randomUUID()}`;
    const primera = await pedir('POST', '/cuentas', {
      cuerpo: { tipo: 'CORRIENTE' },
      autorizacion: t.auth,
      clave,
    });
    expect(primera.estado).toBe(201);
    const segunda = await pedir('POST', '/cuentas', {
      cuerpo: { tipo: 'AHORRO' },
      autorizacion: t.auth,
      clave,
    });
    expect(segunda.estado, JSON.stringify(segunda.cuerpo)).toBe(409);
    expect(segunda.cuerpo['codigo']).toBe('IDEMPOTENCY_KEY_REUSADA');
    expect(await cuentasEnBaseDe(t.id)).toBe(1);
  });
});
