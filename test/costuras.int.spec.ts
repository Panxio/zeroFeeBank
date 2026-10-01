import { Client } from 'pg';
import { Module, type INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroresHttpFilter } from '../src/infra/errores-http.filter.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { CosturasModule } from '../src/modules/costuras/costuras.module.js';
import { HealthModule } from '../src/modules/health/health.module.js';

/**
 * Arnés de S-07 · las costuras de prueba. Ver specs/S-07-costuras.md.
 * ESTE ARCHIVO NO SE TOCA (specs/_CANDADO.md).
 *
 * ─── Por qué habla por HTTP y levanta DOS aplicaciones ──────────────────────────────────
 * V1 dice «sin el flag, la ruta NO EXISTE». Eso sólo se puede comprobar contra un router de
 * verdad: mirar el código fuente y no encontrar la ruta es exactamente un check ciego.
 *
 * ─── La trampa que este arnés evita a propósito ─────────────────────────────────────────
 * Una app que sólo importa CosturasModule apagado NO TIENE NINGUNA RUTA, así que /__test__/
 * daría 404 aunque la implementación no existiera. Ese 404 no prueba nada.
 * Por eso la app-apagada importa TAMBIÉN HealthModule y cada caso del brazo A1 exige dos
 * testigos: /health responde 200 (la app está viva y ruteando) Y /__test__/… da 404.
 */

const prisma = new PrismaService();

let appOn: INestApplication;
let appOff: INestApplication;
let baseOn = '';
let baseOff = '';

/**
 * Construye una app CON el módulo de costuras, decidiendo el flag en el momento de llamar.
 *
 * OJO CON LA VERSIÓN ANTERIOR DE ESTO, que fue el defecto más caro de este arnés: la
 * app-apagada se declaraba con `@Module({ imports: [HealthModule] })` y NO IMPORTABA
 * CosturasModule. Así, el 404 estaba garantizado pase lo que pase: el brazo A1 decía
 * comprobar «sin el flag la ruta no existe» y en realidad comprobaba «una app que no monta
 * el módulo no tiene sus rutas», que es cierto siempre. Con el flag desactivado a la fuerza
 * en la implementación, el arnés seguía en 15/15. El arnés no ve lo que cree ver. Lo cazó la calibración, no la lectura.
 *
 * El decorador se evalúa cuando esta función CORRE, no al importar el archivo: por eso la
 * clase se declara adentro, y por eso CosturasModule.paraEntorno() es un módulo dinámico.
 */
async function levantarApp(flag: string): Promise<INestApplication> {
  process.env['ZFB_COSTURAS_PRUEBA'] = flag;

  @Module({
    imports: [HealthModule, CosturasModule.paraEntorno()],
    providers: [{ provide: APP_FILTER, useClass: ErroresHttpFilter }],
  })
  class AppDePrueba {}

  const app = await NestFactory.create(AppDePrueba, { logger: false });
  await app.listen(0);
  return app;
}

// ─── utilidades ────────────────────────────────────────────────────────────────────────

type Respuesta = { estado: number; cuerpo: unknown };

async function pedir(
  base: string,
  metodo: string,
  ruta: string,
  cuerpo?: unknown,
): Promise<Respuesta> {
  const init: RequestInit = { method: metodo };
  if (cuerpo !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(cuerpo);
  }
  const r = await fetch(`${base}${ruta}`, init);
  const texto = await r.text();
  let parseado: unknown = texto;
  try {
    parseado = texto === '' ? null : JSON.parse(texto);
  } catch {
    /* se queda el texto crudo: un 404 de Nest sí es JSON, pero un 500 crudo puede no serlo */
  }
  return { estado: r.status, cuerpo: parseado };
}

function obj(valor: unknown): Record<string, unknown> {
  expect(valor, 'la respuesta no es un objeto JSON').toBeTypeOf('object');
  expect(valor).not.toBeNull();
  return valor as Record<string, unknown>;
}

