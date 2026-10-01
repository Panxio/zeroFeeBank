import { createHmac, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/prisma.service.js';
import { AppModule } from '../src/app.module.js';

/**
 * Arnés de integración para S-22 · transferencia a otro banco.
 * Ver specs/S-22-otros-bancos.md § 3, § 5 y § 8 (matriz de brazos M9).
 *
 * Principios:
 * - Habla por HTTP y lee la base con Prisma como oráculo independiente.
 * - Monta AppModule (el módulo nuevo se registra en él).
 * - A0: Reloj fijado en 2026-10-01T12:00:00.000Z en beforeEach y liberado en afterAll.
 * - Tokens forjados relativos al reloj fijado, renovados tras mover el reloj (D5).
 * - Todo brazo que compara antes/después exige que el acto del medio tuvo su código exacto:
 *   éxito exige transferirOk (201); rechazos exigen su 4xx y su código tipado exacto.
 * - Cada brazo siembra sus propios titulares y cuentas por partida doble con SIEMBRA_ARNES.
 * - F1: titular y cuenta nuevos por cada una de las 3 ráfagas concurrentes.
 */

const prisma = new PrismaService();
let app: INestApplication;
let base = '';

const SECRETO = 'arnes-s22-secreto-de-pruebas-32-min-ok';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const T_BASE = new Date('2026-10-01T12:00:00.000Z');
let relojActual = T_BASE;

// ─── Utilidades HTTP y Auth ─────────────────────────────────────────────────────────────

interface Respuesta {
  estado: number;
  cuerpo: Record<string, unknown>;
  cabeceras: Headers;
  texto: string;
}

async function pedir(
  metodo: string,
  ruta: string,
  opciones: {
    cuerpo?: unknown;
    autorizacion?: string | null | undefined;
    clave?: string | undefined;
    cuerpoCrudo?: string | undefined;
  } = {},
): Promise<Respuesta> {
  const headers: Record<string, string> = {};
  if (opciones.cuerpo !== undefined || opciones.cuerpoCrudo !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (opciones.autorizacion !== undefined && opciones.autorizacion !== null) {
    headers['authorization'] = opciones.autorizacion;
  }
  if (opciones.clave !== undefined) {
    headers['idempotency-key'] = opciones.clave;
  }
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
    texto,
  };
}

const b64url = (b: Buffer): string => b.toString('base64url');

function forjarToken(sub: string, expEpochSegundos: number, secreto = SECRETO): string {
  const carga = b64url(Buffer.from(JSON.stringify({ sub, exp: expEpochSegundos })));
  const firma = b64url(createHmac('sha256', secreto).update(carga).digest());
  return `${carga}.${firma}`;
}

function tokenPara(titularId: string, instante = relojActual): string {
  const expEpoch = Math.floor(instante.getTime() / 1000) + 3600;
  return forjarToken(titularId, expEpoch);
}

interface Titular {
  id: string;
  auth: string;
}

async function titular(): Promise<Titular> {
  const id = randomUUID();
  await prisma.usuario.create({
    data: {
      id,
      email: `t-${id}@arnes.local`,
      passwordHash: 'no-se-usa: el arnés forja el token',
      creadoEn: relojActual,
    },
  });
  return { id, auth: `Bearer ${tokenPara(id, relojActual)}` };
}

function renovarToken(t: Titular): void {
  t.auth = `Bearer ${tokenPara(t.id, relojActual)}`;
}

// ─── Siembra y oráculo independiente ─────────────────────────────────────────────────────

async function cuentaConSaldo(
  saldoCentavos: bigint,
  titularId: string,
  tipo: 'CORRIENTE' | 'AHORRO' | 'PRESTAMO' = 'CORRIENTE',
): Promise<string> {
  const cuentaId = randomUUID();
  const sistemaId = randomUUID();
  await prisma.cuenta.createMany({
    data: [
      { id: cuentaId, tipo, titularId, creadaEn: relojActual },
      { id: sistemaId, tipo: 'SISTEMA', creadaEn: relojActual },
    ],
  });
  if (saldoCentavos > 0n) {
    const transaccionId = randomUUID();
    await prisma.transaccion.create({
      data: { id: transaccionId, concepto: 'SIEMBRA_ARNES', creadaEn: relojActual },
    });
    await prisma.movimiento.createMany({
      data: [
        { transaccionId, cuentaId, montoCentavos: saldoCentavos, creadoEn: relojActual },
        { transaccionId, cuentaId: sistemaId, montoCentavos: -saldoCentavos, creadoEn: relojActual },
      ],
    });
  }
  return cuentaId;
}

async function saldoDe(cuentaId: string): Promise<bigint> {
  const filas = await prisma.$queryRaw<Array<{ saldo: bigint }>>`
    SELECT COALESCE(SUM(monto_centavos), 0)::bigint AS saldo
    FROM movimiento WHERE cuenta_id = ${cuentaId}::uuid`;
  return filas[0]?.saldo ?? 0n;
}

async function contarTransaccionesOtrosBancos(): Promise<number> {
  return prisma.transaccion.count({
    where: { concepto: 'TRANSFERENCIA_OTRO_BANCO' },
  });
}

// Enmienda § 8.1: reemplazar sólo los ids enviados por el brazo para verificar indistinguibilidad
function reemplazarIds(texto: string, ids: string[]): string {
  let resultado = texto;
  for (const id of ids) {
    if (id) {
      resultado = resultado.replaceAll(id, '<id>');
    }
  }
  return resultado;
}

function codigoDe(r: Respuesta): string {
  try {
    return (JSON.parse(r.texto) as { codigo?: string }).codigo ?? '<sin campo codigo>';
  } catch {
    return `<no es JSON: ${r.texto.slice(0, 120)}>`;
  }
}

// ─── Cliente de Transferencias a Otros Bancos ───────────────────────────────────────────

function cuerpoValido(
  cuentaOrigenId: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    cuentaOrigenId,
    monto: '50.00',
    banco: 'ASERCION',
    numeroCuenta: '000123',
    tipoCuenta: 'AHORRO',
    ...extra,
  };
}

async function transferir(
  autorizacion: string | null,
  cuerpo: unknown,
  clave: string | undefined = `s22-${randomUUID()}`,
  cuerpoCrudo?: string,
): Promise<Respuesta> {
  return pedir('POST', '/transferencias/otros-bancos', {
    cuerpo,
    autorizacion,
    clave,
    cuerpoCrudo,
  });
}

async function transferirOk(
  t: Titular,
  cuerpo: unknown,
  clave = `s22-${randomUUID()}`,
): Promise<Record<string, unknown>> {
  const r = await transferir(t.auth, cuerpo, clave);
  expect(
    r.estado,
    `transferir debía funcionar y respondió ${r.estado}: ${r.texto}`,
  ).toBe(201);
  return r.cuerpo;
}

function exigirRechazo(
  r: Respuesta,
  estadoEsperado: number,
  codigoEsperado: string,
  contexto?: string,
): void {
  const etiqueta = contexto ? `[${contexto}] ` : '';
  expect(
    r.estado,
    `${etiqueta}esperaba HTTP ${estadoEsperado} pero dio ${r.estado}: ${r.texto}`,
  ).toBe(estadoEsperado);
  expect(
    codigoDe(r),
    `${etiqueta}esperaba código ${codigoEsperado} pero dio ${codigoDe(r)}: ${r.texto}`,
  ).toBe(codigoEsperado);
}

async function fijarReloj(instante: Date): Promise<void> {
  relojActual = instante;
  const r = await pedir('POST', '/__test__/reloj', {
    cuerpo: { instante: instante.toISOString() },
  });
  expect(r.estado, `fijar reloj falló: ${r.texto}`).toBe(200);
}

// ─── Ciclo de Vida ──────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  process.env['ZFB_AUTH_SECRET'] = SECRETO;
  process.env['ZFB_COSTURAS_PRUEBA'] = '1';
  await prisma.$connect();
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  // Corrección: base conocida (C1). Sin esto, una OTROS_BANCOS que dejó otra
  // corrida hace verde a C4 y a A3 con una app que acredita otra cuenta (K13).
  const reset = await pedir('POST', '/__test__/reset', { cuerpo: {} });
  expect(reset.estado, `reset falló: ${reset.texto}`).toBe(200);
}, 60_000);

