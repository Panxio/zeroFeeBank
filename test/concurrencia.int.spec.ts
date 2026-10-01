import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/prisma.service.js';
import { SaldosRepository } from '../src/infra/saldos.repository.js';
import { TransferenciasService } from '../src/modules/transferencias/transferencias.service.js';
import { FondosInsuficientesError } from '../src/domain/transferencia/fondos.js';

/**
 * Arnés de S-05, capa 2: la META M2, contra Postgres de verdad.
 *
 * Un test secuencial NO sirve acá: pasa en verde con el `FOR UPDATE` borrado. Lo único que
 * distingue un bloqueo real de un comentario que dice "bloquea" es lanzar las operaciones a
 * la vez y contar cuántas ganaron.
 *
 * No borra nada entre corridas a propósito: el ledger es append-only (D3), así que cada
 * corrida siembra cuentas nuevas en vez de limpiar las anteriores.
 */
const prisma = new PrismaService();
// S-12 sacó la consulta del saldo a SaldosRepository (una sola definición de «saldo» en todo
// el sistema). Cambia CÓMO se construye el servicio, no qué mide este arnés: ninguna aserción
// ni ningún caso se tocó, y M2 sigue siendo 1 éxito / 19 rechazos.
const servicio = new TransferenciasService(prisma, new SaldosRepository(prisma));

/** Siembra una cuenta con el saldo pedido, por partida doble contra una cuenta de sistema. */
async function cuentaConSaldo(saldoCentavos: bigint): Promise<string> {
  const cuentaId = randomUUID();
  const sistemaId = randomUUID();
  await prisma.cuenta.createMany({
    data: [
      { id: cuentaId, tipo: 'CORRIENTE', creadaEn: new Date() },
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
 * Le da a la cuenta un historial de `pares` transacciones que suman cero (un +1 y un -1 en la
 * misma cuenta), sin mover su saldo.
 *
 * NO es decorado: es lo que hace que este test mida algo. Con una cuenta recién creada, el
 * SUM del saldo tarda microsegundos y la ventana entre leer y escribir es tan estrecha que la
 * carrera casi nunca se manifiesta: el test daba 4/4 en verde con el FOR UPDATE borrado
 * (verificado el 2026-09-07). Con historial, el SUM tarda milisegundos, la ventana se abre, y
 * el test distingue un bloqueo real de un comentario que dice "bloquea".
 *
 * Y es un escenario realista, no un truco: una cuenta de banco con movimientos es el caso
 * normal, no el excepcional.
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

async function saldoDe(cuentaId: string): Promise<bigint> {
  const filas = await prisma.$queryRaw<Array<{ saldo: bigint }>>`
    SELECT COALESCE(SUM(monto_centavos), 0)::bigint AS saldo
    FROM movimiento WHERE cuenta_id = ${cuentaId}::uuid`;
  return filas[0]?.saldo ?? 0n;
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('M2 · 20 retiros simultáneos sobre un saldo que alcanza para 1', () => {
  const SIMULTANEOS = 20;
  const MONTO = 100_000n; // $1.000,00 en centavos

  it('deja pasar exactamente 1 y rechaza 19', async () => {
    const origen = await cuentaConSaldo(MONTO);
    const destino = await cuentaConSaldo(0n);
    await conHistorial(origen, 20_000); // ver conHistorial: sin esto el test no mide nada

    const resultados = await Promise.allSettled(
      Array.from({ length: SIMULTANEOS }, () =>
        servicio.transferir({
          transaccionId: randomUUID(),
          origenId: origen,
          destinoId: destino,
          montoCentavos: MONTO,
        }),
      ),
    );

    const exitos = resultados.filter((r) => r.status === 'fulfilled');
    const rechazos = resultados.filter((r) => r.status === 'rejected');

    // El número, no "funciona" (Pilar 7).
    expect({ exitos: exitos.length, rechazos: rechazos.length }).toEqual({
      exitos: 1,
      rechazos: SIMULTANEOS - 1,
    });

    // Y rechazados por la razón correcta: un deadlock o un error de conexión también daría
    // 1 y 19, y sería un verde que no significa nada.
    for (const r of rechazos) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(FondosInsuficientesError);
    }

    // El dinero cuadra: origen en cero, destino con el monto, y ni un centavo aparecido.
    expect(await saldoDe(origen)).toBe(0n);
    expect(await saldoDe(destino)).toBe(MONTO);
  });

  it('no escribe nada en el ledger cuando rechaza (T3)', async () => {
    const origen = await cuentaConSaldo(1_000n);
    const destino = await cuentaConSaldo(0n);

    await expect(
      servicio.transferir({
        transaccionId: randomUUID(),
        origenId: origen,
        destinoId: destino,
        montoCentavos: 1_001n,
      }),
    ).rejects.toBeInstanceOf(FondosInsuficientesError);

    // Ni un movimiento suelto ni una transacción huérfana: la del rechazo no existe.
    expect(await saldoDe(origen)).toBe(1_000n);
    expect(await saldoDe(destino)).toBe(0n);
  });

  it('deja pasar el saldo exacto (borde >=)', async () => {
    const origen = await cuentaConSaldo(1_000n);
    const destino = await cuentaConSaldo(0n);
    await servicio.transferir({
      transaccionId: randomUUID(),
      origenId: origen,
      destinoId: destino,
      montoCentavos: 1_000n,
    });
    expect(await saldoDe(origen)).toBe(0n);
  });
});

describe('T4 · transferencias cruzadas A->B y B->A a la vez', () => {
  const PARES = 10;

  it('ninguna muere por deadlock', async () => {
    const a = await cuentaConSaldo(1_000_000n);
    const b = await cuentaConSaldo(1_000_000n);

    // Sin orden estable de bloqueo, este patrón es EL generador de deadlocks: cada dirección
    // toma primero la cuenta que la otra ya tiene.
    const resultados = await Promise.allSettled(
      Array.from({ length: PARES * 2 }, (_, i) =>
        servicio.transferir({
          transaccionId: randomUUID(),
          origenId: i % 2 === 0 ? a : b,
          destinoId: i % 2 === 0 ? b : a,
          montoCentavos: 1_000n,
        }),
      ),
    );

    const fallidas = resultados.filter((r) => r.status === 'rejected');
    const motivos = fallidas.map((r) => String((r as PromiseRejectedResult).reason).slice(0, 120));
    expect({ fallidas: fallidas.length, motivos }).toEqual({ fallidas: 0, motivos: [] });

    // Y el dinero no se movió en neto: lo que sale de una entra en la otra, en partes iguales.
    expect((await saldoDe(a)) + (await saldoDe(b))).toBe(2_000_000n);
  });
});
