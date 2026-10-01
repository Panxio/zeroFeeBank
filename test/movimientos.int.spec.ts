import { createHmac } from 'node:crypto';
import { Module, type INestApplication } from '@nestjs/common';
import { APP_FILTER, NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroresHttpFilter } from '../src/infra/errores-http.filter.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { CosturasModule } from '../src/modules/costuras/costuras.module.js';
import { MovimientosModule } from '../src/modules/movimientos/movimientos.module.js';

/**
 * Arnés de S-13 · búsqueda de movimientos. Ver specs/S-13-movimientos.md.
 * ESTE ARCHIVO NO SE TOCA (specs/_CANDADO.md).
 *
 * ─── Por qué habla por HTTP ─────────────────────────────────────────────────────────────
 * Media spec SON los estados y los códigos tipados (C5): 400 antes que 404, 404 para lo ajeno
 * y lo inexistente por igual. Un test contra el servicio vería excepciones, no el contrato.
 *
 * ─── Por qué usa la costura de siembra ──────────────────────────────────────────────────
 * Porque los movimientos que escribe la puerta pública llevan la fecha de `now()` de Postgres
 * —el reloj inyectado NO llega a `movimiento.creado_en`, deuda declarada— así que
 * por la puerta pública TODO nace hoy y un filtro por rango de fechas no se puede arnesar.
 * El escenario 'movimientos-buscables' existe para esto.
 *
 * ─── Por qué la población es la que es ──────────────────────────────────────────────────
 * Los otros tres escenarios siembran con UNA fecha y montos iguales. Contra eso, un buscador
 * correcto y uno que IGNORA LOS FILTROS Y DEVUELVE TODO dan el mismo resultado, y el arnés
 * daría verde sobre un endpoint que no filtra nada.
 * Acá cada filtro devuelve un subconjunto PROPIO y NO VACÍO, el AND de dos es distinto de cada
 * uno por separado (F1), y la cuenta ajena COLISIONA en fecha y monto con la del titular, para
 * que quitar la titularidad cambie los números en vez de dar el mismo 404 de siempre.
 *
 * ─── Por qué lee la base con Prisma ─────────────────────────────────────────────────────
 * Como ORÁCULO INDEPENDIENTE: V1 (no escribe) se comprueba contando filas sin pasar por el
 * código auditado. Preguntarle al mismo servicio que se audita es compararlo consigo mismo.
 */

const prisma = new PrismaService();
let app: INestApplication;
let base = '';

/** El secreto lo fija el arnés: si dependiera del .env de cada máquina no mediría lo mismo. */
const SECRETO = 'arnes-s13-secreto-de-pruebas-32-min-ok';

/** M3. Declarado acá A PROPÓSITO: si la implementación lo
 *  cambia, este número es el que manda. */
const TOPE = 50;

@Module({
  imports: [AuthModule, CosturasModule.paraEntorno(), MovimientosModule],
  providers: [{ provide: APP_FILTER, useClass: ErroresHttpFilter }],
})
class AppMovimientos {}

// ─── utilidades ────────────────────────────────────────────────────────────────────────

type Respuesta = {
  estado: number;
  cuerpo: Record<string, unknown>;
};

async function pedir(
  metodo: string,
  ruta: string,
  opciones: { cuerpo?: unknown; autorizacion?: string | null } = {},
): Promise<Respuesta> {
  const headers: Record<string, string> = {};
  if (opciones.cuerpo !== undefined) headers['content-type'] = 'application/json';
  if (typeof opciones.autorizacion === 'string') {
    headers['authorization'] = opciones.autorizacion;
  }
  const init: RequestInit = { method: metodo, headers };
  if (opciones.cuerpo !== undefined) init.body = JSON.stringify(opciones.cuerpo);
  const r = await fetch(`${base}${ruta}`, init);
  const texto = await r.text();
  let cuerpo: unknown = null;
  try {
    cuerpo = texto === '' ? {} : JSON.parse(texto);
  } catch {
    cuerpo = { _crudo: texto };
  }
  return { estado: r.status, cuerpo: (cuerpo ?? {}) as Record<string, unknown> };
}

const b64url = (b: Buffer): string => b.toString('base64url');

/** El formato de token de la Decisión 2 de S-08, reimplementado a mano por el arnés. */
function forjarToken(sub: string, expEpochSegundos: number, secreto = SECRETO): string {
  const carga = b64url(Buffer.from(JSON.stringify({ sub, exp: expEpochSegundos })));
  const firma = b64url(createHmac('sha256', secreto).update(carga).digest());
  return `${carga}.${firma}`;
}

const enUnaHora = (): number => Math.floor(Date.now() / 1000) + 3600;

interface MovimientoSembrado {
  id: string;
  transaccionId: string;
  cuentaId: string;
  montoCentavos: string;
  creadoEn: string;
}

interface Escenario {
  usuarioId: string;
  cuentaId: string;
  cuentaTopeId: string;
  cuentaAjenaId: string;
  usuarioAjenoId: string;
  movimientos: MovimientoSembrado[];
  auth: string;
  authAjeno: string;
}

/**
 * Siembra un escenario NUEVO por caso. No hay reset entre casos a propósito: el ledger es
 * append-only (D3) y cada escenario trae sus propios ids, así que las corridas no se pisan y
 * el orden de los casos no importa (C2).
 */