beforeEach(async () => {
  await fijarReloj(T_BASE);
});

afterAll(async () => {
  if (base) {
    await fetch(`${base}/__test__/reloj`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instante: null }),
    });
  }
  await app?.close();
  await prisma.$disconnect();
});

// ═══ Grupo A · Éxito y ledger ═══════════════════════════════════════════════════════════

describe('Grupo A · Éxito y ledger', () => {
  it('A1 · válida → 201; cuerpo con las 8 claves en orden; id/transaccionId UUID; eco de banco, número y tipo; monto "50.00"; realizadaEn = reloj fijado', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(50_00n, t.id);
    const payload = cuerpoValido(origen, {
      monto: '50.00',
      banco: 'ASERCION',
      numeroCuenta: '000123',
      tipoCuenta: 'AHORRO',
    });

    const r = await transferir(t.auth, payload);
    expect(r.estado, `debía dar 201: ${r.texto}`).toBe(201);
    const cuerpo = r.cuerpo;

    // 8 claves en el orden exacto fijado por § 3.1
    expect(Object.keys(cuerpo)).toEqual([
      'id',
      'transaccionId',
      'cuentaOrigenId',
      'monto',
      'banco',
      'numeroCuenta',
      'tipoCuenta',
      'realizadaEn',
    ]);

    expect(String(cuerpo['id'])).toMatch(UUID_REGEX);
    expect(String(cuerpo['transaccionId'])).toMatch(UUID_REGEX);
    expect(cuerpo['cuentaOrigenId']).toBe(origen);
    expect(cuerpo['monto']).toBe('50.00');
    expect(cuerpo['banco']).toBe('ASERCION');
    expect(cuerpo['numeroCuenta']).toBe('000123');
    expect(cuerpo['tipoCuenta']).toBe('AHORRO');
    expect(cuerpo['realizadaEn']).toBe(relojActual.toISOString());
  });

  it('A2 · exactamente 1 transacción nueva de concepto TRANSFERENCIA_OTRO_BANCO con 2 movimientos: −monto en el origen y +monto en la cuenta de codigo = "OTROS_BANCOS", tipo = "SISTEMA", titular_id nulo; suma 0; creada_en = realizadaEn', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(100_00n, t.id);
    const txAntes = await contarTransaccionesOtrosBancos();

    const cuerpo = await transferirOk(t, cuerpoValido(origen, { monto: '50.00' }));
    const transaccionId = String(cuerpo['transaccionId']);

    const txDespues = await contarTransaccionesOtrosBancos();
    expect(txDespues, 'debe crearse exactamente 1 transacción nueva').toBe(txAntes + 1);

    const tx = await prisma.transaccion.findUnique({
      where: { id: transaccionId },
      include: { movimientos: true },
    });
    expect(tx, `transacción ${transaccionId} no encontrada`).not.toBeNull();
    expect(tx!.concepto).toBe('TRANSFERENCIA_OTRO_BANCO');
    expect(tx!.creadaEn.toISOString()).toBe(String(cuerpo['realizadaEn']));
    expect(tx!.movimientos).toHaveLength(2);

    const movOrigen = tx!.movimientos.find((m) => m.cuentaId === origen);
    const movDestino = tx!.movimientos.find((m) => m.cuentaId !== origen);
    expect(movOrigen, 'debe haber un movimiento en la cuenta origen').toBeDefined();
    expect(movDestino, 'debe haber un movimiento en la cuenta destino').toBeDefined();

    expect(movOrigen!.montoCentavos).toBe(-5000n);
    expect(movDestino!.montoCentavos).toBe(5000n);
    expect(movOrigen!.montoCentavos + movDestino!.montoCentavos).toBe(0n);

    // Cuenta de contrapartida OTROS_BANCOS
    const cuentaSistema = await prisma.cuenta.findUnique({
      where: { id: movDestino!.cuentaId },
    });
    expect(cuentaSistema, 'la cuenta destino debe existir').not.toBeNull();
    expect(cuentaSistema!.codigo).toBe('OTROS_BANCOS');
    expect(cuentaSistema!.tipo).toBe('SISTEMA');
    expect(cuentaSistema!.titularId).toBeNull();
  });

  it('A3 · sin comisión: el saldo del origen baja exactamente el monto y ninguna otra cuenta del titular cambia; tras transferir a dos bancos distintos, hay una sola cuenta OTROS_BANCOS', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(100_00n, t.id);
    const otraCuenta = await cuentaConSaldo(50_00n, t.id);

    const r1 = await transferirOk(t, cuerpoValido(origen, { monto: '10.00', banco: 'STUB' }));
    const r2 = await transferirOk(t, cuerpoValido(origen, { monto: '20.00', banco: 'SANDBOX' }));

    // Enmienda § 8.1: verificar que ambas transacciones acreditan la misma cuenta OTROS_BANCOS leída del movimiento positivo
    const tx1 = await prisma.transaccion.findUnique({
      where: { id: String(r1['transaccionId']) },
      include: { movimientos: true },
    });
    const tx2 = await prisma.transaccion.findUnique({
      where: { id: String(r2['transaccionId']) },
      include: { movimientos: true },
    });
    const movPos1 = tx1?.movimientos.find((m) => m.montoCentavos > 0n);
    const movPos2 = tx2?.movimientos.find((m) => m.montoCentavos > 0n);
    expect(movPos1, 'tx1 debe tener movimiento positivo').toBeDefined();
    expect(movPos2, 'tx2 debe tener movimiento positivo').toBeDefined();
    expect(movPos1!.cuentaId, 'ambas transacciones deben acreditar la misma cuenta').toBe(movPos2!.cuentaId);

    const cuentaOtrosBancos = await prisma.cuenta.findUnique({
      where: { id: movPos1!.cuentaId },
    });
    expect(cuentaOtrosBancos, 'la cuenta acreditada debe existir').not.toBeNull();
    expect(cuentaOtrosBancos!.codigo).toBe('OTROS_BANCOS');

    expect(await saldoDe(origen)).toBe(70_00n);
    expect(await saldoDe(otraCuenta)).toBe(50_00n);

    const cantidadOtrosBancos = await prisma.cuenta.count({
      where: { codigo: 'OTROS_BANCOS' },
    });
    expect(cantidadOtrosBancos, 'debe haber exactamente una cuenta OTROS_BANCOS').toBe(1);
  });

  it('A4 · fila transferencia_otro_banco: banco, número, tipo, origen, titular y transaccionId iguales a lo pedido; "000123" se guarda con sus ceros', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(50_00n, t.id);
    const payload = cuerpoValido(origen, {
      monto: '15.00',
      banco: 'MOCK',
      numeroCuenta: '000123',
      tipoCuenta: 'CORRIENTE',
    });

    const cuerpo = await transferirOk(t, payload);
    const id = String(cuerpo['id']);

    const fila = await prisma.transferenciaOtroBanco.findUnique({
      where: { id },
    });
    expect(fila, `fila transferencia_otro_banco ${id} no encontrada`).not.toBeNull();
    expect(fila!.banco).toBe('MOCK');
    expect(fila!.numeroCuenta).toBe('000123'); // Ceros a la izquierda intactos
    expect(fila!.tipoCuenta).toBe('CORRIENTE');
    expect(fila!.cuentaOrigenId).toBe(origen);
    expect(fila!.titularId).toBe(t.id);
    expect(fila!.transaccionId).toBe(String(cuerpo['transaccionId']));
    expect(fila!.realizadaEn.toISOString()).toBe(String(cuerpo['realizadaEn']));
  });

  it('A5 · los 5 bancos del catálogo → 201 cada uno, 10.00 cada uno', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(100_00n, t.id);
    const bancos = ['ASERCION', 'FIXTURE', 'STUB', 'SANDBOX', 'MOCK'] as const;

    for (const banco of bancos) {
      const cuerpo = await transferirOk(
        t,
        cuerpoValido(origen, { monto: '10.00', banco }),
      );
      expect(cuerpo['banco'], `banco ${banco} debe verse reflejado`).toBe(banco);
    }
  });

  it('A6 · tipoCuenta CORRIENTE y AHORRO → 201', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(100_00n, t.id);

    const c1 = await transferirOk(t, cuerpoValido(origen, { monto: '10.00', tipoCuenta: 'CORRIENTE' }));
    expect(c1['tipoCuenta']).toBe('CORRIENTE');

    const c2 = await transferirOk(t, cuerpoValido(origen, { monto: '10.00', tipoCuenta: 'AHORRO' }));
    expect(c2['tipoCuenta']).toBe('AHORRO');
  });

  it('A7 · numeroCuenta de 1 dígito y de 20 dígitos → 201 (bordes de J6)', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(100_00n, t.id);

    // 1 dígito
    const c1 = await transferirOk(t, cuerpoValido(origen, { monto: '10.00', numeroCuenta: '7' }));
    expect(c1['numeroCuenta']).toBe('7');

    // 20 dígitos
    const c2 = await transferirOk(t, cuerpoValido(origen, { monto: '10.00', numeroCuenta: '12345678901234567890' }));
    expect(c2['numeroCuenta']).toBe('12345678901234567890');
  });

  it('A8 · origen AHORRO y origen PRESTAMO del titular → 201', async () => {
    const t = await titular();
    const ahorro = await cuentaConSaldo(50_00n, t.id, 'AHORRO');
    const prestamo = await cuentaConSaldo(50_00n, t.id, 'PRESTAMO');

    const cAhorro = await transferirOk(t, cuerpoValido(ahorro, { monto: '10.00' }));
    expect(cAhorro['cuentaOrigenId']).toBe(ahorro);

    const cPrestamo = await transferirOk(t, cuerpoValido(prestamo, { monto: '10.00' }));
    expect(cPrestamo['cuentaOrigenId']).toBe(prestamo);
  });

  // Enmienda § 8.1: aceptar montos con menos de dos decimales formateándolos a dos decimales en la respuesta
  it('A9 · monto "10.0" → 201 con monto "10.00"; monto "10" → 201 con "10.00" (paso 4: sólo se rechazan más de 2 decimales)', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(50_00n, t.id);

    const c1 = await transferirOk(t, cuerpoValido(origen, { monto: '10.0' }));
    expect(c1['monto']).toBe('10.00');

    const c2 = await transferirOk(t, cuerpoValido(origen, { monto: '10' }));
    expect(c2['monto']).toBe('10.00');
  });
});

