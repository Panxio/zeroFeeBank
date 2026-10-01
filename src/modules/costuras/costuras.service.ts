import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma.service.js';
import { RelojService } from '../../infra/reloj.js';
import { CuentasSistemaRepository } from '../../infra/cuentas-sistema.repository.js';
import { AuthService } from '../auth/auth.service.js';
import {
  CODIGO_CUENTA_CAJA,
  CODIGO_CUENTA_GARANTIA,
  MS_POR_DIA,
} from '../boletas/boletas.constants.js';
import { CosturasDuenoDbService } from './costuras.dueno-db.service.js';
import { ESCENARIOS_VALIDOS, type EscenarioValido } from './costuras.escenarios.js';
import {
  EscenarioDesconocidoError,
  RelojAvanceInvalidoError,
  RelojInstanteInvalidoError,
  RelojNoFijadoError,
  RelojPeticionInvalidaError,
} from './costuras.errors.js';

export interface CuentaSembradaRespuesta {
  id: string;
  tipo: 'CORRIENTE' | 'AHORRO' | 'SISTEMA';
  saldoCentavos: string;
}

export interface MovimientoSembradoRespuesta {
  id: string;
  transaccionId: string;
  cuentaId: string;
  /** String decimal con signo (D1). El borde JSON nunca expone un bigint. */
  montoCentavos: string;
  /** ISO-8601 en UTC. Es la fecha por la que S-13 filtra. */
  creadoEn: string;
}

export interface SeedRespuesta {
  escenario: string;
  usuarioId: string;
  cuentas: CuentaSembradaRespuesta[];
  cuentaSistemaId: string;
  /**
   * Los cuatro campos de abajo SÓLO los llena 'movimientos-buscables'. Son el oráculo de
   * S-13: sin ellos la suite tendría que adivinar qué sembró el seed, y C1 lo prohíbe
   * expresamente ("una suite que tiene que adivinar el id termina raspando el DOM").
   */
  movimientos?: MovimientoSembradoRespuesta[];
  usuarioAjenoId?: string;
  cuentaAjenaId?: string;
  cuentaTopeId?: string;
  /**
   * S-23 · SÓLO los llena 'boletas-en-cada-estado'. La credencial sirve para entrar
   * (contraseña real, hasheada por AuthService); las boletas van por etiqueta, en el
   * orden de la tabla de specs/S-23-boletas-seed.md.
   */
  credenciales?: { email: string; password: string };
  boletas?: Array<{ etiqueta: string; id: string; montoCentavos: string }>;
}

export interface RelojRespuesta {
  ahora: string;
  fijado: boolean;
}

export interface ResetRespuesta {
  ok: boolean;
  tablasVaciadas: string[];
}

const PASSWORD_HASH_SEMILLA = '!NO-UTILIZABLE-S07!';

