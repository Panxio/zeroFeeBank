import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { RelojModule } from '../../infra/reloj.module.js';
import { CuentasSistemaRepository } from '../../infra/cuentas-sistema.repository.js';
import { IdempotenciaEjecutor } from '../../infra/idempotencia.ejecutor.js';
import { AuthModule } from '../auth/auth.module.js';
import { TransferenciasModule } from '../transferencias/transferencias.module.js';
import { TransferenciasOtrosBancosController } from './transferencias-otros-bancos.controller.js';
import { TransferenciasOtrosBancosService } from './transferencias-otros-bancos.service.js';

/**
 * S-22 · transferencia a otro banco.
 * Ver specs/S-22-otros-bancos.md.
 */
@Module({
  imports: [AuthModule, TransferenciasModule, RelojModule],
  controllers: [TransferenciasOtrosBancosController],
  providers: [
    PrismaService,
    CuentasSistemaRepository,
    IdempotenciaEjecutor,
    TransferenciasOtrosBancosService,
  ],
  exports: [TransferenciasOtrosBancosService],
})
export class TransferenciasOtrosBancosModule {}