// ═══ Grupo B · Validación ═══════════════════════════════════════════════════════════════

describe('Grupo B · Validación', () => {
  it('B1 · banco "BANCO_REAL", "", "asercion", " ASERCION", "ASERCION ", "ZEROFEEBANK", ausente, 1, null → 400 BANCO_NO_PERMITIDO', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(100_00n, t.id);

    const subcasos = [
      'BANCO_REAL',
      '',
      'asercion',
      ' ASERCION',
      'ASERCION ',
      'ZEROFEEBANK',
      undefined,
      1,
      null,
    ];

    for (const subcaso of subcasos) {
      const txAntes = await contarTransaccionesOtrosBancos();
      const saldoAntes = await saldoDe(origen);

      const payload = cuerpoValido(origen);
      if (subcaso === undefined) delete payload['banco'];
      else payload['banco'] = subcaso;

      const r = await transferir(t.auth, payload);
      exigirRechazo(r, 400, 'BANCO_NO_PERMITIDO', `B1 subcaso=${String(subcaso)}`);

      expect(await contarTransaccionesOtrosBancos(), `B1 subcaso=${String(subcaso)} ledger debe quedar intacto`).toBe(txAntes);
      expect(await saldoDe(origen), `B1 subcaso=${String(subcaso)} saldo debe quedar intacto`).toBe(saldoAntes);
    }
  });

  // Enmienda § 8.1: agregar subcaso null para verificar rechazo por tipo no string
  it('B2 · número "", "abc", "12-34", "12 34", 21 dígitos, " 123", "123\\n", 12345 (número JSON), ausente, null → 400 NUMERO_CUENTA_EXTERNA_INVALIDO', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(100_00n, t.id);

    const subcasos = [
      '',
      'abc',
      '12-34',
      '12 34',
      '123456789012345678901',
      ' 123',
      '123\n',
      12345,
      undefined,
      null,
    ];

    for (const subcaso of subcasos) {
      const txAntes = await contarTransaccionesOtrosBancos();
      const saldoAntes = await saldoDe(origen);

      const payload = cuerpoValido(origen);
      if (subcaso === undefined) delete payload['numeroCuenta'];
      else payload['numeroCuenta'] = subcaso;

      const r = await transferir(t.auth, payload);
      exigirRechazo(r, 400, 'NUMERO_CUENTA_EXTERNA_INVALIDO', `B2 subcaso=${String(subcaso)}`);

      expect(await contarTransaccionesOtrosBancos(), `B2 subcaso=${String(subcaso)} ledger debe quedar intacto`).toBe(txAntes);
      expect(await saldoDe(origen), `B2 subcaso=${String(subcaso)} saldo debe quedar intacto`).toBe(saldoAntes);
    }
  });

  // Enmienda § 8.1: agregar subcasos null y 1 para verificar rechazo por tipo no string
  it('B3 · tipo "SISTEMA", "PRESTAMO", "ahorro", "", ausente, null, 1 → 400 TIPO_CUENTA_EXTERNA_INVALIDO', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(100_00n, t.id);

    const subcasos = [
      'SISTEMA',
      'PRESTAMO',
      'ahorro',
      '',
      undefined,
      null,
      1,
    ];

    for (const subcaso of subcasos) {
      const txAntes = await contarTransaccionesOtrosBancos();
      const saldoAntes = await saldoDe(origen);

      const payload = cuerpoValido(origen);
      if (subcaso === undefined) delete payload['tipoCuenta'];
      else payload['tipoCuenta'] = subcaso;

      const r = await transferir(t.auth, payload);
      exigirRechazo(r, 400, 'TIPO_CUENTA_EXTERNA_INVALIDO', `B3 subcaso=${String(subcaso)}`);

      expect(await contarTransaccionesOtrosBancos(), `B3 subcaso=${String(subcaso)} ledger debe quedar intacto`).toBe(txAntes);
      expect(await saldoDe(origen), `B3 subcaso=${String(subcaso)} saldo debe quedar intacto`).toBe(saldoAntes);
    }
  });

  // Enmienda § 8.1: agregar subcaso null para verificar rechazo por tipo no string
  it('B4 · monto "0", "0.00", "-10.00", "abc", "10.001", 10 (número JSON), ausente, null → 400 MONTO_INVALIDO', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(100_00n, t.id);

    const subcasos = [
      '0',
      '0.00',
      '-10.00',
      'abc',
      '10.001',
      10,
      undefined,
      null,
    ];

    for (const subcaso of subcasos) {
      const txAntes = await contarTransaccionesOtrosBancos();
      const saldoAntes = await saldoDe(origen);

      const payload = cuerpoValido(origen);
      if (subcaso === undefined) delete payload['monto'];
      else payload['monto'] = subcaso;

      const r = await transferir(t.auth, payload);
      exigirRechazo(r, 400, 'MONTO_INVALIDO', `B4 subcaso=${String(subcaso)}`);

      expect(await contarTransaccionesOtrosBancos(), `B4 subcaso=${String(subcaso)} ledger debe quedar intacto`).toBe(txAntes);
      expect(await saldoDe(origen), `B4 subcaso=${String(subcaso)} saldo debe quedar intacto`).toBe(saldoAntes);
    }
  });

  // Enmienda § 8.1: verificar ledger y saldo de origen intactos tras cada par (y saldo ajeno en par 5)
  it('B5 · precedencia por pares: monto malo + banco malo → MONTO_INVALIDO · origen no UUID + banco malo → 404 · banco malo + número malo → BANCO_NO_PERMITIDO · número malo + tipo malo → NUMERO_… · tipo malo + origen ajeno → TIPO_…', async () => {
    const t = await titular();
    const otroTitular = await titular();
    const origen = await cuentaConSaldo(100_00n, t.id);
    const cuentaAjena = await cuentaConSaldo(100_00n, otroTitular.id);
    const txAntes = await contarTransaccionesOtrosBancos();
    const saldoAntes = await saldoDe(origen);
    const saldoAjenaAntes = await saldoDe(cuentaAjena);

    // Par 1 · monto malo (paso 4) + banco malo (paso 6) → MONTO_INVALIDO
    const r1 = await transferir(t.auth, cuerpoValido(origen, { monto: '0.00', banco: 'BANCO_REAL' }));
    exigirRechazo(r1, 400, 'MONTO_INVALIDO', 'Par 1: monto malo + banco malo');
    expect(await contarTransaccionesOtrosBancos(), 'Par 1 ledger debe quedar intacto').toBe(txAntes);
    expect(await saldoDe(origen), 'Par 1 saldo debe quedar intacto').toBe(saldoAntes);

    // Par 2 · origen no UUID (paso 5) + banco malo (paso 6) → 404 CUENTA_NO_ENCONTRADA
    const r2 = await transferir(t.auth, cuerpoValido('no-es-uuid', { banco: 'BANCO_REAL' }));
    exigirRechazo(r2, 404, 'CUENTA_NO_ENCONTRADA', 'Par 2: origen no UUID + banco malo');
    expect(await contarTransaccionesOtrosBancos(), 'Par 2 ledger debe quedar intacto').toBe(txAntes);
    expect(await saldoDe(origen), 'Par 2 saldo debe quedar intacto').toBe(saldoAntes);

    // Par 3 · banco malo (paso 6) + número malo (paso 7) → BANCO_NO_PERMITIDO
    const r3 = await transferir(t.auth, cuerpoValido(origen, { banco: 'BANCO_REAL', numeroCuenta: 'abc' }));
    exigirRechazo(r3, 400, 'BANCO_NO_PERMITIDO', 'Par 3: banco malo + número malo');
    expect(await contarTransaccionesOtrosBancos(), 'Par 3 ledger debe quedar intacto').toBe(txAntes);
    expect(await saldoDe(origen), 'Par 3 saldo debe quedar intacto').toBe(saldoAntes);

    // Par 4 · número malo (paso 7) + tipo malo (paso 8) → NUMERO_CUENTA_EXTERNA_INVALIDO
    const r4 = await transferir(t.auth, cuerpoValido(origen, { numeroCuenta: 'abc', tipoCuenta: 'PRESTAMO' }));
    exigirRechazo(r4, 400, 'NUMERO_CUENTA_EXTERNA_INVALIDO', 'Par 4: número malo + tipo malo');
    expect(await contarTransaccionesOtrosBancos(), 'Par 4 ledger debe quedar intacto').toBe(txAntes);
    expect(await saldoDe(origen), 'Par 4 saldo debe quedar intacto').toBe(saldoAntes);

    // Par 5 · tipo malo (paso 8) + origen ajeno (paso 10) → TIPO_CUENTA_EXTERNA_INVALIDO
    const r5 = await transferir(t.auth, cuerpoValido(cuentaAjena, { tipoCuenta: 'PRESTAMO' }));
    exigirRechazo(r5, 400, 'TIPO_CUENTA_EXTERNA_INVALIDO', 'Par 5: tipo malo + origen ajeno');
    expect(await contarTransaccionesOtrosBancos(), 'Par 5 ledger debe quedar intacto').toBe(txAntes);
    expect(await saldoDe(origen), 'Par 5 saldo origen debe quedar intacto').toBe(saldoAntes);
    expect(await saldoDe(cuentaAjena), 'Par 5 saldo cuenta ajena debe quedar intacto').toBe(saldoAjenaAntes);
  });

  // Enmienda § 8.1: exigir codigo TOKEN_AUSENTE en 401 y precedencia de paso 2 (sin clave) sobre paso 4 (monto)
  it('B6 · sin token → 401 (también sin clave: el token va primero) · sin clave → 400 IDEMPOTENCY_KEY_AUSENTE · clave de 201 caracteres → 400 IDEMPOTENCY_KEY_INVALIDA · sin clave y monto "abc" → 400 IDEMPOTENCY_KEY_AUSENTE', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(100_00n, t.id);
    const payload = cuerpoValido(origen);

    // 1. Sin token (con clave) → 401
    const r1 = await transferir(null, payload, randomUUID());
    exigirRechazo(r1, 401, 'TOKEN_AUSENTE', 'sin token');

    // Enmienda § 8.2: los subcasos «sin clave» llaman a `pedir` sin `clave`; con
    // `transferir(…, undefined)` el valor por defecto de la clave se activaba y la cabecera SÍ iba.
    const POST_OTROS_BANCOS = '/transferencias/otros-bancos';

    // 2. Sin token y sin clave → 401 (token precede a clave)
    const r2 = await pedir('POST', POST_OTROS_BANCOS, { cuerpo: payload, autorizacion: null });
    exigirRechazo(r2, 401, 'TOKEN_AUSENTE', 'sin token y sin clave');

    // 3. Con token, sin clave → 400 IDEMPOTENCY_KEY_AUSENTE
    const r3 = await pedir('POST', POST_OTROS_BANCOS, { cuerpo: payload, autorizacion: t.auth });
    exigirRechazo(r3, 400, 'IDEMPOTENCY_KEY_AUSENTE', 'sin clave');

    // 4. Con token, clave de 201 caracteres → 400 IDEMPOTENCY_KEY_INVALIDA
    const clave201 = 'k'.repeat(201);
    const r4 = await transferir(t.auth, payload, clave201);
    exigirRechazo(r4, 400, 'IDEMPOTENCY_KEY_INVALIDA', 'clave de 201 caracteres');

    // 5. Con token, sin clave y monto "abc" → 400 IDEMPOTENCY_KEY_AUSENTE (paso 2 antes que el 4)
    const r5 = await pedir('POST', POST_OTROS_BANCOS, {
      cuerpo: cuerpoValido(origen, { monto: 'abc' }),
      autorizacion: t.auth,
    });
    exigirRechazo(r5, 400, 'IDEMPOTENCY_KEY_AUSENTE', 'sin clave y monto invalido');
  });
});

