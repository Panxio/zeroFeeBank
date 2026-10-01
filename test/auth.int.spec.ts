import { createHmac, randomUUID } from 'node:crypto';
import { Module, type INestApplication } from '@nestjs/common';
import { APP_FILTER, NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ErroresHttpFilter } from '../src/infra/errores-http.filter.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';

/**
 * Arnés de S-08 · registro, login y el token. Ver specs/S-08-auth.md.
 * ESTE ARCHIVO NO SE TOCA (specs/_CANDADO.md).
 *
 * ─── Por qué habla por HTTP ─────────────────────────────────────────────────────────────
 * Los códigos de error tipados (C5) y los estados HTTP sólo existen del otro lado del
 * filtro. Un test que llamara al servicio vería la excepción, no el 401 — y el mapa de
 * códigos a estados vive en src/infra/errores-http.filter.ts, que este arnés SÍ atraviesa.
 *
 * ─── Por qué forja un token a mano ──────────────────────────────────────────────────────
 * El vencimiento no se puede probar esperando una hora, y este módulo no conoce el reloj
 * inyectable (viaja en la unidad paralela S-07). Así que el arnés construye el token con el
 * formato de la Decisión 2 de la spec y un `exp` en el pasado. Es una reimplementación
 * INDEPENDIENTE a propósito: no comparte los errores de la implementación que audita.
 *
 * ─── Por qué no borra la base ───────────────────────────────────────────────────────────
 * El ledger es append-only y el reset es una costura de otra unidad. Cada caso usa un
 * email único, así que las corridas no se pisan.
 */

const prisma = new PrismaService();
let app: INestApplication;
let base = '';

/** El secreto lo fija el arnés: si dependiera del .env de cada máquina, no mediría lo mismo. */
const SECRETO = 'arnes-s08-secreto-de-pruebas-32-min-ok';
const VIGENCIA_MINUTOS_ESPERADA = 60;
const PASSWORD = 'clave-de-prueba-larga';

@Module({
  imports: [AuthModule],
  providers: [{ provide: APP_FILTER, useClass: ErroresHttpFilter }],
})
class AppAuth {}

// ─── utilidades ────────────────────────────────────────────────────────────────────────

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

function emailUnico(prefijo = 'ana'): string {
  return `${prefijo}-${randomUUID()}@ejemplo.cl`;
}

const b64url = (b: Buffer): string => b.toString('base64url');

/** El formato de la Decisión 2, reimplementado a mano por el arnés. */
function forjarToken(sub: string, expEpochSegundos: number): string {
  const carga = b64url(Buffer.from(JSON.stringify({ sub, exp: expEpochSegundos })));
  const firma = b64url(createHmac('sha256', SECRETO).update(carga).digest());
  return `${carga}.${firma}`;
}