async function sembrar(): Promise<Escenario> {
  const r = await pedir('POST', '/__test__/seed', {
    cuerpo: { escenario: 'movimientos-buscables' },
  });
  expect(
    r.estado,
    `la siembra falló (¿ZFB_COSTURAS_PRUEBA=1?): ${JSON.stringify(r.cuerpo)}`,
  ).toBe(201);

  const cuentas = r.cuerpo['cuentas'] as Array<Record<string, unknown>>;
  const movimientos = r.cuerpo['movimientos'] as MovimientoSembrado[];

  // La siembra se AFIRMA antes de usarse. Un escenario que devuelve menos de lo que promete
  // deja todos los casos de abajo midiendo otra cosa: es un arnés imposible (`la siembra
  // revienta y el borde nunca se cruza`), y se cierra acá y no cincuenta líneas más adelante.
  expect(movimientos, 'el seed no devolvió el oráculo de movimientos').toBeDefined();
  expect(movimientos).toHaveLength(10);
  expect(cuentas).toHaveLength(3);

  const usuarioId = String(r.cuerpo['usuarioId']);
  const usuarioAjenoId = String(r.cuerpo['usuarioAjenoId']);
  return {
    usuarioId,
    usuarioAjenoId,
    cuentaId: String(cuentas[0]?.['id']),
    cuentaTopeId: String(r.cuerpo['cuentaTopeId']),
    cuentaAjenaId: String(r.cuerpo['cuentaAjenaId']),
    movimientos,
    auth: `Bearer ${forjarToken(usuarioId, enUnaHora())}`,
    authAjeno: `Bearer ${forjarToken(usuarioAjenoId, enUnaHora())}`,
  };
}

/**
 * `GET /movimientos` con los parámetros dados, ya autenticado.
 *
 * ⚠️ EL CENTINELA DE «SIN TOKEN» ES `null`, NO `undefined`, y eso lo arregló la calibración.
 * Con `undefined` se disparaba EL VALOR POR DEFECTO del parámetro, así que
 * A1 y A15 mandaban el token mientras creían probar «sin cabecera Authorization». Contra el
 * módulo vacío los dos daban 404 y parecían rojos legítimos: el rojo era el correcto por la
 * razón equivocada.
 */
async function buscar(
  e: Escenario,
  params: Record<string, string> = {},
  autorizacion: string | null = e.auth,
): Promise<Respuesta> {
  const qs = new URLSearchParams({ cuentaId: e.cuentaId, ...params }).toString();
  return pedir('GET', `/movimientos?${qs}`, { autorizacion });
}

/** Igual que `buscar`, pero exige 200 y devuelve el cuerpo. */
async function buscarOk(
  e: Escenario,
  params: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const r = await buscar(e, params);
  expect(r.estado, `la búsqueda falló: ${JSON.stringify(r.cuerpo)}`).toBe(200);
  return r.cuerpo;
}

function filas(cuerpo: Record<string, unknown>): Array<Record<string, unknown>> {
  return (cuerpo['movimientos'] ?? []) as Array<Record<string, unknown>>;
}

/** Los ids devueltos, para comparar CONJUNTOS contra el oráculo del seed. */
function idsDe(cuerpo: Record<string, unknown>): string[] {
  return filas(cuerpo).map((m) => String(m['id']));
}

/** El oráculo: los ids sembrados que caen en un rango de días UTC, inclusive. */
function esperadosPorDia(e: Escenario, desde: string, hasta: string): string[] {
  const ini = Date.parse(`${desde}T00:00:00.000Z`);
  const fin = Date.parse(`${hasta}T23:59:59.999Z`);
  return e.movimientos
    .filter((m) => {
      const t = Date.parse(m.creadoEn);
      return t >= ini && t <= fin;
    })
    .map((m) => m.id);
}

/** El oráculo: los ids sembrados cuyo importe ABSOLUTO es el dado (J1 de la spec). */
function esperadosPorMonto(e: Escenario, centavos: bigint): string[] {
  return e.movimientos
    .filter((m) => {
      const v = BigInt(m.montoCentavos);
      return (v < 0n ? -v : v) === centavos;
    })
    .map((m) => m.id);
}

const ordenados = (xs: string[]): string[] => [...xs].sort();