// ─── Escenario 'boletas-en-cada-estado' · la población que S-23 necesita ────────────────
//
// De specs/S-23-boletas-seed.md § Constantes, AL PIE DE LA LETRA. F = this.relojService.ahora()
// al sembrar (J4: nada de `new Date()` sin argumento); d = MS_POR_DIA; plazo 30 días.
// Los montos son potencias de 2 × 10 (J6). El escenario usa los datos del arnés de S-09.
// Conceptos PROPIOS de siembra, como SIEMBRA_ARNES y SIEMBRA_BUSQUEDA: los reales
// (EMISION_BOLETA…) exigen una Idempotency-Key que los reclame (I5, D5), y un asiento sembrado no
// nace de un POST. Mismas cuentas, montos y signos que el servicio; distinto concepto.
const SIEMBRA_BOLETA_EMISION = 'SIEMBRA_BOLETA_EMISION';
const SIEMBRA_BOLETA_COBRO = 'SIEMBRA_BOLETA_COBRO';
const SIEMBRA_BOLETA_VENCIMIENTO = 'SIEMBRA_BOLETA_VENCIMIENTO';
const SIEMBRA_BOLETA_DEVOLUCION = 'SIEMBRA_BOLETA_DEVOLUCION';
const BOLETAS_S23: ReadonlyArray<{
  etiqueta: string;
  montoCentavos: bigint;
  emitidaDias: number;
  cierre: {
    concepto: string;
    dias: number;
    // destino del cierre: cobro → CAJA; vencimiento y devolución → cuenta del titular
    destino: 'CAJA' | 'CUENTA';
  } | null;
  estadoCerrado: 'VENCIDA' | 'COBRADA' | 'DEVUELTA' | null;
}> = [
  { etiqueta: 'VIGENTE', montoCentavos: 16000n, emitidaDias: -1, cierre: null, estadoCerrado: null },
  { etiqueta: 'VENCIDA_POR_LIBERAR', montoCentavos: 8000n, emitidaDias: -31, cierre: null, estadoCerrado: null },
  {
    etiqueta: 'VENCIDA_LIBERADA',
    montoCentavos: 4000n,
    emitidaDias: -32,
    cierre: { concepto: SIEMBRA_BOLETA_VENCIMIENTO, dias: -1, destino: 'CUENTA' },
    estadoCerrado: 'VENCIDA',
  },
  {
    etiqueta: 'COBRADA',
    montoCentavos: 2000n,
    emitidaDias: -20,
    cierre: { concepto: SIEMBRA_BOLETA_COBRO, dias: -10, destino: 'CAJA' },
    estadoCerrado: 'COBRADA',
  },
  {
    etiqueta: 'DEVUELTA',
    montoCentavos: 1000n,
    emitidaDias: -15,
    cierre: { concepto: SIEMBRA_BOLETA_DEVOLUCION, dias: -5, destino: 'CUENTA' },
    estadoCerrado: 'DEVUELTA',
  },
];
const PLAZO_S23_DIAS = 30;
const FONDEO_S23_CENTAVOS = 100000n;
const DIAS_ANTES_FONDEO = 40;
const RUT_BENEFICIARIO_S23 = '12345678-5';
const NOMBRE_BENEFICIARIO_S23 = 'Constructora Andes SpA';
const GLOSA_S23 = 'Fiel cumplimiento contrato 123';
const RUT_RETIRADOR_S23 = '9876543-3';
const NOMBRE_RETIRADOR_S23 = 'Ana Soto';


// ─── Escenario 'movimientos-buscables' · la población que S-13 necesita ─────────────────
//
// POR QUÉ EXISTE. Los otros tres escenarios siembran con UNA sola fecha (`reloj.ahora()`) y
// montos iguales. Contra una población así, un buscador que filtra bien y uno que ignora el
// filtro y devuelve todo son INDISTINGUIBLES: el arnés daría verde sobre un endpoint que no
// filtra nada. Es un arnés ciego, aplicado a los datos.
//
// LAS FECHAS SON ABSOLUTAS, no derivadas del reloj, porque C2 exige que los datos sembrados
// sean estables entre corridas. Y son UTC porque el corte de día del filtro es UTC.
//
// CÓMO ESTÁ ARMADA. Cada filtro tiene que devolver un subconjunto PROPIO y NO VACÍO, y el
// AND de dos tiene que ser distinto de cada uno por separado. Si no, el brazo no distingue
// «filtró» de «no filtró»:
//   día 2026-03-01           -> 3 de 10   (e incluye los dos bordes del día)
//   rango 03-01 .. 03-02     -> 6 de 10
//   monto 25.00 (absoluto)   -> 3 de 10   (dos débitos y un crédito: el signo no confunde)
//   día 03-01 AND monto 25.00-> 1 de 10   <- el brazo que caza «ignora uno de los filtros»
const MOVIMIENTOS_BUSCABLES: ReadonlyArray<{ iso: string; centavos: bigint }> = [
  { iso: '2026-03-01T00:00:00.000Z', centavos: 100000n },
  { iso: '2026-03-01T12:00:00.000Z', centavos: -2500n },
  { iso: '2026-03-01T23:59:59.999Z', centavos: 7500n },
  { iso: '2026-03-02T00:00:00.000Z', centavos: -2500n },
  { iso: '2026-03-02T09:30:00.000Z', centavos: 50000n },
  { iso: '2026-03-02T18:45:00.000Z', centavos: -12345n },
  { iso: '2026-03-03T00:00:00.000Z', centavos: 7500n },
  { iso: '2026-03-03T06:15:00.000Z', centavos: -99999n },
  { iso: '2026-03-03T23:59:59.999Z', centavos: 2500n },
  { iso: '2026-03-04T00:00:00.000Z', centavos: -1n },
];