/**
 * Intenta un UPDATE sobre el ledger con la conexión que se le pase y devuelve el SQLSTATE
 * con que lo rechazaron. Usa `pg` directo y no Prisma porque hace falta conectarse con DOS
 * roles distintos en la misma corrida, y PrismaService lee siempre DATABASE_URL.
 */
async function intentarUpdate(connectionString: string): Promise<string> {
  const cliente = new Client({ connectionString });
  await cliente.connect();
  try {
    await cliente.query('UPDATE movimiento SET monto_centavos = 0');
    return 'NINGUNO — el UPDATE pasó';
  } catch (e) {
    const codigo = (e as { code?: string }).code;
    return codigo ?? `sin SQLSTATE: ${String(e).slice(0, 100)}`;
  } finally {
    await cliente.end();
  }
}

/** Conteo de TODAS las tablas de datos, en un solo objeto: un caso, una aserción. */
async function conteos(): Promise<Record<string, number>> {
  const [movimiento, transaccion, boleta, clave, cuenta, usuario] = await Promise.all([
    prisma.movimiento.count(),
    prisma.transaccion.count(),
    prisma.boleta.count(),
    prisma.claveIdempotencia.count(),
    prisma.cuenta.count(),
    prisma.usuario.count(),
  ]);
  return { movimiento, transaccion, boleta, clave, cuenta, usuario };
}

beforeAll(async () => {
  // El flag se fija ACÁ y no se confía en el .env: un arnés cuyo resultado dependa de una
  // variable que alguien puede tener distinta en su máquina no mide lo que dice medir.
  // Las DOS apps montan el mismo módulo; lo único que cambia entre ellas es el flag.
  appOn = await levantarApp('1');
  baseOn = (await appOn.getUrl()).replace('[::1]', 'localhost');

  appOff = await levantarApp('0');
  baseOff = (await appOff.getUrl()).replace('[::1]', 'localhost');

  // Se deja encendido para el resto de la suite: la app-apagada ya quedó construida.
  process.env['ZFB_COSTURAS_PRUEBA'] = '1';
});

afterAll(async () => {
  await appOn?.close();
  await appOff?.close();
  await prisma.$disconnect();
});

// ─── A1 · V1 · sin el flag la ruta NO EXISTE ───────────────────────────────────────────

describe('A1 · sin el flag, las tres rutas dan 404', () => {
  it('la app-apagada está viva y ruteando, y aun así no tiene ninguna costura', async () => {
    // Un caso, TODOS los testigos, UNA aserción (lección #23: una aserción anterior que
    // aborta el caso se lleva consigo los números que veníamos a leer).
    const salud = await pedir(baseOff, 'GET', '/health');
    const reset = await pedir(baseOff, 'POST', '/__test__/reset');
    const seed = await pedir(baseOff, 'POST', '/__test__/seed', { escenario: 'cuenta-unica' });
    const reloj = await pedir(baseOff, 'POST', '/__test__/reloj', { instante: null });

    expect({
      salud: salud.estado,
      reset: reset.estado,
      seed: seed.estado,
      reloj: reloj.estado,
    }).toEqual({ salud: 200, reset: 404, seed: 404, reloj: 404 });
  });

  it('la MISMA ruta con el flag encendido responde 200 — si no, el 404 de arriba no prueba nada', async () => {
    // Empezó como `.not.toBe(404)` y se puso VERDE recibiendo un 500 (el filtro global se
    // tragaba los 404 de Nest, defecto encontrado). Un control positivo que
    // acepta «cualquier cosa menos X» acepta también los fallos: por eso afirma el 200.
    const reset = await pedir(baseOn, 'POST', '/__test__/reset');
    expect(reset.estado).toBe(200);
  });
});

// ─── A2 · C1 · reset deja el estado base ───────────────────────────────────────────────

