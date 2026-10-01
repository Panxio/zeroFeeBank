import { createHmac, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/prisma.service.js';
import { AppModule } from '../src/app.module.js';

/**
 * Arnés de S-14 · datos de contacto del cliente.
 * Ver specs/S-14-contacto.md. ESTE ARCHIVO NO SE TOCA (specs/_CANDADO.md).
 *
 * ─── Por qué monta AppModule y no una lista de módulos ──────────────────────────────────
 * Los otros arneses arman un @Module a medida con los módulos que les interesan. Éste no
 * puede: `ContactoModule` NO EXISTE cuando se escribe este archivo, y nombrarlo haría que
 * vitest muriera al importar — cero casos corridos en vez de 32 rojos, que es precisamente
 * la corrida ciega que la calibración por ausencia necesita evitar.
 * Montar `AppModule` tiene además un diente propio: si el módulo no se registra en
 * src/app.module.ts, la ruta no se sirve y el arnés se pone rojo. Es la única línea de ese
 * archivo que la spec § 6 autoriza a tocar, y así queda medida.
 *
 * ─── Por qué habla por HTTP ─────────────────────────────────────────────────────────────
 * La mitad del contrato de esta unidad SON los estados y los códigos tipados (C5), y ésos
 * sólo existen del otro lado del filtro. Un test contra el servicio vería excepciones.
 *
 * ─── Por qué lee la base con Prisma ─────────────────────────────────────────────────────
 * Como ORÁCULO INDEPENDIENTE. El endpoint dice qué guardó; el arnés lo contrasta contra las
 * columnas crudas. Preguntarle al mismo servicio que audita sería compararlo consigo mismo.
 *
 * ─── Por qué no borra la base ───────────────────────────────────────────────────────────
 * Cada caso registra su propio titular con email único, así que las corridas no se pisan y
 * el orden de ejecución no importa (C2 del perfil SUT).
 */

const prisma = new PrismaService();
let app: INestApplication;
let base = '';

/** El secreto lo fija el arnés: si dependiera del .env de cada máquina no mediría lo mismo. */
const SECRETO = 'arnes-s14-secreto-de-pruebas-32-min-ok';
const PASSWORD = 'clave-de-prueba-larga';

/** Los siete campos y su máximo, copiados de specs/S-14 § 3. El orden ES la precedencia. */
const CAMPOS = [
  { campo: 'nombre', max: 50, codigo: 'CONTACTO_NOMBRE_INVALIDO' },
  { campo: 'apellido', max: 50, codigo: 'CONTACTO_APELLIDO_INVALIDO' },
  { campo: 'direccion', max: 100, codigo: 'CONTACTO_DIRECCION_INVALIDA' },
  { campo: 'ciudad', max: 50, codigo: 'CONTACTO_CIUDAD_INVALIDA' },
  { campo: 'estado', max: 50, codigo: 'CONTACTO_ESTADO_INVALIDO' },
  { campo: 'codigoPostal', max: 20, codigo: 'CONTACTO_CODIGO_POSTAL_INVALIDO' },
  { campo: 'telefono', max: 20, codigo: 'CONTACTO_TELEFONO_INVALIDO' },
] as const;

const NOMBRES_DE_CAMPO = CAMPOS.map((c) => c.campo);

/**
 * Un contacto válido de referencia. Ningún valor llega al límite: los límites los mide C4.
 *
 * ⚠️ LOS DATOS DE UN ARNÉS TAMBIÉN SE CALIBRAN, y esta función es la
 * prueba: antes, `contactoValido('-antes-del-email')` producía un codigoPostal
 * de 22 caracteres contra el máximo de 20 que el propio arnés exige en C4. D5 y E5 eran
 * IMPOSIBLES de poner en verde: su PUT de preparación se rechazaba con el código del campo
 * que ellos mismos habían pasado de largo. La calibración por ausencia no podía cazarlo —los
 * dos salían rojos, como se esperaba de ellos—; lo cazó el intento de poner el arnés en verde.
 * De ahí la compuerta de abajo: el arnés se niega a construir datos que él mismo rechazaría.
 */
function contactoValido(sufijo = ''): Record<string, string> {
  return {
    nombre: `Ana${sufijo}`,
    apellido: `Pérez${sufijo}`,
    direccion: `Av. Siempre Viva 742${sufijo}`,
    ciudad: `Santiago${sufijo}`,
    estado: `Región Metropolitana${sufijo}`,
    codigoPostal: `832000${sufijo || '0'}`,
    telefono: `+56 9 1234 567${sufijo || '8'}`,
  };
}

/** La compuerta: ningún dato de preparación puede violar los máximos que el arnés exige. */
function contactoValidoSeguro(sufijo = ''): Record<string, string> {
  const datos = contactoValido(sufijo);
  for (const { campo, max } of CAMPOS) {
    const valor = datos[campo] ?? '';
    expect(
      valor.length,
      `el arnés se contradice: ${campo} de preparación mide ${valor.length} y su máximo es ${max}. ` +
        `El sufijo '${sufijo}' es demasiado largo.`,
    ).toBeLessThanOrEqual(max);
  }
  return datos;
}

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
async function nuevoTitular(prefijo = 'contacto'): Promise<Titular> {
  const email = `${prefijo}-${randomUUID()}@ejemplo.cl`;
  const reg = await pedir('POST', '/auth/registro', { cuerpo: { email, password: PASSWORD } });
  expect(reg.estado, `el registro de ${email} falló: ${JSON.stringify(reg.cuerpo)}`).toBe(201);
  const login = await pedir('POST', '/auth/login', { cuerpo: { email, password: PASSWORD } });
  expect(login.estado, `el login de ${email} falló: ${JSON.stringify(login.cuerpo)}`).toBe(200);
  const token = String(login.cuerpo['token']);
  return { id: String(reg.cuerpo['id']), email, token, auth: `Bearer ${token}` };
}

const ver = async (t: Titular): Promise<Respuesta> =>
  pedir('GET', '/contacto', { autorizacion: t.auth });

const guardar = async (t: Titular, cuerpo: unknown): Promise<Respuesta> =>
  pedir('PUT', '/contacto', { cuerpo, autorizacion: t.auth });

/** Un titular con su contacto ya completo. Devuelve lo que se guardó, para comparar. */
async function conContacto(sufijo = ''): Promise<[Titular, Record<string, string>]> {
  const t = await nuevoTitular();
  const datos = contactoValidoSeguro(sufijo);
  const r = await guardar(t, datos);
  expect(r.estado, `el PUT de preparación falló: ${JSON.stringify(r.cuerpo)}`).toBe(200);
  return [t, datos];
}

/** El oráculo independiente: las columnas crudas, sin pasar por el código que se audita. */
async function enBase(titularId: string): Promise<Record<string, unknown>> {
  const u = await prisma.usuario.findUniqueOrThrow({ where: { id: titularId } });
  return u as unknown as Record<string, unknown>;
}

/** Los siete campos tal como están en la base ahora mismo. */
async function contactoEnBase(titularId: string): Promise<Record<string, unknown>> {
  const u = await enBase(titularId);
  return Object.fromEntries(NOMBRES_DE_CAMPO.map((c) => [c, u[c]]));
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

// ═══ A · GET /contacto ═════════════════════════════════════════════════════════════════

describe('A · consultar el contacto', () => {
  it('A1 · un titular recién registrado recibe 200 con los siete campos en null', async () => {
    const t = await nuevoTitular();
    const r = await ver(t);
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(200);
    expect(r.cuerpo['email']).toBe(t.email);
    for (const campo of NOMBRES_DE_CAMPO) {
      expect(r.cuerpo[campo], `${campo} debería venir en null`).toBeNull();
    }
  });

  it('A2 · tras guardarlo, el GET devuelve exactamente lo que se guardó', async () => {
    const [t, datos] = await conContacto();
    const r = await ver(t);
    expect(r.estado).toBe(200);
    for (const [campo, valor] of Object.entries(datos)) {
      expect(r.cuerpo[campo], `${campo} no coincide`).toBe(valor);
    }
    expect(r.cuerpo['email']).toBe(t.email);
  });

  it('A3 · lo que devuelve el GET es lo que hay en la base (oráculo independiente)', async () => {
    const [t] = await conContacto();
    const r = await ver(t);
    const crudo = await contactoEnBase(t.id);
    for (const campo of NOMBRES_DE_CAMPO) {
      expect(r.cuerpo[campo], `${campo}: el endpoint y la columna no dicen lo mismo`).toBe(
        crudo[campo],
      );
    }
  });

  it('A4 · el GET devuelve el contacto del token, nunca el de otro titular', async () => {
    const [uno, datosUno] = await conContacto('-uno');
    const [dos, datosDos] = await conContacto('-dos');
    const rUno = await ver(uno);
    const rDos = await ver(dos);
    expect(rUno.cuerpo['nombre']).toBe(datosUno['nombre']);
    expect(rDos.cuerpo['nombre']).toBe(datosDos['nombre']);
    expect(rUno.cuerpo['nombre']).not.toBe(rDos.cuerpo['nombre']);
    expect(rUno.cuerpo['email']).toBe(uno.email);
    expect(rDos.cuerpo['email']).toBe(dos.email);
  });

  it('A5 · el contrato son OCHO claves exactas: nada de passwordHash, id ni creadoEn', async () => {
    const [t] = await conContacto();
    const r = await ver(t);
    // Ordenadas para que la comparación no dependa del orden de serialización.
    expect(Object.keys(r.cuerpo).sort()).toEqual(['email', ...NOMBRES_DE_CAMPO].sort());
  });
});

// ═══ B · PUT /contacto, el camino feliz ════════════════════════════════════════════════

describe('B · guardar el contacto', () => {
  it('B1 · un PUT completo responde 200 con el contacto ya actualizado', async () => {
    const t = await nuevoTitular();
    const datos = contactoValido();
    const r = await guardar(t, datos);
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(200);
    for (const [campo, valor] of Object.entries(datos)) {
      expect(r.cuerpo[campo], `${campo} no volvió en la respuesta`).toBe(valor);
    }
    expect(r.cuerpo['email']).toBe(t.email);
  });

  it('B2 · el PUT persiste los siete valores en la base (oráculo independiente)', async () => {
    const t = await nuevoTitular();
    const datos = contactoValido();
    await guardar(t, datos);
    const crudo = await contactoEnBase(t.id);
    expect(crudo).toEqual(datos);
  });

  it('B3 · es reemplazo total, no merge: un PUT al que le falta un campo FALLA (J2)', async () => {
    const [t, datos] = await conContacto();
    const incompleto = { ...datos };
    delete incompleto['ciudad'];
    const r = await guardar(t, incompleto);
    expect(r.estado, `un PUT sin ciudad debería fallar: ${JSON.stringify(r.cuerpo)}`).toBe(400);
    expect(r.cuerpo['codigo']).toBe('CONTACTO_CIUDAD_INVALIDA');
    // Y no dejó a medias lo que sí venía: la ciudad vieja sigue ahí, entera.
    const crudo = await contactoEnBase(t.id);
    expect(crudo).toEqual(datos);
  });

  it('B4 · los valores se guardan recortados con trim', async () => {
    const t = await nuevoTitular();
    const datos = contactoValido();
    const conEspacios = Object.fromEntries(
      Object.entries(datos).map(([k, v]) => [k, `   ${v}  `]),
    );
    const r = await guardar(t, conEspacios);
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(200);
    const crudo = await contactoEnBase(t.id);
    expect(crudo).toEqual(datos);
    // ENDURECIDO: antes sólo miraba `nombre` en la
    // respuesta. Devolver el body crudo y recortar únicamente `nombre` dejaba los otros seis
    // con espacios en el 200 —violando el contrato— con la base ya saneada, y pasaba en verde.
    for (const [campo, valor] of Object.entries(datos)) {
      expect(r.cuerpo[campo], `${campo} vuelve sin recortar en la respuesta`).toBe(valor);
    }
  });

  it('B5 · dos PUT idénticos dejan el mismo estado y responden lo mismo', async () => {
    const t = await nuevoTitular();
    const datos = contactoValido();
    const primero = await guardar(t, datos);
    const segundo = await guardar(t, datos);
    expect(primero.estado).toBe(200);
    expect(segundo.estado).toBe(200);
    expect(segundo.cuerpo).toEqual(primero.cuerpo);
    expect(await contactoEnBase(t.id)).toEqual(datos);
  });
});

// ═══ C · la validación de los siete campos ═════════════════════════════════════════════

describe('C · validación', () => {
  it('C1 · sin nombre: 400 CONTACTO_NOMBRE_INVALIDO y ni una columna escrita', async () => {
    const t = await nuevoTitular();
    const datos = contactoValido();
    delete (datos as Record<string, unknown>)['nombre'];
    const r = await guardar(t, datos);
    expect(r.estado).toBe(400);
    expect(r.cuerpo['codigo']).toBe('CONTACTO_NOMBRE_INVALIDO');
    const crudo = await contactoEnBase(t.id);
    for (const campo of NOMBRES_DE_CAMPO) {
      expect(crudo[campo], `${campo} se escribió pese al rechazo`).toBeNull();
    }
  });

  it('C2 · cada campo ausente devuelve SU propio código, no uno genérico (J8)', async () => {
    const t = await nuevoTitular();
    for (const { campo, codigo } of CAMPOS) {
      const cuerpo = contactoValido() as Record<string, unknown>;
      delete cuerpo[campo];
      const r = await guardar(t, cuerpo);
      expect(r.estado, `sin ${campo}: ${JSON.stringify(r.cuerpo)}`).toBe(400);
      expect(r.cuerpo['codigo'], `sin ${campo}`).toBe(codigo);
    }
  });

  it('C3 · un campo con sólo espacios es inválido: el largo se mide TRAS el trim', async () => {
    // ENDURECIDO: antes probaba sólo
    // `ciudad`. Un servicio que aplicara trim en ciudad y midiera `.length` crudo en los
    // otros seis guardaba '     ' como nombre válido y este brazo seguía verde.
    const t = await nuevoTitular();
    // Y con cadena VACÍA además de con espacios: el arnés
    // original sólo usaba '' en `nombre` y `telefono`, así que un `v.length <= max` sin el
    // `>= 1` dejaba persistir '' en apellido, direccion, estado y codigoPostal.
    for (const { campo, codigo } of CAMPOS) {
      for (const valor of ['     ', '']) {
        const r = await guardar(t, { ...contactoValido(), [campo]: valor });
        expect(r.estado, `${campo} = ${JSON.stringify(valor)}: ${JSON.stringify(r.cuerpo)}`).toBe(400);
        expect(r.cuerpo['codigo'], `${campo} = ${JSON.stringify(valor)}`).toBe(codigo);
      }
    }
  });

  it('C4 · el máximo exacto se acepta y uno más se rechaza, campo por campo', async () => {
    for (const { campo, max, codigo } of CAMPOS) {
      const t = await nuevoTitular();
      const justo = { ...contactoValido(), [campo]: 'x'.repeat(max) };
      const rJusto = await guardar(t, justo);
      expect(rJusto.estado, `${campo} con ${max}: ${JSON.stringify(rJusto.cuerpo)}`).toBe(200);
      expect(rJusto.cuerpo[campo]).toBe('x'.repeat(max));

      // El estado ANTES del rechazo, con el acto del medio ya exigido en 200 más arriba.
      const antes = await contactoEnBase(t.id);
      const pasado = { ...contactoValido(), [campo]: 'x'.repeat(max + 1) };
      const rPasado = await guardar(t, pasado);
      expect(rPasado.estado, `${campo} con ${max + 1}`).toBe(400);
      expect(rPasado.cuerpo['codigo'], `${campo} con ${max + 1}`).toBe(codigo);
      // ENDURECIDO: antes se creía a la respuesta y no se
      // miraba la base. Un servicio que truncara con substring() y DESPUÉS respondiera 400
      // dejaba el valor escrito, y el brazo seguía verde.
      expect(await contactoEnBase(t.id), `${campo}: el rechazo por largo escribió en la base`).toEqual(antes);
    }
  });

  it('C5 · un campo que no es string es inválido, nunca un 500', async () => {
    // ENDURECIDO: antes inyectaba los
    // no-strings SÓLO en `telefono`, que además es el ÚLTIMO de la precedencia. Un servicio
    // que comprobara `typeof` sólo ahí y en los otros seis hiciera `!campo || campo.trim()`
    // reventaba con un TypeError -> 500 en `nombre: 42`, y el brazo seguía verde.
    const t = await nuevoTitular();
    for (const { campo, codigo } of CAMPOS) {
      for (const valor of [42, null, { a: 1 }, ['x'], true]) {
        const r = await guardar(t, { ...contactoValido(), [campo]: valor });
        expect(r.estado, `${campo} = ${JSON.stringify(valor)}: ${JSON.stringify(r.cuerpo)}`).toBe(400);
        expect(r.cuerpo['codigo'], `${campo} = ${JSON.stringify(valor)}`).toBe(codigo);
      }
    }
  });

  it('C6 · con dos campos malos responde el PRIMERO de la precedencia fijada', async () => {
    const t = await nuevoTitular();
    const r = await guardar(t, { ...contactoValido(), nombre: '', telefono: '' });
    expect(r.estado).toBe(400);
    expect(r.cuerpo['codigo']).toBe('CONTACTO_NOMBRE_INVALIDO');
  });

  it('C7 · un ARRAY como cuerpo da 400 CONTACTO_NOMBRE_INVALIDO, nunca un 500', async () => {
    // CORREGIDO: la versión anterior recorría [['a'], 'texto', 42, null] esperando
    // CONTACTO_NOMBRE_INVALIDO en los cuatro. Sólo el ARRAY llega al controlador: el parser
    // de Express corre con `strict: true` y rechaza los primitivos JSON en la raíz ANTES de
    // enrutar, devolviendo CUERPO_INVALIDO. O sea que tres de los cuatro casos no medían a
    // S-14 sino a la infraestructura — un arnés ciego al revés: en vez
    // de aprobar al brazo por la unidad, lo reprobaba por ella. Los tres primitivos se
    // mudaron a G4 y siguen vigilados; acá se queda el único que S-14 puede decidir.
    const t = await nuevoTitular();
    const r = await guardar(t, ['a']);
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(400);
    expect(r.cuerpo['codigo']).toBe('CONTACTO_NOMBRE_INVALIDO');
  });

  it('C8 · un PUT rechazado no deja el contacto a medias: todo o nada (J7)', async () => {
    const [t, viejos] = await conContacto('-viejo');
    const nuevos = contactoValido('-nuevo');
    // Seis campos nuevos y perfectamente válidos, y el séptimo roto.
    const r = await guardar(t, { ...nuevos, telefono: '' });
    expect(r.estado).toBe(400);
    expect(r.cuerpo['codigo']).toBe('CONTACTO_TELEFONO_INVALIDO');
    const crudo = await contactoEnBase(t.id);
    expect(crudo, 'quedó escrito algo del PUT rechazado').toEqual(viejos);
  });

  it('C10 · la precedencia vale entre campos INTERMEDIOS, no sólo entre el primero y el último', async () => {
    // NUEVO. C6 sólo enfrentaba `nombre` (primero) contra
    // `telefono` (último), y D3 el email contra `nombre`. Validar los siete en orden
    // ALFABÉTICO deja C6 en verde —'n' < 't'— y rompe la precedencia de la spec en todos los
    // pares intermedios. Acá se recorre la lista entera, par consecutivo a par consecutivo.
    const t = await nuevoTitular();
    for (let i = 0; i < CAMPOS.length - 1; i++) {
      const primero = CAMPOS[i]!;
      const segundo = CAMPOS[i + 1]!;
      const r = await guardar(t, { ...contactoValido(), [primero.campo]: '', [segundo.campo]: '' });
      expect(r.estado, `${primero.campo} vs ${segundo.campo}: ${JSON.stringify(r.cuerpo)}`).toBe(400);
      expect(r.cuerpo['codigo'], `gana el primero de la precedencia: ${primero.campo}`).toBe(primero.codigo);
    }
  });

  it('C11 · un cuerpo JSON vacío {} → 400 CONTACTO_NOMBRE_INVALIDO, y no escribe', async () => {
    // NUEVO. C7 probaba no-objetos y C1/C2 quitaban campos
    // de un cuerpo por lo demás completo, pero NADIE mandaba `{}`. Un servicio que validara
    // iterando sobre las claves PRESENTES no ejecuta ni una validación con `{}` y responde 200.
    const t = await nuevoTitular();
    const antes = await contactoEnBase(t.id);
    const r = await guardar(t, {});
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(400);
    expect(r.cuerpo['codigo']).toBe('CONTACTO_NOMBRE_INVALIDO');
    expect(await contactoEnBase(t.id)).toEqual(antes);
  });

  it('C9 · las claves de sobra se ignoran, no rompen', async () => {
    const t = await nuevoTitular();
    const datos = contactoValido();
    const r = await guardar(t, { ...datos, pais: 'Chile', saldo: '999', id: randomUUID() });
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(200);
    expect(Object.keys(r.cuerpo).sort()).toEqual(['email', ...NOMBRES_DE_CAMPO].sort());
    expect(await contactoEnBase(t.id)).toEqual(datos);
  });
});

// ═══ D · el email, que es la credencial y no se cambia acá ═════════════════════════════

describe('D · el email no se modifica en S-14', () => {
  it('D5 · el rechazo por email ajeno NO borra el contacto que YA existía (V2)', async () => {
    // NUEVO, y es la MISMA FAMILIA que D4 (un brazo que pasa con el módulo sin escribir). D1 mide esto mismo pero partiendo de un titular SIN contacto:
    // sus siete columnas ya eran null, así que `toBeNull()` se cumple solo. Con ese estado
    // previo no se distingue «el PUT no tocó nada» de «el PUT borró lo que había».
    // Acá el estado previo tiene CONTENIDO, así que la diferencia se ve.
    const [t, viejos] = await conContacto('-ant');
    const r = await guardar(t, { ...contactoValido('-nuevo'), email: `otro-${randomUUID()}@ejemplo.cl` });
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(400);
    expect(r.cuerpo['codigo']).toBe('EMAIL_NO_MODIFICABLE');
    expect(await contactoEnBase(t.id), 'el rechazo por email se llevó el contacto previo').toEqual(viejos);
  });

  it('D6 · `email` vacío o null tampoco pasa: se comprueba la PRESENCIA, no la verdad', async () => {
    // NUEVO. Todo el grupo D usaba emails bien formados,
    // así que un `if (body.email && body.email !== titular.email)` —truthy en vez de
    // `'email' in body`— dejaba pasar `email: ''` y `email: null` con un 200.
    const t = await nuevoTitular();
    for (const valor of ['', null]) {
      const antes = await contactoEnBase(t.id);
      const r = await guardar(t, { ...contactoValido(), email: valor });
      expect(r.estado, `email = ${JSON.stringify(valor)}: ${JSON.stringify(r.cuerpo)}`).toBe(400);
      expect(r.cuerpo['codigo'], `email = ${JSON.stringify(valor)}`).toBe('EMAIL_NO_MODIFICABLE');
      expect(await contactoEnBase(t.id)).toEqual(antes);
    }
  });

  it('D1 · un email distinto: 400 EMAIL_NO_MODIFICABLE y ni una columna escrita', async () => {
    const t = await nuevoTitular();
    const r = await guardar(t, { ...contactoValido(), email: `otro-${randomUUID()}@ejemplo.cl` });
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(400);
    expect(r.cuerpo['codigo']).toBe('EMAIL_NO_MODIFICABLE');
    const crudo = await contactoEnBase(t.id);
    for (const campo of NOMBRES_DE_CAMPO) {
      expect(crudo[campo], `${campo} se escribió pese al rechazo`).toBeNull();
    }
  });

  it('D2 · el MISMO email se acepta y se ignora (J5)', async () => {
    const t = await nuevoTitular();
    const datos = contactoValido();
    const r = await guardar(t, { ...datos, email: t.email });
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(200);
    expect(r.cuerpo['email']).toBe(t.email);
    expect(await contactoEnBase(t.id)).toEqual(datos);
  });

  it('D3 · el email ajeno gana sobre un campo inválido (precedencia J4)', async () => {
    const t = await nuevoTitular();
    const r = await guardar(t, {
      ...contactoValido(),
      nombre: '',
      email: `otro-${randomUUID()}@ejemplo.cl`,
    });
    expect(r.estado).toBe(400);
    expect(r.cuerpo['codigo']).toBe('EMAIL_NO_MODIFICABLE');
  });

  it('D4 · ningún PUT toca email, passwordHash ni creadoEn (V3)', async () => {
    const t = await nuevoTitular();
    const antes = await enBase(t.id);
    // Los dos PUT tienen que HABER OCURRIDO. Sin estas dos líneas el brazo se aprueba solo
    // cuando el endpoint no existe —el 404 no toca nada— y eso lo cazó la calibración por
    // ausencia: un brazo que pasa con el módulo sin escribir no es un brazo.
    const uno = await guardar(t, contactoValido());
    expect(uno.estado, JSON.stringify(uno.cuerpo)).toBe(200);
    const dos = await guardar(t, { ...contactoValido('-b'), email: t.email });
    expect(dos.estado, JSON.stringify(dos.cuerpo)).toBe(200);
    const despues = await enBase(t.id);
    // Y el contacto SÍ cambió: si no, la comparación de abajo no probaría nada.
    expect(despues['nombre']).toBe(contactoValido('-b')['nombre']);
    expect(despues['email']).toBe(antes['email']);
    expect(despues['passwordHash']).toBe(antes['passwordHash']);
    // ENDURECIDO, y lo destapó la calibración: la versión anterior comparaba
    // `String(fecha)`, que en JavaScript formatea a SEGUNDOS y se come los milisegundos. Un
    // PUT que refrescara `creadoEn` dentro del mismo segundo —que es lo normal— daba dos
    // cadenas idénticas y el brazo pasaba en verde sobre la columna pisada. Medido: con
    // `creadoEn: new Date()` inyectado en el update, D4 seguía verde. Es la familia de
    // comparar dos relojes en unidades que no son la misma.
    expect((despues['creadoEn'] as Date).toISOString()).toBe((antes['creadoEn'] as Date).toISOString());
  });
});

// ═══ E · quién puede pedir qué ═════════════════════════════════════════════════════════

describe('E · autenticación y aislamiento', () => {
  it('E1 · GET sin token: 401 TOKEN_AUSENTE', async () => {
    const r = await pedir('GET', '/contacto');
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(401);
    expect(r.cuerpo['codigo']).toBe('TOKEN_AUSENTE');
  });

  it('E2 · PUT sin token: 401 y ni una columna escrita (V1)', async () => {
    const t = await nuevoTitular();
    const r = await pedir('PUT', '/contacto', { cuerpo: contactoValido() });
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(401);
    expect(r.cuerpo['codigo']).toBe('TOKEN_AUSENTE');
    const crudo = await contactoEnBase(t.id);
    for (const campo of NOMBRES_DE_CAMPO) {
      expect(crudo[campo], `${campo} se escribió sin token`).toBeNull();
    }
  });

  it('E3 · un token de firma ajena: 401 TOKEN_INVALIDO, en GET y en PUT', async () => {
    const t = await nuevoTitular();
    const ajeno = forjarToken(t.id, Math.floor(Date.now() / 1000) + 3600, 'otro-secreto-distinto');
    const g = await pedir('GET', '/contacto', { autorizacion: `Bearer ${ajeno}` });
    expect(g.estado).toBe(401);
    expect(g.cuerpo['codigo']).toBe('TOKEN_INVALIDO');
    const p = await pedir('PUT', '/contacto', {
      cuerpo: contactoValido(),
      autorizacion: `Bearer ${ajeno}`,
    });
    expect(p.estado).toBe(401);
    expect(p.cuerpo['codigo']).toBe('TOKEN_INVALIDO');
  });

  it('E4 · un token vencido se distingue de uno inválido', async () => {
    const t = await nuevoTitular();
    const vencido = forjarToken(t.id, Math.floor(Date.now() / 1000) - 60);
    const r = await pedir('GET', '/contacto', { autorizacion: `Bearer ${vencido}` });
    expect(r.estado).toBe(401);
    expect(r.cuerpo['codigo']).toBe('TOKEN_EXPIRADO');
    // ENDURECIDO: sólo probaba el GET. La ruta de MUTACIÓN
    // es la que importa para V1, y quedaba sin vigilar: una sesión vencida podía seguir
    // escribiendo. E3 ya cubría las dos para el token de firma ajena; éste no.
    const antes = await contactoEnBase(t.id);
    const w = await pedir('PUT', '/contacto', {
      cuerpo: contactoValido(),
      autorizacion: `Bearer ${vencido}`,
    });
    expect(w.estado, JSON.stringify(w.cuerpo)).toBe(401);
    expect(w.cuerpo['codigo']).toBe('TOKEN_EXPIRADO');
    expect(await contactoEnBase(t.id), 'un token vencido escribió columnas').toEqual(antes);
  });

  it('E6 · una cabecera Authorization SIN el prefijo `Bearer ` → 401 TOKEN_AUSENTE', async () => {
    // NUEVO. E1 y E2 sólo probaban la AUSENCIA física de la
    // cabecera. Un `(req.headers['authorization'] ?? '').replace(/^Bearer\s*/, '')` acepta
    // cualquier esquema, se come el prefijo inexistente y devuelve TOKEN_INVALIDO —o un 500—
    // donde la spec exige TOKEN_AUSENTE. La spec lo dice con todas sus letras: «falta
    // Authorization, O NO EMPIEZA CON Bearer » → TOKEN_AUSENTE.
    const t = await nuevoTitular();
    for (const cabecera of ['Basic dXNlcjpwYXNz', t.token, `bearer ${t.token}`]) {
      const r = await pedir('GET', '/contacto', { autorizacion: cabecera });
      expect(r.estado, `Authorization: ${cabecera.slice(0, 20)}: ${JSON.stringify(r.cuerpo)}`).toBe(401);
      expect(r.cuerpo['codigo'], `Authorization: ${cabecera.slice(0, 20)}`).toBe('TOKEN_AUSENTE');
    }
  });

  it('E5 · el titular sale del TOKEN, no del cuerpo: un id ajeno se ignora (J3, V4)', async () => {
    const [victima, suyos] = await conContacto('-vic');
    const atacante = await nuevoTitular('atacante');
    const intento = contactoValidoSeguro('-sec');
    // Sin `email` en el cuerpo a propósito: si lo llevara, la precedencia J4 respondería 400
    // antes de llegar a escribir y el brazo se aprobaría solo, sin haber probado nada.
    const r = await guardar(atacante, {
      ...intento,
      id: victima.id,
      titularId: victima.id,
      usuarioId: victima.id,
    });
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(200);
    expect(await contactoEnBase(victima.id), 'le escribieron el contacto a la víctima').toEqual(
      suyos,
    );
    // Y lo que sí se guardó fue el contacto del atacante, en SU propia fila.
    expect(await contactoEnBase(atacante.id)).toEqual(intento);
  });
});

// ═══ F · lo que S-14 no toca ═══════════════════════════════════════════════════════════

describe('F · lo que esta unidad NO toca', () => {
  it('F1 · un PUT no escribe ni una fila en el ledger ni en las claves (V5)', async () => {
    const antes = await Promise.all([
      prisma.movimiento.count(),
      prisma.transaccion.count(),
      prisma.claveIdempotencia.count(),
    ]);
    const t = await nuevoTitular();
    // Igual que D4: los dos PUT tienen que haber ocurrido de verdad, uno aceptado y otro
    // rechazado. Sin esto, el brazo pasaba con el módulo sin escribir.
    const bueno = await guardar(t, contactoValido());
    expect(bueno.estado, JSON.stringify(bueno.cuerpo)).toBe(200);
    const malo = await guardar(t, { ...contactoValido(), nombre: '' });
    expect(malo.estado, JSON.stringify(malo.cuerpo)).toBe(400);
    const despues = await Promise.all([
      prisma.movimiento.count(),
      prisma.transaccion.count(),
      prisma.claveIdempotencia.count(),
    ]);
    expect(despues, 'S-14 escribió en contabilidad').toEqual(antes);
  });

  it('F2 · el endpoint NO pide Idempotency-Key: sin ella funciona igual (no-goal)', async () => {
    const t = await nuevoTitular();
    const sinClave = await guardar(t, contactoValido());
    expect(sinClave.estado, JSON.stringify(sinClave.cuerpo)).toBe(200);
    // Y mandarla tampoco cambia nada: no es un endpoint idempotente por clave.
    const conClave = await pedir('PUT', '/contacto', {
      cuerpo: contactoValido('-b'),
      autorizacion: t.auth,
      clave: `s14-${randomUUID()}`,
    });
    expect(conClave.estado, JSON.stringify(conClave.cuerpo)).toBe(200);
    expect(conClave.cuerpo['nombre']).toBe(contactoValido('-b')['nombre']);
  });
});

// ═══ G · los controles: no dependen de S-14 y deben quedar VERDES sin ella ═════════════

describe('G · controles que no dependen de S-14', () => {
  it('G1 · el registro y el login de S-08 siguen funcionando', async () => {
    const email = `control-${randomUUID()}@ejemplo.cl`;
    const reg = await pedir('POST', '/auth/registro', { cuerpo: { email, password: PASSWORD } });
    expect(reg.estado, JSON.stringify(reg.cuerpo)).toBe(201);
    const login = await pedir('POST', '/auth/login', { cuerpo: { email, password: PASSWORD } });
    expect(login.estado, JSON.stringify(login.cuerpo)).toBe(200);
    expect(typeof login.cuerpo['token']).toBe('string');
  });

  it('G4 · los primitivos JSON en la raíz los rechaza el parser, no S-14 → 400 CUERPO_INVALIDO', async () => {
    // Nacido de partir C7 en dos. NO depende de S-14: el body parser de
    // Express (`strict: true`) responde antes de enrutar, igual que G3. Se queda como
    // control con dientes —una implementación que montara su propio parseo y se tragara el rechazo
    // lo pondría rojo— y porque el contrato de C5 se cumple igual: 400 con código tipado.
    const t = await nuevoTitular();
    for (const cuerpo of ['texto', 42, null]) {
      const r = await guardar(t, cuerpo);
      expect(r.estado, `cuerpo = ${JSON.stringify(cuerpo)}`).toBe(400);
      expect(r.cuerpo['codigo'], `cuerpo = ${JSON.stringify(cuerpo)}`).toBe('CUERPO_INVALIDO');
    }
  });

  it('G3 · un cuerpo que no es JSON válido → 400 CUERPO_INVALIDO', async () => {
    // Nació como C10: la spec lista CUERPO_INVALIDO y
    // ningún brazo lo ejercitaba. Pero la calibración por ausencia lo puso VERDE sin el
    // módulo: el parser de cuerpo y el filtro global responden antes de enrutar, así que no
    // mide a S-14 sino a la infraestructura. Se queda —una implementación que registrara su propio
    // parseo y se tragara el SyntaxError lo pondría rojo— pero declarado como control.
    // «Un brazo que no puede fallar por culpa de la unidad no es un brazo de la unidad.»
    const t = await nuevoTitular();
    const antes = await contactoEnBase(t.id);
    const r = await pedir('PUT', '/contacto', { cuerpoCrudo: '{"nombre": ', autorizacion: t.auth });
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(400);
    expect(r.cuerpo['codigo']).toBe('CUERPO_INVALIDO');
    expect(await contactoEnBase(t.id)).toEqual(antes);
  });

  it('G2 · GET /auth/yo sigue devolviendo el id y el email del token', async () => {
    const t = await nuevoTitular();
    const r = await pedir('GET', '/auth/yo', { autorizacion: t.auth });
    expect(r.estado, JSON.stringify(r.cuerpo)).toBe(200);
    expect(r.cuerpo['id']).toBe(t.id);
    expect(r.cuerpo['email']).toBe(t.email);
  });
});