// La cuenta AJENA colisiona A PROPÓSITO en fecha y monto con la del titular. Si el filtro de
// titularidad desapareciera entero, «día 2026-03-01» pasaría de 3 a 5 y «monto 25.00» de 3 a
// 4: el brazo se pone rojo. Sin esta colisión, ajena e inexistente responden ambas 404 y son
// indistinguibles.
const MOVIMIENTOS_AJENOS: ReadonlyArray<{ iso: string; centavos: bigint }> = [
  { iso: '2026-03-01T06:00:00.000Z', centavos: -2500n },
  { iso: '2026-03-01T18:00:00.000Z', centavos: 7500n },
  { iso: '2026-03-02T12:00:00.000Z', centavos: 50000n },
];

// La cuenta del TOPE: 51 movimientos, uno más que el tope de 50. Los primeros 50 comparten el
// MISMO instante exacto y el último es 1 h más nuevo (D15). El instante repetido obliga a
// que el orden tenga un desempate estable —lo único que hace no-intermitente una aserción sobre
// `movimientos[0]` (C2)— y el corte por tope cae DENTRO del empate. La fila más nueva (mismo día
// UTC) hace que un `sort` ascendente sí mueva filas: sin ella, B7 era ciego a un reordenamiento.
const TOPE_INSTANTE_ISO = '2026-04-01T00:00:00.000Z';
const TOPE_INSTANTE_NUEVA_ISO = '2026-04-01T01:00:00.000Z';
const TOPE_CANTIDAD = 51;
const TOPE_CENTAVOS = 100n;

const CONCEPTO_SIEMBRA_BUSQUEDA = 'SIEMBRA_BUSQUEDA';

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

