import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { RelojModule } from '../../infra/reloj.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

/**
 * S-08 · registro, login y el token. Ver specs/S-08-auth.md.
 */
@Module({
  imports: [RelojModule],
  controllers: [AuthController],
  providers: [PrismaService, AuthService],
  exports: [AuthService],
})
export class AuthModule {}
