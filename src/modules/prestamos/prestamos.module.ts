import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { RelojModule } from '../../infra/reloj.module.js';
import { SaldosRepository } from '../../infra/saldos.repository.js';
import { CuentasSistemaRepository } from '../../infra/cuentas-sistema.repository.js';
import { IdempotenciaEjecutor } from '../../infra/idempotencia.ejecutor.js';
import { AuthModule } from '../auth/auth.module.js';
import { PrestamosController } from './prestamos.controller.js';
import { PrestamosMotor } from './prestamos.motor.js';
import { PrestamosService } from './prestamos.service.js';

@Module({
  imports: [AuthModule, RelojModule],
  controllers: [PrestamosController],
  providers: [
    PrismaService,
    SaldosRepository,
    CuentasSistemaRepository,
    IdempotenciaEjecutor,
    PrestamosMotor,
    PrestamosService,
  ],
})
export class PrestamosModule {}
