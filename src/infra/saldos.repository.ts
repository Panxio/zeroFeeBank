import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service.js';

/**
 * LA definición de «saldo» del sistema. Una sola, a propósito.
 *
 * Antes de S-12 esta consulta vivía suelta dentro de transferencias.service.ts, y el resumen
 * de cuentas necesitaba exactamente el mismo cálculo. Escribir un segundo SUM(monto_centavos)
 * deja dos definiciones de saldo en producción, que es literalmente cómo nacen los descuadres
 * que I3 existe para cazar: el día que una de las dos cambie —un filtro por fecha, una
 * exclusión de conceptos— la otra sigue diciendo otra cosa y nadie se entera.
 *
 * D2 · el saldo es una CONSULTA DERIVADA del ledger, nunca una columna. Si algún día aparece
 * un `saldo` materializado en la tabla `cuenta`, I3a se pone rojo.
 *
 * Recibe siempre el cliente con el que hay que hablar. En una transferencia ese cliente es la
 * transacción abierta y el llamado va DESPUÉS del FOR UPDATE (D4): un saldo leído fuera de la
 * transacción, o antes del bloqueo, deja el código funcionando, los tests secuenciales verdes
 * y la cuenta en descubierto.
 */
export type ClienteDb = Prisma.TransactionClient;

@Injectable()
export class SaldosRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** El cliente por defecto, para las lecturas que no van dentro de una transacción. */
  get sinTransaccion(): ClienteDb {
    return this.prisma;
  }

  async saldoDeCuenta(db: ClienteDb, cuentaId: string): Promise<bigint> {
    const filas = await db.$queryRaw<Array<{ saldo: bigint }>>(
      Prisma.sql`SELECT COALESCE(SUM(monto_centavos), 0)::bigint AS saldo
                 FROM movimiento WHERE cuenta_id = ${cuentaId}::uuid`,
    );
    return filas[0]?.saldo ?? 0n;
  }

  /**
   * Los saldos de todas las cuentas de un titular, en una sola consulta.
   *
   * LEFT JOIN y no INNER: una cuenta recién abierta sin movimientos tiene saldo 0, no
   * desaparece del resumen. Es el primer/último elemento del Pilar 4 aplicado a una lista.
   */
  async saldosDeTitular(db: ClienteDb, titularId: string): Promise<Map<string, bigint>> {
    const filas = await db.$queryRaw<Array<{ cuenta_id: string; saldo: bigint }>>(
      Prisma.sql`SELECT c.id AS cuenta_id, COALESCE(SUM(m.monto_centavos), 0)::bigint AS saldo
                 FROM cuenta c LEFT JOIN movimiento m ON m.cuenta_id = c.id
                 WHERE c.titular_id = ${titularId}::uuid
                 GROUP BY c.id`,
    );
    return new Map(filas.map((f) => [f.cuenta_id, f.saldo]));
  }
}
