import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { estadoEn, type Estado } from '../../domain/boleta/boleta.js';
import { formatMoney } from '../../domain/money/money.js';
import { CuentasSistemaRepository } from '../../infra/cuentas-sistema.repository.js';
import {
  IdempotenciaEjecutor,
  type ResultadoIdempotente,
} from '../../infra/idempotencia.ejecutor.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { RelojService } from '../../infra/reloj.js';
import { TransferenciasService } from '../transferencias/transferencias.service.js';
import {
  CODIGO_CUENTA_CAJA,
  CODIGO_CUENTA_GARANTIA,
  CONCEPTO_COBRO_BOLETA,
  CONCEPTO_DEVOLUCION_BOLETA,
  CONCEPTO_EMISION_BOLETA,
  CONCEPTO_VENCIMIENTO_BOLETA,
  ENDPOINT_POST_BOLETAS,
  ENDPOINT_POST_BOLETAS_COBRAR,
  ENDPOINT_POST_BOLETAS_DEVOLVER,
  ENDPOINT_POST_BOLETAS_VENCER,
  MS_POR_DIA,
  UUID_REGEX,
} from './boletas.constants.js';
import {
  armarBoletaDto,
  esBoletaConTransaccionDto,
  reconstruirBoletaConTransaccion,
  type BoletaConTransaccionDto,
  type BoletaDto,
  type BoletasListadoDto,
} from './boletas.dto.js';
import {
  BoletaNoEncontradaError,
  BoletaNoVencidaError,
  CuentaNoEncontradaError,
  RetiradorNoAutorizadoError,
  TransicionInvalidaError,
} from './boletas.errors.js';

interface FilaBoletaDb {
  id: string;
  cuenta_id: string;
  monto_centavos: bigint;
  estado: Estado;
  emitida_en: Date;
  vence_en: Date;
  beneficiario_rut: string;
  beneficiario_nombre: string;
  glosa: string;
  retirador_rut: string;
  retirador_nombre: string;
  transaccion_emision_id: string;
  transaccion_cierre_id: string | null;
}

