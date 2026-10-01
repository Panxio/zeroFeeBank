import { Injectable } from '@nestjs/common';
import { formatMoney } from '../../domain/money/money.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { RelojService } from '../../infra/reloj.js';
import { CONCEPTO_TRANSFERENCIA, UUID_REGEX } from './comprobantes.constants.js';
import {
  BoletaNoCerradaError,
  BoletaNoEncontradaError,
  TransferenciaNoEncontradaError,
} from './comprobantes.errors.js';
import {
  generarBoletaComprobantePdf,
  generarBoletaResumenPdf,
  generarTransferenciaPdf,
} from './plantillas/pdf.js';

@Injectable()
export class ComprobantesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reloj: RelojService,
  ) {}

  async comprobanteTransferencia(titularId: string, id: string): Promise<Buffer> {
    if (!UUID_REGEX.test(id)) {
      throw new TransferenciaNoEncontradaError();
    }

    const tx = await this.prisma.transaccion.findUnique({
      where: { id },
      include: {
        movimientos: {
          include: {
            cuenta: true,
          },
        },
      },
    });

    if (!tx || tx.concepto !== CONCEPTO_TRANSFERENCIA) {
      throw new TransferenciaNoEncontradaError();
    }

    const movOrigen = tx.movimientos.find((m) => m.montoCentavos < 0n);
    const movDestino = tx.movimientos.find((m) => m.montoCentavos > 0n);

    if (!movOrigen || !movDestino) {
      throw new TransferenciaNoEncontradaError();
    }

    if (movOrigen.cuenta.titularId !== titularId) {
      throw new TransferenciaNoEncontradaError();
    }

    const ahora = this.reloj.ahora();

    return generarTransferenciaPdf(
      {
        id: tx.id,
        fecha: tx.creadaEn.toISOString(),
        origen: movOrigen.cuentaId,
        destino: movDestino.cuentaId,
        monto: formatMoney(-movOrigen.montoCentavos),
      },
      ahora,
    );
  }

  async comprobanteBoleta(titularId: string, id: string): Promise<Buffer> {
    if (!UUID_REGEX.test(id)) {
      throw new BoletaNoEncontradaError();
    }

    const boleta = await this.prisma.boleta.findUnique({
      where: { id },
      include: {
        cuenta: true,
      },
    });

    if (!boleta || boleta.cuenta.titularId !== titularId) {
      throw new BoletaNoEncontradaError();
    }

    const ahora = this.reloj.ahora();

    return generarBoletaComprobantePdf(
      {
        id: boleta.id,
        cuenta: boleta.cuentaId,
        monto: formatMoney(boleta.montoCentavos),
        emitidaEn: boleta.emitidaEn.toISOString(),
        venceEn: boleta.venceEn.toISOString(),
        beneficiarioRut: boleta.beneficiarioRut,
        beneficiarioNombre: boleta.beneficiarioNombre,
        glosa: boleta.glosa,
        retiradorRut: boleta.retiradorRut,
        retiradorNombre: boleta.retiradorNombre,
      },
      ahora,
    );
  }

  async resumenBoleta(titularId: string, id: string): Promise<Buffer> {
    if (!UUID_REGEX.test(id)) {
      throw new BoletaNoEncontradaError();
    }

    const boleta = await this.prisma.boleta.findUnique({
      where: { id },
      include: {
        cuenta: true,
        transaccionCierre: true,
      },
    });

    if (!boleta || boleta.cuenta.titularId !== titularId) {
      throw new BoletaNoEncontradaError();
    }

    if (boleta.transaccionCierreId === null || !boleta.transaccionCierre) {
      throw new BoletaNoCerradaError();
    }

    const ahora = this.reloj.ahora();

    return generarBoletaResumenPdf(
      {
        id: boleta.id,
        cuenta: boleta.cuentaId,
        monto: formatMoney(boleta.montoCentavos),
        emitidaEn: boleta.emitidaEn.toISOString(),
        venceEn: boleta.venceEn.toISOString(),
        beneficiarioRut: boleta.beneficiarioRut,
        beneficiarioNombre: boleta.beneficiarioNombre,
        glosa: boleta.glosa,
        retiradorRut: boleta.retiradorRut,
        retiradorNombre: boleta.retiradorNombre,
        estado: boleta.estado,
        cierre: boleta.transaccionCierre.creadaEn.toISOString(),
      },
      ahora,
    );
  }
}
