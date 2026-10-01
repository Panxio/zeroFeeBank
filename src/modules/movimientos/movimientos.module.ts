import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { MovimientosController } from './movimientos.controller.js';
import { MovimientosService } from './movimientos.service.js';

/**
 * S-13 · búsqueda de movimientos. Ver specs/S-13-movimientos.md.
 */
@Module({
  imports: [AuthModule],
  controllers: [MovimientosController],
  providers: [MovimientosService, PrismaService],
  exports: [MovimientosService],
})
export class MovimientosModule {}