// ═══ Grupo C · Origen ═══════════════════════════════════════════════════════════════════

describe('Grupo C · Origen', () => {
  it('C1 · origen UUID inexistente → 404 CUENTA_NO_ENCONTRADA; ledger intacto', async () => {
    const t = await titular();
    const origenInexistente = randomUUID();
    const txAntes = await contarTransaccionesOtrosBancos();

    const r = await transferir(t.auth, cuerpoValido(origenInexistente));
    exigirRechazo(r, 404, 'CUENTA_NO_ENCONTRADA');

    expect(await contarTransaccionesOtrosBancos()).toBe(txAntes);
  });

  it('C2 · origen de otro titular → 404, indistinguible de C1 (cuerpos iguales quitados los ids); saldo del ajeno intacto', async () => {
    const t1 = await titular();
    const t2 = await titular();
    const cuentaAjena = await cuentaConSaldo(100_00n, t2.id);
    const inexistente = randomUUID();

    const rAjena = await transferir(t1.auth, cuerpoValido(cuentaAjena));
    const rInexistente = await transferir(t1.auth, cuerpoValido(inexistente));

    exigirRechazo(rAjena, 404, 'CUENTA_NO_ENCONTRADA');
    exigirRechazo(rInexistente, 404, 'CUENTA_NO_ENCONTRADA');
    // Enmienda § 8.1: la indistinguibilidad compara textos reemplazando sólo los ids enviados por el brazo
    expect(reemplazarIds(rAjena.texto, [cuentaAjena])).toBe(reemplazarIds(rInexistente.texto, [inexistente]));

    expect(await saldoDe(cuentaAjena)).toBe(100_00n);
  });

  it('C3 · origen "no-es-uuid" → 404 (no 500)', async () => {
    const t = await titular();
    const r = await transferir(t.auth, cuerpoValido('no-es-uuid'));
    exigirRechazo(r, 404, 'CUENTA_NO_ENCONTRADA');
  });

  it('C4 · origen = la cuenta OTROS_BANCOS, leída de la base tras una transferencia 201 → 404', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(100_00n, t.id);

    const postResp = await transferirOk(t, cuerpoValido(origen, { monto: '10.00' }));
    const transaccionId = String(postResp['transaccionId']);

    // Enmienda § 8.1: leer OTROS_BANCOS del movimiento positivo de su propia transacción 201 y comprobar codigo
    const tx = await prisma.transaccion.findUnique({
      where: { id: transaccionId },
      include: { movimientos: true },
    });
    expect(tx, `transacción ${transaccionId} no encontrada`).not.toBeNull();
    const movPos = tx!.movimientos.find((m) => m.montoCentavos > 0n);
    expect(movPos, 'debe existir movimiento positivo en la transacción').toBeDefined();

    const otrosBancos = await prisma.cuenta.findUnique({ where: { id: movPos!.cuentaId } });
    expect(otrosBancos, 'la cuenta de contrapartida debe existir en la base').not.toBeNull();
    expect(otrosBancos!.codigo).toBe('OTROS_BANCOS');

    const txAntes = await contarTransaccionesOtrosBancos();
    const r = await transferir(t.auth, cuerpoValido(otrosBancos!.id));
    exigirRechazo(r, 404, 'CUENTA_NO_ENCONTRADA');

    expect(await contarTransaccionesOtrosBancos()).toBe(txAntes);
  });

  it('C5 · guarda de S-21: POST /transferencias con destino OTROS_BANCOS → 404 CUENTA_NO_ENCONTRADA', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(100_00n, t.id);

    // Corrección: C5 es una guarda de S-21 y NO depende del endpoint nuevo. La
    // versión anterior fabricaba la cuenta sólo si la transferencia externa no daba 201: una
    // rama que cambia lo que el brazo mide según el color de otro acto (lección IN13).
    // Se obtiene o se crea SIEMPRE igual, con el mismo código que usará la app (J10); el
    // `codigo` es único, así que la app, si ya existe, la reutiliza (ON CONFLICT DO NOTHING).
    const existente = await prisma.cuenta.findUnique({ where: { codigo: 'OTROS_BANCOS' } });
    const destinoId =
      existente?.id ??
      (
        await prisma.cuenta.create({
          data: { id: randomUUID(), tipo: 'SISTEMA', codigo: 'OTROS_BANCOS', creadaEn: relojActual },
        })
      ).id;

    const r = await pedir('POST', '/transferencias', {
      cuerpo: { origenId: origen, destinoId, monto: '10.00' },
      autorizacion: t.auth,
      clave: `s21-guarda-${randomUUID()}`,
    });

    exigirRechazo(r, 404, 'CUENTA_NO_ENCONTRADA');
    expect(await saldoDe(origen)).toBe(100_00n);
  });

  // Enmienda § 8.1: precedencia paso 10 (origen ajeno) sobre paso 11 (tope diario) cuando el tope del ajeno está lleno
  it('C6 · origen ajeno con el tope del ajeno lleno: el ajeno transfiere 200.00 → 201 y 0.01 → 409 TOPE_DIARIO_EXCEDIDO (premisa); luego el titular del token usa esa cuenta, 10.00 → 404 CUENTA_NO_ENCONTRADA (paso 10 antes que el 11); saldo del ajeno intacto', async () => {
    const t1 = await titular();
    const t2 = await titular();
    const cuentaT2 = await cuentaConSaldo(300_00n, t2.id);

    await transferirOk(t2, cuerpoValido(cuentaT2, { monto: '200.00' }));
    const rExceso = await transferir(t2.auth, cuerpoValido(cuentaT2, { monto: '0.01' }));
    exigirRechazo(rExceso, 409, 'TOPE_DIARIO_EXCEDIDO', 't2 supera tope');

    const rAjeno = await transferir(t1.auth, cuerpoValido(cuentaT2, { monto: '10.00' }));
    exigirRechazo(rAjeno, 404, 'CUENTA_NO_ENCONTRADA', 't1 usa cuenta ajena con tope lleno');

    expect(await saldoDe(cuentaT2)).toBe(100_00n);
  });
});

