import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { ComprobantesController } from './comprobantes.controller.js';
import { ComprobantesService } from './comprobantes.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ComprobantesController],
  providers: [ComprobantesService, PrismaService],
  exports: [ComprobantesService],
})
export class ComprobantesModule {}