describe('A2 · reset deja el sistema en el estado base', () => {
  it('vacía TODAS las tablas de datos, incluido el ledger', async () => {
    await pedir(baseOn, 'POST', '/__test__/reset');
    const sembrado = await pedir(baseOn, 'POST', '/__test__/seed', { escenario: 'dos-cuentas' });
    const antes = await conteos();

    const reset = await pedir(baseOn, 'POST', '/__test__/reset');
    const despues = await conteos();

    expect({
      siembraOk: sembrado.estado,
      resetOk: reset.estado,
      habiaDatos: Object.values(antes).some((n) => n > 0),
      despues,
    }).toEqual({
      siembraOk: 201,
      resetOk: 200,
      habiaDatos: true,
      despues: { movimiento: 0, transaccion: 0, boleta: 0, clave: 0, cuenta: 0, usuario: 0 },
    });
  });

  it('sobre una base ya vacía responde 200 igual (borde 1 de la spec)', async () => {
    await pedir(baseOn, 'POST', '/__test__/reset');
    const segundo = await pedir(baseOn, 'POST', '/__test__/reset');
    expect(segundo.estado).toBe(200);
  });
});

// ─── A3 · V2 · el reset NO debilita el append-only ─────────────────────────────────────

describe('A3 · después del reset, la garantía D3 sigue en pie', () => {
  it('el trigger de TRUNCATE volvió, y el ledger sigue rechazando un UPDATE con ZFB01', async () => {
    await pedir(baseOn, 'POST', '/__test__/reset');
    const sembrado = await pedir(baseOn, 'POST', '/__test__/seed', { escenario: 'cuenta-unica' });
    expect(sembrado.estado, 'la siembra falló: el resto del caso no mediría nada').toBe(201);

    // Testigo 1 · el trigger existe en el catálogo de Postgres, por su nombre.
    const triggers = await prisma.$queryRawUnsafe<Array<{ tgname: string }>>(
      `SELECT t.tgname FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relname = 'movimiento' AND NOT t.tgisinternal`,
    );
    const nombres = triggers.map((t) => t.tgname).sort();

    // Testigo 2 · y sigue MORDIENDO. OJO CON QUIÉN LO INTENTA: S-04 puso DOS defensas
    // distintas sobre el ledger, y cada una habla su propio idioma.
    //   · al rol de la app lo frena el REVOKE de la tabla  → 42501
    //   · al DUEÑO de la base lo frena el trigger          → ZFB01
    // Este brazo nació preguntándole sólo al rol de la app y esperando ZFB01: nunca lo
    // habría visto, porque el permiso muerde primero y el trigger no llega a dispararse.
    // Es un arnés ciego por confundir dos mecanismos que dan un solo
    // síntoma. No lo cazó la calibración.
    // Ahora se le pregunta a los DOS, y cada uno tiene que responder con SU código.
    const codigoUpdate = {
      comoApp: await intentarUpdate(String(process.env['DATABASE_URL'])),
      comoDueno: await intentarUpdate(String(process.env['DATABASE_URL_MIGRACION'])),
    };

    // Testigo 3 · el ledger sembrado sigue ahí (un reset que borrara de más también sería rojo).
    const movimientos = await prisma.movimiento.count();

    expect({
      tieneTriggerDeTruncate: nombres.includes('movimiento_sin_truncate'),
      tieneTriggerDeUpdate: nombres.includes('movimiento_sin_update'),
      tieneTriggerDeDelete: nombres.includes('movimiento_sin_delete'),
      codigoUpdate,
      movimientos,
    }).toEqual({
      tieneTriggerDeTruncate: true,
      tieneTriggerDeUpdate: true,
      tieneTriggerDeDelete: true,
      codigoUpdate: { comoApp: '42501', comoDueno: 'ZFB01' },
      movimientos: 2,
    });
  });
});

// ─── A4 · V3 · seed devuelve los ids que creó ──────────────────────────────────────────