// ═══ Grupo D · Tope ═════════════════════════════════════════════════════════════════════

describe('Grupo D · Tope', () => {
  it('D1 · 200.00 en una → 201; luego 0.01 → 409 TOPE_DIARIO_EXCEDIDO, ledger y saldo intactos', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(300_00n, t.id);

    await transferirOk(t, cuerpoValido(origen, { monto: '200.00' }));
    expect(await saldoDe(origen)).toBe(100_00n);

    const txAntes = await contarTransaccionesOtrosBancos();
    const r = await transferir(t.auth, cuerpoValido(origen, { monto: '0.01' }));
    exigirRechazo(r, 409, 'TOPE_DIARIO_EXCEDIDO');

    expect(await contarTransaccionesOtrosBancos()).toBe(txAntes);
    expect(await saldoDe(origen)).toBe(100_00n);
  });

  it('D2 · 50.00 + 50.00 + 100.00 → tres 201; luego 0.01 → 409', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(300_00n, t.id);

    await transferirOk(t, cuerpoValido(origen, { monto: '50.00' }));
    await transferirOk(t, cuerpoValido(origen, { monto: '50.00' }));
    await transferirOk(t, cuerpoValido(origen, { monto: '100.00' }));

    const r = await transferir(t.auth, cuerpoValido(origen, { monto: '0.01' }));
    exigirRechazo(r, 409, 'TOPE_DIARIO_EXCEDIDO');
  });

  it('D3 · 199.99 → 201; 0.02 → 409; 0.01 → 201 (el rechazo no sumó; el acumulado queda en 200,00 exacto)', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(300_00n, t.id);

    await transferirOk(t, cuerpoValido(origen, { monto: '199.99' }));

    const rechazo = await transferir(t.auth, cuerpoValido(origen, { monto: '0.02' }));
    exigirRechazo(rechazo, 409, 'TOPE_DIARIO_EXCEDIDO');

    await transferirOk(t, cuerpoValido(origen, { monto: '0.01' }));

    // El tope quedó exactamente lleno (200.00), cualquier centavo adicional se rechaza
    const rechazoFinal = await transferir(t.auth, cuerpoValido(origen, { monto: '0.01' }));
    exigirRechazo(rechazoFinal, 409, 'TOPE_DIARIO_EXCEDIDO');
  });

  it('D4 · 200.01 en una → 409; ledger intacto (no se transfiere una parte)', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(300_00n, t.id);
    const txAntes = await contarTransaccionesOtrosBancos();

    const r = await transferir(t.auth, cuerpoValido(origen, { monto: '200.01' }));
    exigirRechazo(r, 409, 'TOPE_DIARIO_EXCEDIDO');

    expect(await contarTransaccionesOtrosBancos()).toBe(txAntes);
    expect(await saldoDe(origen)).toBe(300_00n);
  });

  it('D5 · reinicio: reloj en día D 12:00Z, 150.00 → 201; reloj en D 23:59:59.999Z, 50.01 → 409 y 50.00 → 201; reloj en D+1 00:00:00.000Z, 200.00 → 201 y 0.01 → 409', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(500_00n, t.id);

    // 1. Día D 12:00Z → 150.00
    await fijarReloj(new Date('2026-10-01T12:00:00.000Z'));
    renovarToken(t);
    await transferirOk(t, cuerpoValido(origen, { monto: '150.00' }));

    // 2. Día D 23:59:59.999Z → 50.01 rechaza, 50.00 pasa
    await fijarReloj(new Date('2026-10-01T23:59:59.999Z'));
    renovarToken(t);

    const r5001 = await transferir(t.auth, cuerpoValido(origen, { monto: '50.01' }));
    exigirRechazo(r5001, 409, 'TOPE_DIARIO_EXCEDIDO', 'D 23:59:59.999Z monto=50.01');

    await transferirOk(t, cuerpoValido(origen, { monto: '50.00' }));

    // 3. Día D+1 00:00:00.000Z → 200.00 pasa, 0.01 rechaza
    await fijarReloj(new Date('2026-10-02T00:00:00.000Z'));
    renovarToken(t);

    await transferirOk(t, cuerpoValido(origen, { monto: '200.00' }));

    const r001 = await transferir(t.auth, cuerpoValido(origen, { monto: '0.01' }));
    exigirRechazo(r001, 409, 'TOPE_DIARIO_EXCEDIDO', 'D+1 00:00:00.000Z monto=0.01');
  });

  it('D6 · por cuenta: cuenta A del titular 200.00 → 201; cuenta B del mismo titular 200.00 → 201; A 0.01 → 409 y B 0.01 → 409', async () => {
    const t = await titular();
    const cuentaA = await cuentaConSaldo(300_00n, t.id);
    const cuentaB = await cuentaConSaldo(300_00n, t.id);

    await transferirOk(t, cuerpoValido(cuentaA, { monto: '200.00' }));
    await transferirOk(t, cuerpoValido(cuentaB, { monto: '200.00' }));

    const rA = await transferir(t.auth, cuerpoValido(cuentaA, { monto: '0.01' }));
    exigirRechazo(rA, 409, 'TOPE_DIARIO_EXCEDIDO', 'cuentaA 0.01');

    const rB = await transferir(t.auth, cuerpoValido(cuentaB, { monto: '0.01' }));
    exigirRechazo(rB, 409, 'TOPE_DIARIO_EXCEDIDO', 'cuentaB 0.01');
  });

  it('D7 · el primero llena su tope (200.00 → 201, 0.01 → 409); otro titular con su cuenta 200.00 → 201', async () => {
    const t1 = await titular();
    const t2 = await titular();
    const cuenta1 = await cuentaConSaldo(300_00n, t1.id);
    const cuenta2 = await cuentaConSaldo(300_00n, t2.id);

    await transferirOk(t1, cuerpoValido(cuenta1, { monto: '200.00' }));
    const r1 = await transferir(t1.auth, cuerpoValido(cuenta1, { monto: '0.01' }));
    exigirRechazo(r1, 409, 'TOPE_DIARIO_EXCEDIDO');

    await transferirOk(t2, cuerpoValido(cuenta2, { monto: '200.00' }));
  });

  it('D8 · sólo otros bancos cuentan: con una transferencia interna de 150.00 y un pago de 100.00 desde A el mismo día, externa 200.00 → 201; y tras llenar el tope, una interna de 300.00 desde A → 201', async () => {
    const t = await titular();
    const cuentaA = await cuentaConSaldo(1000_00n, t.id);
    const cuentaB = await cuentaConSaldo(100_00n, t.id);

    // 1. Transferencia interna de 150.00 desde A hacia B
    const rInt = await pedir('POST', '/transferencias', {
      cuerpo: { origenId: cuentaA, destinoId: cuentaB, monto: '150.00' },
      autorizacion: t.auth,
      clave: `int-d8-${randomUUID()}`,
    });
    expect(rInt.estado, `transferencia interna inicial debía dar 201: ${rInt.texto}`).toBe(201);

    // 2. Pago de servicio de 100.00 desde A
    const rPago = await pedir('POST', '/pagos', {
      cuerpo: {
        cuentaOrigenId: cuentaA,
        monto: '100.00',
        beneficiarioNombre: 'Empresa Electrica SA',
        beneficiarioDireccion: 'Av. Siempre Viva 742',
        beneficiarioCiudad: 'Santiago',
        beneficiarioEstado: 'Region Metropolitana',
        beneficiarioCodigoPostal: '8320000',
        beneficiarioTelefono: '+56 2 2345 6789',
        cuentaBeneficiario: 'SERV-99887766',
      },
      autorizacion: t.auth,
      clave: `pago-d8-${randomUUID()}`,
    });
    expect(rPago.estado, `pago de servicio debía dar 201: ${rPago.texto}`).toBe(201);

    // 3. Transferencia externa de 200.00 desde A (tope intacto)
    await transferirOk(t, cuerpoValido(cuentaA, { monto: '200.00' }));

    // Enmienda § 8.1: verificar la premisa de tope lleno con 0.01 adicional que debe ser rechazado
    const rExceso = await transferir(t.auth, cuerpoValido(cuentaA, { monto: '0.01' }));
    exigirRechazo(rExceso, 409, 'TOPE_DIARIO_EXCEDIDO', 'D8 exceso tras 200.00');

    // 4. Tras llenar el tope externo, una interna de 300.00 desde A sigue funcionando
    const rInt2 = await pedir('POST', '/transferencias', {
      cuerpo: { origenId: cuentaA, destinoId: cuentaB, monto: '300.00' },
      autorizacion: t.auth,
      clave: `int2-d8-${randomUUID()}`,
    });
    expect(rInt2.estado, `transferencia interna posterior debía dar 201: ${rInt2.texto}`).toBe(201);
  });

  it('D9 · precedencia: acumulado 150.00 y saldo 50.00; 60.00 (rompe tope y fondos) → 409 TOPE_DIARIO_EXCEDIDO', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(200_00n, t.id);

    await transferirOk(t, cuerpoValido(origen, { monto: '150.00' }));
    expect(await saldoDe(origen)).toBe(50_00n);

    const txAntes = await contarTransaccionesOtrosBancos();
    // 60.00 excede el tope diario (150 + 60 = 210 > 200) Y el saldo disponible (50 < 60)
    // Precedencia J12 / Paso 11: TOPE_DIARIO_EXCEDIDO gana sobre FONDOS_INSUFICIENTES
    const r = await transferir(t.auth, cuerpoValido(origen, { monto: '60.00' }));
    exigirRechazo(r, 409, 'TOPE_DIARIO_EXCEDIDO');

    // Enmienda § 8.1: verificar ledger y saldo de 50.00 intactos tras el 409
    expect(await contarTransaccionesOtrosBancos(), 'D9 ledger debe quedar intacto').toBe(txAntes);
    expect(await saldoDe(origen), 'D9 saldo debe quedar en 50.00').toBe(50_00n);
  });

  it('D10 · fondos dentro del tope: saldo 50.00, acumulado 0, 60.00 → 409 FONDOS_INSUFICIENTES, ledger intacto; luego 50.00 → 201', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(50_00n, t.id);
    const txAntes = await contarTransaccionesOtrosBancos();

    const r = await transferir(t.auth, cuerpoValido(origen, { monto: '60.00' }));
    exigirRechazo(r, 409, 'FONDOS_INSUFICIENTES');

    expect(await contarTransaccionesOtrosBancos()).toBe(txAntes);
    expect(await saldoDe(origen)).toBe(50_00n);

    await transferirOk(t, cuerpoValido(origen, { monto: '50.00' }));
    expect(await saldoDe(origen)).toBe(0n);
  });
});

