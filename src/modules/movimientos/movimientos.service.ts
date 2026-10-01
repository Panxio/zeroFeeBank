import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { formatMoney } from '../../domain/money/money.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { TOPE_MOVIMIENTOS } from './movimientos.constants.js';
import type {
  BuscarMovimientosParams,
  BuscarMovimientosRespuestaDto,
  MovimientoItemDto,
} from './movimientos.dto.js';
import { CuentaNoEncontradaError } from './movimientos.errors.js';

@Injectable()
export class MovimientosService {
  constructor(private readonly prisma: PrismaService) {}

  async buscarMovimientos(
    params: BuscarMovimientosParams,
  ): Promise<BuscarMovimientosRespuestaDto> {
    // 3. Existencia y titularidad de cuentaId -> 404
    const cuenta = await this.prisma.cuenta.findUnique({
      where: { id: params.cuentaId },
      select: { titularId: true },
    });

    if (!cuenta || cuenta.titularId !== params.titularId) {
      throw new CuentaNoEncontradaError(params.cuentaId);
    }

    // 4. La búsqueda
    const where: Prisma.MovimientoWhereInput = {
      cuentaId: params.cuentaId,
    };

    if (params.transaccionId !== undefined) {
      where.transaccionId = params.transaccionId;
    }

    if (params.desde !== undefined || params.hasta !== undefined) {
      const creadoEnFiltro: Prisma.DateTimeFilter = {};
      if (params.desde !== undefined) {
        creadoEnFiltro.gte = new Date(`${params.desde}T00:00:00.000Z`);
      }
      if (params.hasta !== undefined) {
        creadoEnFiltro.lte = new Date(`${params.hasta}T23:59:59.999Z`);
      }
      where.creadoEn = creadoEnFiltro;
    }

    if (params.montoCentavos !== undefined) {
      if (params.montoCentavos === 0n) {
        where.montoCentavos = 0n;
      } else {
        where.montoCentavos = {
          in: [params.montoCentavos, -params.montoCentavos],
        };
      }
    }

    const registros = await this.prisma.movimiento.findMany({
      where,
      orderBy: [{ creadoEn: 'desc' }, { id: 'asc' }],
      take: TOPE_MOVIMIENTOS + 1,
      select: {
        id: true,
        transaccionId: true,
        montoCentavos: true,
        creadoEn: true,
        transaccion: {
          select: {
            concepto: true,
          },
        },
      },
    });

    const hayMas = registros.length > TOPE_MOVIMIENTOS;
    const filas = hayMas ? registros.slice(0, TOPE_MOVIMIENTOS) : registros;

    const movimientos: MovimientoItemDto[] = filas.map((r) => ({
      id: r.id,
      transaccionId: r.transaccionId,
      concepto: r.transaccion.concepto,
      monto: formatMoney(r.montoCentavos),
      fecha: r.creadoEn.toISOString(),
    }));

    return {
      cuentaId: params.cuentaId,
      movimientos,
      devueltos: movimientos.length,
      hayMas,
    };
  }
}
