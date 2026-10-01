import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ClienteDb } from './saldos.repository.js';

/**
 * LA forma de obtener una cuenta de sistema, una sola, a propósito.
 *
 * Nació dentro de S-12 pegada a la caja. S-09 estrena la segunda cuenta de sistema (la de
 * garantía) y la alternativa era copiar el INSERT: dos implementaciones del mismo mecanismo
 * crítico, y este mecanismo en particular YA se escribió mal una vez.
 *
 * ⚠️ EL `ON CONFLICT DO NOTHING` NO ES ESTILO. La entrega original de S-12 hacía `create` y
 * atrapaba el P2002 del índice único para releer la fila. En PostgreSQL eso NO se puede: un
 * error dentro de una transacción la ABORTA entera, y la relectura muere con 25P02 «current
 * transaction is aborted». Se reprodujo con dos aperturas simultáneas sobre una base sin caja:
 * una devolvió 201 y la otra un 500 (`npm run sonda:caja`, 2026-09-07).
 *
 * ON CONFLICT DO NOTHING no lanza, así que no aborta nada: el que llega segundo espera a que
 * el primero cierre, no inserta, y el SELECT siguiente —snapshot nuevo, porque el aislamiento
 * es READ COMMITTED— ya ve la fila del otro.
 *
 * Se descartó un pg_advisory_xact_lock: también sirve, pero añade un segundo candado a una
 * transacción que ya tiene el de la clave de idempotencia, y dos candados en distinto orden
 * son la receta del deadlock que D4 existe para evitar.
 *
 * Las cuentas de sistema NO tienen titular y quedan FUERA de I4 (límite de sobregiro): su
 * saldo negativo *es* el dinero que el sistema entregó al mundo exterior.
 */
@Injectable()
export class CuentasSistemaRepository {
  async obtenerOCrear(db: ClienteDb, codigo: string, en: Date): Promise<{ id: string }> {
    await db.$executeRaw(
      Prisma.sql`INSERT INTO cuenta (id, tipo, titular_id, codigo, limite_sobregiro_centavos, creada_en)
                 VALUES (gen_random_uuid(), 'SISTEMA', NULL, ${codigo}, 0, ${en})
                 ON CONFLICT (codigo) DO NOTHING`,
    );
    const filas = await db.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM cuenta WHERE codigo = ${codigo}`,
    );
    const fila = filas[0];
    if (fila === undefined) {
      throw new Error(`la cuenta de sistema ${codigo} no existe después de crearla`);
    }
    return fila;
  }
}
