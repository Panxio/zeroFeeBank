import { Module, type INestApplication } from '@nestjs/common';
import { APP_FILTER, NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroresHttpFilter } from '../src/infra/errores-http.filter.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { CosturasModule } from '../src/modules/costuras/costuras.module.js';
import { MovimientosModule } from '../src/modules/movimientos/movimientos.module.js';

/**
 * Arnés de S-28 · el seed `movimientos-buscables` devuelve una credencial usable.
 * Ver specs/S-28-credencial-movimientos.md. ESTE ARCHIVO NO SE TOCA (specs/_CANDADO.md).
 *
 * ─── Por qué existe en un archivo propio ────────────────────────────────────────────────
 * `test/costuras.int.spec.ts` es el árbitro de S-07 y tiene candado. Esta unidad agrega un
 * campo a UN escenario, así que trae su propio archivo en vez de tocar aquél.
 *
 * ─── Qué mide, y por qué no basta con mirar la respuesta ────────────────────────────────
 * El defecto que esta unidad cierra NO era un campo ausente: era una credencial que existe
 * en el papel y no sirve para entrar. Por eso ningún caso de acá se conforma con que el JSON
 * traiga `credenciales`: cada uno **la usa**. K1 entra por `POST /auth/login`, que es la
 * misma puerta que usará la suite E2E, y K2 le pide al token los movimientos del oráculo.
 * Un brazo que sólo afirmara la forma del JSON dejaría vivo exactamente el bug de origen.
 *
 * ─── Por qué habla por HTTP ─────────────────────────────────────────────────────────────
 * Lo que la pantalla necesita es la ruta completa seed → login → consulta. Un test contra el
 * servicio saltaría el guardia de autenticación, que es justo la parte que estaba rota.
 */

const prisma = new PrismaService();
let app: INestApplication;
let base = '';

@Module({
  imports: [CosturasModule.paraEntorno(), AuthModule, MovimientosModule],
  providers: [{ provide: APP_FILTER, useClass: ErroresHttpFilter }],
})
class AppCredenciales {}

type Respuesta = { estado: number; cuerpo: Record<string, unknown> };

