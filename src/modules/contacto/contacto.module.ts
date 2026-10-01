import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { ContactoController } from './contacto.controller.js';
import { ContactoService } from './contacto.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ContactoController],
  providers: [ContactoService, PrismaService],
  exports: [ContactoService],
})
export class ContactoModule {}
