import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({
  controllers: [HealthController],
  providers: [HealthService, PrismaService],
})
export class HealthModule {}