// ═══ Grupo E · Idempotencia ═════════════════════════════════════════════════════════════

describe('Grupo E · Idempotencia', () => {
  it('E1 · misma clave dos veces (150.00) → 201 y replay 201 + Idempotency-Replayed: true, cuerpo idéntico; 1 transacción; luego 50.00 con otra clave → 201 (el tope contó una vez)', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(300_00n, t.id);
    const clave = `k-e1-${randomUUID()}`;
    const payload = cuerpoValido(origen, { monto: '150.00' });

    const txAntes = await contarTransaccionesOtrosBancos();
    const r1 = await transferir(t.auth, payload, clave);
    expect(r1.estado).toBe(201);
    expect(r1.cabeceras.get('idempotency-replayed')).toBeNull();

    const r2 = await transferir(t.auth, payload, clave);
    expect(r2.estado).toBe(201);
    expect(r2.cabeceras.get('idempotency-replayed')).toBe('true');
    expect(r2.texto).toBe(r1.texto);

    expect(await contarTransaccionesOtrosBancos()).toBe(txAntes + 1);

    // El tope contó una sola vez, por lo que 50.00 adicionales entran en 201
    await transferirOk(t, cuerpoValido(origen, { monto: '50.00' }));
    expect(await saldoDe(origen)).toBe(100_00n);
  });

  it('E2 · misma clave, cambia uno de numeroCuenta, banco, tipoCuenta, monto (4 subcasos) → 409 IDEMPOTENCY_KEY_REUSADA, nada escrito', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(300_00n, t.id);
    const otraCuenta = await cuentaConSaldo(300_00n, t.id);

    // Enmienda § 8.1: agregar subcasos cuentaOrigenId y monto con string alternativo ("10.0")
    const subcasos = [
      { campo: 'numeroCuenta', valor: '999999' },
      { campo: 'banco', valor: 'FIXTURE' },
      { campo: 'tipoCuenta', valor: 'CORRIENTE' },
      { campo: 'monto', valor: '20.00' },
      { campo: 'cuentaOrigenId', valor: otraCuenta },
      { campo: 'monto', valor: '10.0' },
    ];

    for (const subcaso of subcasos) {
      const clave = `k-e2-${subcaso.campo}-${randomUUID()}`;
      const basePayload = cuerpoValido(origen, {
        monto: '10.00',
        banco: 'ASERCION',
        numeroCuenta: '000123',
        tipoCuenta: 'AHORRO',
      });

      // Ejecución inicial 201
      await transferirOk(t, basePayload, clave);
      const txAntes = await contarTransaccionesOtrosBancos();
      const saldoAntes = await saldoDe(origen);
      const saldoOtraAntes = await saldoDe(otraCuenta);

      // Reintento con clave idéntica pero campo modificado
      const modificado = { ...basePayload, [subcaso.campo]: subcaso.valor };
      const r = await transferir(t.auth, modificado, clave);
      exigirRechazo(r, 409, 'IDEMPOTENCY_KEY_REUSADA', `E2 cambio en ${subcaso.campo}`);

      expect(await contarTransaccionesOtrosBancos(), `E2 cambio en ${subcaso.campo} no debe escribir transacción`).toBe(txAntes);
      expect(await saldoDe(origen), `E2 cambio en ${subcaso.campo} saldo debe quedar intacto`).toBe(saldoAntes);
      expect(await saldoDe(otraCuenta), `E2 cambio en ${subcaso.campo} saldo de otraCuenta debe quedar intacto`).toBe(saldoOtraAntes);
    }
  });

  it('E3 · misma clave y mismo cuerpo desde otro titular → 409 IDEMPOTENCY_KEY_REUSADA, no la respuesta del primero', async () => {
    const t1 = await titular();
    const t2 = await titular();
    const origen1 = await cuentaConSaldo(100_00n, t1.id);
    const clave = `k-e3-${randomUUID()}`;
    const payload = cuerpoValido(origen1, { monto: '10.00' });

    const r1 = await transferir(t1.auth, payload, clave);
    expect(r1.estado).toBe(201);

    const r2 = await transferir(t2.auth, payload, clave);
    exigirRechazo(r2, 409, 'IDEMPOTENCY_KEY_REUSADA');
    expect(r2.texto).not.toBe(r1.texto);
  });

  it('E4 · 200.00 con clave K → 201; replay de K → 201 idéntico, no 409 de tope', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(250_00n, t.id);
    const clave = `k-e4-${randomUUID()}`;
    const payload = cuerpoValido(origen, { monto: '200.00' });

    const r1 = await transferir(t.auth, payload, clave);
    expect(r1.estado).toBe(201);

    // Replay de la misma clave (Paso 9 antes que paso 11): devuelve 201 guardado, no 409
    const r2 = await transferir(t.auth, payload, clave);
    expect(r2.estado).toBe(201);
    expect(r2.cabeceras.get('idempotency-replayed')).toBe('true');
    expect(r2.texto).toBe(r1.texto);
  });

  // Enmienda § 8.1: precedencia pasos 4-8 (validación) antes que paso 9 (replay o reuso de clave idempotente)
  it('E5 · clave K con cuerpo válido → 201; misma K con banco "BANCO_REAL" → 400 BANCO_NO_PERMITIDO, no replay ni 409 (pasos 4–8 antes que el 9); ledger intacto', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(100_00n, t.id);
    const clave = `k-e5-${randomUUID()}`;

    await transferirOk(t, cuerpoValido(origen, { monto: '10.00' }), clave);
    const txAntes = await contarTransaccionesOtrosBancos();
    const saldoAntes = await saldoDe(origen);

    const r = await transferir(t.auth, cuerpoValido(origen, { monto: '10.00', banco: 'BANCO_REAL' }), clave);
    exigirRechazo(r, 400, 'BANCO_NO_PERMITIDO', 'E5 banco inválido con clave existente');

    expect(await contarTransaccionesOtrosBancos(), 'E5 ledger debe quedar intacto').toBe(txAntes);
    expect(await saldoDe(origen), 'E5 saldo debe quedar intacto').toBe(saldoAntes);
  });
});

