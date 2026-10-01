import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/infra/prisma.service.js';

/**
 * Arnés de S-06 · la META M3, contra Postgres de verdad y por HTTP de verdad.
 * Ver specs/S-06-idempotencia.md. ESTE ARCHIVO NO SE TOCA (specs/_CANDADO.md).
 *
 * ─── S-18 · CAMBIO DE CONTRATO, declarado ──────────────────────────────────────
 * `POST /transferencias` pasa a exigir `Authorization: Bearer <token>`, y el titular sólo
 * puede mover dinero DESDE una cuenta suya. Los nueve casos de abajo se escribieron cuando
 * el token no existía y llamaban sin él.
 *
 * Qué dice la spec: specs/S-18-transferencia-
 * autenticada.md § 0. **Se ENDURECE, nunca se ablanda**: no se borró ni se relajó una sola
 * aserción de las que ya estaban. Lo único que cambia en los nueve casos vigentes es que la
 * petición lleva token y las cuentas sembradas tienen dueño; todo lo que medían —el candado,
 * la huella, el borde de bigint, el 409, el ledger intacto— se sigue midiendo igual.
 * Lo nuevo vive en el grupo B, al final, y sólo AÑADE.
 *
 * `transferir(...)` recibe la autorización como PRIMER parámetro y obligatorio, con `null`
 * explícito para «sin token». Es deliberado: en S-13 dos casos creían probar «sin cabecera
 * Authorization» mientras la mandaban. Un parámetro opcional
 * al final habría dejado la misma trampa abierta acá.
 *
 * Por qué habla por HTTP y no llama al servicio:
 *   el borde de serialización de `bigint` SÓLO existe cuando la respuesta se serializa de
 *   verdad. `JSON.stringify` de un bigint lanza; un test que llame al servicio directamente
 *   nunca cruza ese borde y se pondría verde sobre un borde que no existe.
 *
 * Por qué no borra nada entre corridas:
 *   el ledger es append-only (D3). Cada caso siembra sus propias cuentas.
 */

const prisma = new PrismaService();
let app: INestApplication;
let base: string;

const ENDPOINT = '/transferencias';

/** Se fija en beforeAll ANTES de crear la app: AuthService valida el secreto al construirse. */
const SECRETO = 'arnes-s06-s18-secreto-de-pruebas-32-min';

/** El formato de token de la Decisión 2 de S-08, reimplementado a mano por el arnés. */
function forjarToken(sub: string, expEpochSegundos: number, secreto = SECRETO): string {
  const carga = Buffer.from(JSON.stringify({ sub, exp: expEpochSegundos })).toString('base64url');
  const firma = createHmac('sha256', secreto).update(carga).digest('base64url');
  return `${carga}.${firma}`;
}

const enUnaHora = (): number => Math.floor(Date.now() / 1000) + 3600;
const haceUnMinuto = (): number => Math.floor(Date.now() / 1000) - 60;

// ─── Siembra ────────────────────────────────────────────────────────────────────────────

/**
 * Un titular de verdad, con su token ya forjado.
 *
 * El usuario se siembra por Prisma y no por `POST /auth/registro` a propósito: `passwordHash`
 * no se usa nunca —el arnés forja el token con el secreto, no hace login— y pasar por el
 * registro metería el scrypt de S-08 (16384 iteraciones) en cada caso de este archivo.
 */
async function titular(): Promise<{ id: string; auth: string }> {
  const id = randomUUID();
  await prisma.usuario.create({
    data: { id, email: `t-${id}@arnes.local`, passwordHash: 'no-se-usa: el arnés forja el token', creadoEn: new Date() },
  });
  return { id, auth: `Bearer ${forjarToken(id, enUnaHora())}` };
}

/**
 * Cuenta con el saldo pedido, por partida doble contra una cuenta de sistema (D2).
 *
 * S-18 · `titularId` es obligatorio para las cuentas de cliente: sin dueño, la comprobación
 * de titularidad no tiene contra qué comparar y el arnés se pondría verde sobre una app que
 * no comprueba nada. La cuenta de contrapartida sigue siendo SISTEMA y sin titular, que es lo
 * que dice el esquema (prisma/schema.prisma:46).
 */
async function cuentaConSaldo(
  saldoCentavos: bigint,
  titularId: string,
  // S-21 · sólo AÑADE: por defecto CORRIENTE, así las llamadas de A y B siembran lo mismo que antes.
  tipo: 'CORRIENTE' | 'AHORRO' | 'PRESTAMO' = 'CORRIENTE',
): Promise<string> {
  const cuentaId = randomUUID();
  const sistemaId = randomUUID();
  await prisma.cuenta.createMany({
    data: [
      { id: cuentaId, tipo, titularId, creadaEn: new Date() },
      { id: sistemaId, tipo: 'SISTEMA', creadaEn: new Date() },
    ],
  });
  if (saldoCentavos > 0n) {
    const transaccionId = randomUUID();
    await prisma.transaccion.create({ data: { id: transaccionId, concepto: 'SIEMBRA_ARNES', creadaEn: new Date() } });
    await prisma.movimiento.createMany({
      data: [
        { transaccionId, cuentaId, montoCentavos: saldoCentavos, creadoEn: new Date() },
        { transaccionId, cuentaId: sistemaId, montoCentavos: -saldoCentavos, creadoEn: new Date() },
      ],
    });
  }
  return cuentaId;
}

