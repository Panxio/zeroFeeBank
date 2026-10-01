import { Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { parseMoney } from '../../domain/money/money.js';
import { esRutValido, normalizarRut, RutInvalidoError } from '../../domain/rut/rut.js';
import { AuthService } from '../auth/auth.service.js';
import {
  LARGO_MAXIMO_GLOSA,
  LARGO_MAXIMO_IDEMPOTENCY_KEY,
  LARGO_MAXIMO_NOMBRE,
  PLAZO_DIAS_MAXIMO,
  PLAZO_DIAS_MINIMO,
  UUID_REGEX,
} from './boletas.constants.js';
import {
  BoletaNoEncontradaError,
  CuentaNoEncontradaError,
  GlosaInvalidaError,
  IdempotencyKeyAusenteError,
  IdempotencyKeyInvalidaError,
  MontoInvalidoError,
  NombreInvalidoError,
  PlazoInvalidoError,
} from './boletas.errors.js';
import { BoletasService } from './boletas.service.js';

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null;
}

function extraerIdParam(req: Request): string {
  const idRaw = req.params['id'];
  return typeof idRaw === 'string' ? idRaw : '';
}

@Controller('boletas')
export class BoletasController {
  constructor(
    private readonly authService: AuthService,
    private readonly boletasService: BoletasService,
  ) {}

  private extraerClave(req: Request): string {
    const headerClave = req.headers['idempotency-key'];
    const claveCruda = Array.isArray(headerClave) ? headerClave[0] : headerClave;

    if (typeof claveCruda !== 'string' || claveCruda.trim().length === 0) {
      throw new IdempotencyKeyAusenteError();
    }

    if (
      claveCruda.length > LARGO_MAXIMO_IDEMPOTENCY_KEY ||
      claveCruda.trim().length > LARGO_MAXIMO_IDEMPOTENCY_KEY
    ) {
      throw new IdempotencyKeyInvalidaError();
    }

    return claveCruda.trim();
  }

  @Post()
  async emitir(@Req() req: Request, @Res() res: Response): Promise<void> {
    // 1. Token -> titular
    const titular = await this.authService.yo(req.headers['authorization']);

    // 2. Idempotency-Key
    const clave = this.extraerClave(req);

    // 3. Forma del cuerpo
    const body: unknown = req.body;
    const bodyObj = esObjeto(body) ? body : {};

    // 3.1 cuentaOrigenId
    const cuentaOrigenIdRaw = bodyObj['cuentaOrigenId'];
    if (typeof cuentaOrigenIdRaw !== 'string' || !UUID_REGEX.test(cuentaOrigenIdRaw)) {
      throw new CuentaNoEncontradaError(
        typeof cuentaOrigenIdRaw === 'string' ? cuentaOrigenIdRaw : '',
      );
    }
    const cuentaOrigenId = cuentaOrigenIdRaw;

    // 3.2 monto
    const montoRaw = bodyObj['monto'];
    if (typeof montoRaw !== 'string') {
      throw new MontoInvalidoError();
    }
    let montoCentavos: bigint;
    try {
      montoCentavos = parseMoney(montoRaw);
    } catch {
      throw new MontoInvalidoError();
    }
    if (montoCentavos <= 0n) {
      throw new MontoInvalidoError();
    }

    // 3.3 plazoDias
    const plazoDiasRaw = bodyObj['plazoDias'];
    if (
      typeof plazoDiasRaw !== 'number' ||
      !Number.isInteger(plazoDiasRaw) ||
      plazoDiasRaw < PLAZO_DIAS_MINIMO ||
      plazoDiasRaw > PLAZO_DIAS_MAXIMO
    ) {
      throw new PlazoInvalidoError();
    }
    const plazoDias = plazoDiasRaw;

    // 3.4 beneficiarioRut
    const benRutRaw = bodyObj['beneficiarioRut'];
    if (!esRutValido(benRutRaw)) {
      throw new RutInvalidoError();
    }
    const beneficiarioRut = normalizarRut(benRutRaw);

    // 3.5 retiradorRut
    const retRutRaw = bodyObj['retiradorRut'];
    if (!esRutValido(retRutRaw)) {
      throw new RutInvalidoError();
    }
    const retiradorRut = normalizarRut(retRutRaw);

    // 3.6 beneficiarioNombre
    const benNomRaw = bodyObj['beneficiarioNombre'];
    if (typeof benNomRaw !== 'string') {
      throw new NombreInvalidoError();
    }
    const benNomTrimmed = benNomRaw.trim();
    if (benNomTrimmed.length < 1 || benNomTrimmed.length > LARGO_MAXIMO_NOMBRE) {
      throw new NombreInvalidoError();
    }

    // 3.7 retiradorNombre
    const retNomRaw = bodyObj['retiradorNombre'];
    if (typeof retNomRaw !== 'string') {
      throw new NombreInvalidoError();
    }
    const retNomTrimmed = retNomRaw.trim();
    if (retNomTrimmed.length < 1 || retNomTrimmed.length > LARGO_MAXIMO_NOMBRE) {
      throw new NombreInvalidoError();
    }

    // 3.8 glosa
    const glosaRaw = bodyObj['glosa'];
    if (typeof glosaRaw !== 'string') {
      throw new GlosaInvalidaError();
    }
    const glosaTrimmed = glosaRaw.trim();
    if (glosaTrimmed.length < 1 || glosaTrimmed.length > LARGO_MAXIMO_GLOSA) {
      throw new GlosaInvalidaError();
    }

    // 4 y 5. Idempotencia y ejecución dentro de la transacción
    const resultado = await this.boletasService.emitir({
      titularId: titular.id,
      clave,
      body: bodyObj,
      cuentaOrigenId,
      montoCentavos,
      plazoDias,
      beneficiarioRut,
      beneficiarioNombre: benNomTrimmed,
      glosa: glosaTrimmed,
      retiradorRut,
      retiradorNombre: retNomTrimmed,
    });

    if (resultado.esReplay) {
      res.setHeader('Idempotency-Replayed', 'true');
      res.status(resultado.estadoHttp).json(resultado.respuesta);
      return;
    }

    res.status(201).json(resultado.respuesta);
  }