async function pedir(
  metodo: string,
  ruta: string,
  opciones: { cuerpo?: unknown; autorizacion?: string } = {},
): Promise<Respuesta> {
  const headers: Record<string, string> = {};
  if (opciones.cuerpo !== undefined) headers['content-type'] = 'application/json';
  if (opciones.autorizacion !== undefined) headers['authorization'] = opciones.autorizacion;
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

interface Sembrado {
  estado: number;
  cuerpo: Record<string, unknown>;
  email: string;
  password: string;
  cuentaBuscableId: string;
  cuentaAjenaId: string;
  movimientos: Array<Record<string, unknown>>;
}

/**
 * Siembra el escenario y AFIRMA los límites del propio contrato antes de devolverlo
 * (regla del repositorio: «todo dato de preparación se construye con una función que afirma
 * los límites del propio contrato»). Sin esto, un seed que devolviera `credenciales: {}`
 * haría que los casos de abajo fallaran por `undefined` y el rojo no diría qué pasó.
 */
async function sembrar(): Promise<Sembrado> {
  const r = await pedir('POST', '/__test__/seed', {
    cuerpo: { escenario: 'movimientos-buscables' },
  });
  expect(r.estado, `el seed no respondió 201: ${JSON.stringify(r.cuerpo)}`).toBe(201);
  const credenciales = r.cuerpo['credenciales'] as Record<string, unknown> | undefined;
  expect(credenciales, 'el seed no devolvió `credenciales`').toBeTypeOf('object');
  const email = credenciales?.['email'];
  const password = credenciales?.['password'];
  expect(typeof email, 'credenciales.email no es un string').toBe('string');
  expect(typeof password, 'credenciales.password no es un string').toBe('string');
  const cuentas = (r.cuerpo['cuentas'] ?? []) as Array<Record<string, unknown>>;
  expect(cuentas.length, 'el escenario ya no devuelve sus 3 cuentas').toBe(3);
  const movimientos = (r.cuerpo['movimientos'] ?? []) as Array<Record<string, unknown>>;
  return {
    estado: r.estado,
    cuerpo: r.cuerpo,
    email: String(email),
    password: String(password),
    cuentaBuscableId: String(cuentas[0]?.['id']),
    cuentaAjenaId: String(r.cuerpo['cuentaAjenaId']),
    movimientos,
  };
}

async function entrar(email: string, password: string): Promise<Respuesta> {
  return pedir('POST', '/auth/login', { cuerpo: { email, password } });
}

beforeAll(async () => {
  process.env['ZFB_COSTURAS_PRUEBA'] = '1';
  app = await NestFactory.create(AppCredenciales, { logger: false });
  await app.listen(0);
  base = await app.getUrl();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

// ═══ K · S-28 · la credencial del oráculo de pantalla ══════════════════════════════════

describe('K · S-28 · seed movimientos-buscables con credencial', () => {
  it('K1 · S28-I1 · la credencial que devuelve el seed ENTRA por /auth/login', async () => {
    const s = await sembrar();
    const login = await entrar(s.email, s.password);
    expect(login.estado, `el login falló: ${JSON.stringify(login.cuerpo)}`).toBe(200);
    expect(typeof login.cuerpo['token'], 'el login no devolvió token').toBe('string');
    expect(String(login.cuerpo['token']).length).toBeGreaterThan(0);
  });

  it('K2 · S28-I2 · ese token ve los 10 movimientos que el propio seed declaró', async () => {
    const s = await sembrar();
    const login = await entrar(s.email, s.password);
    expect(login.estado, JSON.stringify(login.cuerpo)).toBe(200);
    const auth = `Bearer ${String(login.cuerpo['token'])}`;

    const r = await pedir('GET', `/movimientos?cuentaId=${s.cuentaBuscableId}`, {
      autorizacion: auth,
    });
    expect(r.estado, `la consulta falló: ${JSON.stringify(r.cuerpo)}`).toBe(200);
    const devueltos = (r.cuerpo['movimientos'] ?? []) as Array<Record<string, unknown>>;

    // El oráculo es lo que declaró el SEED, no lo que devuelve la consulta: comparar la
    // consulta consigo misma no tendría dientes.
    expect(s.movimientos.length, 'el seed ya no declara 10 movimientos').toBe(10);
    const esperados = s.movimientos.map((m) => String(m['id'])).sort();
    const obtenidos = devueltos.map((m) => String(m['id'])).sort();
    expect(obtenidos).toEqual(esperados);
  });

  it('K3 · S28-I3 · dos seed seguidos dan emails y claves DISTINTOS (J7)', async () => {
    const a = await sembrar();
    const b = await sembrar();
    expect(a.email).not.toBe(b.email);
    expect(a.password).not.toBe(b.password);
    // Y la clave del primero no entra como el segundo: son titulares distintos de verdad.
    const cruzado = await entrar(b.email, a.password);
    expect(cruzado.estado, 'la clave de un seed entró en otro').not.toBe(200);
  });

  it('K4 · S28-I4 · el titular AJENO no quedó abierto', async () => {
    const s = await sembrar();
    const ajena = await prisma.cuenta.findUnique({ where: { id: s.cuentaAjenaId } });
    expect(ajena, 'no existe la cuenta ajena del escenario').not.toBeNull();
    const titularAjenoId = String(ajena?.titularId);
    expect(titularAjenoId, 'la cuenta ajena no tiene titular').not.toBe('null');
    const ajeno = await prisma.usuario.findUnique({ where: { id: titularAjenoId } });
    expect(ajeno?.email, 'no existe el usuario ajeno').toBeTypeOf('string');

    // Su hash sigue siendo el inutilizable, y ninguna clave conocida lo abre.
    expect(ajeno?.passwordHash).toBe('!NO-UTILIZABLE-S07!');
    const intento = await entrar(String(ajeno?.email), s.password);
    expect(intento.estado, 'se pudo entrar como el titular ajeno').not.toBe(200);
  });

  it('K5 · S28-I5 · el resto de la respuesta no se movió: 3 cuentas, 4 ids y los 10 movimientos', async () => {
    const s = await sembrar();
    const cuentas = s.cuerpo['cuentas'] as Array<Record<string, unknown>>;
    expect(cuentas.map((c) => c['tipo'])).toEqual(['CORRIENTE', 'CORRIENTE', 'CORRIENTE']);
    for (const clave of ['usuarioId', 'cuentaSistemaId', 'usuarioAjenoId', 'cuentaAjenaId', 'cuentaTopeId']) {
      expect(typeof s.cuerpo[clave], `falta ${clave} en la respuesta del seed`).toBe('string');
    }
    expect(s.movimientos.length).toBe(10);
    // Los 10 movimientos declarados existen en la base, en la cuenta buscable.
    for (const m of s.movimientos) {
      const fila = await prisma.movimiento.findUnique({ where: { id: String(m['id']) } });
      expect(fila, `el movimiento ${String(m['id'])} no está en la base`).not.toBeNull();
      expect(fila?.cuentaId).toBe(s.cuentaBuscableId);
      expect(fila?.montoCentavos.toString()).toBe(String(m['montoCentavos']));
    }
  });

  it('K6 · el usuario del seed NO queda con el hash inutilizable (el defecto de origen)', async () => {
    const s = await sembrar();
    const usuario = await prisma.usuario.findUnique({ where: { email: s.email } });
    expect(usuario, 'no existe el titular sembrado').not.toBeNull();
    expect(usuario?.passwordHash, 'el titular del oráculo sigue con el hash inutilizable').not.toBe(
      '!NO-UTILIZABLE-S07!',
    );
  });
});