/**
 * Historial que ENSANCHA LA VENTANA de la carrera. No es decorado.
 *
 * Lección de S-05, tercera forma en que un arnés nace ciego:
 * con una cuenta recién creada el SUM del saldo tarda microsegundos, la ventana entre
 * consultar la clave y escribirla es tan estrecha que la carrera casi nunca se manifiesta, y
 * el test se pone verde sobre una idempotencia ingenua. Con historial el SUM tarda
 * milisegundos, la ventana se abre, y el test distingue un candado real de un `SELECT`
 * seguido de un `INSERT`.
 *
 * Y es un escenario realista: una cuenta de banco con movimientos es el caso normal.
 */
async function conHistorial(cuentaId: string, pares: number): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO transaccion (id, concepto, creada_en)
    SELECT gen_random_uuid(), 'HISTORIAL_ARNES', now() FROM generate_series(1, ${pares})`;
  await prisma.$executeRaw`
    INSERT INTO movimiento (id, transaccion_id, cuenta_id, monto_centavos, creado_en)
    SELECT gen_random_uuid(), t.id, ${cuentaId}::uuid, s.signo, now()
    FROM (SELECT id FROM transaccion WHERE concepto = 'HISTORIAL_ARNES' ORDER BY creada_en DESC LIMIT ${pares}) t
    CROSS JOIN (VALUES (1::bigint), (-1::bigint)) AS s(signo)`;
}

// ─── Testigos ───────────────────────────────────────────────────────────────────────────

/**
 * Cuenta movimientos y transacciones REALES de transferencia entre estas dos cuentas.
 * Una transferencia ejecutada = 1 transacción y 2 movimientos. Dos = 2 y 4.
 */
async function ejecuciones(
  origen: string,
  destino: string,
): Promise<{ transacciones: number; movimientos: number }> {
  const filas = await prisma.$queryRaw<Array<{ transacciones: bigint; movimientos: bigint }>>`
    SELECT COUNT(DISTINCT m.transaccion_id) AS transacciones, COUNT(*) AS movimientos
    FROM movimiento m
    JOIN transaccion t ON t.id = m.transaccion_id
    WHERE t.concepto = 'TRANSFERENCIA'
      AND m.cuenta_id IN (${origen}::uuid, ${destino}::uuid)`;
  const f = filas[0];
  return { transacciones: Number(f?.transacciones ?? 0n), movimientos: Number(f?.movimientos ?? 0n) };
}

async function saldoDe(cuentaId: string): Promise<bigint> {
  const filas = await prisma.$queryRaw<Array<{ saldo: bigint }>>`
    SELECT COALESCE(SUM(monto_centavos), 0)::bigint AS saldo
    FROM movimiento WHERE cuenta_id = ${cuentaId}::uuid`;
  return filas[0]?.saldo ?? 0n;
}

// ─── El cliente HTTP ────────────────────────────────────────────────────────────────────

interface Respuesta {
  status: number;
  /** El TEXTO crudo. Es lo que se afirma para J5: un objeto ya parseado perdió las comillas. */
  texto: string;
  replay: string | null;
}

async function transferir(
  autorizacion: string | null,
  cuerpo: unknown,
  clave: string | undefined,
  cuerpoCrudo?: string,
): Promise<Respuesta> {
  const cabeceras: Record<string, string> = { 'Content-Type': 'application/json' };
  if (autorizacion !== null) cabeceras['Authorization'] = autorizacion;
  if (clave !== undefined) cabeceras['Idempotency-Key'] = clave;
  const r = await fetch(`${base}${ENDPOINT}`, {
    method: 'POST',
    headers: cabeceras,
    body: cuerpoCrudo ?? JSON.stringify(cuerpo),
  });
  return {
    status: r.status,
    texto: await r.text(),
    replay: r.headers.get('Idempotency-Replayed'),
  };
}

function codigoDe(r: Respuesta): string {
  try {
    return (JSON.parse(r.texto) as { codigo?: string }).codigo ?? '<sin campo codigo>';
  } catch {
    return `<no es JSON: ${r.texto.slice(0, 120)}>`;
  }
}

// ─── Arranque ───────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await prisma.$connect();
  // Antes de crear la app: AuthService valida ZFB_AUTH_SECRET en su constructor.
  process.env['ZFB_AUTH_SECRET'] = SECRETO;
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  // Nest devuelve http://[::1]:PORT cuando escucha en todas las interfaces; `fetch` sí lo
  // resuelve, pero 127.0.0.1 evita depender de que la máquina tenga IPv6 configurada.
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
}, 60_000);

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

// ─── A1 · el caso secuencial ────────────────────────────────────────────────────────────

describe('A1 · misma clave dos veces, en serie', () => {
  it('ejecuta una sola vez y devuelve la misma respuesta', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(1_000_000n, t.id);
    const destino = await cuentaConSaldo(0n, t.id);
    const clave = randomUUID();
    const cuerpo = { origenId: origen, destinoId: destino, monto: '1234.56' };

    const primera = await transferir(t.auth, cuerpo, clave);
    const segunda = await transferir(t.auth, cuerpo, clave);

    // Testigo 1 · las dos respuestas son idénticas, cuerpo y código (J2).
    expect({ status: primera.status, texto: primera.texto }).toEqual({
      status: 201,
      texto: segunda.texto,
    });
    expect(segunda.status).toBe(201);

    // Testigo 2 · el header dice quién ejecutó y quién repitió. Dos síntomas independientes:
    // con uno solo, una implementación que ejecuta y luego compensa es indistinguible.
    expect({ primera: primera.replay, segunda: segunda.replay }).toEqual({
      primera: null,
      segunda: 'true',
    });

    // Testigo 3 · el ledger. UNA transacción, DOS movimientos (J1).
    expect(await ejecuciones(origen, destino)).toEqual({ transacciones: 1, movimientos: 2 });

    // Testigo 4 · la plata. Se movió una sola vez.
    expect({ origen: await saldoDe(origen), destino: await saldoDe(destino) }).toEqual({
      origen: 1_000_000n - 123_456n,
      destino: 123_456n,
    });
  });
});

// ─── A2 · EL CASO QUE IMPORTA ───────────────────────────────────────────────────────────

describe('A2 · veinte peticiones idénticas A LA VEZ (M3)', () => {
  const SIMULTANEAS = 20;

  it('ejecuta exactamente una y las otras diecinueve repiten', async () => {
    const t = await titular();
    // El saldo alcanza para las VEINTE a propósito. Si alcanzara sólo para una, el
    // `FOR UPDATE` de S-05 rechazaría las otras diecinueve por fondos y el conteo daría 2
    // aunque la idempotencia fuera ingenua: el arnés se pondría verde sobre el defecto que
    // vino a cazar. Con saldo de sobra, una idempotencia ingenua deja 40 movimientos.
    const origen = await cuentaConSaldo(1_000_000n, t.id);
    const destino = await cuentaConSaldo(0n, t.id);
    await conHistorial(origen, 20_000); // ver conHistorial: sin esto el test no mide nada

    const clave = randomUUID();
    const cuerpo = { origenId: origen, destinoId: destino, monto: '10.00' };

    const respuestas = await Promise.all(
      Array.from({ length: SIMULTANEAS }, () => transferir(t.auth, cuerpo, clave)),
    );

    // Los cinco testigos se reúnen y se afirman DE UNA SOLA VEZ. Si se afirman por
    // separado, el primero que falle aborta el caso y el conteo del ledger —que es el
    // número de M3— no se llega a imprimir nunca. Un arnés que falla antes de medir lo que
    // vino a medir no reporta nada (Pilar 7).
    //
    // Testigo 1 · todas respondieron 201. Una implementación que se apoya sólo en la llave
    //   primaria de `clave_idempotencia` deja el ledger correcto y devuelve 500 en el resto:
    //   el conteo de movimientos por sí solo no la distingue de una correcta.
    // Testigo 2 · un solo cuerpo distinto entre las veinte, mismo transaccionId (J2).
    // Testigo 3 · exactamente UNA ejecutó; las otras diecinueve repitieron.
    // Testigo 4 · el ledger: UNA transacción, DOS movimientos — no veinte, no cuarenta (J1).
    // Testigo 5 · la plata se movió una sola vez.
    const estados = [...new Set(respuestas.map((r) => r.status))].sort();
    const cuerpos = [...new Set(respuestas.map((r) => r.texto))];
    const ejecutaron = respuestas.filter((r) => r.replay === null).length;

    expect({
      estados,
      respuestas: estados.length === 1 ? SIMULTANEAS : respuestas.map((r) => r.status),
      cuerposDistintos: cuerpos.length,
      ejecutaron,
      repitieron: SIMULTANEAS - ejecutaron,
      ledger: await ejecuciones(origen, destino),
      saldoDestino: await saldoDe(destino),
    }).toEqual({
      estados: [201],
      respuestas: SIMULTANEAS,
      cuerposDistintos: 1,
      ejecutaron: 1,
      repitieron: SIMULTANEAS - 1,
      ledger: { transacciones: 1, movimientos: 2 },
      saldoDestino: 1_000n,
    });
  }, 60_000);
});

// ─── A3 · el control negativo ───────────────────────────────────────────────────────────

describe('A3 · claves distintas con el mismo cuerpo (control negativo)', () => {
  it('son dos transferencias de verdad', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(1_000_000n, t.id);
    const destino = await cuentaConSaldo(0n, t.id);
    const cuerpo = { origenId: origen, destinoId: destino, monto: '25.00' };

    // Sin este caso, una implementación que NUNCA ejecuta nada pasaría A1 y A2 en verde.
    // La idempotencia no puede volverse un candado que deja de mover plata (J3).
    const a = await transferir(t.auth, cuerpo, randomUUID());
    const b = await transferir(t.auth, cuerpo, randomUUID());

    expect({ a: a.status, b: b.status }).toEqual({ a: 201, b: 201 });
    expect(a.texto).not.toBe(b.texto); // transaccionId distinto: son dos asientos
    expect({ a: a.replay, b: b.replay }).toEqual({ a: null, b: null });
    expect(await ejecuciones(origen, destino)).toEqual({ transacciones: 2, movimientos: 4 });
    expect(await saldoDe(destino)).toBe(5_000n);
  });
});

// ─── A4 · misma clave, cuerpo distinto ──────────────────────────────────────────────────

describe('A4 · misma clave con un cuerpo distinto', () => {
  it('la rechaza con 409 IDEMPOTENCY_KEY_REUSADA y no escribe nada', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(1_000_000n, t.id);
    const destino = await cuentaConSaldo(0n, t.id);
    const clave = randomUUID();

    const primera = await transferir(t.auth, { origenId: origen, destinoId: destino, monto: '10.00' }, clave);
    expect(primera.status).toBe(201);

    const segunda = await transferir(t.auth, { origenId: origen, destinoId: destino, monto: '20.00' }, clave);

    expect({ status: segunda.status, codigo: codigoDe(segunda) }).toEqual({
      status: 409,
      codigo: 'IDEMPOTENCY_KEY_REUSADA',
    });
    // J4 · el rechazo no deja rastro: sigue habiendo UNA sola transferencia.
    expect(await ejecuciones(origen, destino)).toEqual({ transacciones: 1, movimientos: 2 });
    expect(await saldoDe(destino)).toBe(1_000n);
  });
});

// ─── A5 · el borde de bigint ────────────────────────────────────────────────────────────

describe('A5 · el borde de serialización (D1)', () => {
  it('el monto viaja como string decimal y sobrevive por encima de 2^53', async () => {
    const t = await titular();
    // 90.000.000.000.000.000,00 en centavos = 9e18, que es ~1000 veces 2^53 y sigue dentro
    // del BIGINT de Postgres (tope 9_223_372_036_854_775_807). Un Number() colado en el borde
    // lo redondea y la plata cambia sin que nada avise.
    //
    // El primer valor que escribí, 9_999_999_999_999_999_999n, NO cabía en BIGINT: la siembra
    // reventaba y el caso que venía a probar el borde no se ejecutaba nunca. Queda anotado
    // porque es la clase de arnés que se pone rojo por la razón equivocada.
    const GRANDE = 9_000_000_000_000_000_000n;
    const origen = await cuentaConSaldo(GRANDE, t.id);
    const destino = await cuentaConSaldo(0n, t.id);

    const r = await transferir(
      t.auth,
      { origenId: origen, destinoId: destino, monto: '90000000000000000.00' },
      randomUUID(),
    );

    expect(r.status).toBe(201);
    // Se afirma sobre el TEXTO CRUDO: un objeto ya parseado perdió la prueba de las comillas.
    expect(r.texto).toMatch(/"monto"\s*:\s*"90000000000000000\.00"/);
    expect(r.texto).not.toMatch(/"monto"\s*:\s*[-0-9]/); // ni un número desnudo
    expect(await saldoDe(destino)).toBe(GRANDE);
  });

  it('rechaza un monto que llega como número de JSON', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(1_000_000n, t.id);
    const destino = await cuentaConSaldo(0n, t.id);
    // Cuerpo crudo, no un objeto: hay que meter un `number` de verdad en el JSON.
    const r = await transferir(
      t.auth,
      undefined,
      randomUUID(),
      `{"origenId":"${origen}","destinoId":"${destino}","monto":1234.56}`,
    );
    expect({ status: r.status, codigo: codigoDe(r) }).toEqual({
      status: 400,
      codigo: 'MONTO_INVALIDO',
    });
    expect(await ejecuciones(origen, destino)).toEqual({ transacciones: 0, movimientos: 0 });
  });
});

// ─── A6 · el header obligatorio ─────────────────────────────────────────────────────────

describe('A6 · sin Idempotency-Key no se mueve plata (D5)', () => {
  it('rechaza con 400 IDEMPOTENCY_KEY_AUSENTE y no escribe nada', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(1_000_000n, t.id);
    const destino = await cuentaConSaldo(0n, t.id);
    const cuerpo = { origenId: origen, destinoId: destino, monto: '10.00' };

    const sinHeader = await transferir(t.auth, cuerpo, undefined);
    const vacia = await transferir(t.auth, cuerpo, '   ');
    const larga = await transferir(t.auth, cuerpo, 'x'.repeat(201));

    expect({
      sinHeader: { status: sinHeader.status, codigo: codigoDe(sinHeader) },
      vacia: { status: vacia.status, codigo: codigoDe(vacia) },
      larga: { status: larga.status, codigo: codigoDe(larga) },
    }).toEqual({
      sinHeader: { status: 400, codigo: 'IDEMPOTENCY_KEY_AUSENTE' },
      vacia: { status: 400, codigo: 'IDEMPOTENCY_KEY_AUSENTE' },
      larga: { status: 400, codigo: 'IDEMPOTENCY_KEY_INVALIDA' },
    });
    expect(await ejecuciones(origen, destino)).toEqual({ transacciones: 0, movimientos: 0 });
  });
});

// ─── A7 · el fallo de negocio ───────────────────────────────────────────────────────────

describe('A7 · un rechazo de negocio no consume la clave (Decisión 3)', () => {
  it('devuelve 409 FONDOS_INSUFICIENTES, no escribe nada, y la clave queda libre', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(500n, t.id);
    const destino = await cuentaConSaldo(0n, t.id);
    const clave = randomUUID();
    const cuerpo = { origenId: origen, destinoId: destino, monto: '10.00' };

    const rechazada = await transferir(t.auth, cuerpo, clave);
    expect({ status: rechazada.status, codigo: codigoDe(rechazada) }).toEqual({
      status: 409,
      codigo: 'FONDOS_INSUFICIENTES',
    });
    // J6 · ni un movimiento suelto ni una transacción huérfana.
    expect(await ejecuciones(origen, destino)).toEqual({ transacciones: 0, movimientos: 0 });

    // Y la misma clave se puede reintentar cuando la cuenta ya tiene fondos: la operación que
    // falló no movió un centavo, así que repetirla no duplica nada (Decisión 3).
    const fondeo = randomUUID();
    await prisma.transaccion.create({ data: { id: fondeo, concepto: 'SIEMBRA_ARNES', creadaEn: new Date() } });
    const caja = await cuentaConSaldo(0n, t.id);
    await prisma.movimiento.createMany({
      data: [
        { transaccionId: fondeo, cuentaId: origen, montoCentavos: 100_000n, creadoEn: new Date() },
        { transaccionId: fondeo, cuentaId: caja, montoCentavos: -100_000n, creadoEn: new Date() },
      ],
    });

    const aceptada = await transferir(t.auth, cuerpo, clave);
    expect({ status: aceptada.status, replay: aceptada.replay }).toEqual({
      status: 201,
      replay: null,
    });
    expect(await ejecuciones(origen, destino)).toEqual({ transacciones: 1, movimientos: 2 });
  });
});

// ─── A8 · las validaciones de borde que quedan ──────────────────────────────────────────

describe('A8 · el resto del contrato de errores', () => {
  it('mapea cada situación a su código tipado (C5)', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(1_000n, t.id);
    const destino = await cuentaConSaldo(0n, t.id);
    const inexistente = randomUUID();

    const casos = {
      montoCero: await transferir(t.auth, { origenId: origen, destinoId: destino, monto: '0' }, randomUUID()),
      montoNegativo: await transferir(t.auth, { origenId: origen, destinoId: destino, monto: '-1.00' }, randomUUID()),
      montoMalFormado: await transferir(t.auth, { origenId: origen, destinoId: destino, monto: '1,50' }, randomUUID()),
      tresDecimales: await transferir(t.auth, { origenId: origen, destinoId: destino, monto: '1.234' }, randomUUID()),
      mismaCuenta: await transferir(t.auth, { origenId: origen, destinoId: origen, monto: '1.00' }, randomUUID()),
      cuentaInexistente: await transferir(t.auth, { origenId: inexistente, destinoId: destino, monto: '1.00' }, randomUUID()),
    };

    expect(Object.fromEntries(
      Object.entries(casos).map(([k, r]) => [k, { status: r.status, codigo: codigoDe(r) }]),
    )).toEqual({
      montoCero: { status: 400, codigo: 'MONTO_INVALIDO' },
      montoNegativo: { status: 400, codigo: 'MONTO_INVALIDO' },
      montoMalFormado: { status: 400, codigo: 'MONTO_INVALIDO' },
      tresDecimales: { status: 400, codigo: 'MONTO_INVALIDO' },
      mismaCuenta: { status: 400, codigo: 'MISMA_CUENTA' },
      cuentaInexistente: { status: 404, codigo: 'CUENTA_NO_ENCONTRADA' },
    });
    expect(await ejecuciones(origen, destino)).toEqual({ transacciones: 0, movimientos: 0 });
  });
});

// ═══ B · S-18 · la transferencia exige identificarse ════════════════════════════════════
//
// Todo lo de este bloque es NUEVO. No reemplaza ni relaja nada de A1–A8: sólo añade lo que
// el contrato de S-18 estrena. Ver specs/S-18-transferencia-autenticada.md.

/** El id que el cliente mandó se borra del mensaje: lo que queda es lo que el sistema DICE. */
function sinIds(texto: string): string {
  return texto.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>');
}

describe('S-18 · sin identificarse no se mueve plata', () => {
  it('B1 · sin cabecera Authorization: 401 TOKEN_AUSENTE y el ledger intacto (V1)', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(1_000_000n, t.id);
    const destino = await cuentaConSaldo(0n, t.id);
    const cuerpo = { origenId: origen, destinoId: destino, monto: '10.00' };

    const r = await transferir(null, cuerpo, randomUUID());

    expect({ status: r.status, codigo: codigoDe(r) }).toEqual({
      status: 401,
      codigo: 'TOKEN_AUSENTE',
    });
    // V1 · ni el ledger ni la clave de idempotencia se tocaron.
    expect(await ejecuciones(origen, destino)).toEqual({ transacciones: 0, movimientos: 0 });
  });

  it('B2 · token con firma ajena: 401 TOKEN_INVALIDO', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(1_000_000n, t.id);
    const destino = await cuentaConSaldo(0n, t.id);
    const impostor = `Bearer ${forjarToken(t.id, enUnaHora(), 'otro-secreto-cualquiera-32-ch')}`;

    const r = await transferir(impostor, { origenId: origen, destinoId: destino, monto: '10.00' }, randomUUID());

    expect({ status: r.status, codigo: codigoDe(r) }).toEqual({
      status: 401,
      codigo: 'TOKEN_INVALIDO',
    });
    expect(await ejecuciones(origen, destino)).toEqual({ transacciones: 0, movimientos: 0 });
  });

  it('B3 · token vencido: 401 TOKEN_EXPIRADO', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(1_000_000n, t.id);
    const destino = await cuentaConSaldo(0n, t.id);
    const vencido = `Bearer ${forjarToken(t.id, haceUnMinuto())}`;

    const r = await transferir(vencido, { origenId: origen, destinoId: destino, monto: '10.00' }, randomUUID());

    expect({ status: r.status, codigo: codigoDe(r) }).toEqual({
      status: 401,
      codigo: 'TOKEN_EXPIRADO',
    });
    expect(await ejecuciones(origen, destino)).toEqual({ transacciones: 0, movimientos: 0 });
  });
});

describe('S-18 · la precedencia: el 401 va ANTES que el 400 (J1)', () => {
  it('B4 · sin token y sin Idempotency-Key responde 401, no 400', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(1_000_000n, t.id);
    const destino = await cuentaConSaldo(0n, t.id);

    // A un cliente no identificado no se le diagnostica la forma de su petición. Este caso
    // distingue «comprueba el token primero» de «comprueba el token en algún momento»: con
    // el orden invertido el sistema respondería 400 IDEMPOTENCY_KEY_AUSENTE.
    const r = await transferir(null, { origenId: origen, destinoId: destino, monto: '10.00' }, undefined);

    expect({ status: r.status, codigo: codigoDe(r) }).toEqual({
      status: 401,
      codigo: 'TOKEN_AUSENTE',
    });
  });

  it('B5 · sin token y con un monto inválido también responde 401', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(1_000_000n, t.id);
    const destino = await cuentaConSaldo(0n, t.id);

    const r = await transferir(null, { origenId: origen, destinoId: destino, monto: '-1.00' }, randomUUID());

    expect({ status: r.status, codigo: codigoDe(r) }).toEqual({
      status: 401,
      codigo: 'TOKEN_AUSENTE',
    });
  });
});

describe('S-18 · sólo el titular del ORIGEN puede ordenar la transferencia (N1)', () => {
  it('B6 · la cuenta origen ajena es INDISTINGUIBLE de la inexistente (V2, J4)', async () => {
    const dueño = await titular();
    const intruso = await titular();
    const ajena = await cuentaConSaldo(1_000_000n, dueño.id);
    const propiaDelIntruso = await cuentaConSaldo(0n, intruso.id);
    const inexistente = randomUUID();

    const sobreLaAjena = await transferir(
      intruso.auth,
      { origenId: ajena, destinoId: propiaDelIntruso, monto: '10.00' },
      randomUUID(),
    );
    const sobreLaInexistente = await transferir(
      intruso.auth,
      { origenId: inexistente, destinoId: propiaDelIntruso, monto: '10.00' },
      randomUUID(),
    );

    // Las dos respuestas, normalizado el id que el propio cliente mandó, tienen que ser la
    // MISMA. Si alguna palabra difiere —«no es tuya» contra «no existe»— el 404 se vuelve un
    // oráculo de existencia y se puede barrer el espacio de ids.
    expect({
      ajena: { status: sobreLaAjena.status, texto: sinIds(sobreLaAjena.texto) },
      inexistente: { status: sobreLaInexistente.status, texto: sinIds(sobreLaInexistente.texto) },
    }).toEqual({
      ajena: { status: 404, texto: sinIds(sobreLaInexistente.texto) },
      inexistente: { status: 404, texto: sinIds(sobreLaInexistente.texto) },
    });
    expect(codigoDe(sobreLaAjena)).toBe('CUENTA_NO_ENCONTRADA');

    // Y no movió un centavo de la cuenta ajena (V1).
    expect(await saldoDe(ajena)).toBe(1_000_000n);
  });

  it('B7 · CONTROL: el dueño SÍ puede con su propia cuenta', async () => {
    // Sin este caso, una app que respondiera 404 a TODA transferencia pasaría el caso de
    // arriba en verde. Un control negativo tiene que importar lo que dice negar.
    const dueño = await titular();
    const origen = await cuentaConSaldo(1_000_000n, dueño.id);
    const destino = await cuentaConSaldo(0n, dueño.id);

    const r = await transferir(dueño.auth, { origenId: origen, destinoId: destino, monto: '10.00' }, randomUUID());

    expect({ status: r.status, replay: r.replay }).toEqual({ status: 201, replay: null });
    expect(await saldoDe(destino)).toBe(1_000n);
  });

  it('B8 · el DESTINO puede ser de otro titular: es el caso normal (N1)', async () => {
    // La regla de negocio es «sólo el titular del origen». Del destino se exige que exista y
    // nada más: transferirle a otra persona es para lo que sirve una transferencia.
    const quienPaga = await titular();
    const quienRecibe = await titular();
    const origen = await cuentaConSaldo(1_000_000n, quienPaga.id);
    const destino = await cuentaConSaldo(0n, quienRecibe.id);

    const r = await transferir(quienPaga.auth, { origenId: origen, destinoId: destino, monto: '250.00' }, randomUUID());

    expect({ status: r.status, codigo: r.status === 201 ? '201' : codigoDe(r) }).toEqual({
      status: 201,
      codigo: '201',
    });
    expect({ origen: await saldoDe(origen), destino: await saldoDe(destino) }).toEqual({
      origen: 1_000_000n - 25_000n,
      destino: 25_000n,
    });
  });

  it('B9 · el titular NO se lee del cuerpo de la petición (V3)', async () => {
    // Un campo `titularId` en el cuerpo no puede cambiar nada: el titular sale del token.
    // Si la implementación lo leyera del cuerpo, el intruso se saldría con la suya y esto
    // devolvería 201.
    const dueño = await titular();
    const intruso = await titular();
    const ajena = await cuentaConSaldo(1_000_000n, dueño.id);
    const destino = await cuentaConSaldo(0n, intruso.id);

    const r = await transferir(
      intruso.auth,
      { origenId: ajena, destinoId: destino, monto: '10.00', titularId: dueño.id },
      randomUUID(),
    );

    expect({ status: r.status, codigo: codigoDe(r) }).toEqual({
      status: 404,
      codigo: 'CUENTA_NO_ENCONTRADA',
    });
    expect(await saldoDe(ajena)).toBe(1_000_000n);
  });
});

describe('S-18 · el titular entra en la huella de idempotencia (J2)', () => {
  it('B10 · la clave de otro NO devuelve su respuesta guardada: 409, no un replay ajeno', async () => {
    // NACIÓ CIEGO y se corrigió antes de usarse. La primera redacción daba a
    // cada titular SU PROPIO par de cuentas: los cuerpos ya diferían entre sí, la huella ya
    // era distinta sin `titularId`, y el caso pasaba en verde contra la app SIN S-18. Decía
    // medir J2 y no lo medía — el mismo defecto que ya se había encontrado en S-13.
    //
    // Lo que sí distingue una huella con `titularId` de una sin él: MISMA clave y MISMO
    // cuerpo, dos titulares. Sin J2 la huella coincide, el sistema lo toma por un reintento
    // y le entrega al segundo la RESPUESTA GUARDADA del primero —con su transaccionId y sus
    // cuentas—. No es un descuadre contable: es una filtración.
    const dueño = await titular();
    const intruso = await titular();
    const origen = await cuentaConSaldo(1_000_000n, dueño.id);
    const destino = await cuentaConSaldo(0n, dueño.id);
    const clave = randomUUID();
    const cuerpo = { origenId: origen, destinoId: destino, monto: '10.00' };

    const primera = await transferir(dueño.auth, cuerpo, clave);
    expect(primera.status).toBe(201);

    const segunda = await transferir(intruso.auth, cuerpo, clave);

    expect({ status: segunda.status, codigo: codigoDe(segunda) }).toEqual({
      status: 409,
      codigo: 'IDEMPOTENCY_KEY_REUSADA',
    });
    // Testigo independiente: pase lo que pase, el intruso NO recibe el cuerpo del dueño.
    expect(segunda.texto).not.toBe(primera.texto);
    expect(segunda.replay).toBeNull();
    // Y la transferencia del dueño sigue siendo UNA.
    expect(await ejecuciones(origen, destino)).toEqual({ transacciones: 1, movimientos: 2 });
  });

  it('B11 · el replay tampoco es un pase libre: con el token vencido responde 401', async () => {
    // La identificación se exige SIEMPRE, antes de resolver la clave (J1 + J3). Si el 401 se
    // comprobara después de la idempotencia, esta segunda llamada devolvería la respuesta
    // guardada con 201 y un token que ya no vale.
    const t = await titular();
    const origen = await cuentaConSaldo(1_000_000n, t.id);
    const destino = await cuentaConSaldo(0n, t.id);
    const clave = randomUUID();
    const cuerpo = { origenId: origen, destinoId: destino, monto: '10.00' };

    const primera = await transferir(t.auth, cuerpo, clave);
    expect(primera.status).toBe(201);

    const vencido = `Bearer ${forjarToken(t.id, haceUnMinuto())}`;
    const replay = await transferir(vencido, cuerpo, clave);

    expect({ status: replay.status, codigo: codigoDe(replay), replay: replay.replay }).toEqual({
      status: 401,
      codigo: 'TOKEN_EXPIRADO',
      replay: null,
    });
    // Y la transferencia original sigue siendo UNA sola: el 401 no ejecutó ni deshizo nada.
    expect(await ejecuciones(origen, destino)).toEqual({ transacciones: 1, movimientos: 2 });
  });
});

// ═══ C · S-21 · al mismo banco: corriente ↔ ahorro sí, a una cuenta de sistema no ═══════
//
// Todo lo de este bloque es NUEVO (specs/S-21-destino-sistema.md; HU-01 CA4–CA6). No toca
// A ni B: sólo añade. El chequeo va en la puerta HTTP y no en el motor, porque apertura,
// boletas, pagos y préstamo mueven plata hacia y desde cuentas SISTEMA por el motor.

/** Una cuenta de sistema como las del esquema: sin titular (prisma/schema.prisma, Cuenta). */
async function cuentaDeSistema(): Promise<string> {
  const id = randomUUID();
  await prisma.cuenta.create({ data: { id, tipo: 'SISTEMA', creadaEn: new Date() } });
  return id;
}

describe('S-21 · entre cuentas propias de distinto tipo (V2, CA4)', () => {
  it('C1 · corriente → ahorro propia: 201 y la plata se mueve', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(1_000_000n, t.id, 'CORRIENTE');
    const destino = await cuentaConSaldo(0n, t.id, 'AHORRO');

    const r = await transferir(t.auth, { origenId: origen, destinoId: destino, monto: '123.45' }, randomUUID());

    expect({ status: r.status, codigo: r.status === 201 ? '201' : codigoDe(r) }).toEqual({ status: 201, codigo: '201' });
    expect({ origen: await saldoDe(origen), destino: await saldoDe(destino) }).toEqual({
      origen: 1_000_000n - 12_345n,
      destino: 12_345n,
    });
    expect(await ejecuciones(origen, destino)).toEqual({ transacciones: 1, movimientos: 2 });
  });

  it('C2 · ahorro → corriente propia: 201 y la plata se mueve', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(1_000_000n, t.id, 'AHORRO');
    const destino = await cuentaConSaldo(0n, t.id, 'CORRIENTE');

    const r = await transferir(t.auth, { origenId: origen, destinoId: destino, monto: '123.45' }, randomUUID());

    expect({ status: r.status, codigo: r.status === 201 ? '201' : codigoDe(r) }).toEqual({ status: 201, codigo: '201' });
    expect({ origen: await saldoDe(origen), destino: await saldoDe(destino) }).toEqual({
      origen: 1_000_000n - 12_345n,
      destino: 12_345n,
    });
    expect(await ejecuciones(origen, destino)).toEqual({ transacciones: 1, movimientos: 2 });
  });
});

describe('S-21 · un cliente no le transfiere a una cuenta de sistema (V4, CA5)', () => {
  it('C3 · destino SISTEMA: 404 CUENTA_NO_ENCONTRADA y el ledger intacto', async () => {
    // Hueco medido: respondía 201 y movía la plata.
    const t = await titular();
    const origen = await cuentaConSaldo(1_000_000n, t.id);
    const sistema = await cuentaDeSistema();

    const r = await transferir(t.auth, { origenId: origen, destinoId: sistema, monto: '10.00' }, randomUUID());

    expect({ status: r.status, codigo: codigoDe(r) }).toEqual({ status: 404, codigo: 'CUENTA_NO_ENCONTRADA' });
    expect({ origen: await saldoDe(origen), sistema: await saldoDe(sistema) }).toEqual({ origen: 1_000_000n, sistema: 0n });
    expect(await ejecuciones(origen, sistema)).toEqual({ transacciones: 0, movimientos: 0 });
  });

  it('C4 · el 404 del destino SISTEMA es INDISTINGUIBLE del destino inexistente (J1)', async () => {
    // Igual que B6 con el origen: si una palabra difiere, el 404 le confirma a quien barre
    // UUID que dio con una cuenta de sistema real.
    const t = await titular();
    const origen = await cuentaConSaldo(1_000_000n, t.id);
    const sistema = await cuentaDeSistema();

    const haciaSistema = await transferir(t.auth, { origenId: origen, destinoId: sistema, monto: '10.00' }, randomUUID());
    const haciaInexistente = await transferir(
      t.auth,
      { origenId: origen, destinoId: randomUUID(), monto: '10.00' },
      randomUUID(),
    );

    expect({
      sistema: { status: haciaSistema.status, texto: sinIds(haciaSistema.texto) },
      inexistente: { status: haciaInexistente.status, texto: sinIds(haciaInexistente.texto) },
    }).toEqual({
      sistema: { status: 404, texto: sinIds(haciaInexistente.texto) },
      inexistente: { status: 404, texto: sinIds(haciaInexistente.texto) },
    });
    expect(await saldoDe(origen)).toBe(1_000_000n);
  });

  it('C5 · destino SISTEMA con el origen sin fondos: 404, no 409 (J2)', async () => {
    const t = await titular();
    const origen = await cuentaConSaldo(0n, t.id);
    const propia = await cuentaConSaldo(0n, t.id);
    const sistema = await cuentaDeSistema();

    // Control: sin fondos de verdad. Hacia una cuenta propia, el mismo origen da 409.
    const control = await transferir(t.auth, { origenId: origen, destinoId: propia, monto: '10.00' }, randomUUID());
    expect({ status: control.status, codigo: codigoDe(control) }).toEqual({ status: 409, codigo: 'FONDOS_INSUFICIENTES' });

    const r = await transferir(t.auth, { origenId: origen, destinoId: sistema, monto: '10.00' }, randomUUID());

    expect({ status: r.status, codigo: codigoDe(r) }).toEqual({ status: 404, codigo: 'CUENTA_NO_ENCONTRADA' });
    expect(await ejecuciones(origen, sistema)).toEqual({ transacciones: 0, movimientos: 0 });
  });

  it('C6 · guarda: destino PRESTAMO propio sigue en 201 (J3; S-16 N4)', async () => {
    // Se cierra SISTEMA y nada más. Una lista blanca «CORRIENTE o AHORRO» dejaría fuera la
    // cuenta de préstamo, que S-16 N4 usa como cualquier cuenta del titular.
    const t = await titular();
    const origen = await cuentaConSaldo(1_000_000n, t.id);
    const prestamo = await cuentaConSaldo(0n, t.id, 'PRESTAMO');

    const r = await transferir(t.auth, { origenId: origen, destinoId: prestamo, monto: '10.00' }, randomUUID());

    expect({ status: r.status, codigo: r.status === 201 ? '201' : codigoDe(r) }).toEqual({ status: 201, codigo: '201' });
    expect(await saldoDe(prestamo)).toBe(1_000n);
  });
});