// ═══ Grupo F · Concurrencia (D4) ═════════════════════════════════════════════════════════

describe('Grupo F · Concurrencia (D4)', () => {
  it('F1 · 3 ráfagas, cada una sobre un titular y una cuenta nuevos con fondos 1000,00: 10 simultáneas de 50.00 → exactamente 4 201 y 6 409 TOPE_DIARIO_EXCEDIDO; acumulado en el ledger = 200,00; saldo = 800,00', async () => {
    for (let rafaga = 1; rafaga <= 3; rafaga++) {
      const t = await titular();
      const origen = await cuentaConSaldo(1000_00n, t.id);

      const peticiones = Array.from({ length: 10 }, () =>
        transferir(
          t.auth,
          cuerpoValido(origen, { monto: '50.00' }),
          `f1-r${rafaga}-${randomUUID()}`,
        ),
      );

      const respuestas = await Promise.all(peticiones);
      const ok = respuestas.filter((r) => r.estado === 201);
      const rechazadas = respuestas.filter(
        (r) => r.estado === 409 && codigoDe(r) === 'TOPE_DIARIO_EXCEDIDO',
      );

      expect(ok, `ráfaga ${rafaga}: exactamente 4 deben ser 201`).toHaveLength(4);
      expect(rechazadas, `ráfaga ${rafaga}: exactamente 6 deben ser 409 TOPE_DIARIO_EXCEDIDO`).toHaveLength(6);
      expect(respuestas.filter((r) => r.estado === 500), `ráfaga ${rafaga}: ningún 500`).toHaveLength(0);

      const acumulado = await prisma.movimiento.aggregate({
        _sum: { montoCentavos: true },
        where: {
          cuentaId: origen,
          transaccion: { concepto: 'TRANSFERENCIA_OTRO_BANCO' },
        },
      });
      expect(acumulado._sum.montoCentavos, `ráfaga ${rafaga}: acumulado debitado en ledger debe ser -200,00`).toBe(-200_00n);
      expect(await saldoDe(origen), `ráfaga ${rafaga}: saldo final debe ser 800,00`).toBe(800_00n);
    }
  });

  // Enmienda § 8.1: 3 ráfagas con titulares y cuentas nuevos, verificando saldos finales de 460.00
  it('F2 · titulares distintos: 4 externas de 10.00 desde A y 4 desde B, en paralelo con 4 internas A→B y 4 B→A de 1.00 → las 16 201 (ningún 500: sin deadlock)', async () => {
    for (let rafaga = 1; rafaga <= 3; rafaga++) {
      const tA = await titular();
      const tB = await titular();
      const cuentaA = await cuentaConSaldo(500_00n, tA.id);
      const cuentaB = await cuentaConSaldo(500_00n, tB.id);

      const peticiones = [
        // 4 externas desde A
        ...Array.from({ length: 4 }, () =>
          transferir(tA.auth, cuerpoValido(cuentaA, { monto: '10.00', banco: 'ASERCION' }), `f2-r${rafaga}-extA-${randomUUID()}`),
        ),
        // 4 externas desde B
        ...Array.from({ length: 4 }, () =>
          transferir(tB.auth, cuerpoValido(cuentaB, { monto: '10.00', banco: 'FIXTURE' }), `f2-r${rafaga}-extB-${randomUUID()}`),
        ),
        // 4 internas A → B
        ...Array.from({ length: 4 }, () =>
          pedir('POST', '/transferencias', {
            cuerpo: { origenId: cuentaA, destinoId: cuentaB, monto: '1.00' },
            autorizacion: tA.auth,
            clave: `f2-r${rafaga}-intAB-${randomUUID()}`,
          }),
        ),
        // 4 internas B → A
        ...Array.from({ length: 4 }, () =>
          pedir('POST', '/transferencias', {
            cuerpo: { origenId: cuentaB, destinoId: cuentaA, monto: '1.00' },
            autorizacion: tB.auth,
            clave: `f2-r${rafaga}-intBA-${randomUUID()}`,
          }),
        ),
      ];

      const respuestas = await Promise.all(peticiones);
      expect(respuestas.filter((r) => r.estado === 500), `ráfaga ${rafaga}: ninguna petición debe fallar con 500 (sin deadlock)`).toHaveLength(0);
      for (let i = 0; i < respuestas.length; i++) {
        expect(respuestas[i]!.estado, `ráfaga ${rafaga}: petición ${i + 1} de 16 debía ser 201: ${respuestas[i]!.texto}`).toBe(201);
      }

      expect(await saldoDe(cuentaA), `ráfaga ${rafaga}: saldo final de cuentaA debe ser 460.00`).toBe(460_00n);
      expect(await saldoDe(cuentaB), `ráfaga ${rafaga}: saldo final de cuentaB debe ser 460.00`).toBe(460_00n);
    }
  });
});