@Injectable()
export class BoletasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reloj: RelojService,
    private readonly idempotencia: IdempotenciaEjecutor,
    private readonly transferencias: TransferenciasService,
    private readonly cuentasSistema: CuentasSistemaRepository,
  ) {}

  async emitir(params: {
    titularId: string;
    clave: string;
    body: Record<string, unknown>;
    cuentaOrigenId: string;
    montoCentavos: bigint;
    plazoDias: number;
    beneficiarioRut: string;
    beneficiarioNombre: string;
    glosa: string;
    retiradorRut: string;
    retiradorNombre: string;
  }): Promise<ResultadoIdempotente<BoletaConTransaccionDto>> {
    const {
      titularId,
      clave,
      body,
      cuentaOrigenId,
      montoCentavos,
      plazoDias,
      beneficiarioRut,
      beneficiarioNombre,
      glosa,
      retiradorRut,
      retiradorNombre,
    } = params;

    return this.idempotencia.ejecutar<BoletaConTransaccionDto>({
      clave,
      endpoint: ENDPOINT_POST_BOLETAS,
      huellaDe: {
        titularId,
        cuentaOrigenId: body['cuentaOrigenId'],
        monto: body['monto'],
        plazoDias: body['plazoDias'],
        beneficiarioRut: body['beneficiarioRut'],
        beneficiarioNombre: body['beneficiarioNombre'],
        glosa: body['glosa'],
        retiradorRut: body['retiradorRut'],
        retiradorNombre: body['retiradorNombre'],
      },
      estadoHttp: 201,
      esRespuestaValida: esBoletaConTransaccionDto,
      reconstruir: reconstruirBoletaConTransaccion,
      operacion: async (tx) => {
        const cuentaOrigen = await tx.cuenta.findFirst({
          where: {
            id: cuentaOrigenId,
            titularId,
          },
        });

        if (!cuentaOrigen) {
          throw new CuentaNoEncontradaError(cuentaOrigenId);
        }

        // DEUDA-reloj · el instante se lee ANTES de escribir para compartirlo con la cuenta de
        // garantía, el asiento y la propia boleta.
        const emitidaEn = this.reloj.ahora();

        const cuentaGarantia = await this.cuentasSistema.obtenerOCrear(
          tx,
          CODIGO_CUENTA_GARANTIA,
          emitidaEn,
        );

        const transaccionId = randomUUID();
        await this.transferencias.transferirEn(tx, {
          transaccionId,
          origenId: cuentaOrigenId,
          destinoId: cuentaGarantia.id,
          montoCentavos,
          concepto: CONCEPTO_EMISION_BOLETA,
          en: emitidaEn,
        });

        const venceEn = new Date(emitidaEn.getTime() + plazoDias * MS_POR_DIA);

        const boletaId = randomUUID();
        await tx.boleta.create({
          data: {
            id: boletaId,
            cuentaId: cuentaOrigenId,
            montoCentavos,
            estado: 'VIGENTE',
            emitidaEn,
            venceEn,
            beneficiarioRut,
            beneficiarioNombre,
            glosa,
            retiradorRut,
            retiradorNombre,
            transaccionEmisionId: transaccionId,
            transaccionCierreId: null,
          },
        });

        return reconstruirBoletaConTransaccion({
          id: boletaId,
          estado: 'VIGENTE',
          monto: formatMoney(montoCentavos),
          cuentaOrigenId,
          beneficiarioRut,
          beneficiarioNombre,
          glosa,
          retiradorRut,
          retiradorNombre,
          emitidaEn: emitidaEn.toISOString(),
          venceEn: venceEn.toISOString(),
          fondosLiberados: false,
          transaccionId,
        });
      },
    });
  }

  async listar(titularId: string): Promise<BoletasListadoDto> {
    const boletas = await this.prisma.boleta.findMany({
      where: {
        cuenta: {
          titularId,
        },
      },
      orderBy: [{ emitidaEn: 'asc' }, { id: 'asc' }],
    });

    const ahora = this.reloj.ahora();
    return {
      boletas: boletas.map((b) => armarBoletaDto(b, ahora)),
    };
  }

  async consultarUna(titularId: string, id: string): Promise<BoletaDto> {
    if (!UUID_REGEX.test(id)) {
      throw new BoletaNoEncontradaError();
    }

    const boleta = await this.prisma.boleta.findUnique({
      where: { id },
      include: { cuenta: true },
    });

    if (!boleta || boleta.cuenta.titularId !== titularId) {
      throw new BoletaNoEncontradaError();
    }

    const ahora = this.reloj.ahora();
    return armarBoletaDto(boleta, ahora);
  }

  async cobrar(params: {
    boletaId: string;
    rutRetirador: string;
    clave: string;
    bodyRutRetirador: unknown;
  }): Promise<ResultadoIdempotente<BoletaConTransaccionDto>> {
    const { boletaId, rutRetirador, clave, bodyRutRetirador } = params;

    return this.idempotencia.ejecutar<BoletaConTransaccionDto>({
      clave,
      endpoint: ENDPOINT_POST_BOLETAS_COBRAR,
      huellaDe: {
        boletaId,
        rutRetirador: bodyRutRetirador,
      },
      estadoHttp: 200,
      esRespuestaValida: esBoletaConTransaccionDto,
      reconstruir: reconstruirBoletaConTransaccion,
      operacion: async (tx) => {
        const filas = await tx.$queryRaw<FilaBoletaDb[]>(
          Prisma.sql`SELECT * FROM boleta WHERE id = ${boletaId}::uuid FOR UPDATE`,
        );
        const boleta = filas[0];
        if (!boleta) {
          throw new BoletaNoEncontradaError();
        }

        if (rutRetirador !== boleta.retirador_rut) {
          throw new RetiradorNoAutorizadoError();
        }

        const ahora = this.reloj.ahora();
        const fechaEmitida =
          boleta.emitida_en instanceof Date ? boleta.emitida_en : new Date(boleta.emitida_en);
        const fechaVence =
          boleta.vence_en instanceof Date ? boleta.vence_en : new Date(boleta.vence_en);

        const estadoActual = estadoEn(
          {
            id: boleta.id,
            monto: BigInt(boleta.monto_centavos),
            emitidaEn: fechaEmitida,
            venceEn: fechaVence,
            estado: boleta.estado,
          },
          ahora,
        );

        if (estadoActual !== 'VIGENTE') {
          throw new TransicionInvalidaError();
        }

        const cuentaGarantia = await this.cuentasSistema.obtenerOCrear(
          tx,
          CODIGO_CUENTA_GARANTIA,
          ahora,
        );
        const cuentaCaja = await this.cuentasSistema.obtenerOCrear(
          tx,
          CODIGO_CUENTA_CAJA,
          ahora,
        );

        const transaccionId = randomUUID();
        const montoCentavos = BigInt(boleta.monto_centavos);
        await this.transferencias.transferirEn(tx, {
          transaccionId,
          origenId: cuentaGarantia.id,
          destinoId: cuentaCaja.id,
          montoCentavos,
          concepto: CONCEPTO_COBRO_BOLETA,
          en: ahora,
        });

        await tx.boleta.update({
          where: { id: boleta.id },
          data: {
            estado: 'COBRADA',
            transaccionCierreId: transaccionId,
          },
        });

        return reconstruirBoletaConTransaccion({
          id: boleta.id,
          estado: 'COBRADA',
          monto: formatMoney(montoCentavos),
          cuentaOrigenId: boleta.cuenta_id,
          beneficiarioRut: boleta.beneficiario_rut,
          beneficiarioNombre: boleta.beneficiario_nombre,
          glosa: boleta.glosa,
          retiradorRut: boleta.retirador_rut,
          retiradorNombre: boleta.retirador_nombre,
          emitidaEn: fechaEmitida.toISOString(),
          venceEn: fechaVence.toISOString(),
          fondosLiberados: true,
          transaccionId,
        });
      },
    });
  }

  async vencer(params: {
    titularId: string;
    boletaId: string;
    clave: string;
  }): Promise<ResultadoIdempotente<BoletaConTransaccionDto>> {
    const { titularId, boletaId, clave } = params;

    return this.idempotencia.ejecutar<BoletaConTransaccionDto>({
      clave,
      endpoint: ENDPOINT_POST_BOLETAS_VENCER,
      huellaDe: {
        titularId,
        boletaId,
      },
      estadoHttp: 200,
      esRespuestaValida: esBoletaConTransaccionDto,
      reconstruir: reconstruirBoletaConTransaccion,
      operacion: async (tx) => {
        const filas = await tx.$queryRaw<FilaBoletaDb[]>(
          Prisma.sql`SELECT * FROM boleta WHERE id = ${boletaId}::uuid FOR UPDATE`,
        );
        const boleta = filas[0];
        if (!boleta) {
          throw new BoletaNoEncontradaError();
        }

        const cuenta = await tx.cuenta.findUnique({
          where: { id: boleta.cuenta_id },
        });
        if (!cuenta || cuenta.titularId !== titularId) {
          throw new BoletaNoEncontradaError();
        }

        if (boleta.estado !== 'VIGENTE') {
          throw new TransicionInvalidaError();
        }

        const ahora = this.reloj.ahora();
        const fechaEmitida =
          boleta.emitida_en instanceof Date ? boleta.emitida_en : new Date(boleta.emitida_en);
        const fechaVence =
          boleta.vence_en instanceof Date ? boleta.vence_en : new Date(boleta.vence_en);

        const estadoActual = estadoEn(
          {
            id: boleta.id,
            monto: BigInt(boleta.monto_centavos),
            emitidaEn: fechaEmitida,
            venceEn: fechaVence,
            estado: boleta.estado,
          },
          ahora,
        );

        if (estadoActual !== 'VENCIDA') {
          throw new BoletaNoVencidaError();
        }

        const cuentaGarantia = await this.cuentasSistema.obtenerOCrear(
          tx,
          CODIGO_CUENTA_GARANTIA,
          ahora,
        );

        const transaccionId = randomUUID();
        const montoCentavos = BigInt(boleta.monto_centavos);
        await this.transferencias.transferirEn(tx, {
          transaccionId,
          origenId: cuentaGarantia.id,
          destinoId: boleta.cuenta_id,
          montoCentavos,
          concepto: CONCEPTO_VENCIMIENTO_BOLETA,
          en: ahora,
        });

        await tx.boleta.update({
          where: { id: boleta.id },
          data: {
            estado: 'VENCIDA',
            transaccionCierreId: transaccionId,
          },
        });

        return reconstruirBoletaConTransaccion({
          id: boleta.id,
          estado: 'VENCIDA',
          monto: formatMoney(montoCentavos),
          cuentaOrigenId: boleta.cuenta_id,
          beneficiarioRut: boleta.beneficiario_rut,
          beneficiarioNombre: boleta.beneficiario_nombre,
          glosa: boleta.glosa,
          retiradorRut: boleta.retirador_rut,
          retiradorNombre: boleta.retirador_nombre,
          emitidaEn: fechaEmitida.toISOString(),
          venceEn: fechaVence.toISOString(),
          fondosLiberados: true,
          transaccionId,
        });
      },
    });
  }

  async devolver(params: {
    titularId: string;
    boletaId: string;
    clave: string;
  }): Promise<ResultadoIdempotente<BoletaConTransaccionDto>> {
    const { titularId, boletaId, clave } = params;

    return this.idempotencia.ejecutar<BoletaConTransaccionDto>({
      clave,
      endpoint: ENDPOINT_POST_BOLETAS_DEVOLVER,
      huellaDe: {
        titularId,
        boletaId,
      },
      estadoHttp: 200,
      esRespuestaValida: esBoletaConTransaccionDto,
      reconstruir: reconstruirBoletaConTransaccion,
      operacion: async (tx) => {
        const filas = await tx.$queryRaw<FilaBoletaDb[]>(
          Prisma.sql`SELECT * FROM boleta WHERE id = ${boletaId}::uuid FOR UPDATE`,
        );
        const boleta = filas[0];
        if (!boleta) {
          throw new BoletaNoEncontradaError();
        }

        const cuenta = await tx.cuenta.findUnique({
          where: { id: boleta.cuenta_id },
        });
        if (!cuenta || cuenta.titularId !== titularId) {
          throw new BoletaNoEncontradaError();
        }

        const ahora = this.reloj.ahora();
        const fechaEmitida =
          boleta.emitida_en instanceof Date ? boleta.emitida_en : new Date(boleta.emitida_en);
        const fechaVence =
          boleta.vence_en instanceof Date ? boleta.vence_en : new Date(boleta.vence_en);

        const estadoActual = estadoEn(
          {
            id: boleta.id,
            monto: BigInt(boleta.monto_centavos),
            emitidaEn: fechaEmitida,
            venceEn: fechaVence,
            estado: boleta.estado,
          },
          ahora,
        );

        if (estadoActual !== 'VIGENTE') {
          throw new TransicionInvalidaError();
        }

        const cuentaGarantia = await this.cuentasSistema.obtenerOCrear(
          tx,
          CODIGO_CUENTA_GARANTIA,
          ahora,
        );

        const transaccionId = randomUUID();
        const montoCentavos = BigInt(boleta.monto_centavos);
        await this.transferencias.transferirEn(tx, {
          transaccionId,
          origenId: cuentaGarantia.id,
          destinoId: boleta.cuenta_id,
          montoCentavos,
          concepto: CONCEPTO_DEVOLUCION_BOLETA,
          en: ahora,
        });

        await tx.boleta.update({
          where: { id: boleta.id },
          data: {
            estado: 'DEVUELTA',
            transaccionCierreId: transaccionId,
          },
        });

        return reconstruirBoletaConTransaccion({
          id: boleta.id,
          estado: 'DEVUELTA',
          monto: formatMoney(montoCentavos),
          cuentaOrigenId: boleta.cuenta_id,
          beneficiarioRut: boleta.beneficiario_rut,
          beneficiarioNombre: boleta.beneficiario_nombre,
          glosa: boleta.glosa,
          retiradorRut: boleta.retirador_rut,
          retiradorNombre: boleta.retirador_nombre,
          emitidaEn: fechaEmitida.toISOString(),
          venceEn: fechaVence.toISOString(),
          fondosLiberados: true,
          transaccionId,
        });
      },
    });
  }
}
