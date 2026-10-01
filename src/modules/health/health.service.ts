import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma.service.js';

/** Estado de la base tal como lo ve este proceso, ahora. */
export type EstadoBd = 'up' | 'down';

/**
 * Tope de espera de la sonda a la base, en milisegundos.
 * /health existe para que una suite no tenga que dormir; si la base no contesta
 * en este tiempo, para efectos de quien pregunta está caída. Ver S-00 § Constantes.
 */
export const TOPE_SONDA_BD_MS = 2000;

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Pregunta a la base **en cada llamada** (invariante H2: nada de cachear).
   * Una base colgada no es lo mismo que una caída, pero para quien espera sí:
   * las dos se responden 'down'.
   */
  async estadoBd(): Promise<EstadoBd> {
    const sonda = this.prisma.$queryRaw`SELECT 1`;
    const tope = new Promise<never>((_, rechazar) =>
      setTimeout(() => rechazar(new Error('tope de sonda')), TOPE_SONDA_BD_MS).unref(),
    );
    try {
      await Promise.race([sonda, tope]);
      return 'up';
    } catch {
      return 'down';
    }
  }
}
