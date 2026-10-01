import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma.service.js';
import { RelojService } from '../../infra/reloj.js';
import {
  CredencialesInvalidasError,
  EmailInvalidoError,
  EmailYaRegistradoError,
  PasswordDebilError,
  TokenAusenteError,
  TokenExpiradoError,
  TokenInvalidoError,
} from './auth.errors.js';

export const VIGENCIA_TOKEN_MINUTOS = 60;

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_SALT_LEN = 16;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

const DUMMY_SALT_B64 = Buffer.alloc(SCRYPT_SALT_LEN).toString('base64');
const DUMMY_HASH_B64 = Buffer.alloc(SCRYPT_KEYLEN).toString('base64');
const HASH_DESCARTE = `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${DUMMY_SALT_B64}$${DUMMY_HASH_B64}`;

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reloj: RelojService,
  ) {
    this.validarSecreto();
  }

  private validarSecreto(): string {
    const secreto = process.env['ZFB_AUTH_SECRET'];
    if (typeof secreto !== 'string' || secreto.length < 32) {
      throw new Error('ZFB_AUTH_SECRET no está definida o mide menos de 32 caracteres');
    }
    return secreto;
  }

  private get secreto(): string {
    return this.validarSecreto();
  }

  validarEmail(email: unknown): string {
    if (typeof email !== 'string') {
      throw new EmailInvalidoError();
    }
    const normalizado = email.trim().toLowerCase();
    if (normalizado.length === 0 || normalizado.length > 254) {
      throw new EmailInvalidoError();
    }
    if (normalizado.includes(' ') || /\s/.test(normalizado)) {
      throw new EmailInvalidoError();
    }
    const partes = normalizado.split('@');
    if (partes.length !== 2) {
      throw new EmailInvalidoError();
    }
    const [local, dominio] = partes;
    if (local === undefined || dominio === undefined) {
      throw new EmailInvalidoError();
    }
    if (local.length === 0 || dominio.length === 0) {
      throw new EmailInvalidoError();
    }
    if (!dominio.includes('.')) {
      throw new EmailInvalidoError();
    }
    if (dominio.startsWith('.') || dominio.endsWith('.')) {
      throw new EmailInvalidoError();
    }
    return normalizado;
  }

  validarPassword(password: unknown): asserts password is string {
    if (typeof password !== 'string' || password.length < 8) {
      throw new PasswordDebilError();
    }
  }

  private ejecutarScrypt(
    password: string,
    salt: Buffer,
    keylen: number,
    options: { N: number; r: number; p: number; maxmem: number },
  ): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, keylen, options, (err, derivedKey) => {
        if (err) {
          reject(err);
        } else {
          resolve(derivedKey);
        }
      });
    });
  }

  async hashearPassword(password: string): Promise<string> {
    const salt = randomBytes(SCRYPT_SALT_LEN);
    const hash = await this.ejecutarScrypt(password, salt, SCRYPT_KEYLEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: SCRYPT_MAXMEM,
    });
    return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`;
  }

  async verificarPassword(password: string, hashCompleto: string): Promise<boolean> {
    const partes = hashCompleto.split('$');
    if (partes.length !== 6 || partes[0] !== 'scrypt') {
      return false;
    }
    const N = Number(partes[1]);
    const r = Number(partes[2]);
    const p = Number(partes[3]);
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
      return false;
    }
    const saltRaw = partes[4];
    const hashRaw = partes[5];
    if (saltRaw === undefined || hashRaw === undefined) {
      return false;
    }
    const salt = Buffer.from(saltRaw, 'base64');
    const hashEsperado = Buffer.from(hashRaw, 'base64');

    const hashDerivado = await this.ejecutarScrypt(password, salt, hashEsperado.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    });

    if (hashDerivado.length !== hashEsperado.length) {
      return false;
    }

    return timingSafeEqual(hashDerivado, hashEsperado);
  }

  generarToken(usuarioId: string, expEpochSegundos: number): string {
    const cargaObj = { sub: usuarioId, exp: expEpochSegundos };
    const cargaJson = JSON.stringify(cargaObj);
    const cargaB64Url = Buffer.from(cargaJson, 'utf8').toString('base64url');
    const firmaB64Url = createHmac('sha256', this.secreto)
      .update(cargaB64Url)
      .digest('base64url');
    return `${cargaB64Url}.${firmaB64Url}`;
  }

  async registrar(cuerpo: unknown): Promise<{ id: string; email: string; creadoEn: string }> {
    // 1. Forma del cuerpo: email primero, luego clave
    if (!esObjeto(cuerpo)) {
      throw new EmailInvalidoError();
    }
    const email = this.validarEmail(cuerpo['email']);
    this.validarPassword(cuerpo['password']);

    // 2. Unicidad
    const existente = await this.prisma.usuario.findUnique({
      where: { email },
    });
    if (existente) {
      throw new EmailYaRegistradoError();
    }

    // 3. Escribir
    const passwordHash = await this.hashearPassword(cuerpo['password']);

    try {
      const nuevo = await this.prisma.usuario.create({
        data: {
          email,
          passwordHash,
          creadoEn: this.reloj.ahora(),
        },
      });

      return {
        id: nuevo.id,
        email: nuevo.email,
        creadoEn: nuevo.creadoEn.toISOString(),
      };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new EmailYaRegistradoError();
      }
      throw err;
    }
  }

  async login(cuerpo: unknown): Promise<{ token: string; tipo: string; expiraEn: string }> {
    // 1. Forma del cuerpo: email primero, luego clave
    if (!esObjeto(cuerpo)) {
      throw new EmailInvalidoError();
    }
    const email = this.validarEmail(cuerpo['email']);
    this.validarPassword(cuerpo['password']);

    // 2. Búsqueda
    const usuario = await this.prisma.usuario.findUnique({
      where: { email },
    });

    // 3. Verificación (si no existe, verificar contra hash de descarte para mitigar timing attacks)
    if (!usuario) {
      await this.verificarPassword(cuerpo['password'], HASH_DESCARTE);
      throw new CredencialesInvalidasError();
    }

    const valida = await this.verificarPassword(cuerpo['password'], usuario.passwordHash);
    if (!valida) {
      throw new CredencialesInvalidasError();
    }

    // 4. Emitir token
    const ahoraSegundos = Math.floor(this.reloj.ahora().getTime() / 1000);
    const expSegundos = ahoraSegundos + VIGENCIA_TOKEN_MINUTOS * 60;
    const expiraEn = new Date(expSegundos * 1000).toISOString();
    const token = this.generarToken(usuario.id, expSegundos);

    return {
      token,
      tipo: 'Bearer',
      expiraEn,
    };
  }

  async yo(autorizacion: unknown): Promise<{ id: string; email: string }> {
    const header = Array.isArray(autorizacion) ? autorizacion[0] : autorizacion;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new TokenAusenteError();
    }

    const token = header.slice('Bearer '.length).trim();
    if (token.length === 0) {
      throw new TokenAusenteError();
    }

    // 1. Hay exactamente un punto
    const partes = token.split('.');
    if (partes.length !== 2) {
      throw new TokenInvalidoError();
    }
    const cargaB64Url = partes[0];
    const firmaB64Url = partes[1];
    if (cargaB64Url === undefined || firmaB64Url === undefined) {
      throw new TokenInvalidoError();
    }
    if (cargaB64Url.length === 0 || firmaB64Url.length === 0) {
      throw new TokenInvalidoError();
    }

    // 2. Recalcular la firma y compararla con timingSafeEqual ANTES de parsear la carga
    const firmaEsperada = createHmac('sha256', this.secreto)
      .update(cargaB64Url)
      .digest('base64url');

    const bufRecibido = Buffer.from(firmaB64Url);
    const bufEsperado = Buffer.from(firmaEsperada);

    // 3. Si no cuadra, TOKEN_INVALIDO
    if (bufRecibido.length !== bufEsperado.length || !timingSafeEqual(bufRecibido, bufEsperado)) {
      throw new TokenInvalidoError();
    }

    // 4. Parsear la carga
    let parsed: unknown;
    try {
      const jsonStr = Buffer.from(cargaB64Url, 'base64url').toString('utf8');
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new TokenInvalidoError();
    }

    if (!esObjeto(parsed)) {
      throw new TokenInvalidoError();
    }

    // 5. Si exp ya pasó, TOKEN_EXPIRADO
    const expRaw = parsed['exp'];
    const exp = typeof expRaw === 'number' ? expRaw : typeof expRaw === 'string' ? Number(expRaw) : NaN;
    if (!Number.isFinite(exp)) {
      throw new TokenInvalidoError();
    }

    const ahoraSegundos = Math.floor(this.reloj.ahora().getTime() / 1000);
    if (exp <= ahoraSegundos) {
      throw new TokenExpiradoError();
    }

    // 6. Buscar el usuario
    const sub = parsed['sub'];
    if (typeof sub !== 'string' || sub.length === 0) {
      throw new TokenInvalidoError();
    }

    const usuario = await this.prisma.usuario.findUnique({
      where: { id: sub },
    });

    if (!usuario) {
      throw new TokenInvalidoError();
    }

    return {
      id: usuario.id,
      email: usuario.email,
    };
  }
}