@Injectable()
export class CosturasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly relojService: RelojService,
    private readonly duenoDb: CosturasDuenoDbService,
    // S-23 · GARANTIA y CAJA por el ÚNICO mecanismo de cuentas de sistema (J5) y la
    // contraseña del escenario hasheada por el mismo scrypt de /auth.
    private readonly cuentasSistema: CuentasSistemaRepository,
    private readonly auth: AuthService,
  ) {}

  async reset(): Promise<ResetRespuesta> {
    await this.duenoDb.vaciarBase();
    this.relojService.desfijar();
    return {
      ok: true,
      tablasVaciadas: [
        'movimiento',
        'transaccion',
        'boleta',
        'clave_idempotencia',
        'cuenta',
        'usuario',
      ],
    };
  }

  reloj(body: unknown): RelojRespuesta {
    if (!esObjeto(body)) {
      throw new RelojPeticionInvalidaError();
    }

    const tieneInstante = 'instante' in body;
    const tieneAvanzarMs = 'avanzarMs' in body;

    if (
      (tieneInstante && tieneAvanzarMs) ||
      (!tieneInstante && !tieneAvanzarMs)
    ) {
      throw new RelojPeticionInvalidaError();
    }

    if (tieneInstante) {
      const instante = body['instante'];
      if (instante === null) {
        this.relojService.desfijar();
        return {
          ahora: this.relojService.ahora().toISOString(),
          fijado: false,
        };
      }

      if (typeof instante !== 'string') {
        throw new RelojInstanteInvalidoError();
      }

      const isoRegex =
        /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
      const parsed = new Date(instante);
      if (!isoRegex.test(instante) || Number.isNaN(parsed.getTime())) {
        throw new RelojInstanteInvalidoError();
      }

      this.relojService.fijar(parsed);
      return {
        ahora: this.relojService.ahora().toISOString(),
        fijado: true,
      };
    }

    const avanzarMs = body['avanzarMs'];
    if (
      typeof avanzarMs !== 'number' ||
      !Number.isInteger(avanzarMs) ||
      avanzarMs < 0
    ) {
      throw new RelojAvanceInvalidoError();
    }

    if (!this.relojService.estaFijado()) {
      throw new RelojNoFijadoError();
    }

    const nuevoAhora = this.relojService.avanzar(avanzarMs);
    return {
      ahora: nuevoAhora.toISOString(),
      fijado: true,
    };
  }

  async seed(body: unknown): Promise<SeedRespuesta> {
    // Decisión 3: validar el cuerpo y resolver el escenario en el catálogo
    // ANTES de abrir la transacción.
    if (!esObjeto(body) || typeof body['escenario'] !== 'string') {
      const valor = esObjeto(body) ? body['escenario'] : undefined;
      throw new EscenarioDesconocidoError(valor);
    }

    const escenario = body['escenario'];
    if (
      !ESCENARIOS_VALIDOS.includes(escenario as EscenarioValido)
    ) {
      throw new EscenarioDesconocidoError(escenario);
    }

    return this.prisma.$transaction(async (tx) => {
      const fecha = this.relojService.ahora();

      if (escenario === 'boletas-en-cada-estado') {
        return this.sembrarBoletasEnCadaEstado(tx);
      }

      const usuarioId = randomUUID();
      const cuentaSistemaId = randomUUID();
      const emailUsuario = `usuario-${usuarioId}@zerofeebank.local`;

      // S-28 (D90-1): 'movimientos-buscables' es el ORÁCULO DE PANTALLA de
      // S-17-movimientos, y desde la pantalla hay que poder ENTRAR como su titular. Con
      // PASSWORD_HASH_SEMILLA no se puede, así que todo brazo de interfaz que lo use nacía
      // IMPOSIBLE —rojo sobre una app sana—, un arnés imposible que ninguna calibración
      // caza. Mismo camino que 'boletas-en-cada-estado': clave aleatoria por seed (J7: nunca
      // una constante del repositorio) hasheada por AuthService, el mismo camino del registro
      // real. Los demás escenarios NO cambian (S-28 § 3), y el usuario AJENO tampoco: nadie
      // debe poder entrar como él.
      const passwordClaro =
        escenario === 'movimientos-buscables' ? randomBytes(18).toString('base64url') : null;
      const passwordHash =
        passwordClaro === null
          ? PASSWORD_HASH_SEMILLA
          : await this.auth.hashearPassword(passwordClaro);

      await tx.usuario.create({
        data: {
          id: usuarioId,
          email: emailUsuario,
          passwordHash,
          creadoEn: fecha,
        },
      });

      await tx.cuenta.create({
        data: {
          id: cuentaSistemaId,
          tipo: 'SISTEMA',
          titularId: null,
          codigo: null,
          limiteSobregiroCentavos: 0n,
          creadaEn: fecha,
        },
      });

      if (escenario === 'cuenta-unica') {
        const cuentaId = randomUUID();
        const transaccionId = randomUUID();

        await tx.cuenta.create({
          data: {
            id: cuentaId,
            tipo: 'CORRIENTE',
            titularId: usuarioId,
            codigo: null,
            limiteSobregiroCentavos: 0n,
            creadaEn: fecha,
          },
        });

        await tx.transaccion.create({
          data: {
            id: transaccionId,
            concepto: 'SIEMBRA',
            creadaEn: fecha,
          },
        });

        await tx.movimiento.createMany({
          data: [
            {
              id: randomUUID(),
              transaccionId,
              cuentaId,
              montoCentavos: 100000n,
              creadoEn: fecha,
            },
            {
              id: randomUUID(),
              transaccionId,
              cuentaId: cuentaSistemaId,
              montoCentavos: -100000n,
              creadoEn: fecha,
            },
          ],
        });

        return {
          escenario: 'cuenta-unica',
          usuarioId,
          cuentas: [
            { id: cuentaId, tipo: 'CORRIENTE', saldoCentavos: '100000' },
          ],
          cuentaSistemaId,
        };
      }

      if (escenario === 'dos-cuentas') {
        const cuenta1Id = randomUUID();
        const cuenta2Id = randomUUID();
        const transaccionId = randomUUID();

        await tx.cuenta.createMany({
          data: [
            {
              id: cuenta1Id,
              tipo: 'CORRIENTE',
              titularId: usuarioId,
              codigo: null,
              limiteSobregiroCentavos: 0n,
              creadaEn: fecha,
            },
            {
              id: cuenta2Id,
              tipo: 'CORRIENTE',
              titularId: usuarioId,
              codigo: null,
              limiteSobregiroCentavos: 0n,
              creadaEn: fecha,
            },
          ],
        });

        await tx.transaccion.create({
          data: {
            id: transaccionId,
            concepto: 'SIEMBRA',
            creadaEn: fecha,
          },
        });

        await tx.movimiento.createMany({
          data: [
            {
              id: randomUUID(),
              transaccionId,
              cuentaId: cuenta1Id,
              montoCentavos: 100000n,
              creadoEn: fecha,
            },
            {
              id: randomUUID(),
              transaccionId,
              cuentaId: cuentaSistemaId,
              montoCentavos: -100000n,
              creadoEn: fecha,
            },
          ],
        });

        return {
          escenario: 'dos-cuentas',
          usuarioId,
          cuentas: [
            { id: cuenta1Id, tipo: 'CORRIENTE', saldoCentavos: '100000' },
            { id: cuenta2Id, tipo: 'CORRIENTE', saldoCentavos: '0' },
          ],
          cuentaSistemaId,
        };
      }

      if (escenario === 'movimientos-buscables') {
        // S-28: la clave en claro nace arriba para ESTE escenario. Si alguna vez dejara de
        // nacer, este seed tiene que reventar ruidosamente y no devolver una credencial
        // inservible: una costura que miente es peor que una que no existe (perfil SUT).
        if (passwordClaro === null) {
          throw new Error('S-28: movimientos-buscables se sembró sin clave en claro');
        }
        const cuentaBuscableId = randomUUID();
        const cuentaTopeId = randomUUID();
        const usuarioAjenoId = randomUUID();
        const cuentaAjenaId = randomUUID();

        await tx.usuario.create({
          data: {
            id: usuarioAjenoId,
            email: `ajeno-${usuarioAjenoId}@zerofeebank.local`,
            passwordHash: PASSWORD_HASH_SEMILLA,
            creadoEn: fecha,
          },
        });

        await tx.cuenta.createMany({
          data: [
            {
              id: cuentaBuscableId,
              tipo: 'CORRIENTE',
              titularId: usuarioId,
              codigo: null,
              limiteSobregiroCentavos: 0n,
              creadaEn: fecha,
            },
            {
              id: cuentaTopeId,
              tipo: 'CORRIENTE',
              titularId: usuarioId,
              codigo: null,
              limiteSobregiroCentavos: 0n,
              creadaEn: fecha,
            },
            {
              id: cuentaAjenaId,
              tipo: 'CORRIENTE',
              titularId: usuarioAjenoId,
              codigo: null,
              limiteSobregiroCentavos: 0n,
              creadaEn: fecha,
            },
          ],
        });

        const transaccionesData: Array<{ id: string; concepto: string; creadaEn: Date }> = [];
        const movimientosData: Array<{
          id: string;
          transaccionId: string;
          cuentaId: string;
          montoCentavos: bigint;
          creadoEn: Date;
        }> = [];
        const oraculo: MovimientoSembradoRespuesta[] = [];

        // Cada movimiento sembrado lleva SU PROPIA transacción con dos patas que suman 0
        // (D2). Sembrar una sola pata dejaría I1 e I2 en rojo, y el arnés de S-13 estaría
        // apoyado en una base descuadrada: un arnés no puede pedir una base que su propio
        // sistema declara inválida.
        const sembrarPar = (
          cuentaId: string,
          centavos: bigint,
          iso: string,
          registrarEnOraculo: boolean,
        ): void => {
          const creadoEn = new Date(iso);
          const txId = randomUUID();
          const movId = randomUUID();
          transaccionesData.push({
            id: txId,
            concepto: CONCEPTO_SIEMBRA_BUSQUEDA,
            creadaEn: creadoEn,
          });
          movimientosData.push(
            {
              id: movId,
              transaccionId: txId,
              cuentaId,
              montoCentavos: centavos,
              creadoEn,
            },
            {
              id: randomUUID(),
              transaccionId: txId,
              cuentaId: cuentaSistemaId,
              montoCentavos: -centavos,
              creadoEn,
            },
          );
          if (registrarEnOraculo) {
            oraculo.push({
              id: movId,
              transaccionId: txId,
              cuentaId,
              montoCentavos: centavos.toString(),
              creadoEn: creadoEn.toISOString(),
            });
          }
        };

        for (const m of MOVIMIENTOS_BUSCABLES) {
          sembrarPar(cuentaBuscableId, m.centavos, m.iso, true);
        }
        for (const m of MOVIMIENTOS_AJENOS) {
          sembrarPar(cuentaAjenaId, m.centavos, m.iso, false);
        }
        for (let i = 0; i < TOPE_CANTIDAD - 1; i++) {
          sembrarPar(cuentaTopeId, TOPE_CENTAVOS, TOPE_INSTANTE_ISO, false);
        }
        sembrarPar(cuentaTopeId, TOPE_CENTAVOS, TOPE_INSTANTE_NUEVA_ISO, false);

        await tx.transaccion.createMany({ data: transaccionesData });
        await tx.movimiento.createMany({ data: movimientosData });

        const saldoBuscable = MOVIMIENTOS_BUSCABLES.reduce((a, m) => a + m.centavos, 0n);
        const saldoAjena = MOVIMIENTOS_AJENOS.reduce((a, m) => a + m.centavos, 0n);
        const saldoTope = TOPE_CENTAVOS * BigInt(TOPE_CANTIDAD);

        return {
          escenario: 'movimientos-buscables',
          usuarioId,
          cuentas: [
            {
              id: cuentaBuscableId,
              tipo: 'CORRIENTE' as const,
              saldoCentavos: saldoBuscable.toString(),
            },
            {
              id: cuentaTopeId,
              tipo: 'CORRIENTE' as const,
              saldoCentavos: saldoTope.toString(),
            },
            {
              id: cuentaAjenaId,
              tipo: 'CORRIENTE' as const,
              saldoCentavos: saldoAjena.toString(),
            },
          ],
          cuentaSistemaId,
          usuarioAjenoId,
          cuentaAjenaId,
          cuentaTopeId,
          movimientos: oraculo,
          // S-28 · la credencial del TITULAR de las tres cuentas (no la del ajeno).
          credenciales: { email: emailUsuario, password: passwordClaro },
        };
      }

      // escenario === 'cuenta-con-historial'
      const cuentaId = randomUUID();
      await tx.cuenta.create({
        data: {
          id: cuentaId,
          tipo: 'CORRIENTE',
          titularId: usuarioId,
          codigo: null,
          limiteSobregiroCentavos: 0n,
          creadaEn: fecha,
        },
      });

      const transaccionesData: Array<{
        id: string;
        concepto: string;
        creadaEn: Date;
      }> = [];

      const movimientosData: Array<{
        id: string;
        transaccionId: string;
        cuentaId: string;
        montoCentavos: bigint;
        creadoEn: Date;
      }> = [];

      for (let i = 0; i < 20; i++) {
        const txId = randomUUID();
        transaccionesData.push({
          id: txId,
          concepto: 'SIEMBRA',
          creadaEn: fecha,
        });
        movimientosData.push(
          {
            id: randomUUID(),
            transaccionId: txId,
            cuentaId,
            montoCentavos: 5000n,
            creadoEn: fecha,
          },
          {
            id: randomUUID(),
            transaccionId: txId,
            cuentaId: cuentaSistemaId,
            montoCentavos: -5000n,
            creadoEn: fecha,
          },
        );
      }

      await tx.transaccion.createMany({ data: transaccionesData });
      await tx.movimiento.createMany({ data: movimientosData });

      return {
        escenario: 'cuenta-con-historial',
        usuarioId,
        cuentas: [
          { id: cuentaId, tipo: 'CORRIENTE', saldoCentavos: '100000' },
        ],
        cuentaSistemaId,
      };
    });
  }

  /**
   * S-23 · un titular con credencial que sirve para entrar, una cuenta CORRIENTE
   * fondeada y 5 boletas, una por estado (specs/S-23-boletas-seed.md § Constantes).
   *
   * J5: los asientos son EXACTAMENTE los que escribirían `emitir`/`vencer`/`cobrar`/
   * `devolver` — 2 movimientos que suman 0 (D2), mismo concepto, cuentas y signo. No se
   * usa TransferenciasService porque su `assertFondosSuficientes` y su bloqueo son del
   * jugador real; sembrar es poblar el estado que el sistema alcanza de verdad, con la
   * misma forma de asiento. Todo lo que escribe es INSERT (D3), dentro de la transacción
   * que `seed` ya abrió.
   */
  private async sembrarBoletasEnCadaEstado(
    tx: Prisma.TransactionClient,
  ): Promise<SeedRespuesta> {
    const f = this.relojService.ahora();
    const inst = (dias: number): Date => new Date(f.getTime() + dias * MS_POR_DIA);
    const fondoEn = inst(-DIAS_ANTES_FONDEO);

    const usuarioId = randomUUID();
    const cuentaSistemaId = randomUUID();
    const cuentaId = randomUUID();
    // J7: aleatoria en cada seed, nunca una constante del repositorio.
    const passwordClaro = randomBytes(18).toString('base64url');
    const passwordHash = await this.auth.hashearPassword(passwordClaro);

    await tx.usuario.create({
      data: {
        id: usuarioId,
        email: `usuario-${usuarioId}@zerofeebank.local`,
        passwordHash,
        creadoEn: fondoEn,
      },
    });

    // La cuenta SISTEMA propia del escenario, contrapartida del fondeo: la misma que
    // usan los otros 4 escenarios, y NO CAJA.
    await tx.cuenta.create({
      data: {
        id: cuentaSistemaId,
        tipo: 'SISTEMA',
        titularId: null,
        codigo: null,
        limiteSobregiroCentavos: 0n,
        creadaEn: fondoEn,
      },
    });
    await tx.cuenta.create({
      data: {
        id: cuentaId,
        tipo: 'CORRIENTE',
        titularId: usuarioId,
        codigo: null,
        limiteSobregiroCentavos: 0n,
        creadaEn: fondoEn,
      },
    });

    // Fondeo: 1000,00, en F − 40 d, antes de toda emisión.
    const fondeoTxId = randomUUID();
    await tx.transaccion.create({
      data: { id: fondeoTxId, concepto: 'SIEMBRA', creadaEn: fondoEn },
    });
    await tx.movimiento.createMany({
      data: [
        { id: randomUUID(), transaccionId: fondeoTxId, cuentaId, montoCentavos: FONDEO_S23_CENTAVOS, creadoEn: fondoEn },
        {
          id: randomUUID(),
          transaccionId: fondeoTxId,
          cuentaId: cuentaSistemaId,
          montoCentavos: -FONDEO_S23_CENTAVOS,
          creadoEn: fondoEn,
        },
      ],
    });

    // GARANTIA y CAJA por el mismo mecanismo que BoletasService (J5).
    const garantia = await this.cuentasSistema.obtenerOCrear(tx, CODIGO_CUENTA_GARANTIA, inst(-DIAS_ANTES_FONDEO));

    const boletas: Array<{ etiqueta: string; id: string; montoCentavos: string }> = [];

    for (const b of BOLETAS_S23) {
      const emitidaEn = inst(b.emitidaDias);
      const venceEn = inst(b.emitidaDias + PLAZO_S23_DIAS);
      const boletaId = randomUUID();
      const transaccionEmisionId = randomUUID();

      // Emisión: cuenta → GARANTIA, igual que `emitir` (concepto EMISION_BOLETA).
      await tx.transaccion.create({
        data: { id: transaccionEmisionId, concepto: SIEMBRA_BOLETA_EMISION, creadaEn: emitidaEn },
      });
      await tx.movimiento.createMany({
        data: [
          { id: randomUUID(), transaccionId: transaccionEmisionId, cuentaId, montoCentavos: -b.montoCentavos, creadoEn: emitidaEn },
          {
            id: randomUUID(),
            transaccionId: transaccionEmisionId,
            cuentaId: garantia.id,
            montoCentavos: b.montoCentavos,
            creadoEn: emitidaEn,
          },
        ],
      });

      let transaccionCierreId: string | null = null;
      if (b.cierre !== null) {
        const cierreEn = inst(b.cierre.dias);
        transaccionCierreId = randomUUID();
        await tx.transaccion.create({
          data: { id: transaccionCierreId, concepto: b.cierre.concepto, creadaEn: cierreEn },
        });
        const destinoId =
          b.cierre.destino === 'CAJA'
            ? (await this.cuentasSistema.obtenerOCrear(tx, CODIGO_CUENTA_CAJA, cierreEn)).id
            : cuentaId;
        // Cobro: GARANTIA → CAJA. Vencimiento y devolución: GARANTIA → cuenta.
        await tx.movimiento.createMany({
          data: [
            {
              id: randomUUID(),
              transaccionId: transaccionCierreId,
              cuentaId: garantia.id,
              montoCentavos: -b.montoCentavos,
              creadoEn: cierreEn,
            },
            {
              id: randomUUID(),
              transaccionId: transaccionCierreId,
              cuentaId: destinoId,
              montoCentavos: b.montoCentavos,
              creadoEn: cierreEn,
            },
          ],
        });
      }

      await tx.boleta.create({
        data: {
          id: boletaId,
          cuentaId,
          montoCentavos: b.montoCentavos,
          // La VENCIDA_POR_LIBERAR persiste VIGENTE (vencida sólo al leer); las otras
          // cerradas llevan su estado y su asiento (K4 cazado aquí).
          estado: b.estadoCerrado ?? 'VIGENTE',
          emitidaEn,
          venceEn,
          beneficiarioRut: RUT_BENEFICIARIO_S23,
          beneficiarioNombre: NOMBRE_BENEFICIARIO_S23,
          glosa: GLOSA_S23,
          retiradorRut: RUT_RETIRADOR_S23,
          retiradorNombre: NOMBRE_RETIRADOR_S23,
          transaccionEmisionId,
          transaccionCierreId,
        },
      });

      boletas.push({ etiqueta: b.etiqueta, id: boletaId, montoCentavos: b.montoCentavos.toString() });
    }

    // Saldo DERIVADO del ledger, no restado a mano (D2). Con la tabla de la spec da 74000.
    const agregado = await tx.movimiento.aggregate({
      where: { cuentaId },
      _sum: { montoCentavos: true },
    });

    return {
      escenario: 'boletas-en-cada-estado',
      usuarioId,
      cuentas: [
        {
          id: cuentaId,
          tipo: 'CORRIENTE' as const,
          saldoCentavos: (agregado._sum.montoCentavos ?? 0n).toString(),
        },
      ],
      cuentaSistemaId,
      credenciales: { email: `usuario-${usuarioId}@zerofeebank.local`, password: passwordClaro },
      boletas,
    };
  }
}
