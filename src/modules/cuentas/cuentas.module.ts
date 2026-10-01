import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { RelojModule } from '../../infra/reloj.module.js';
import { SaldosRepository } from '../../infra/saldos.repository.js';
import { CuentasSistemaRepository } from '../../infra/cuentas-sistema.repository.js';
import { IdempotenciaEjecutor } from '../../infra/idempotencia.ejecutor.js';
import { AuthModule } from '../auth/auth.module.js';
import { TransferenciasModule } from '../transferencias/transferencias.module.js';
import { CuentasController } from './cuentas.controller.js';
import { CuentasService } from './cuentas.service.js';

/**
 * S-12 · apertura de cuenta y resumen con saldo derivado. Ver specs/S-12-cuentas.md.
 */
@Module({
  imports: [AuthModule, TransferenciasModule, RelojModule],
  controllers: [CuentasController],
  providers: [
    PrismaService,
    SaldosRepository,
    CuentasSistemaRepository,
    IdempotenciaEjecutor,
    CuentasService,
  ],
  exports: [CuentasService],
})
export class CuentasModule {}
