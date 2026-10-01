import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { RelojModule } from '../../infra/reloj.module.js';
import { SaldosRepository } from '../../infra/saldos.repository.js';
import { IdempotenciaEjecutor } from '../../infra/idempotencia.ejecutor.js';
import { AuthModule } from '../auth/auth.module.js';
import { TransferenciasService } from './transferencias.service.js';
import { TransferenciasController } from './transferencias.controller.js';
import { IdempotenciaService } from './idempotencia.service.js';

@Module({
  imports: [AuthModule, RelojModule],
  controllers: [TransferenciasController],
  providers: [
    PrismaService,
    SaldosRepository,
    IdempotenciaEjecutor,
    TransferenciasService,
    IdempotenciaService,
  ],
  exports: [TransferenciasService, IdempotenciaService],
})
export class TransferenciasModule {}

