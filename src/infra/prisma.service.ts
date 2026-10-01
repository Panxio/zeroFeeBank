import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Cliente Prisma como proveedor de Nest. Vive en infra: el dominio no lo conoce
 * ni puede importarlo (regla de dependencia, invariante H4 de S-00).
 *
 * NO se conecta en el arranque a propósito: la app tiene que levantar aunque la
 * base esté caída, para poder reportarlo por /health (invariante H3).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const connectionString = process.env['DATABASE_URL'];
    if (connectionString === undefined || connectionString === '') {
      // Falla ruidosa y temprana: una URL ausente que se descubre a mitad de una
      // transferencia es mucho más cara que uno que no arranca.
      throw new Error('DATABASE_URL no está definida. Ver .env y docker-compose.yml.');
    }
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