  @Get()
  async listar(@Req() req: Request, @Res() res: Response): Promise<void> {
    const titular = await this.authService.yo(req.headers['authorization']);
    const listado = await this.boletasService.listar(titular.id);
    res.status(200).json(listado);
  }

  @Get(':id')
  async consultarUna(@Req() req: Request, @Res() res: Response): Promise<void> {
    const titular = await this.authService.yo(req.headers['authorization']);
    const id = extraerIdParam(req);
    const boleta = await this.boletasService.consultarUna(titular.id, id);
    res.status(200).json(boleta);
  }

  @Post(':id/cobrar')
  async cobrar(@Req() req: Request, @Res() res: Response): Promise<void> {
    // 1. Idempotency-Key (Authorization se ignora si viene)
    const clave = this.extraerClave(req);

    // 2. Validate id
    const id = extraerIdParam(req);
    if (!UUID_REGEX.test(id)) {
      throw new BoletaNoEncontradaError();
    }

    // 3. Forma del cuerpo
    const body: unknown = req.body;
    const bodyObj = esObjeto(body) ? body : {};
    const rutRetiradorRaw = bodyObj['rutRetirador'];
    if (!esRutValido(rutRetiradorRaw)) {
      throw new RutInvalidoError();
    }
    const rutRetirador = normalizarRut(rutRetiradorRaw);

    // 4 y 5. Idempotencia y ejecución
    const resultado = await this.boletasService.cobrar({
      boletaId: id,
      rutRetirador,
      clave,
      bodyRutRetirador: rutRetiradorRaw,
    });

    if (resultado.esReplay) {
      res.setHeader('Idempotency-Replayed', 'true');
      res.status(resultado.estadoHttp).json(resultado.respuesta);
      return;
    }

    res.status(200).json(resultado.respuesta);
  }

  @Post(':id/vencer')
  async vencer(@Req() req: Request, @Res() res: Response): Promise<void> {
    // 1. Token -> titular
    const titular = await this.authService.yo(req.headers['authorization']);

    // 2. Idempotency-Key
    const clave = this.extraerClave(req);

    // 3. Validate id
    const id = extraerIdParam(req);
    if (!UUID_REGEX.test(id)) {
      throw new BoletaNoEncontradaError();
    }

    // 4 y 5. Idempotencia y ejecución
    const resultado = await this.boletasService.vencer({
      titularId: titular.id,
      boletaId: id,
      clave,
    });

    if (resultado.esReplay) {
      res.setHeader('Idempotency-Replayed', 'true');
      res.status(resultado.estadoHttp).json(resultado.respuesta);
      return;
    }

    res.status(200).json(resultado.respuesta);
  }

  @Post(':id/devolver')
  async devolver(@Req() req: Request, @Res() res: Response): Promise<void> {
    // 1. Token -> titular
    const titular = await this.authService.yo(req.headers['authorization']);

    // 2. Idempotency-Key
    const clave = this.extraerClave(req);

    // 3. Validate id
    const id = extraerIdParam(req);
    if (!UUID_REGEX.test(id)) {
      throw new BoletaNoEncontradaError();
    }

    // 4 y 5. Idempotencia y ejecución
    const resultado = await this.boletasService.devolver({
      titularId: titular.id,
      boletaId: id,
      clave,
    });

    if (resultado.esReplay) {
      res.setHeader('Idempotency-Replayed', 'true');
      res.status(resultado.estadoHttp).json(resultado.respuesta);
      return;
    }

    res.status(200).json(resultado.respuesta);
  }
}
