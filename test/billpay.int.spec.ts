import { createHmac, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/prisma.service.js';
import { AppModule } from '../src/app.module.js';

/**
 * Arnés de S-15 · pago a terceros (Bill Pay).
 * Ver specs/S-15-billpay.md. ESTE ARCHIVO NO SE TOCA (specs/_CANDADO.md).
 *
 * ─── Lo que separa este arnés del de S-14: ESTA UNIDAD MUEVE DINERO ─────────────────────
 * Por eso existe el grupo B entero. Un arnés de S-15 que sólo mirara códigos HTTP estaría
 * ciego a lo único que de verdad importa acá: que la plata cuadre. La partida doble (D2),
 * el destino del crédito, el número EXACTO de movimientos (N3: comisión cero) y los saldos
 * derivados se comprueban contra el ledger crudo, no contra lo que diga el endpoint.
 *
 * ─── LA ADVERTENCIA DEL ACTO PREVIO, QUE ACÁ ES MÁS PELIGROSA QUE EN NINGÚN OTRO SITIO ──
 * «Todo brazo que compare un ANTES con un DESPUÉS tiene que exigir que el ACTO DEL MEDIO
 * haya tenido éxito.» Si no, mide la ausencia de acción y no la ausencia de efecto, y en
 * verde esas dos cosas se ven idénticas.
 * Casi todos los brazos del grupo B comparan el ledger antes y después de un pago. Por eso
 * NINGUNO de ellos hace el POST por su cuenta: todos pasan por `pagarOk`, que exige 201 y
 * revienta con el cuerpo del error si no lo recibe. Y los brazos que miden que un RECHAZO
 * no escribe nada (C13) exigen el 4xx concreto, no «que no sea 201» — un 401 también
 * cumpliría esa condición y el brazo se aprobaría solo.
 *
 * ─── Por qué monta AppModule y no una lista de módulos ──────────────────────────────────
 * `PagosModule` NO EXISTE cuando se escribe este archivo, y nombrarlo haría que vitest
 * muriera al importar: cero casos corridos en vez de N rojos, que es justo la corrida ciega
 * que la calibración por ausencia necesita evitar. Montar AppModule tiene además un diente
 * propio: si el módulo no se registra en src/app.module.ts, la ruta no se sirve.
 *
 * ─── Por qué habla por HTTP y lee la base con Prisma ────────────────────────────────────
 * Los estados y los códigos tipados (C5) sólo existen del otro lado del filtro. Y Prisma es
 * el ORÁCULO INDEPENDIENTE: el endpoint dice qué guardó, el arnés lo contrasta contra las
 * filas crudas. Preguntarle al servicio que se audita sería compararlo consigo mismo.
 */

const prisma = new PrismaService();
let app: INestApplication;
let base = '';

const SECRETO = 'arnes-s15-secreto-de-pruebas-32-min-ok';
const PASSWORD = 'clave-de-prueba-larga';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El saldo con el que nace la primera cuenta de un titular (S-12). */
const SALDO_INICIAL_CENTAVOS = 100000n;

/** El concepto del asiento de un pago. Versionado en scripts/invariantes.sh (§ 0, J2). */
const CONCEPTO_PAGO = 'PAGO_SERVICIO';

/**
 * Los siete campos del beneficiario con su máximo, copiados de specs/S-15 § 3.
 * EL ORDEN ES LA PRECEDENCIA: con dos campos malos gana el primero de esta lista.
 */
const CAMPOS = [
  { campo: 'beneficiarioNombre', max: 100, codigo: 'PAGO_BENEFICIARIO_NOMBRE_INVALIDO' },
  { campo: 'beneficiarioDireccion', max: 100, codigo: 'PAGO_BENEFICIARIO_DIRECCION_INVALIDA' },
  { campo: 'beneficiarioCiudad', max: 50, codigo: 'PAGO_BENEFICIARIO_CIUDAD_INVALIDA' },
  { campo: 'beneficiarioEstado', max: 50, codigo: 'PAGO_BENEFICIARIO_ESTADO_INVALIDO' },
  {
    campo: 'beneficiarioCodigoPostal',
    max: 20,
    codigo: 'PAGO_BENEFICIARIO_CODIGO_POSTAL_INVALIDO',
  },
  { campo: 'beneficiarioTelefono', max: 20, codigo: 'PAGO_BENEFICIARIO_TELEFONO_INVALIDO' },
  { campo: 'cuentaBeneficiario', max: 50, codigo: 'PAGO_CUENTA_BENEFICIARIO_INVALIDA' },
] as const;

const NOMBRES_DE_CAMPO = CAMPOS.map((c) => c.campo);

/** Un beneficiario válido. Ningún valor llega al límite: los límites los miden C3 y C7. */
function beneficiarioValido(sufijo = ''): Record<string, string> {
  return {
    beneficiarioNombre: `Empresa Electrica SA${sufijo}`,
    beneficiarioDireccion: `Av. Siempre Viva 742${sufijo}`,
    beneficiarioCiudad: `Santiago${sufijo}`,
    beneficiarioEstado: `Region Metropolitana${sufijo}`,
    beneficiarioCodigoPostal: `832000${sufijo || '0'}`,
    beneficiarioTelefono: `+56 2 2345 678${sufijo || '9'}`,
    cuentaBeneficiario: `SERV-9988776${sufijo || '6'}`,
  };
}

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

async function nuevoTitular(prefijo = 'billpay'): Promise<Titular> {
  const email = `${prefijo}-${randomUUID()}@ejemplo.cl`;
  const reg = await pedir('POST', '/auth/registro', { cuerpo: { email, password: PASSWORD } });
  expect(reg.estado, `el registro de ${email} falló: ${JSON.stringify(reg.cuerpo)}`).toBe(201);
  const login = await pedir('POST', '/auth/login', { cuerpo: { email, password: PASSWORD } });
  expect(login.estado, `el login de ${email} falló: ${JSON.stringify(login.cuerpo)}`).toBe(200);
  const token = String(login.cuerpo['token']);
  return { id: String(reg.cuerpo['id']), email, token, auth: `Bearer ${token}` };
}

/**
 * Un titular con una cuenta corriente ya fondeada (S-12 la fondea desde la CAJA con
 * SALDO_INICIAL_CENTAVOS). Sin esto no hay nada que pagar.
 */
async function conCuenta(prefijo = 'billpay'): Promise<[Titular, string]> {
  const t = await nuevoTitular(prefijo);
  const r = await pedir('POST', '/cuentas', {
    cuerpo: { tipo: 'CORRIENTE' },
    autorizacion: t.auth,
    clave: `s15-apertura-${randomUUID()}`,
  });
  expect(r.estado, `la apertura de preparación falló: ${JSON.stringify(r.cuerpo)}`).toBe(201);
  return [t, String(r.cuerpo['id'])];
}

function cuerpoDePago(cuentaOrigenId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { cuentaOrigenId, monto: '125.50', ...beneficiarioValido(), ...extra };
}

async function pagar(
  t: Titular,
  cuerpo: unknown,
  clave = `s15-${randomUUID()}`,
): Promise<Respuesta> {
  return pedir('POST', '/pagos', { cuerpo, autorizacion: t.auth, clave });
}

/**
 * EL GUARDIÁN DEL ACTO PREVIO. Todo brazo que compare un antes con un después
 * pasa por acá: si el pago no devolvió 201, el brazo MUERE en vez de medir la nada.
 */
async function pagarOk(
  t: Titular,
  cuerpo: unknown,
  clave = `s15-${randomUUID()}`,
): Promise<Record<string, unknown>> {
  const r = await pagar(t, cuerpo, clave);
  expect(r.estado, `el pago debía funcionar y respondió ${r.estado}: ${JSON.stringify(r.cuerpo)}`).toBe(201);
  return r.cuerpo;
}

const listar = async (t: Titular): Promise<Respuesta> =>
  pedir('GET', '/pagos', { autorizacion: t.auth });

// ─── el oráculo independiente: el ledger crudo ─────────────────────────────────────────

/** Los movimientos de una transacción, leídos de la base sin pasar por el código auditado. */
async function movimientosDe(transaccionId: string): Promise<Array<{ cuentaId: string; montoCentavos: bigint }>> {
  const filas = await prisma.movimiento.findMany({
    where: { transaccionId },
    select: { cuentaId: true, montoCentavos: true },
    orderBy: { cuentaId: 'asc' },
  });
  return filas;
}

async function conceptoDe(transaccionId: string): Promise<string | null> {
  const t = await prisma.transaccion.findUnique({ where: { id: transaccionId }, select: { concepto: true } });
  return t?.concepto ?? null;
}

/** El saldo derivado del ledger (D2). Nunca una columna: acá se define «saldo» para el arnés. */
async function saldoDe(cuentaId: string): Promise<bigint> {
  const r = await prisma.movimiento.aggregate({ where: { cuentaId }, _sum: { montoCentavos: true } });
  return r._sum.montoCentavos ?? 0n;
}

/** La cuenta de sistema CAJA. `null` si no existe todavía. */
async function cuentaCaja(): Promise<string | null> {
  const c = await prisma.cuenta.findUnique({ where: { codigo: 'CAJA' }, select: { id: true } });
  return c?.id ?? null;
}

/** Cuántas filas hay hoy en las tres tablas que un rechazo NO debe tocar. */
async function censo(titularId: string): Promise<Record<string, number>> {
  return {
    pagos: await prisma.pago.count({ where: { titularId } }),
    transacciones: await prisma.transaccion.count({ where: { concepto: CONCEPTO_PAGO } }),
    movimientos: await prisma.movimiento.count({
      where: { transaccion: { concepto: CONCEPTO_PAGO } },
    }),
  };
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

// ═══ A · POST /pagos · el camino feliz y la forma de la respuesta ══════════════════════

describe('A · el pago se ejecuta', () => {
  it('A1 · devuelve 201 con el contrato completo de specs/S-15 § 3', async () => {
    const [t, cuenta] = await conCuenta();
    const cuerpo = await pagarOk(t, cuerpoDePago(cuenta));
    expect(String(cuerpo['id'])).toMatch(UUID_REGEX);
    expect(String(cuerpo['transaccionId'])).toMatch(UUID_REGEX);
    expect(cuerpo['cuentaOrigenId']).toBe(cuenta);
    expect(cuerpo['monto']).toBe('125.50');
    expect(cuerpo['beneficiarioNombre']).toBe(beneficiarioValido()['beneficiarioNombre']);
    expect(cuerpo['cuentaBeneficiario']).toBe(beneficiarioValido()['cuentaBeneficiario']);
    expect(typeof cuerpo['pagadoEn']).toBe('string');
    expect(new Date(String(cuerpo['pagadoEn'])).getTime()).not.toBeNaN();
  });

  it('A2 · lo que devuelve el 201 es lo que hay en la base (oráculo independiente)', async () => {
    const [t, cuenta] = await conCuenta();
    const cuerpo = await pagarOk(t, cuerpoDePago(cuenta));
    const fila = await prisma.pago.findUniqueOrThrow({ where: { id: String(cuerpo['id']) } });
    expect(fila.transaccionId).toBe(cuerpo['transaccionId']);
    expect(fila.cuentaOrigenId).toBe(cuenta);
    expect(fila.titularId).toBe(t.id);
    for (const campo of NOMBRES_DE_CAMPO) {
      expect((fila as unknown as Record<string, unknown>)[campo], `${campo} no coincide`).toBe(
        beneficiarioValido()[campo],
      );
    }
  });

  it('A3 · el monto viaja como STRING decimal, nunca como número (D1)', async () => {
    const [t, cuenta] = await conCuenta();
    const cuerpo = await pagarOk(t, cuerpoDePago(cuenta, { monto: '9.05' }));
    expect(typeof cuerpo['monto']).toBe('string');
    expect(cuerpo['monto']).toBe('9.05');
  });

  it('A4 · los siete campos se guardan TRIMMEADOS', async () => {
    const [t, cuenta] = await conCuenta();
    const conEspacios = Object.fromEntries(
      NOMBRES_DE_CAMPO.map((c) => [c, `  ${beneficiarioValido()[c]}  `]),
    );
    const cuerpo = await pagarOk(t, cuerpoDePago(cuenta, conEspacios));
    const fila = await prisma.pago.findUniqueOrThrow({ where: { id: String(cuerpo['id']) } });
    for (const campo of NOMBRES_DE_CAMPO) {
      expect((fila as unknown as Record<string, unknown>)[campo], `${campo} sin trimmear`).toBe(
        beneficiarioValido()[campo],
      );
    }
  });

  it('A5 · el 201 no filtra columnas internas de la fila', async () => {
    const [t, cuenta] = await conCuenta();
    const cuerpo = await pagarOk(t, cuerpoDePago(cuenta));
    expect(Object.keys(cuerpo).sort()).toEqual(
      ['beneficiarioNombre', 'cuentaBeneficiario', 'cuentaOrigenId', 'id', 'monto', 'pagadoEn', 'transaccionId'].sort(),
    );
  });

  it('A6 · el pago deja el saldo exactamente en 0 si se paga todo (borde ==, no <)', async () => {
    const [t, cuenta] = await conCuenta();
    await pagarOk(t, cuerpoDePago(cuenta, { monto: '1000.00' }));
    expect(await saldoDe(cuenta)).toBe(0n);
  });
});

// ═══ B · el ledger · partida doble, destino y comisión cero ════════════════════════════
//
// Todos pasan por pagarOk: sin 201 no hay antes/después que comparar (lección de la 17).

describe('B · el ledger cuadra', () => {
  it('B1 · la transacción del pago suma EXACTAMENTE 0 (D2)', async () => {
    const [t, cuenta] = await conCuenta();
    const cuerpo = await pagarOk(t, cuerpoDePago(cuenta));
    const movs = await movimientosDe(String(cuerpo['transaccionId']));
    expect(movs.length, 'la transacción no tiene movimientos').toBeGreaterThan(0);
    expect(movs.reduce((a, m) => a + m.montoCentavos, 0n)).toBe(0n);
  });

  it('B2 · debita la cuenta origen y acredita la CAJA, y el concepto es PAGO_SERVICIO', async () => {
    const [t, cuenta] = await conCuenta();
    const cuerpo = await pagarOk(t, cuerpoDePago(cuenta, { monto: '300.00' }));
    const caja = await cuentaCaja();
    expect(caja, 'la cuenta de sistema CAJA no existe').not.toBeNull();
    const movs = await movimientosDe(String(cuerpo['transaccionId']));
    const debito = movs.find((m) => m.cuentaId === cuenta);
    const credito = movs.find((m) => m.cuentaId === caja);
    expect(debito, 'no hay movimiento en la cuenta origen').toBeDefined();
    expect(credito, 'no hay movimiento en la CAJA').toBeDefined();
    expect(debito?.montoCentavos).toBe(-30000n);
    expect(credito?.montoCentavos).toBe(30000n);
    expect(await conceptoDe(String(cuerpo['transaccionId']))).toBe(CONCEPTO_PAGO);
  });

  it('B3 · la transacción tiene EXACTAMENTE 2 movimientos: comisión cero (N3, V3)', async () => {
    // La razón de existir de este brazo: una comisión silenciosa dejaría la suma en 0 y B1
    // seguiría verde. Sin contar los movimientos, «no hay comisión» sería una intención.
    const [t, cuenta] = await conCuenta();
    const cuerpo = await pagarOk(t, cuerpoDePago(cuenta));
    const movs = await movimientosDe(String(cuerpo['transaccionId']));
    expect(movs.length).toBe(2);
  });

  it('B4 · los saldos derivados se mueven por el monto exacto, y sólo ellos', async () => {
    const [t, cuenta] = await conCuenta();
    const caja = await cuentaCaja();
    expect(caja).not.toBeNull();
    const antesCuenta = await saldoDe(cuenta);
    const antesCaja = await saldoDe(caja as string);
    await pagarOk(t, cuerpoDePago(cuenta, { monto: '250.75' }));
    expect(await saldoDe(cuenta)).toBe(antesCuenta - 25075n);
    expect(await saldoDe(caja as string)).toBe(antesCaja + 25075n);
  });

  it('B5 · un pago no escribe en la tabla de boletas ni toca otras cuentas del titular', async () => {
    // CORREGIDO: era un DATO ERRÓNEO del arnés, no una
    // relajación: la segunda cuenta se abría con '100.00' = 10 000 centavos, contra el
    // MONTO_APERTURA_MINIMO_CENTAVOS de S-12, que son 100 000 (los 1000 dólares). La apertura de preparación se rechazaba con MONTO_APERTURA_INSUFICIENTE y el
    // brazo era IMPOSIBLE de poner en verde — de la misma familia que
    // otros datos de preparación. Y la calibración por ausencia tampoco podía verlo: salía rojo,
    // que es justo lo que se esperaba de él.
    // El patrón correcto es el de cuentas C1: la primera con 3000.00 desde la CAJA, la
    // segunda con el mínimo, y queda saldo de sobra para pagar. Las aserciones NO cambian.
    const t = await nuevoTitular();
    const primera = await pedir('POST', '/cuentas', {
      cuerpo: { tipo: 'CORRIENTE', monto: '3000.00' },
      autorizacion: t.auth,
      clave: `s15-primera-${randomUUID()}`,
    });
    expect(primera.estado, JSON.stringify(primera.cuerpo)).toBe(201);
    const cuenta = String(primera.cuerpo['id']);
    const segunda = await pedir('POST', '/cuentas', {
      cuerpo: { tipo: 'CORRIENTE', cuentaOrigenId: cuenta, monto: '1000.00' },
      autorizacion: t.auth,
      clave: `s15-segunda-${randomUUID()}`,
    });
    expect(segunda.estado, JSON.stringify(segunda.cuerpo)).toBe(201);
    const otraCuenta = String(segunda.cuerpo['id']);
    const antesOtra = await saldoDe(otraCuenta);
    const boletasAntes = await prisma.boleta.count();
    await pagarOk(t, cuerpoDePago(cuenta, { monto: '10.00' }));
    expect(await saldoDe(otraCuenta), 'el pago movió otra cuenta del titular').toBe(antesOtra);
    expect(await prisma.boleta.count(), 'el pago escribió una boleta').toBe(boletasAntes);
  });
});

// ═══ C · validación y precedencia ══════════════════════════════════════════════════════

describe('C · validación', () => {
  it('C1 · beneficiarioNombre ausente → 400 con su código', async () => {
    const [t, cuenta] = await conCuenta();
    const cuerpo = cuerpoDePago(cuenta);
    delete cuerpo['beneficiarioNombre'];
    const r = await pagar(t, cuerpo);
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(400);
    expect(r.cuerpo['codigo']).toBe('PAGO_BENEFICIARIO_NOMBRE_INVALIDO');
  });

  it('C2 · CADA UNO de los siete campos con sólo espacios → 400 con SU código (no vacío TRAS trim)', async () => {
    // ENDURECIDO: la versión
    // anterior probaba '   ' SÓLO en beneficiarioNombre, y la spec § 5 dice «un campo del
    // beneficiario». Un servicio que comprobara `!valor` en los otros seis dejaba pasar
    // '   ': una cadena de espacios es truthy y su largo es menor al máximo. El
    // caso se probó en UNA instancia y se creyó probado en todas.
    const [t, cuenta] = await conCuenta();
    for (const { campo, codigo } of CAMPOS) {
      const r = await pagar(t, cuerpoDePago(cuenta, { [campo]: '   ' }));
      expect(r.estado, `${campo}: ${JSON.stringify(r.cuerpo)}`).toBe(400);
      expect(r.cuerpo['codigo'], `${campo} devolvió el código equivocado`).toBe(codigo);
    }
  });

  it('C3 · beneficiarioNombre EXACTAMENTE en el máximo (100) → se acepta', async () => {
    const [t, cuenta] = await conCuenta();
    const cuerpo = await pagarOk(t, cuerpoDePago(cuenta, { beneficiarioNombre: 'N'.repeat(100) }));
    expect(cuerpo['beneficiarioNombre']).toBe('N'.repeat(100));
  });

  it('C4 · beneficiarioNombre de 101 → 400 con su código', async () => {
    const [t, cuenta] = await conCuenta();
    const r = await pagar(t, cuerpoDePago(cuenta, { beneficiarioNombre: 'N'.repeat(101) }));
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(400);
    expect(r.cuerpo['codigo']).toBe('PAGO_BENEFICIARIO_NOMBRE_INVALIDO');
  });

  it('C5 · cada uno de los otros seis campos, ausente → 400 con SU código', async () => {
    const [t, cuenta] = await conCuenta();
    for (const { campo, codigo } of CAMPOS.slice(1)) {
      const cuerpo = cuerpoDePago(cuenta);
      delete cuerpo[campo];
      const r = await pagar(t, cuerpo);
      expect(r.estado, `${campo}: ${JSON.stringify(r.cuerpo)}`).toBe(400);
      expect(r.cuerpo['codigo'], `${campo} devolvió el código equivocado`).toBe(codigo);
    }
  });

  it('C6 · cada uno de los otros seis campos, un carácter sobre su máximo → 400 con SU código', async () => {
    const [t, cuenta] = await conCuenta();
    for (const { campo, max, codigo } of CAMPOS.slice(1)) {
      const r = await pagar(t, cuerpoDePago(cuenta, { [campo]: 'x'.repeat(max + 1) }));
      expect(r.estado, `${campo}: ${JSON.stringify(r.cuerpo)}`).toBe(400);
      expect(r.cuerpo['codigo'], `${campo} devolvió el código equivocado`).toBe(codigo);
    }
  });

  it('C7 · cada uno de los otros seis campos EXACTAMENTE en su máximo → se acepta', async () => {
    for (const { campo, max } of CAMPOS.slice(1)) {
      const [t, cuenta] = await conCuenta();
      const cuerpo = await pagarOk(t, cuerpoDePago(cuenta, { [campo]: 'x'.repeat(max) }));
      expect(String(cuerpo['id'])).toMatch(UUID_REGEX);
    }
  });

  it('C8 · monto "0.00" → 400 MONTO_INVALIDO (D6: no es «un pago que no hace nada»)', async () => {
    const [t, cuenta] = await conCuenta();
    const r = await pagar(t, cuerpoDePago(cuenta, { monto: '0.00' }));
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(400);
    expect(r.cuerpo['codigo']).toBe('MONTO_INVALIDO');
  });

  it('C9 · monto negativo → 400 MONTO_INVALIDO (el signo lo pone el asiento, no el input)', async () => {
    const [t, cuenta] = await conCuenta();
    const r = await pagar(t, cuerpoDePago(cuenta, { monto: '-125.50' }));
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(400);
    expect(r.cuerpo['codigo']).toBe('MONTO_INVALIDO');
  });

  it('C10 · monto como NÚMERO JSON → 400 (D1: en el borde el dinero es string)', async () => {
    // El caso que más fácil se cuela, porque «funciona igual» hasta que un centavo se pierde.
    const [t, cuenta] = await conCuenta();
    const r = await pagar(t, cuerpoDePago(cuenta, { monto: 125.5 }));
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(400);
    expect(r.cuerpo['codigo']).toBe('MONTO_INVALIDO');
  });

  it('C11 · precedencia: con el monto Y el nombre malos, gana MONTO_INVALIDO', async () => {
    const [t, cuenta] = await conCuenta();
    const r = await pagar(t, cuerpoDePago(cuenta, { monto: 'no-es-monto', beneficiarioNombre: '' }));
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(400);
    expect(r.cuerpo['codigo']).toBe('MONTO_INVALIDO');
  });

  it('C12 · un rechazo 400 no deja NI UNA fila en pago, transaccion ni movimiento (J11, V2)', async () => {
    // El 400 se EXIGE, no se acepta «cualquier cosa que no sea 201»: un 401 también cumpliría
    // esa condición y el brazo se aprobaría solo.
    const [t, cuenta] = await conCuenta();
    const antes = await censo(t.id);
    const r = await pagar(t, cuerpoDePago(cuenta, { beneficiarioCiudad: '' }));
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(400);
    expect(r.cuerpo['codigo']).toBe('PAGO_BENEFICIARIO_CIUDAD_INVALIDA');
    expect(await censo(t.id)).toEqual(antes);
  });

  it('C13 · saldo insuficiente → 409 FONDOS_INSUFICIENTES, y no escribe nada', async () => {
    // CORREGIDO: la spec decía 422 y el brazo lo copió, pero
    // src/infra/errores-http.filter.ts:97 traduce FONDOS_INSUFICIENTES a 409 desde S-05, y
    // el filtro está FUERA del alcance del módulo de pagos. Con 422 este brazo era IMPOSIBLE
    // de poner en verde. El 409 no es una relajación: es el dato correcto, y es el que ya
    // exigen cuentas C7 y test/idempotencia.int.spec.ts para el mismo error.
    const [t, cuenta] = await conCuenta();
    const antes = await censo(t.id);
    const saldoAntes = await saldoDe(cuenta);
    const r = await pagar(t, cuerpoDePago(cuenta, { monto: '999999.00' }));
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(409);
    expect(r.cuerpo['codigo']).toBe('FONDOS_INSUFICIENTES');
    expect(await censo(t.id)).toEqual(antes);
    expect(await saldoDe(cuenta)).toBe(saldoAntes);
  });

  it('C14 · cuentaBeneficiario con la forma de una cuenta REAL no se vuelve transferencia interna (J9)', async () => {
    const [otro, cuentaAjena] = await conCuenta('destino');
    const [t, cuenta] = await conCuenta();
    const saldoAjenoAntes = await saldoDe(cuentaAjena);
    const cuerpo = await pagarOk(t, cuerpoDePago(cuenta, { cuentaBeneficiario: cuentaAjena, monto: '50.00' }));
    expect(await saldoDe(cuentaAjena), 'el pago acreditó una cuenta interna').toBe(saldoAjenoAntes);
    const movs = await movimientosDe(String(cuerpo['transaccionId']));
    expect(movs.some((m) => m.cuentaId === cuentaAjena), 'la cuenta ajena aparece en el asiento').toBe(false);
    expect(otro.id).not.toBe(t.id);
  });

  it('C15 · monto AUSENTE → 400 MONTO_INVALIDO', async () => {
    // La tabla de errores de la spec § 3 dice «monto
    // ausente, no-string, no decimal, 0 o negativo». C8/C9/C10/C11 cubren los otros cuatro;
    // ninguno quitaba el campo, y `if (cuerpo.monto !== undefined) validar(...)` pasaba.
    const [t, cuenta] = await conCuenta();
    const cuerpo = cuerpoDePago(cuenta);
    delete cuerpo['monto'];
    const r = await pagar(t, cuerpo);
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(400);
    expect(r.cuerpo['codigo']).toBe('MONTO_INVALIDO');
  });

  it('C16 · precedencia ENTRE campos del beneficiario: con dos malos gana el primero de CAMPOS', async () => {
    // C11 medía la precedencia entre el monto y el nombre;
    // NINGÚN brazo enfrentaba dos campos del beneficiario entre sí, que es lo que dice el
    // paso 5 de la precedencia. Es la misma familia que se encontró en S-14 (C6 sólo
    // enfrentaba el primero contra el último), y por eso acá se recorre la lista ENTERA por
    // pares adyacentes, sacada de CAMPOS: así crece sola cuando crezca el contrato.
    const [t, cuenta] = await conCuenta();
    for (let i = 1; i < CAMPOS.length; i++) {
      const antes = CAMPOS[i - 1]!;
      const despues = CAMPOS[i]!;
      const r = await pagar(t, cuerpoDePago(cuenta, { [antes.campo]: '', [despues.campo]: '' }));
      expect(r.estado, `${antes.campo}+${despues.campo}: ${JSON.stringify(r.cuerpo)}`).toBe(400);
      expect(
        r.cuerpo['codigo'],
        `con ${antes.campo} y ${despues.campo} malos debía ganar ${antes.campo}`,
      ).toBe(antes.codigo);
    }
  });

  it('C17 · CADA UNO de los siete campos con un valor NO-STRING → 400 con SU código, nunca 500', async () => {
    // La tabla de errores dice «ausente, NO-STRING, vacío tras trim, o > máximo» para los
    // siete, y ningún brazo mandaba un no-string. Es el mismo hueco que se
    // encontró en S-14: un servicio que llame `.trim()` sin comprobar `typeof` revienta con
    // un TypeError y devuelve 500 en vez del código tipado que exige C5 del perfil SUT.
    const [t, cuenta] = await conCuenta();
    for (const { campo, codigo } of CAMPOS) {
      const r = await pagar(t, cuerpoDePago(cuenta, { [campo]: 42 }));
      expect(r.estado, `${campo}: ${JSON.stringify(r.cuerpo)}`).toBe(400);
      expect(r.cuerpo['codigo'], `${campo} devolvió el código equivocado`).toBe(codigo);
    }
  });
});

// ═══ D · idempotencia (D5) ═════════════════════════════════════════════════════════════

describe('D · idempotencia', () => {
  it('D1 · replay exacto: mismo 201, mismo cuerpo, UN SOLO asiento (V4)', async () => {
    const [t, cuenta] = await conCuenta();
    const clave = `s15-replay-${randomUUID()}`;
    const cuerpo = cuerpoDePago(cuenta);
    const primera = await pagar(t, cuerpo, clave);
    const segunda = await pagar(t, cuerpo, clave);
    expect(primera.estado, JSON.stringify(primera.cuerpo)).toBe(201);
    expect(segunda.estado, JSON.stringify(segunda.cuerpo)).toBe(201);
    expect(segunda.cuerpo).toEqual(primera.cuerpo);
    expect(await prisma.pago.count({ where: { titularId: t.id } })).toBe(1);
    expect(await saldoDe(cuenta)).toBe(SALDO_INICIAL_CENTAVOS - 12550n);
  });

  it('D2 · misma clave y huella distinta → 409, y CERO asientos nuevos', async () => {
    const [t, cuenta] = await conCuenta();
    const clave = `s15-choque-${randomUUID()}`;
    const primera = await pagar(t, cuerpoDePago(cuenta), clave);
    expect(primera.estado, JSON.stringify(primera.cuerpo)).toBe(201);
    const antes = await censo(t.id);
    const segunda = await pagar(t, cuerpoDePago(cuenta, { monto: '999.00' }), clave);
    expect(segunda.estado, JSON.stringify(segunda.cuerpo)).toBe(409);
    expect(segunda.cuerpo['codigo']).toBe('IDEMPOTENCY_KEY_REUSADA');
    expect(await censo(t.id)).toEqual(antes);
  });

  it('D3 · sin Idempotency-Key → 400, y con una de 201 caracteres → 400', async () => {
    const [t, cuenta] = await conCuenta();
    const sinClave = await pedir('POST', '/pagos', { cuerpo: cuerpoDePago(cuenta), autorizacion: t.auth });
    expect(sinClave.estado, JSON.stringify(sinClave.cuerpo)).toBe(400);
    expect(sinClave.cuerpo['codigo']).toBe('IDEMPOTENCY_KEY_AUSENTE');
    const larga = await pagar(t, cuerpoDePago(cuenta), 'k'.repeat(201));
    expect(larga.estado, JSON.stringify(larga.cuerpo)).toBe(400);
    expect(larga.cuerpo['codigo']).toBe('IDEMPOTENCY_KEY_INVALIDA');
    // Añadido: la tabla de errores dice «falta Idempotency-Key O VIENE
    // VACÍA». El brazo sólo probaba la ausencia, y `if (clave === undefined)` pasaba.
    const vacia = await pagar(t, cuerpoDePago(cuenta), '');
    expect(vacia.estado, JSON.stringify(vacia.cuerpo)).toBe(400);
    expect(vacia.cuerpo['codigo']).toBe('IDEMPOTENCY_KEY_AUSENTE');
  });

  it('D4 · otro titular con la MISMA clave y el MISMO cuerpo → 409, no la respuesta del dueño (J6)', async () => {
    // REESCRITO ENTERO, y por DOS razones distintas. La versión anterior:
    //
    //   (1) ERA IMPOSIBLE DE PASAR. Exigía 201 al segundo titular, pero `clave` es única en
    //       todo el sistema y IdempotenciaEjecutor devuelve 409 en cuanto la huella difiere.
    //       Es lo que ya exigen cuentas D3 y boletas C5 para este mismo caso.
    //
    //   (2) ERA CIEGO AL DEFECTO QUE DECÍA CAZAR (L7). Le daba a cada titular SU PROPIA
    //       cuenta, así que los cuerpos ya diferían y la huella ya era distinta SIN
    //       `titularId`: el brazo daba 409 en los dos mundos y no medía J6. Es exactamente
    //       el defecto que S-18 corrigió en su B10 —«NACIÓ CIEGO»— reproducido
    //       tal cual acá.
    //
    // Lo que sí distingue una huella CON titularId de una SIN él: MISMA clave y MISMO
    // cuerpo, dos titulares. Sin J6 la huella coincide, el sistema lo toma por un reintento
    // y le entrega al intruso la RESPUESTA GUARDADA del dueño, con su transaccionId y su
    // cuenta. No es un descuadre contable: es una filtración.
    const [duenio, cuentaDuenio] = await conCuenta('duenio');
    const intruso = await nuevoTitular('intruso');
    const clave = `s15-compartida-${randomUUID()}`;
    const cuerpo = cuerpoDePago(cuentaDuenio);

    const delDuenio = await pagar(duenio, cuerpo, clave);
    expect(delDuenio.estado, JSON.stringify(delDuenio.cuerpo)).toBe(201);
    const antes = await censo(duenio.id);

    const delIntruso = await pagar(intruso, cuerpo, clave);
    expect(delIntruso.estado, JSON.stringify(delIntruso.cuerpo)).toBe(409);
    expect(delIntruso.cuerpo['codigo']).toBe('IDEMPOTENCY_KEY_REUSADA');
    // Testigo independiente: pase lo que pase, el intruso NO recibe el cuerpo del dueño.
    expect(delIntruso.cuerpo['id'], 'el intruso recibió el pago guardado del dueño').toBeUndefined();
    expect(delIntruso.cuerpo['transaccionId']).toBeUndefined();
    // Y el pago del dueño sigue siendo UNO, sin asientos nuevos.
    expect(await censo(duenio.id)).toEqual(antes);
    expect(await prisma.pago.count({ where: { titularId: intruso.id } })).toBe(0);
  });

  it('D5 · el replay NO vuelve a ejecutar: el saldo se mueve una sola vez (J7)', async () => {
    const [t, cuenta] = await conCuenta();
    const clave = `s15-unavez-${randomUUID()}`;
    const cuerpo = cuerpoDePago(cuenta, { monto: '100.00' });
    const primera = await pagar(t, cuerpo, clave);
    expect(primera.estado, JSON.stringify(primera.cuerpo)).toBe(201);
    const saldoTrasUno = await saldoDe(cuenta);
    for (let i = 0; i < 3; i++) {
      const r = await pagar(t, cuerpo, clave);
      expect(r.estado, `replay ${i}: ${JSON.stringify(r.cuerpo)}`).toBe(201);
    }
    expect(await saldoDe(cuenta), 'el replay volvió a mover plata').toBe(saldoTrasUno);
    expect(await prisma.pago.count({ where: { titularId: t.id } })).toBe(1);
  });

  it('D6 · misma clave y MISMO monto pero OTRO beneficiario → 409, no un replay (V4)', async () => {
    // Es el más peligroso de los ocho: D2 comprueba la
    // colisión de huella variando el MONTO, así que una huella de {titularId, cuentaOrigen,
    // monto} —sin los campos del beneficiario— pasaba D2 en verde. Con ella, un cliente que
    // reintenta la misma clave cambiando el destinatario recibe un 201 con el pago al
    // beneficiario ANTERIOR y cree que le pagó a otro. La huella cubre el pago ENTERO.
    const [t, cuenta] = await conCuenta();
    const clave = `s15-otrobenef-${randomUUID()}`;
    const primera = await pagar(t, cuerpoDePago(cuenta), clave);
    expect(primera.estado, JSON.stringify(primera.cuerpo)).toBe(201);
    const antes = await censo(t.id);
    const segunda = await pagar(
      t,
      cuerpoDePago(cuenta, { beneficiarioNombre: 'Otra Empresa Distinta SA' }),
      clave,
    );
    expect(segunda.estado, JSON.stringify(segunda.cuerpo)).toBe(409);
    expect(segunda.cuerpo['codigo']).toBe('IDEMPOTENCY_KEY_REUSADA');
    expect(await censo(t.id)).toEqual(antes);
  });
});

// ═══ E · auth y aislamiento ════════════════════════════════════════════════════════════

describe('E · auth y aislamiento', () => {
// El invariante V1 dice que ninguna petición SIN TOKEN VÁLIDO escribe una sola fila en
// `pago`, `transaccion` ni `movimiento`. Antes los cuatro brazos de token
// miraban sólo el 401 y NINGUNO censaba la base: una implementación que registrara la transacción
// antes de identificar al cliente pasaba los cuatro en verde. Es la mitad del invariante
// que nadie estaba midiendo.

  it('E1 · sin cabecera Authorization → 401 TOKEN_AUSENTE, y sin escribir nada (V1)', async () => {
    const [t, cuenta] = await conCuenta();
    const antes = await censo(t.id);
    const r = await pedir('POST', '/pagos', {
      cuerpo: cuerpoDePago(cuenta),
      clave: `s15-${randomUUID()}`,
    });
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(401);
    expect(r.cuerpo['codigo']).toBe('TOKEN_AUSENTE');
    expect(await censo(t.id), 'una petición sin token escribió en la base (V1)').toEqual(antes);
  });

  it('E2 · token firmado con otro secreto → 401 TOKEN_INVALIDO, y sin escribir nada (V1)', async () => {
    const [t, cuenta] = await conCuenta();
    const antes = await censo(t.id);
    const ajeno = forjarToken(t.id, Math.floor(Date.now() / 1000) + 3600, 'otro-secreto-distinto-32-caracteres');
    const r = await pedir('POST', '/pagos', {
      cuerpo: cuerpoDePago(cuenta),
      autorizacion: `Bearer ${ajeno}`,
      clave: `s15-${randomUUID()}`,
    });
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(401);
    expect(r.cuerpo['codigo']).toBe('TOKEN_INVALIDO');
    expect(await censo(t.id), 'una firma ajena escribió en la base (V1)').toEqual(antes);
  });

  it('E3 · token vencido → 401 TOKEN_EXPIRADO, y sin escribir nada (V1)', async () => {
    const [t, cuenta] = await conCuenta();
    const antes = await censo(t.id);
    const vencido = forjarToken(t.id, Math.floor(Date.now() / 1000) - 60);
    const r = await pedir('POST', '/pagos', {
      cuerpo: cuerpoDePago(cuenta),
      autorizacion: `Bearer ${vencido}`,
      clave: `s15-${randomUUID()}`,
    });
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(401);
    expect(r.cuerpo['codigo']).toBe('TOKEN_EXPIRADO');
    expect(await censo(t.id), 'un token vencido escribió en la base (V1)').toEqual(antes);
  });

  it('E4 · sin token Y sin Idempotency-Key → 401, NO 400: el token va primero (J5)', async () => {
    const [t, cuenta] = await conCuenta();
    const antes = await censo(t.id);
    const r = await pedir('POST', '/pagos', { cuerpo: cuerpoDePago(cuenta) });
    expect(r.estado, `a un cliente no identificado no se le diagnostica la forma: ${JSON.stringify(r.cuerpo)}`).toBe(401);
    expect(await censo(t.id), 'una petición sin token ni clave escribió en la base (V1)').toEqual(antes);
  });

  it('E5 · un titularId en el cuerpo se IGNORA: el titular sale del token (J3)', async () => {
    const [t, cuenta] = await conCuenta();
    const otro = await nuevoTitular('impostor');
    const cuerpo = await pagarOk(t, cuerpoDePago(cuenta, { titularId: otro.id }));
    const fila = await prisma.pago.findUniqueOrThrow({ where: { id: String(cuerpo['id']) } });
    expect(fila.titularId, 'el titular salió del cuerpo, no del token').toBe(t.id);
  });

  it('E6 · pagar desde la cuenta de OTRO → 404 CUENTA_NO_ENCONTRADA, no 403 (J4)', async () => {
    const [, cuentaAjena] = await conCuenta('victima');
    const t = await nuevoTitular('atacante');
    const saldoAntes = await saldoDe(cuentaAjena);
    const r = await pagar(t, cuerpoDePago(cuentaAjena));
    expect(r.estado, `un 403 confirmaría que la cuenta existe: ${JSON.stringify(r.cuerpo)}`).toBe(404);
    expect(r.cuerpo['codigo']).toBe('CUENTA_NO_ENCONTRADA');
    expect(await saldoDe(cuentaAjena), 'la cuenta ajena se movió').toBe(saldoAntes);
  });

  it('E7 · la cuenta ajena y la INEXISTENTE responden exactamente lo mismo (J4)', async () => {
    const [, cuentaAjena] = await conCuenta('victima2');
    const t = await nuevoTitular('atacante2');
    const ajena = await pagar(t, cuerpoDePago(cuentaAjena));
    const fantasma = await pagar(t, cuerpoDePago(randomUUID()));
    // ENDURECIDO (calibración por ausencia): la versión
    // anterior sólo exigía 404 en las dos y que los cuerpos fueran IGUALES. Con la ruta
    // inexistente las dos recibían el 404 de enrutado de Nest, eran idénticas, y el brazo
    // se aprobaba solo. Misma familia que un brazo que pasa sin implementación: comparaba dos cosas sin
    // exigir que ninguna fuera la correcta.
    expect(ajena.estado, JSON.stringify(ajena.cuerpo)).toBe(404);
    expect(fantasma.estado, JSON.stringify(fantasma.cuerpo)).toBe(404);
    expect(ajena.cuerpo['codigo']).toBe('CUENTA_NO_ENCONTRADA');
    expect(fantasma.cuerpo['codigo']).toBe('CUENTA_NO_ENCONTRADA');
    expect(ajena.cuerpo, 'las dos respuestas difieren: se puede barrer el espacio de ids').toEqual(fantasma.cuerpo);
  });

  it('E8 · cuentaOrigenId que no es un uuid → 404, sin tocar la base', async () => {
    const t = await nuevoTitular();
    const r = await pagar(t, cuerpoDePago('no-soy-un-uuid'));
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(404);
    expect(r.cuerpo['codigo']).toBe('CUENTA_NO_ENCONTRADA');
  });

  it('E9 · cuentaOrigenId AUSENTE → 404 CUENTA_NO_ENCONTRADA, y no paga desde ninguna cuenta', async () => {
    // La tabla de errores dice «cuentaOrigenId AUSENTE,
    // no-uuid, inexistente, o de otro titular». E6/E7/E8 cubren los otros tres; el campo
    // nunca faltaba, porque `cuerpoDePago` siempre lo pone. Una implementación cómoda que
    // hiciera `cuerpo.cuentaOrigenId ?? primeraCuentaDelTitular` pagaba con 201 desde una
    // cuenta que el cliente no nombró, y los 47 brazos quedaban en verde.
    const [t, cuenta] = await conCuenta();
    const saldoAntes = await saldoDe(cuenta);
    const antes = await censo(t.id);
    const cuerpo = cuerpoDePago(cuenta);
    delete cuerpo['cuentaOrigenId'];
    const r = await pagar(t, cuerpo);
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(404);
    expect(r.cuerpo['codigo']).toBe('CUENTA_NO_ENCONTRADA');
    expect(await saldoDe(cuenta), 'pagó desde una cuenta que el cliente no nombró').toBe(saldoAntes);
    expect(await censo(t.id)).toEqual(antes);
  });
});

// ═══ F · GET /pagos ════════════════════════════════════════════════════════════════════

describe('F · listar los pagos', () => {
  it('F1 · un titular sin pagos recibe 200 con lista vacía, no 404', async () => {
    const t = await nuevoTitular();
    const r = await listar(t);
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(200);
    expect(r.cuerpo['pagos']).toEqual([]);
  });

  it('F2 · devuelve los pagos del titular con la forma del 201', async () => {
    const [t, cuenta] = await conCuenta();
    const uno = await pagarOk(t, cuerpoDePago(cuenta, { monto: '10.00' }));
    const dos = await pagarOk(t, cuerpoDePago(cuenta, { monto: '20.00' }));
    const r = await listar(t);
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(200);
    const pagos = r.cuerpo['pagos'] as Array<Record<string, unknown>>;
    expect(pagos.length).toBe(2);
    const ids = pagos.map((p) => p['id']);
    expect(ids).toContain(uno['id']);
    expect(ids).toContain(dos['id']);
    // ENDURECIDO: la versión anterior
    // comprobaba las CLAVES del objeto con Object.keys y nunca el VALOR de `monto`. Y el
    // monto es justo el campo que NO existe en la tabla `pago`: hay que derivarlo del
    // ledger. Un servicio que devolviera `{ ...fila, monto: '0.00' }` sin consultar los
    // movimientos pasaba este brazo en verde con todos los montos falseados.
    const porId = new Map(pagos.map((p) => [String(p['id']), p]));
    expect(porId.get(String(uno['id']))?.['monto'], 'el monto del listado no es el que se pagó').toBe('10.00');
    expect(porId.get(String(dos['id']))?.['monto'], 'el monto del listado no es el que se pagó').toBe('20.00');
    for (const p of pagos) {
      expect(Object.keys(p).sort()).toEqual(
        ['beneficiarioNombre', 'cuentaBeneficiario', 'cuentaOrigenId', 'id', 'monto', 'pagadoEn', 'transaccionId'].sort(),
      );
    }
  });

  it('F3 · un titular NO ve los pagos de otro (V5)', async () => {
    const [duenio, cuentaDuenio] = await conCuenta('duenio-lista');
    const suyo = await pagarOk(duenio, cuerpoDePago(cuentaDuenio));
    const mirón = await nuevoTitular('miron');
    const r = await listar(mirón);
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(200);
    const pagos = r.cuerpo['pagos'] as Array<Record<string, unknown>>;
    expect(pagos.map((p) => p['id']), 'el listado filtró mal por titular').not.toContain(suyo['id']);
    expect(pagos).toEqual([]);
  });

  it('F5 · el listado viene en el orden del contrato: pagadoEn desc, id asc', async () => {
    // La spec § 3 fija «orden pagadoEn desc y id asc» y F2
    // sólo usaba `toContain`, que ignora el orden por completo: un `orderBy: { pagadoEn:
    // 'asc' }` pasaba en verde. Acá el orden esperado NO se escribe a mano —dos pagos
    // pueden caer en el mismo instante y el brazo sería intermitente, y un intermitente es
    // un defecto—: se DERIVA de las filas crudas con el comparador del contrato, que es el
    // oráculo independiente. Así el brazo mide el orden y nunca la suerte del reloj.
    const [t, cuenta] = await conCuenta();
    for (const monto of ['10.00', '20.00', '30.00']) {
      await pagarOk(t, cuerpoDePago(cuenta, { monto }));
    }
    const r = await listar(t);
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(200);
    const devueltos = (r.cuerpo['pagos'] as Array<Record<string, unknown>>).map((p) => String(p['id']));

    const crudos = await prisma.pago.findMany({ where: { titularId: t.id }, select: { id: true, pagadoEn: true } });
    const esperados = [...crudos]
      .sort((a, b) => {
        const dif = b.pagadoEn.getTime() - a.pagadoEn.getTime();
        return dif !== 0 ? dif : a.id.localeCompare(b.id);
      })
      .map((f) => f.id);

    expect(esperados.length, 'el arnés no sembró los tres pagos').toBe(3);
    expect(devueltos, 'el listado no respeta pagadoEn desc, id asc').toEqual(esperados);
  });

  it('F4 · GET /pagos sin token → 401', async () => {
    const r = await pedir('GET', '/pagos');
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(401);
    expect(r.cuerpo['codigo']).toBe('TOKEN_AUSENTE');
  });
});

// ═══ G · controles que NO dependen de S-15 ═════════════════════════════════════════════
//
// Sin ellos, «todo rojo» en la calibración por ausencia no tiene contra qué leerse: no se
// distingue «la unidad no existe» de «el arnés no arranca».

describe('G · controles que no dependen de S-15', () => {
  it('G1 · el registro y el login de S-08 siguen funcionando', async () => {
    const email = `control-${randomUUID()}@ejemplo.cl`;
    const reg = await pedir('POST', '/auth/registro', { cuerpo: { email, password: PASSWORD } });
    expect(reg.estado, JSON.stringify(reg.cuerpo)).toBe(201);
    const login = await pedir('POST', '/auth/login', { cuerpo: { email, password: PASSWORD } });
    expect(login.estado, JSON.stringify(login.cuerpo)).toBe(200);
    expect(typeof login.cuerpo['token']).toBe('string');
  });

  it('G2 · S-12 sigue abriendo cuentas fondeadas desde la CAJA', async () => {
    const [, cuenta] = await conCuenta('control');
    expect(await saldoDe(cuenta)).toBe(SALDO_INICIAL_CENTAVOS);
  });

  it('G4 · S-12 fondea la primera cuenta con el saldo que este arnés da por sentado', async () => {
    // Estaba como B5 y se movió acá en la calibración por ausencia: NO paga
    // nada, así que no depende de S-15 y quedaba verde en el grupo del ledger, ensuciando la
    // lectura de «todo rojo salvo G». Sigue siendo valioso —fija el punto de partida que D1,
    // D5 y A6 dan por sentado—, pero es un control y va donde van los controles.
    const [, cuenta] = await conCuenta('control-saldo');
    expect(await saldoDe(cuenta)).toBe(SALDO_INICIAL_CENTAVOS);
  });

  it('G5 · un cuerpo que no es JSON válido → 400 CUERPO_INVALIDO', async () => {
    // Estaba como C11. La calibración por ausencia lo destapó: pasa SIN el módulo, porque el
    // parser de cuerpo y el filtro global responden antes de enrutar. O sea que NO mide a
    // S-15: mide la infraestructura. Se queda —una implementación que registrara su propio parseo y
    // se tragara el SyntaxError lo pondría rojo, y eso es exactamente lo que un control hace—
    // pero declarado como control, que es lo que es. Un brazo que no puede fallar por culpa
    // de la unidad no es un brazo de la unidad.
    const t = await nuevoTitular();
    const r = await pedir('POST', '/pagos', {
      cuerpoCrudo: '{"monto": ',
      autorizacion: t.auth,
      clave: `s15-${randomUUID()}`,
    });
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(400);
    expect(r.cuerpo['codigo']).toBe('CUERPO_INVALIDO');
  });

  it('G3 · el motor de transferencias de S-05/S-18 sigue cuadrando (D2)', async () => {
    const [t, origen] = await conCuenta('control-tr');
    const [, destino] = await conCuenta('control-tr-dst');
    const r = await pedir('POST', '/transferencias', {
      cuerpo: { origenId: origen, destinoId: destino, monto: '15.00' },
      autorizacion: t.auth,
      clave: `s15-control-${randomUUID()}`,
    });
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(201);
    const movs = await movimientosDe(String(r.cuerpo['transaccionId']));
    expect(movs.length).toBe(2);
    expect(movs.reduce((a, m) => a + m.montoCentavos, 0n)).toBe(0n);
  });
});