/** El oráculo independiente de V1: cuántas filas hay, leídas sin pasar por el código auditado. */
async function conteoDelLedger(): Promise<{ mov: number; tx: number; claves: number }> {
  const [mov, tx, claves] = await Promise.all([
    prisma.movimiento.count(),
    prisma.transaccion.count(),
    prisma.claveIdempotencia.count(),
  ]);
  return { mov, tx, claves };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';

beforeAll(async () => {
  process.env['ZFB_AUTH_SECRET'] = SECRETO;
  process.env['ZFB_COSTURAS_PRUEBA'] = '1';
  app = await NestFactory.create(AppMovimientos, { logger: false });
  await app.listen(0);
  base = (await app.getUrl()).replace('[::1]', 'localhost');
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

// ═══ A · el token y la forma de los parámetros ═════════════════════════════════════════

describe('A · autenticación y validación de parámetros', () => {
  it('A1 · sin cabecera Authorization: 401 TOKEN_AUSENTE', async () => {
    const e = await sembrar();
    const r = await buscar(e, {}, null);
    expect(r.estado).toBe(401);
    expect(r.cuerpo['codigo']).toBe('TOKEN_AUSENTE');
  });

  it('A2 · token con firma ajena: 401 TOKEN_INVALIDO', async () => {
    const e = await sembrar();
    const impostor = `Bearer ${forjarToken(e.usuarioId, enUnaHora(), 'otro-secreto-cualquiera')}`;
    const r = await buscar(e, {}, impostor);
    expect(r.estado).toBe(401);
    expect(r.cuerpo['codigo']).toBe('TOKEN_INVALIDO');
  });

  it('A3 · token vencido: 401 TOKEN_EXPIRADO', async () => {
    const e = await sembrar();
    const vencido = `Bearer ${forjarToken(e.usuarioId, Math.floor(Date.now() / 1000) - 60)}`;
    const r = await buscar(e, {}, vencido);
    expect(r.estado).toBe(401);
    expect(r.cuerpo['codigo']).toBe('TOKEN_EXPIRADO');
  });

  it('A4 · sin cuentaId: 400 CUENTA_ID_REQUERIDO', async () => {
    const e = await sembrar();
    const r = await pedir('GET', '/movimientos', { autorizacion: e.auth });
    expect(r.estado).toBe(400);
    expect(r.cuerpo['codigo']).toBe('CUENTA_ID_REQUERIDO');
  });

  it('A5 · cuentaId vacío: 400 CUENTA_ID_REQUERIDO (la cadena vacía NO es «sin filtro»)', async () => {
    const e = await sembrar();
    const r = await pedir('GET', '/movimientos?cuentaId=', { autorizacion: e.auth });
    expect(r.estado).toBe(400);
    expect(r.cuerpo['codigo']).toBe('CUENTA_ID_REQUERIDO');
  });

  it('A6 · cuentaId que no es UUID: 400 CUENTA_ID_INVALIDO', async () => {
    const e = await sembrar();
    const r = await pedir('GET', '/movimientos?cuentaId=no-soy-un-uuid', {
      autorizacion: e.auth,
    });
    expect(r.estado).toBe(400);
    expect(r.cuerpo['codigo']).toBe('CUENTA_ID_INVALIDO');
  });

  it('A7 · cuentaId repetido (llega como arreglo): 400 CUENTA_ID_INVALIDO, no se toma el primero', async () => {
    const e = await sembrar();
    const r = await pedir(
      'GET',
      `/movimientos?cuentaId=${e.cuentaId}&cuentaId=${e.cuentaAjenaId}`,
      { autorizacion: e.auth },
    );
    expect(r.estado).toBe(400);
    expect(r.cuerpo['codigo']).toBe('CUENTA_ID_INVALIDO');
  });

  it('A8 · transaccionId que no es UUID: 400 TRANSACCION_ID_INVALIDO', async () => {
    const e = await sembrar();
    const r = await buscar(e, { transaccionId: 'abc' });
    expect(r.estado).toBe(400);
    expect(r.cuerpo['codigo']).toBe('TRANSACCION_ID_INVALIDO');
  });

  it('A9 · desde con formato inválido: 400 FECHA_INVALIDA', async () => {
    const e = await sembrar();
    const r = await buscar(e, { desde: '01-03-2026' });
    expect(r.estado).toBe(400);
    expect(r.cuerpo['codigo']).toBe('FECHA_INVALIDA');
  });

  it('A10 · fecha con forma correcta pero día inexistente (2026-02-30): 400 FECHA_INVALIDA', async () => {
    const e = await sembrar();
    const r = await buscar(e, { hasta: '2026-02-30' });
    expect(r.estado).toBe(400);
    expect(r.cuerpo['codigo']).toBe('FECHA_INVALIDA');
  });

  it('A11 · desde posterior a hasta: 400 RANGO_INVALIDO', async () => {
    const e = await sembrar();
    const r = await buscar(e, { desde: '2026-03-03', hasta: '2026-03-01' });
    expect(r.estado).toBe(400);
    expect(r.cuerpo['codigo']).toBe('RANGO_INVALIDO');
  });

  it('A12 · monto con signo: 400 MONTO_INVALIDO (D6: el signo no lo pone el input)', async () => {
    const e = await sembrar();
    const r = await buscar(e, { monto: '-25.00' });
    expect(r.estado).toBe(400);
    expect(r.cuerpo['codigo']).toBe('MONTO_INVALIDO');
  });

  it('A13 · monto no parseable: 400 MONTO_INVALIDO', async () => {
    const e = await sembrar();
    const r = await buscar(e, { monto: 'veinticinco' });
    expect(r.estado).toBe(400);
    expect(r.cuerpo['codigo']).toBe('MONTO_INVALIDO');
  });

  it('A14 · 400 ANTES que 404: parámetro malo sobre una cuenta que no existe da 400', async () => {
    // La precedencia es contrato (§ Precedencia). Si fuera al revés, un parámetro cualquiera
    // serviría de sonda para saber qué cuentas existen.
    const e = await sembrar();
    const r = await pedir('GET', `/movimientos?cuentaId=${UUID_INEXISTENTE}&monto=xx`, {
      autorizacion: e.auth,
    });
    expect(r.estado).toBe(400);
    expect(r.cuerpo['codigo']).toBe('MONTO_INVALIDO');
  });

  it('A15 · 401 ANTES que 400: sin token y con parámetro malo da 401', async () => {
    const e = await sembrar();
    const r = await buscar(e, { monto: 'xx' }, null);
    expect(r.estado).toBe(401);
    expect(r.cuerpo['codigo']).toBe('TOKEN_AUSENTE');
  });
});

// ═══ B · la búsqueda sin filtros y el contrato de la fila ══════════════════════════════

describe('B · sin filtros: la cuenta entera', () => {
  it('B1 · devuelve exactamente los 10 movimientos sembrados', async () => {
    const e = await sembrar();
    const c = await buscarOk(e);
    expect(ordenados(idsDe(c))).toEqual(ordenados(e.movimientos.map((m) => m.id)));
  });

  it('B2 · el contrato de la respuesta está completo', async () => {
    const e = await sembrar();
    const c = await buscarOk(e);
    expect(c['cuentaId']).toBe(e.cuentaId);
    expect(c['devueltos']).toBe(10);
    expect(c['hayMas']).toBe(false);
  });

  it('B3 · cada fila trae los cinco campos, y ninguno de más', async () => {
    const e = await sembrar();
    const c = await buscarOk(e);
    for (const m of filas(c)) {
      expect(Object.keys(m).sort()).toEqual(
        ['concepto', 'fecha', 'id', 'monto', 'transaccionId'].sort(),
      );
      expect(String(m['id'])).toMatch(UUID_REGEX);
      expect(String(m['transaccionId'])).toMatch(UUID_REGEX);
      expect(String(m['fecha'])).toMatch(ISO_REGEX);
      expect(m['concepto']).toBe('SIEMBRA_BUSQUEDA');
    }
  });

  it('B4 · los montos salen como string decimal CON signo (D1), nunca como number', async () => {
    const e = await sembrar();
    const c = await buscarOk(e);
    const porId = new Map(e.movimientos.map((m) => [m.id, BigInt(m.montoCentavos)]));
    for (const m of filas(c)) {
      expect(typeof m['monto'], `monto de ${String(m['id'])} no es string`).toBe('string');
      const centavos = porId.get(String(m['id']));
      const signo = (centavos ?? 0n) < 0n ? '-' : '';
      const abs = (centavos ?? 0n) < 0n ? -(centavos ?? 0n) : (centavos ?? 0n);
      const esperado = `${signo}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
      expect(m['monto']).toBe(esperado);
    }
  });

  it('B5 · una cuenta SIN movimientos: 200 con lista vacía, no 404', async () => {
    // La cuenta del sistema del escenario existe pero no es del titular; para una cuenta
    // propia y vacía se usa el escenario 'cuenta-unica', cuya segunda cuenta no tiene nada.
    const r = await pedir('POST', '/__test__/seed', { cuerpo: { escenario: 'dos-cuentas' } });
    expect(r.estado).toBe(201);
    const cuentas = r.cuerpo['cuentas'] as Array<Record<string, unknown>>;
    const auth = `Bearer ${forjarToken(String(r.cuerpo['usuarioId']), enUnaHora())}`;
    const vacia = String(cuentas[1]?.['id']);
    const c = await pedir('GET', `/movimientos?cuentaId=${vacia}`, { autorizacion: auth });
    expect(c.estado, JSON.stringify(c.cuerpo)).toBe(200);
    expect(c.cuerpo['devueltos']).toBe(0);
    expect(c.cuerpo['hayMas']).toBe(false);
    expect(filas(c.cuerpo)).toHaveLength(0);
  });
});

// ═══ C · el filtro por fecha ═══════════════════════════════════════════════════════════

describe('C · filtro por fecha, día completo UTC e inclusivo', () => {
  it('C1 · un día (desde=hasta) devuelve 3 de 10, no 10', async () => {
    const e = await sembrar();
    const c = await buscarOk(e, { desde: '2026-03-01', hasta: '2026-03-01' });
    const esperado = esperadosPorDia(e, '2026-03-01', '2026-03-01');
    expect(esperado).toHaveLength(3);
    expect(ordenados(idsDe(c))).toEqual(ordenados(esperado));
  });

  it('C2 · el día incluye su borde inferior, 00:00:00.000Z', async () => {
    const e = await sembrar();
    const c = await buscarOk(e, { desde: '2026-03-01', hasta: '2026-03-01' });
    const borde = e.movimientos.find((m) => m.creadoEn === '2026-03-01T00:00:00.000Z');
    // El `toHaveLength` no es adorno: sin él, un endpoint que devuelve TODO también contiene
    // el borde y el brazo pasa sin filtrar nada. Medido en la calibración.
    expect(filas(c)).toHaveLength(3);
    expect(idsDe(c)).toContain(borde?.id);
  });

  it('C3 · el día incluye su borde superior, 23:59:59.999Z', async () => {
    const e = await sembrar();
    const c = await buscarOk(e, { desde: '2026-03-01', hasta: '2026-03-01' });
    const borde = e.movimientos.find((m) => m.creadoEn === '2026-03-01T23:59:59.999Z');
    expect(filas(c)).toHaveLength(3);
    expect(idsDe(c)).toContain(borde?.id);
  });

  it('C4 · un rango de dos días devuelve 6 de 10', async () => {
    const e = await sembrar();
    const c = await buscarOk(e, { desde: '2026-03-01', hasta: '2026-03-02' });
    const esperado = esperadosPorDia(e, '2026-03-01', '2026-03-02');
    expect(esperado).toHaveLength(6);
    expect(ordenados(idsDe(c))).toEqual(ordenados(esperado));
  });

  it('C5 · sólo desde: filtra por un extremo', async () => {
    // ⚠️ CORREGIDO: el número
    // decía 3 y la población tiene 4 movimientos desde el 2026-03-03 (los tres de ese día más
    // el del 04): el caso moría en su propio control del oráculo SIN LLEGAR a contrastar la
    // respuesta del endpoint. Sobrevivió a las dos calibraciones
    // porque contra el módulo vacío moría antes en el 404, y la corrida contra la degenerada
    // se leyó por sus VERDES en vez de por el motivo de cada rojo.
    // Se corrige el dato, NO la exigencia: la igualdad exacta de conjuntos sigue intacta.
    const e = await sembrar();
    const c = await buscarOk(e, { desde: '2026-03-03' });
    const esperado = esperadosPorDia(e, '2026-03-03', '2999-12-31');
    expect(esperado).toHaveLength(4);
    expect(ordenados(idsDe(c))).toEqual(ordenados(esperado));
  });

  it('C6 · sólo hasta: filtra por el otro extremo', async () => {
    const e = await sembrar();
    const c = await buscarOk(e, { hasta: '2026-03-01' });
    const esperado = esperadosPorDia(e, '1970-01-01', '2026-03-01');
    expect(esperado).toHaveLength(3);
    expect(ordenados(idsDe(c))).toEqual(ordenados(esperado));
  });

  it('C7 · un rango sin nada dentro: 200 con lista vacía', async () => {
    const e = await sembrar();
    const c = await buscarOk(e, { desde: '2026-01-01', hasta: '2026-01-31' });
    expect(filas(c)).toHaveLength(0);
    expect(c['devueltos']).toBe(0);
    expect(c['hayMas']).toBe(false);
  });

  it('C8 · el día siguiente al último NO arrastra el movimiento del día anterior', async () => {
    // El error clásico del rango exclusivo/inclusivo mal puesto: un `< hasta` en vez de
    // `<= fin del día` se lleva o deja fuera exactamente una fila.
    const e = await sembrar();
    const c = await buscarOk(e, { desde: '2026-03-04', hasta: '2026-03-04' });
    const esperado = esperadosPorDia(e, '2026-03-04', '2026-03-04');
    expect(esperado).toHaveLength(1);
    expect(idsDe(c)).toEqual(esperado);
  });
});

// ═══ D · el filtro por monto ═══════════════════════════════════════════════════════════

describe('D · filtro por monto, importe absoluto (J1)', () => {
  it('D1 · monto 25.00 devuelve 3 de 10: dos débitos y un crédito', async () => {
    const e = await sembrar();
    const c = await buscarOk(e, { monto: '25.00' });
    const esperado = esperadosPorMonto(e, 2500n);
    expect(esperado).toHaveLength(3);
    expect(ordenados(idsDe(c))).toEqual(ordenados(esperado));
  });

  it('D2 · el resultado de 25.00 trae los DOS signos: el filtro no confunde signo con importe', async () => {
    const e = await sembrar();
    const c = await buscarOk(e, { monto: '25.00' });
    const montos = filas(c).map((m) => String(m['monto']));
    expect(montos.filter((m) => m.startsWith('-')).length).toBe(2);
    expect(montos.filter((m) => !m.startsWith('-')).length).toBe(1);
  });

  it('D3 · un importe con céntimos no redondos (123.45) casa exacto', async () => {
    const e = await sembrar();
    const c = await buscarOk(e, { monto: '123.45' });
    const esperado = esperadosPorMonto(e, 12345n);
    expect(esperado).toHaveLength(1);
    expect(idsDe(c)).toEqual(esperado);
  });

  it('D4 · un importe grande (999.99) casa exacto y no por prefijo', async () => {
    const e = await sembrar();
    const c = await buscarOk(e, { monto: '999.99' });
    const esperado = esperadosPorMonto(e, 99999n);
    expect(esperado).toHaveLength(1);
    expect(idsDe(c)).toEqual(esperado);
  });

  it('D5 · un importe que no existe: 200 con lista vacía', async () => {
    const e = await sembrar();
    const c = await buscarOk(e, { monto: '777.77' });
    expect(filas(c)).toHaveLength(0);
  });

  it('D6 · 0.01 casa el movimiento de un centavo, y sólo ése', async () => {
    const e = await sembrar();
    const c = await buscarOk(e, { monto: '0.01' });
    const esperado = esperadosPorMonto(e, 1n);
    expect(esperado).toHaveLength(1);
    expect(idsDe(c)).toEqual(esperado);
  });
});

// ═══ E · el filtro por transacción ═════════════════════════════════════════════════════

describe('E · filtro por transacción', () => {
  it('E1 · devuelve UNA fila, no las dos patas del asiento', async () => {
    // La transacción tiene dos movimientos: el de la cuenta del titular y su contrapartida en
    // la cuenta de sistema. El cliente sólo ve el suyo (M1). Si saliera la contraparte, este
    // caso es el único que lo vería.
    const e = await sembrar();
    const uno = e.movimientos[0];
    const c = await buscarOk(e, { transaccionId: String(uno?.transaccionId) });
    expect(filas(c)).toHaveLength(1);
    expect(idsDe(c)).toEqual([uno?.id]);
  });

  it('E2 · la fila devuelta trae ese mismo transaccionId', async () => {
    const e = await sembrar();
    const uno = e.movimientos[4];
    const c = await buscarOk(e, { transaccionId: String(uno?.transaccionId) });
    expect(filas(c)[0]?.['transaccionId']).toBe(uno?.transaccionId);
  });

  it('E3 · una transacción inexistente: 200 con lista vacía, NO 404', async () => {
    const e = await sembrar();
    const c = await buscarOk(e, { transaccionId: UUID_INEXISTENTE });
    expect(filas(c)).toHaveLength(0);
  });

  it('E4 · la transacción de OTRA cuenta no devuelve nada desde esta cuenta', async () => {
    // Combina las dos líneas rojas: aunque el id de transacción sea real, si su movimiento
    // no es de `cuentaId` no sale. Es lo que impide usar el filtro para leer cuentas ajenas.
    const e = await sembrar();
    const ajena = await pedir('POST', '/__test__/seed', {
      cuerpo: { escenario: 'movimientos-buscables' },
    });
    const otro = (ajena.cuerpo['movimientos'] as MovimientoSembrado[])[0];
    const c = await buscarOk(e, { transaccionId: String(otro?.transaccionId) });
    expect(filas(c)).toHaveLength(0);
  });
});

// ═══ F · los filtros se acumulan (AND) ═════════════════════════════════════════════════

describe('F · combinación de filtros con AND (M6)', () => {
  it('F1 · día 03-01 AND monto 25.00 devuelve 1, no 3 ni 3', async () => {
    // EL BRAZO CENTRAL DEL ARNÉS. Los dos filtros por separado devuelven 3 cada uno; su AND
    // devuelve 1. Un endpoint que ignore CUALQUIERA de los dos da 3 y este caso se pone rojo.
    // Sin él, una implementación que aplica sólo el primer filtro pasaría todo lo demás.
    const e = await sembrar();
    const soloDia = await buscarOk(e, { desde: '2026-03-01', hasta: '2026-03-01' });
    const soloMonto = await buscarOk(e, { monto: '25.00' });
    expect(filas(soloDia)).toHaveLength(3);
    expect(filas(soloMonto)).toHaveLength(3);

    const ambos = await buscarOk(e, {
      desde: '2026-03-01',
      hasta: '2026-03-01',
      monto: '25.00',
    });
    const esperado = esperadosPorDia(e, '2026-03-01', '2026-03-01').filter((id) =>
      esperadosPorMonto(e, 2500n).includes(id),
    );
    expect(esperado).toHaveLength(1);
    expect(idsDe(ambos)).toEqual(esperado);
  });

  it('F2 · transaccionId AND un rango que NO lo contiene devuelve vacío', async () => {
    const e = await sembrar();
    const uno = e.movimientos[0]; // 2026-03-01
    const c = await buscarOk(e, {
      transaccionId: String(uno?.transaccionId),
      desde: '2026-03-03',
      hasta: '2026-03-03',
    });
    expect(filas(c)).toHaveLength(0);
  });

  it('F3 · los tres filtros a la vez, coherentes entre sí, devuelven la fila exacta', async () => {
    const e = await sembrar();
    const uno = e.movimientos[5]; // 2026-03-02T18:45 · -12345
    const dia = String(uno?.creadoEn).slice(0, 10);
    const c = await buscarOk(e, {
      transaccionId: String(uno?.transaccionId),
      desde: dia,
      hasta: dia,
      monto: '123.45',
    });
    expect(idsDe(c)).toEqual([uno?.id]);
  });

  it('F4 · un parámetro desconocido se ignora, no inventa un 400', async () => {
    const e = await sembrar();
    const qs = new URLSearchParams({ cuentaId: e.cuentaId, foo: 'bar' }).toString();
    const r = await pedir('GET', `/movimientos?${qs}`, { autorizacion: e.auth });
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(200);
    expect(r.cuerpo['devueltos']).toBe(10);
  });
});

// ═══ G · titularidad: lo ajeno y lo inexistente responden IGUAL ════════════════════════

describe('G · titularidad', () => {
  it('G1 · una cuenta ajena responde 404 CUENTA_NO_ENCONTRADA', async () => {
    const e = await sembrar();
    const r = await pedir('GET', `/movimientos?cuentaId=${e.cuentaAjenaId}`, {
      autorizacion: e.auth,
    });
    expect(r.estado).toBe(404);
    expect(r.cuerpo['codigo']).toBe('CUENTA_NO_ENCONTRADA');
  });

  it('G2 · una cuenta inexistente responde EXACTAMENTE lo mismo', async () => {
    // Idéntico a G1 a propósito: un 403 en G1 confirmaría que la cuenta existe y dejaría
    // barrer el espacio de ids (misma línea roja de S-12 y S-09).
    const e = await sembrar();
    const r = await pedir('GET', `/movimientos?cuentaId=${UUID_INEXISTENTE}`, {
      autorizacion: e.auth,
    });
    expect(r.estado).toBe(404);
    expect(r.cuerpo['codigo']).toBe('CUENTA_NO_ENCONTRADA');
  });

  it('G3 · ningún resultado del titular pertenece a la cuenta ajena (V2)', async () => {
    const e = await sembrar();
    const c = await buscarOk(e);
    const idsAjenos = new Set(
      (
        await prisma.movimiento.findMany({
          where: { cuentaId: e.cuentaAjenaId },
          select: { id: true },
        })
      ).map((m) => m.id),
    );
    expect(idsAjenos.size).toBe(3);
    for (const id of idsDe(c)) expect(idsAjenos.has(id)).toBe(false);
  });

  it('G4 · el filtro por día NO se lleva los movimientos ajenos que caen ese mismo día', async () => {
    // ⚠️ ENUNCIADO CORREGIDO. Este brazo decía medir la
    // TITULARIDAD y no la mide: la consulta filtra por `cuentaId`, así que quitar la
    // comprobación de titular no cambia nada para la cuenta propia — se inyectó el defecto y
    // G4 siguió verde. El comentario anterior explicaba con seguridad algo que era falso, que
    // es el mismo defecto en otra forma: un brazo con buena letra que no caza lo que
    // dice cazar. La titularidad la miden G1, G2 y G6.
    // Lo que ESTE brazo caza de verdad, y está medido: que la consulta NO IGNORE `cuentaId`.
    // Los 2 movimientos ajenos del 2026-03-01 colisionan a propósito con los 3 propios, así
    // que un `where` sin `cuentaId` devuelve 5 y el brazo se pone rojo (defecto D8 de la
    // calibración). Sin la colisión, ese defecto pasaría entero.
    const e = await sembrar();
    const c = await buscarOk(e, { desde: '2026-03-01', hasta: '2026-03-01' });
    expect(filas(c)).toHaveLength(3);
  });

  it('G5 · el filtro por monto tampoco se lleva el ajeno de ese mismo importe', async () => {
    // Mismo caso que G4 por el otro filtro: caza que la consulta no ignore `cuentaId`, no la
    // titularidad. Ver la nota de G4.
    const e = await sembrar();
    const c = await buscarOk(e, { monto: '25.00' });
    expect(filas(c)).toHaveLength(3);
  });

  it('G6 · el titular ajeno SÍ ve su propia cuenta', async () => {
    // Control negativo del control: si G1 diera 404 porque el endpoint devuelve 404 para
    // todo, este caso lo destapa. Un control que no puede pasar no negó nada.
    const e = await sembrar();
    const r = await pedir('GET', `/movimientos?cuentaId=${e.cuentaAjenaId}`, {
      autorizacion: e.authAjeno,
    });
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(200);
    expect(r.cuerpo['devueltos']).toBe(3);
  });
});

// ═══ H · el tope y el orden ════════════════════════════════════════════════════════════

describe('H · tope duro de 50 y orden declarado', () => {
  it('H1 · 51 disponibles devuelven exactamente 50 y hayMas=true', async () => {
    const e = await sembrar();
    const c = await pedir('GET', `/movimientos?cuentaId=${e.cuentaTopeId}`, {
      autorizacion: e.auth,
    });
    expect(c.estado, JSON.stringify(c.cuerpo)).toBe(200);
    expect(filas(c.cuerpo)).toHaveLength(TOPE);
    expect(c.cuerpo['devueltos']).toBe(TOPE);
    expect(c.cuerpo['hayMas']).toBe(true);
  });

  it('H2 · con 10 disponibles hayMas es false: no está cableado a true', async () => {
    const e = await sembrar();
    const c = await buscarOk(e);
    expect(c['hayMas']).toBe(false);
  });

  it('H3 · el orden es fecha DESCENDENTE', async () => {
    const e = await sembrar();
    const c = await buscarOk(e);
    const fechas = filas(c).map((m) => Date.parse(String(m['fecha'])));
    for (let i = 1; i < fechas.length; i++) {
      expect(fechas[i - 1] ?? 0).toBeGreaterThanOrEqual(fechas[i] ?? 0);
    }
    expect(String(filas(c)[0]?.['fecha'])).toBe('2026-03-04T00:00:00.000Z');
  });

  it('H4 · fecha DESCENDENTE y, a igualdad exacta de fecha, el desempate es id ASCENDENTE', async () => {
    // D15. La cuenta del tope tiene 50 movimientos en el MISMO instante
    // exacto y UNO 1 h más nuevo. La más nueva sale primera (fecha descendente); las 50 empatadas
    // van detrás y, sin desempate, su orden lo decide el planificador de Postgres y una
    // aserción sobre movimientos[0] es un intermitente esperando a ocurrir (C2).
    const e = await sembrar();
    const c = await pedir('GET', `/movimientos?cuentaId=${e.cuentaTopeId}`, {
      autorizacion: e.auth,
    });
    const ids = idsDe(c.cuerpo);
    expect(ids).toHaveLength(TOPE);
    const nueva = await prisma.movimiento.findFirst({
      where: { cuentaId: e.cuentaTopeId },
      orderBy: { creadoEn: 'desc' },
      select: { id: true },
    });
    expect(ids[0]).toBe(nueva?.id);
    expect(ids.slice(1)).toEqual([...ids.slice(1)].sort());
  });

  it('H5 · el orden es ESTABLE entre dos llamadas idénticas', async () => {
    // ⚠️ ENDURECIDO EN LA CALIBRACIÓN. La primera versión sólo
    // comparaba las dos respuestas entre sí, y con el módulo VACÍO las dos daban 404 con lista
    // vacía: `[] === []` y el brazo pasaba en verde sin que el endpoint existiera. Era el
    // único de los 57 que pasaba contra el módulo vacío — un control que no puede fallar es
    // decoración. Ahora exige 200 y las 50 filas ANTES de comparar, así que sin implementación
    // se pone rojo como los demás.
    const e = await sembrar();
    const a = await pedir('GET', `/movimientos?cuentaId=${e.cuentaTopeId}`, {
      autorizacion: e.auth,
    });
    const b = await pedir('GET', `/movimientos?cuentaId=${e.cuentaTopeId}`, {
      autorizacion: e.auth,
    });
    expect(a.estado, JSON.stringify(a.cuerpo)).toBe(200);
    expect(b.estado, JSON.stringify(b.cuerpo)).toBe(200);
    expect(idsDe(a.cuerpo)).toHaveLength(TOPE);
    expect(idsDe(a.cuerpo)).toEqual(idsDe(b.cuerpo));
  });

  it('H6 · el tope se aplica DESPUÉS de ordenar, no antes', async () => {
    // Si se topara antes de ordenar, las 50 filas devueltas serían 50 cualesquiera de las 51.
    // D15: la más nueva entra siempre, y con el desempate ascendente la fila que queda
    // fuera tiene que ser EXACTAMENTE la mayor por id ENTRE LAS 50 EMPATADAS (el corte cae
    // dentro del empate, así que el desempate sigue siendo lo que decide quién sobra).
    const e = await sembrar();
    const c = await pedir('GET', `/movimientos?cuentaId=${e.cuentaTopeId}`, {
      autorizacion: e.auth,
    });
    const todos = await prisma.movimiento.findMany({
      where: { cuentaId: e.cuentaTopeId },
      select: { id: true, creadoEn: true },
    });
    expect(todos).toHaveLength(51);
    const instanteMax = Math.max(...todos.map((m) => m.creadoEn.getTime()));
    const nuevas = todos.filter((m) => m.creadoEn.getTime() === instanteMax);
    expect(nuevas, 'la cuenta del tope debe tener UNA sola fila más nueva').toHaveLength(1);
    const empatadas = todos
      .filter((m) => m.creadoEn.getTime() !== instanteMax)
      .map((m) => m.id)
      .sort();
    expect(empatadas).toHaveLength(50);
    const esperados = [String(nuevas[0]?.id), ...empatadas.slice(0, TOPE - 1)];
    expect(idsDe(c.cuerpo)).toEqual(esperados);
  });

  it('H7 · el tope también aplica con filtros puestos', async () => {
    const e = await sembrar();
    const c = await pedir(
      'GET',
      `/movimientos?cuentaId=${e.cuentaTopeId}&monto=1.00&desde=2026-04-01&hasta=2026-04-01`,
      { autorizacion: e.auth },
    );
    expect(filas(c.cuerpo)).toHaveLength(TOPE);
    expect(c.cuerpo['hayMas']).toBe(true);
  });
});

// ═══ I · V1: esto es LECTURA, y no escribe nada ════════════════════════════════════════

describe('I · la búsqueda no escribe (V1)', () => {
  it('I1 · doce búsquedas variadas dejan el ledger con el MISMO número de filas', async () => {
    const e = await sembrar();
    const antes = await conteoDelLedger();
    await buscarOk(e);
    await buscarOk(e, { desde: '2026-03-01', hasta: '2026-03-02' });
    await buscarOk(e, { monto: '25.00' });
    await buscarOk(e, { transaccionId: String(e.movimientos[0]?.transaccionId) });
    await buscarOk(e, { desde: '2026-03-01', hasta: '2026-03-01', monto: '25.00' });
    await buscar(e, { monto: 'xx' });
    await buscar(e, {}, null);
    await pedir('GET', `/movimientos?cuentaId=${UUID_INEXISTENTE}`, { autorizacion: e.auth });
    await pedir('GET', `/movimientos?cuentaId=${e.cuentaAjenaId}`, { autorizacion: e.auth });
    await pedir('GET', `/movimientos?cuentaId=${e.cuentaTopeId}`, { autorizacion: e.auth });
    await buscarOk(e, { monto: '0.01' });
    await buscarOk(e, { desde: '2026-01-01', hasta: '2026-01-31' });
    const despues = await conteoDelLedger();
    expect(despues).toEqual(antes);
  });

  it('I2 · no crea claves de idempotencia: este POST-que-no-es-POST no las lleva', async () => {
    const e = await sembrar();
    const antes = (await conteoDelLedger()).claves;
    await buscarOk(e);
    expect((await conteoDelLedger()).claves).toBe(antes);
  });
});