describe('A4 · seed devuelve los identificadores que creó', () => {
  it('cada id existe en la base, y el saldo declarado es el saldo derivado del ledger', async () => {
    await pedir(baseOn, 'POST', '/__test__/reset');
    const r = await pedir(baseOn, 'POST', '/__test__/seed', { escenario: 'dos-cuentas' });
    expect(r.estado).toBe(201);
    const cuerpo = obj(r.cuerpo);

    const usuarioId = cuerpo['usuarioId'];
    const sistemaId = cuerpo['cuentaSistemaId'];
    const cuentas = cuerpo['cuentas'] as Array<Record<string, unknown>>;
    expect(Array.isArray(cuentas), 'seed no devolvió el arreglo de cuentas').toBe(true);

    const existeUsuario =
      (await prisma.usuario.count({ where: { id: String(usuarioId) } })) === 1;
    const existeSistema =
      (await prisma.cuenta.count({ where: { id: String(sistemaId), tipo: 'SISTEMA' } })) === 1;

    // El saldo que seed DECLARA contra el que el ledger DERIVA. Dos fuentes del mismo dato
    // que no cuadran es un defecto (D2), no una diferencia de formato.
    const saldos: Array<{ declarado: unknown; derivado: string; tipoDeclarado: string }> = [];
    for (const c of cuentas) {
      const suma = await prisma.movimiento.aggregate({
        where: { cuentaId: String(c['id']) },
        _sum: { montoCentavos: true },
      });
      saldos.push({
        declarado: c['saldoCentavos'],
        derivado: String(suma._sum.montoCentavos ?? 0n),
        tipoDeclarado: typeof c['saldoCentavos'],
      });
    }

    expect({
      escenario: cuerpo['escenario'],
      existeUsuario,
      existeSistema,
      cuantasCuentas: cuentas.length,
      saldos,
    }).toEqual({
      escenario: 'dos-cuentas',
      existeUsuario: true,
      existeSistema: true,
      cuantasCuentas: 2,
      saldos: [
        { declarado: '100000', derivado: '100000', tipoDeclarado: 'string' },
        { declarado: '0', derivado: '0', tipoDeclarado: 'string' },
      ],
    });
  });

  it('cuenta-con-historial trae los 20 movimientos que la spec fija, y suman 100000', async () => {
    await pedir(baseOn, 'POST', '/__test__/reset');
    const r = await pedir(baseOn, 'POST', '/__test__/seed', {
      escenario: 'cuenta-con-historial',
    });
    expect(r.estado).toBe(201);
    const cuentas = obj(r.cuerpo)['cuentas'] as Array<Record<string, unknown>>;
    const cuentaId = String(cuentas[0]?.['id']);

    const movimientos = await prisma.movimiento.findMany({ where: { cuentaId } });
    const suma = movimientos.reduce((a, m) => a + m.montoCentavos, 0n);
    const montos = [...new Set(movimientos.map((m) => String(m.montoCentavos)))];

    expect({ cuantos: movimientos.length, suma: String(suma), montos }).toEqual({
      cuantos: 20,
      suma: '100000',
      montos: ['5000'],
    });
  });
});

// ─── A5 · V6 · lo sembrado respeta la partida doble ────────────────────────────────────

describe('A5 · sembrar no es excusa para descuadrar (D2 / I1)', () => {
  it('cada transacción sembrada suma exactamente 0, en los tres escenarios', async () => {
    const descuadres: Array<{ escenario: string; transaccionId: string; suma: string }> = [];
    for (const escenario of ['cuenta-unica', 'dos-cuentas', 'cuenta-con-historial']) {
      await pedir(baseOn, 'POST', '/__test__/reset');
      const r = await pedir(baseOn, 'POST', '/__test__/seed', { escenario });
      expect(r.estado, `la siembra de ${escenario} falló`).toBe(201);

      const filas = await prisma.movimiento.groupBy({
        by: ['transaccionId'],
        _sum: { montoCentavos: true },
      });
      expect(filas.length, `${escenario} no escribió ninguna transacción`).toBeGreaterThan(0);
      for (const f of filas) {
        const suma = f._sum.montoCentavos ?? 0n;
        if (suma !== 0n) {
          descuadres.push({ escenario, transaccionId: f.transaccionId, suma: String(suma) });
        }
      }
    }
    expect(descuadres).toEqual([]);
  });
});

