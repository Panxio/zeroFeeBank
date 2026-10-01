import { Module } from '@nestjs/common';
import { CuentasSistemaRepository } from '../../infra/cuentas-sistema.repository.js';
import { IdempotenciaEjecutor } from '../../infra/idempotencia.ejecutor.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { RelojModule } from '../../infra/reloj.module.js';
import { SaldosRepository } from '../../infra/saldos.repository.js';
import { AuthModule } from '../auth/auth.module.js';
import { CuentasModule } from '../cuentas/cuentas.module.js';
import { TransferenciasModule } from '../transferencias/transferencias.module.js';
import { BoletasController } from './boletas.controller.js';
import { BoletasService } from './boletas.service.js';

@Module({
  imports: [AuthModule, TransferenciasModule, CuentasModule, RelojModule],
  controllers: [BoletasController],
  providers: [
    BoletasService,
    PrismaService,
    SaldosRepository,
    IdempotenciaEjecutor,
    CuentasSistemaRepository,
  ],
  exports: [BoletasService],
})
export class BoletasModule {}
