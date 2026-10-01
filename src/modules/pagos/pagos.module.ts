import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { RelojModule } from '../../infra/reloj.module.js';
import { CuentasSistemaRepository } from '../../infra/cuentas-sistema.repository.js';
import { IdempotenciaEjecutor } from '../../infra/idempotencia.ejecutor.js';
import { AuthModule } from '../auth/auth.module.js';
import { TransferenciasModule } from '../transferencias/transferencias.module.js';
import { PagosController } from './pagos.controller.js';
import { PagosService } from './pagos.service.js';

/**
 * S-15 · pago a terceros (Bill Pay). Ver specs/S-15-billpay.md.
 *
 * AuthModule da el AuthService (el titular sale del token, J3) y TransferenciasModule
 * exporta el motor de dinero que escribe el asiento (D2, D4). Ninguno de los dos se
 * reimplementa acá.
 */
@Module({
  imports: [AuthModule, TransferenciasModule, RelojModule],
  controllers: [PagosController],
  providers: [PrismaService, CuentasSistemaRepository, IdempotenciaEjecutor, PagosService],
})
export class PagosModule {}