// ─── A6 · V4 · el escenario desconocido falla RUIDOSAMENTE y no escribe nada ───────────

describe('A6 · un escenario que no existe', () => {
  it('devuelve 400 con código tipado y NO escribe una sola fila', async () => {
    await pedir(baseOn, 'POST', '/__test__/reset');
    const antes = await conteos();

    const inexistente = await pedir(baseOn, 'POST', '/__test__/seed', {
      escenario: 'este-escenario-no-existe',
    });
    const sinClave = await pedir(baseOn, 'POST', '/__test__/seed', {});
    const noEsString = await pedir(baseOn, 'POST', '/__test__/seed', { escenario: 42 });

    const despues = await conteos();

    expect({
      inexistente: { estado: inexistente.estado, codigo: obj(inexistente.cuerpo)['codigo'] },
      sinClave: { estado: sinClave.estado, codigo: obj(sinClave.cuerpo)['codigo'] },
      noEsString: { estado: noEsString.estado, codigo: obj(noEsString.cuerpo)['codigo'] },
      escribio: JSON.stringify(antes) !== JSON.stringify(despues),
    }).toEqual({
      inexistente: { estado: 400, codigo: 'ESCENARIO_DESCONOCIDO' },
      sinClave: { estado: 400, codigo: 'ESCENARIO_DESCONOCIDO' },
      noEsString: { estado: 400, codigo: 'ESCENARIO_DESCONOCIDO' },
      escribio: false,
    });
  });

  it('el mensaje enumera los escenarios válidos, para quien lee un log de CI', async () => {
    const r = await pedir(baseOn, 'POST', '/__test__/seed', { escenario: 'nada' });
    const mensaje = String(obj(r.cuerpo)['mensaje']);
    expect({
      nombra_cuenta_unica: mensaje.includes('cuenta-unica'),
      nombra_dos_cuentas: mensaje.includes('dos-cuentas'),
      nombra_historial: mensaje.includes('cuenta-con-historial'),
    }).toEqual({ nombra_cuenta_unica: true, nombra_dos_cuentas: true, nombra_historial: true });
  });
});

// ─── A7 · V5 · los escenarios son estables entre corridas ──────────────────────────────

describe('A7 · el mismo escenario, dos veces', () => {
  it('da la misma forma y los mismos montos, con identificadores distintos', async () => {
    await pedir(baseOn, 'POST', '/__test__/reset');
    const uno = obj((await pedir(baseOn, 'POST', '/__test__/seed', { escenario: 'dos-cuentas' })).cuerpo);
    const dos = obj((await pedir(baseOn, 'POST', '/__test__/seed', { escenario: 'dos-cuentas' })).cuerpo);

    const forma = (c: Record<string, unknown>): unknown =>
      (c['cuentas'] as Array<Record<string, unknown>>).map((x) => ({
        tipo: x['tipo'],
        saldoCentavos: x['saldoCentavos'],
      }));

    expect({
      mismaForma: JSON.stringify(forma(uno)) === JSON.stringify(forma(dos)),
      usuariosDistintos: uno['usuarioId'] !== dos['usuarioId'],
      sistemasDistintos: uno['cuentaSistemaId'] !== dos['cuentaSistemaId'],
    }).toEqual({ mismaForma: true, usuariosDistintos: true, sistemasDistintos: true });
  });
});

// ─── A8 · V7 · el reloj ────────────────────────────────────────────────────────────────