// ═══ Grupo G · Consulta ═════════════════════════════════════════════════════════════════

describe('Grupo G · Consulta', () => {
  // Enmienda § 8.1: comparar texto exacto del GET con el del POST para comprobar orden de claves
  it('G1 · GET del titular → 200, cuerpo igual al del POST (monto derivado del ledger)', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(100_00n, t.id);
    const payload = cuerpoValido(origen, {
      monto: '50.00',
      banco: 'ASERCION',
      numeroCuenta: '000123',
      tipoCuenta: 'AHORRO',
    });

    const post = await transferir(t.auth, payload);
    expect(post.estado, `POST debía responder 201: ${post.texto}`).toBe(201);
    const id = String(post.cuerpo['id']);

    const getResp = await pedir('GET', `/transferencias/otros-bancos/${id}`, {
      autorizacion: t.auth,
    });
    expect(getResp.estado, `GET debía responder 200: ${getResp.texto}`).toBe(200);
    expect(getResp.texto).toBe(post.texto);
    expect(getResp.cuerpo).toEqual(post.cuerpo);
  });

  it('G2 · GET de otro titular → 404 TRANSFERENCIA_NO_ENCONTRADA, indistinguible de un id inexistente', async () => {
    const t1 = await titular();
    const t2 = await titular();
    const origen = await cuentaConSaldo(100_00n, t1.id);

    const postResp = await transferirOk(t1, cuerpoValido(origen));
    const id = String(postResp['id']);
    const idInexistente = randomUUID();

    const rOtro = await pedir('GET', `/transferencias/otros-bancos/${id}`, {
      autorizacion: t2.auth,
    });
    const rInexistente = await pedir('GET', `/transferencias/otros-bancos/${idInexistente}`, {
      autorizacion: t2.auth,
    });

    exigirRechazo(rOtro, 404, 'TRANSFERENCIA_NO_ENCONTRADA');
    exigirRechazo(rInexistente, 404, 'TRANSFERENCIA_NO_ENCONTRADA');
    // Enmienda § 8.1: indistinguibilidad reemplaza sólo los ids enviados por el brazo
    expect(reemplazarIds(rOtro.texto, [id])).toBe(reemplazarIds(rInexistente.texto, [idInexistente]));
  });

  it('G3 · id UUID inexistente y id "no-es-uuid" → 404 TRANSFERENCIA_NO_ENCONTRADA (no 500)', async () => {
    const t = await titular();

    const rUuid = await pedir('GET', `/transferencias/otros-bancos/${randomUUID()}`, {
      autorizacion: t.auth,
    });
    exigirRechazo(rUuid, 404, 'TRANSFERENCIA_NO_ENCONTRADA');

    const rNoUuid = await pedir('GET', '/transferencias/otros-bancos/no-es-uuid', {
      autorizacion: t.auth,
    });
    exigirRechazo(rNoUuid, 404, 'TRANSFERENCIA_NO_ENCONTRADA');
  });

  // Enmienda § 8.1: exigir código TOKEN_AUSENTE en 401 de GET sin token
  it('G4 · sin token → 401', async () => {
    const r = await pedir('GET', `/transferencias/otros-bancos/${randomUUID()}`);
    exigirRechazo(r, 401, 'TOKEN_AUSENTE', 'GET sin token');
  });

  it('G5 · el transaccionId de la transferencia y el transaccionId de una transferencia interna → 404 (J16)', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(100_00n, t.id);
    const destino = await cuentaConSaldo(50_00n, t.id);

    // 1. Transferencia a otro banco: intentar GET usando su transaccionId
    const postExt = await transferirOk(t, cuerpoValido(origen, { monto: '10.00' }));
    const rExtTx = await pedir('GET', `/transferencias/otros-bancos/${String(postExt['transaccionId'])}`, {
      autorizacion: t.auth,
    });
    exigirRechazo(rExtTx, 404, 'TRANSFERENCIA_NO_ENCONTRADA', 'GET por transaccionId de transferencia externa');

    // 2. Transferencia interna: intentar GET usando su transaccionId
    const rInt = await pedir('POST', '/transferencias', {
      cuerpo: { origenId: origen, destinoId: destino, monto: '10.00' },
      autorizacion: t.auth,
      clave: `int-g5-${randomUUID()}`,
    });
    expect(rInt.estado).toBe(201);
    const txInternaId = String(rInt.cuerpo['transaccionId']);

    const rIntTx = await pedir('GET', `/transferencias/otros-bancos/${txInternaId}`, {
      autorizacion: t.auth,
    });
    exigirRechazo(rIntTx, 404, 'TRANSFERENCIA_NO_ENCONTRADA', 'GET por transaccionId de transferencia interna');
  });

  // Enmienda § 8.1: usar id de transferencia 201 real y verificar que la fila y ledger sigan intactos tras PUT/PATCH/DELETE
  it('G6 · PUT, PATCH, DELETE sobre /transferencias/otros-bancos/:id → 404, ledger y fila intactos', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(100_00n, t.id);
    const postResp = await transferirOk(t, cuerpoValido(origen, { monto: '10.00' }));
    const id = String(postResp['id']);

    const filaAntes = await prisma.transferenciaOtroBanco.findUnique({ where: { id } });
    expect(filaAntes, 'la fila debe existir antes').not.toBeNull();
    const txAntes = await contarTransaccionesOtrosBancos();

    const rPut = await pedir('PUT', `/transferencias/otros-bancos/${id}`, {
      cuerpo: { monto: '10.00' },
      autorizacion: t.auth,
    });
    expect(rPut.estado, 'PUT debe dar 404').toBe(404);

    const rPatch = await pedir('PATCH', `/transferencias/otros-bancos/${id}`, {
      cuerpo: { monto: '10.00' },
      autorizacion: t.auth,
    });
    expect(rPatch.estado, 'PATCH debe dar 404').toBe(404);

    const rDel = await pedir('DELETE', `/transferencias/otros-bancos/${id}`, {
      autorizacion: t.auth,
    });
    expect(rDel.estado, 'DELETE debe dar 404').toBe(404);

    const filaDespues = await prisma.transferenciaOtroBanco.findUnique({ where: { id } });
    expect(filaDespues, 'la fila debe seguir existiendo con los mismos campos').toEqual(filaAntes);
    expect(await contarTransaccionesOtrosBancos(), 'ledger debe quedar intacto').toBe(txAntes);
  });
});