function leerCarga(token: string): Record<string, unknown> {
  const [carga] = token.split('.');
  return JSON.parse(Buffer.from(String(carga), 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
}

async function registrar(email: string, password = PASSWORD): Promise<Respuesta> {
  return pedir('POST', '/auth/registro', { cuerpo: { email, password } });
}

async function entrar(email: string, password = PASSWORD): Promise<string> {
  const r = await pedir('POST', '/auth/login', { cuerpo: { email, password } });
  expect(r.estado, `el login de ${email} falló: ${JSON.stringify(r.cuerpo)}`).toBe(200);
  return String(r.cuerpo['token']);
}

beforeAll(async () => {
  process.env['ZFB_AUTH_SECRET'] = SECRETO;
  app = await NestFactory.create(AppAuth, { logger: false });
  await app.listen(0);
  base = (await app.getUrl()).replace('[::1]', 'localhost');
});

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

// ─── B1 · el registro, y que la contraseña no quede escrita en ninguna parte ───────────

describe('B1 · registro', () => {
  it('crea el usuario, devuelve su id y el email normalizado', async () => {
    const email = emailUnico();
    const r = await registrar(`  ${email.toUpperCase()}  `);
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(201);

    const enBase = await prisma.usuario.findUnique({ where: { email } });

    expect({
      estado: r.estado,
      email: r.cuerpo['email'],
      idEsElDeLaBase: r.cuerpo['id'] === enBase?.id,
      traeCreadoEn: typeof r.cuerpo['creadoEn'] === 'string',
      noDevuelveHash: !('passwordHash' in r.cuerpo) && !('password' in r.cuerpo),
    }).toEqual({
      estado: 201,
      email,
      idEsElDeLaBase: true,
      traeCreadoEn: true,
      noDevuelveHash: true,
    });
  });

  it('V1+V2 · la clave no se guarda en claro, y dos claves iguales dan hashes distintos', async () => {
    const a = emailUnico('uno');
    const b = emailUnico('dos');
    await registrar(a);
    await registrar(b);
    const ua = await prisma.usuario.findUnique({ where: { email: a } });
    const ub = await prisma.usuario.findUnique({ where: { email: b } });

    expect({
      contieneLaClaveEnClaro: String(ua?.passwordHash).includes(PASSWORD),
      hashesDistintos: ua?.passwordHash !== ub?.passwordHash,
      // El formato de la Decisión 1 lleva los parámetros DENTRO del campo.
      formato: /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(
        String(ua?.passwordHash),
      ),
    }).toEqual({ contieneLaClaveEnClaro: false, hashesDistintos: true, formato: true });
  });

  it('V7 · el mismo email en otra caja y con espacios es el MISMO usuario', async () => {
    const email = emailUnico('caja');
    const primero = await registrar(email);
    const segundo = await registrar(`  ${email.toUpperCase()} `);
    const cuantos = await prisma.usuario.count({ where: { email } });

    expect({
      primero: primero.estado,
      segundo: [segundo.estado, segundo.cuerpo['codigo']],
      cuantos,
    }).toEqual({ primero: 201, segundo: [409, 'EMAIL_YA_REGISTRADO'], cuantos: 1 });
  });
});

// ─── B2 · la validación del cuerpo, y su ORDEN ─────────────────────────────────────────

describe('B2 · validación del cuerpo', () => {
  it('rechaza cada forma inválida con su código, y el email se valida ANTES que la clave', async () => {
    const sinArroba = await registrar('no-es-un-email');
    const sinPunto = await pedir('POST', '/auth/registro', {
      cuerpo: { email: 'ana@ejemplo', password: PASSWORD },
    });
    const conEspacio = await pedir('POST', '/auth/registro', {
      cuerpo: { email: 'a na@ejemplo.cl', password: PASSWORD },
    });
    const largo = await pedir('POST', '/auth/registro', {
      cuerpo: { email: `${'a'.repeat(250)}@ejemplo.cl`, password: PASSWORD },
    });
    const claveCorta = await registrar(emailUnico(), '1234567');
    const sinClave = await pedir('POST', '/auth/registro', { cuerpo: { email: emailUnico() } });
    // Los DOS mal a la vez: la spec fija que gana el email.
    const ambosMal = await pedir('POST', '/auth/registro', {
      cuerpo: { email: 'roto', password: 'x' },
    });

    expect({
      sinArroba: [sinArroba.estado, sinArroba.cuerpo['codigo']],
      sinPunto: [sinPunto.estado, sinPunto.cuerpo['codigo']],
      conEspacio: [conEspacio.estado, conEspacio.cuerpo['codigo']],
      largo: [largo.estado, largo.cuerpo['codigo']],
      claveCorta: [claveCorta.estado, claveCorta.cuerpo['codigo']],
      sinClave: [sinClave.estado, sinClave.cuerpo['codigo']],
      ambosMal: [ambosMal.estado, ambosMal.cuerpo['codigo']],
    }).toEqual({
      sinArroba: [400, 'EMAIL_INVALIDO'],
      sinPunto: [400, 'EMAIL_INVALIDO'],
      conEspacio: [400, 'EMAIL_INVALIDO'],
      largo: [400, 'EMAIL_INVALIDO'],
      claveCorta: [400, 'PASSWORD_DEBIL'],
      sinClave: [400, 'PASSWORD_DEBIL'],
      ambosMal: [400, 'EMAIL_INVALIDO'],
    });
  });

  it('borde 3 y 4 · 8 caracteres exactos vale, y la clave NO se recorta ni se normaliza', async () => {
    const justo = await registrar(emailUnico('justo'), '12345678');

    // Una clave con espacios en los bordes: si alguien le hace trim(), entrar con la versión
    // recortada funcionaría. Tiene que fallar.
    const email = emailUnico('espacios');
    const conEspacios = '  clave con espacios  ';
    await registrar(email, conEspacios);
    const tal_cual = await pedir('POST', '/auth/login', {
      cuerpo: { email, password: conEspacios },
    });
    const recortada = await pedir('POST', '/auth/login', {
      cuerpo: { email, password: conEspacios.trim() },
    });

    expect({
      ochoJusto: justo.estado,
      talCual: tal_cual.estado,
      recortada: [recortada.estado, recortada.cuerpo['codigo']],
    }).toEqual({ ochoJusto: 201, talCual: 200, recortada: [401, 'CREDENCIALES_INVALIDAS'] });
  });
});

// ─── B3 · el login ─────────────────────────────────────────────────────────────────────

describe('B3 · login', () => {
  it('devuelve un token cuyo vencimiento CUADRA con expiraEn, a 60 minutos', async () => {
    const email = emailUnico('login');
    await registrar(email);
    const antes = Date.now();
    const r = await pedir('POST', '/auth/login', { cuerpo: { email, password: PASSWORD } });
    const despues = Date.now();

    const token = String(r.cuerpo['token']);
    const carga = leerCarga(token);
    const expMs = Number(carga['exp']) * 1000;
    const expiraEnMs = new Date(String(r.cuerpo['expiraEn'])).getTime();
    // El servidor trunca al segundo (`Math.floor(Date.now()/1000)`), así que `exp` cae en
    // la VENTANA de la petición, no en un punto. La cota exacta es ésa, y se afirma sobre
    // segundos enteros, que es la unidad en que el dato existe.
    const expSegundos = Number(carga['exp']);
    const minimoSegundos = Math.floor(antes / 1000) + VIGENCIA_MINUTOS_ESPERADA * 60;
    const maximoSegundos = Math.floor(despues / 1000) + VIGENCIA_MINUTOS_ESPERADA * 60;

    expect({
      estado: r.estado,
      tipo: r.cuerpo['tipo'],
      // Dos fuentes del mismo dato: si no cuadran, es un defecto, no un formato distinto.
      // Al segundo, porque `exp` va en segundos enteros.
      expCuadraConExpiraEn: Math.abs(expMs - expiraEnMs) < 1000,
      // Endurecida con la causa aislada (200 logins, 6 rojos
      // = 3,0 %). La forma anterior —`(exp*1000 - antes)/60000 <= 60`— comparaba un
      // instante del CLIENTE contra un `exp` truncado al segundo por el SERVIDOR: cuando el
      // borde del segundo caía entre los dos, una implementación CORRECTA daba 60,0017 y el
      // caso se ponía rojo. Ablandarla habría sido subir la tolerancia; esto la aprieta:
      // antes toleraba hasta 59 s de holgura por abajo, ahora clava exp al segundo dentro
      // de la ventana medida. Calibrada con vigencia de 59 y de 61 minutos: las dos rojas.
      vigenciaCorrecta: expSegundos >= minimoSegundos && expSegundos <= maximoSegundos,
      subEsElUsuario: carga['sub'] === (await prisma.usuario.findUnique({ where: { email } }))?.id,
      duroMenosDeUnMinuto: despues - antes < 60_000,
    }).toEqual({
      estado: 200,
      tipo: 'Bearer',
      expCuadraConExpiraEn: true,
      vigenciaCorrecta: true,
      subEsElUsuario: true,
      duroMenosDeUnMinuto: true,
    });
  });

  it('V4 · un email desconocido y una clave equivocada dan EXACTAMENTE la misma respuesta', async () => {
    const email = emailUnico('existe');
    await registrar(email);

    const claveMala = await pedir('POST', '/auth/login', {
      cuerpo: { email, password: 'otra-clave-cualquiera' },
    });
    const noExiste = await pedir('POST', '/auth/login', {
      cuerpo: { email: emailUnico('fantasma'), password: PASSWORD },
    });

    expect({
      claveMala: [claveMala.estado, claveMala.cuerpo['codigo'], claveMala.cuerpo['mensaje']],
      noExiste: [noExiste.estado, noExiste.cuerpo['codigo'], noExiste.cuerpo['mensaje']],
      sonIdenticas: JSON.stringify(claveMala) === JSON.stringify(noExiste),
    }).toEqual({
      claveMala: [401, 'CREDENCIALES_INVALIDAS', claveMala.cuerpo['mensaje']],
      noExiste: [401, 'CREDENCIALES_INVALIDAS', claveMala.cuerpo['mensaje']],
      sonIdenticas: true,
    });
  });
});

// ─── B4 · el token, y los DOS mecanismos que lo rechazan ───────────────────────────────

describe('B4 · GET /auth/yo', () => {
  it('con un token recién emitido dice quién soy', async () => {
    const email = emailUnico('yo');
    await registrar(email);
    const token = await entrar(email);
    const r = await pedir('GET', '/auth/yo', { autorizacion: `Bearer ${token}` });
    const enBase = await prisma.usuario.findUnique({ where: { email } });

    expect({ estado: r.estado, id: r.cuerpo['id'], email: r.cuerpo['email'] }).toEqual({
      estado: 200,
      id: enBase?.id,
      email,
    });
  });

  it('V5+V6 · firma rota y vencimiento son DOS mecanismos con DOS códigos distintos', async () => {
    const email = emailUnico('mecanismos');
    await registrar(email);
    const usuario = await prisma.usuario.findUnique({ where: { email } });
    const token = await entrar(email);

    // 1 · un solo bit distinto en la carga, con la firma vieja.
    const [carga, firma] = token.split('.');
    const cargaAlterada = b64url(
      Buffer.from(JSON.stringify({ ...leerCarga(token), sub: randomUUID() })),
    );
    const firmaRota = `${cargaAlterada}.${String(firma)}`;

    // 2 · bien firmado por nosotros, pero vencido hace una hora.
    const vencido = forjarToken(String(usuario?.id), Math.floor(Date.now() / 1000) - 3600);

    // 3 · control POSITIVO: el mismo forjado, pero vigente. Si esto no da 200, los otros dos
    //     rojos no prueban nada — probarían que el arnés no sabe forjar tokens.
    const forjadoVigente = forjarToken(String(usuario?.id), Math.floor(Date.now() / 1000) + 600);

    const sinCabecera = await pedir('GET', '/auth/yo');
    const basic = await pedir('GET', '/auth/yo', { autorizacion: 'Basic abc' });
    const bearerVacio = await pedir('GET', '/auth/yo', { autorizacion: 'Bearer ' });
    const sinPunto = await pedir('GET', '/auth/yo', { autorizacion: `Bearer ${String(carga)}` });
    const rota = await pedir('GET', '/auth/yo', { autorizacion: `Bearer ${firmaRota}` });
    const caducado = await pedir('GET', '/auth/yo', { autorizacion: `Bearer ${vencido}` });
    const vigente = await pedir('GET', '/auth/yo', { autorizacion: `Bearer ${forjadoVigente}` });

    expect({
      sinCabecera: [sinCabecera.estado, sinCabecera.cuerpo['codigo']],
      basic: [basic.estado, basic.cuerpo['codigo']],
      bearerVacio: [bearerVacio.estado, bearerVacio.cuerpo['codigo']],
      sinPunto: [sinPunto.estado, sinPunto.cuerpo['codigo']],
      firmaRota: [rota.estado, rota.cuerpo['codigo']],
      vencido: [caducado.estado, caducado.cuerpo['codigo']],
      controlPositivo: [vigente.estado, vigente.cuerpo['email']],
    }).toEqual({
      sinCabecera: [401, 'TOKEN_AUSENTE'],
      basic: [401, 'TOKEN_AUSENTE'],
      bearerVacio: [401, 'TOKEN_AUSENTE'],
      sinPunto: [401, 'TOKEN_INVALIDO'],
      firmaRota: [401, 'TOKEN_INVALIDO'],
      vencido: [401, 'TOKEN_EXPIRADO'],
      controlPositivo: [200, email],
    });
  });

  it('borde 6 · un token bien firmado de un usuario que ya no existe da 401, no 500', async () => {
    const email = emailUnico('borrado');
    await registrar(email);
    const usuario = await prisma.usuario.findUnique({ where: { email } });
    const token = await entrar(email);
    await prisma.usuario.delete({ where: { id: String(usuario?.id) } });

    const r = await pedir('GET', '/auth/yo', { autorizacion: `Bearer ${token}` });
    expect([r.estado, r.cuerpo['codigo']]).toEqual([401, 'TOKEN_INVALIDO']);
  });
});

// ─── B5 · el borde 8 de la spec, que los diez casos de arriba no miraban ───────────────
//
// Añadido DESPUÉS de que los otros diez casos pasaran 10/10. No es un caso ablandado: es uno
// que faltaba. El borde 8 del Pilar 4 de la spec
// («cuerpo que no es JSON → 400 con código tipado, nunca un 500») estaba escrito y ningún
// brazo lo comprobaba, así que el arnés nació ciego a él.
//
// El defecto que caza NO está en el módulo de auth: el 400 sin código lo produce el
// body-parser de Express antes de llegar al controlador, y el arreglo vive en src/infra/.
describe('B5 · cuerpo malformado', () => {
  it('borde 8 · un JSON roto sale con código tipado, no con el error crudo de Express', async () => {
    const r = await fetch(`${base}/auth/registro`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{esto no es json',
    });
    const cuerpo = (await r.json()) as Record<string, unknown>;

    expect({ estado: r.status, codigo: cuerpo['codigo'] }).toEqual({
      estado: 400,
      codigo: 'CUERPO_INVALIDO',
    });
  });
});