describe('A8 · el reloj se fija, se adelanta y se suelta', () => {
  it('fijado, dos lecturas seguidas dan EXACTAMENTE el mismo instante', async () => {
    const instante = '2027-01-15T10:00:00.000Z';
    const fijar = await pedir(baseOn, 'POST', '/__test__/reloj', { instante });
    const lee1 = await pedir(baseOn, 'POST', '/__test__/reloj', { avanzarMs: 0 });
    const lee2 = await pedir(baseOn, 'POST', '/__test__/reloj', { avanzarMs: 0 });

    expect({
      estado: fijar.estado,
      ahoraAlFijar: obj(fijar.cuerpo)['ahora'],
      fijado: obj(fijar.cuerpo)['fijado'],
      lectura1: obj(lee1.cuerpo)['ahora'],
      lectura2: obj(lee2.cuerpo)['ahora'],
    }).toEqual({
      estado: 200,
      ahoraAlFijar: instante,
      fijado: true,
      lectura1: instante,
      lectura2: instante,
    });
  });

  it('avanza el tiempo exactamente lo pedido, y lo suelta cuando se le dice', async () => {
    await pedir(baseOn, 'POST', '/__test__/reloj', { instante: '2027-01-15T10:00:00.000Z' });
    const unDia = await pedir(baseOn, 'POST', '/__test__/reloj', { avanzarMs: 86_400_000 });
    const soltar = await pedir(baseOn, 'POST', '/__test__/reloj', { instante: null });
    const real = new Date(String(obj(soltar.cuerpo)['ahora'])).getTime();

    expect({
      avanzado: obj(unDia.cuerpo)['ahora'],
      fijadoTrasSoltar: obj(soltar.cuerpo)['fijado'],
      // Soltado, el reloj vuelve a la hora real: tiene que estar cerca de AHORA, no en 2027.
      volvioALaHoraReal: Math.abs(real - Date.now()) < 60_000,
    }).toEqual({
      avanzado: '2027-01-16T10:00:00.000Z',
      fijadoTrasSoltar: false,
      volvioALaHoraReal: true,
    });
  });

  it('rechaza con códigos DISTINTOS cada forma de pedir mal', async () => {
    await pedir(baseOn, 'POST', '/__test__/reloj', { instante: null });
    const ambas = await pedir(baseOn, 'POST', '/__test__/reloj', {
      instante: '2027-01-15T10:00:00.000Z',
      avanzarMs: 1,
    });
    const ninguna = await pedir(baseOn, 'POST', '/__test__/reloj', {});
    const noFecha = await pedir(baseOn, 'POST', '/__test__/reloj', { instante: 'mañana' });
    const negativo = await pedir(baseOn, 'POST', '/__test__/reloj', { avanzarMs: -1 });
    await pedir(baseOn, 'POST', '/__test__/reloj', { instante: null });
    const sinFijar = await pedir(baseOn, 'POST', '/__test__/reloj', { avanzarMs: 1000 });

    expect({
      ambas: [ambas.estado, obj(ambas.cuerpo)['codigo']],
      ninguna: [ninguna.estado, obj(ninguna.cuerpo)['codigo']],
      noFecha: [noFecha.estado, obj(noFecha.cuerpo)['codigo']],
      negativo: [negativo.estado, obj(negativo.cuerpo)['codigo']],
      sinFijar: [sinFijar.estado, obj(sinFijar.cuerpo)['codigo']],
    }).toEqual({
      ambas: [400, 'RELOJ_PETICION_INVALIDA'],
      ninguna: [400, 'RELOJ_PETICION_INVALIDA'],
      noFecha: [400, 'RELOJ_INSTANTE_INVALIDO'],
      negativo: [400, 'RELOJ_AVANCE_INVALIDO'],
      sinFijar: [400, 'RELOJ_NO_FIJADO'],
    });
  });

  it('el reset devuelve el reloj a la hora real (borde 3 de la spec)', async () => {
    await pedir(baseOn, 'POST', '/__test__/reloj', { instante: '2027-01-15T10:00:00.000Z' });
    await pedir(baseOn, 'POST', '/__test__/reset');
    const lee = await pedir(baseOn, 'POST', '/__test__/reloj', { avanzarMs: 1000 });

    // Con el reloj suelto, avanzar es un error: eso ES la prueba de que el reset lo soltó.
    expect([lee.estado, obj(lee.cuerpo)['codigo']]).toEqual([400, 'RELOJ_NO_FIJADO']);
  });
});
