import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CuentasSistemaRepository } from '../../infra/cuentas-sistema.repository.js';
import { CuentaNoEncontradaError } from '../../infra/errores-de-dinero.js';
import { SaldosRepository } from '../../infra/saldos.repository.js';
import { assertBalanceada } from '../../domain/ledger/ledger.js';
import { crearAsientoPrestamo, evaluarPrestamo } from '../../domain/prestamo/prestamo.js';
import { assertFondosSuficientes } from '../../domain/transferencia/fondos.js';
import { CODIGO_CUENTA_PRESTAMOS, CONCEPTO_ASIENTO_PRESTAMO } from './prestamos.constants.js';

export interface PeticionPrestamo {
  titularId: string;
  cuentaOrigenId: string;
  montoCentavos: bigint;
  pieCentavos: bigint;
  /** Instante del reloj inyectado: cuenta nueva, transacción y movimientos lo comparten (C2). */
  en: Date;
}

/**
 * S-16 · el motor de dinero del préstamo. Lo escribe el autor de la spec; la implementación lo LLAMA y no lo toca.
 * Ver specs/S-16-prestamo.md § 0 (por qué no son dos transferencias) y J6 (el bloqueo).
 *
 * Corre dentro de la transacción que le pasan (la de IdempotenciaEjecutor): todo rechazo es un
 * `throw` y revierte la cuenta nueva, el asiento y la clave, sin código de limpieza.
 */
@Injectable()
export class PrestamosMotor {
  constructor(
    private readonly saldos: SaldosRepository,
    private readonly cuentasSistema: CuentasSistemaRepository,
  ) {}

  async otorgarEn(
    tx: Prisma.TransactionClient,
    p: PeticionPrestamo,
  ): Promise<{ cuentaPrestamoId: string; transaccionId: string }> {
    // 1 · La contrapartida ANTES de los candados: obtenerOCrear puede insertar, y su
    //     ON CONFLICT espera al otro inserto sin abortar (sonda:caja).
    const contrapartida = await this.cuentasSistema.obtenerOCrear(
      tx,
      CODIGO_CUENTA_PRESTAMOS,
      p.en,
    );

    // 2 · J6 · bloqueo de TODAS las cuentas del titular más la contrapartida, en orden de id
    //     ascendente: el mismo orden global de S-05, así que no hay ciclo posible con él. La
    //     regla lee el saldo de cada una; sin candado, dos préstamos simultáneos leerían los
    //     mismos fondos y cobrarían el pie dos veces sobre el mismo dinero.
    const delTitular = await tx.cuenta.findMany({
      where: { titularId: p.titularId },
      select: { id: true },
    });
    const enOrden = [...delTitular.map((c) => c.id), contrapartida.id].sort();
    const limites = new Map<string, bigint>();
    for (const cuentaId of enOrden) {
      // Una consulta por cuenta a propósito (igual que S-05): el orden lo fija el bucle, no
      // el plan de ejecución de un `IN (...) FOR UPDATE`.
      const filas = await tx.$queryRaw<Array<{ limite_sobregiro_centavos: bigint }>>(
        Prisma.sql`SELECT limite_sobregiro_centavos FROM cuenta WHERE id = ${cuentaId}::uuid FOR UPDATE`,
      );
      const fila = filas[0];
      if (fila !== undefined) limites.set(cuentaId, fila.limite_sobregiro_centavos);
    }

    // 3 · J8 · la cuenta de origen tiene que ser del titular. Ajena o inexistente: el mismo 404.
    const limiteOrigen = limites.get(p.cuentaOrigenId);
    if (limiteOrigen === undefined || p.cuentaOrigenId === contrapartida.id) {
      throw new CuentaNoEncontradaError(p.cuentaOrigenId);
    }

    // 4 · Saldos DERIVADOS del ledger, ya bajo candado y dentro de la transacción (D2, D4).
    //     Los tipos se releen acá: una cuenta PRESTAMO creada por otro préstamo que cerró
    //     mientras esperábamos el candado NO suma a los fondos (V3).
    const saldos = await this.saldos.saldosDeTitular(tx, p.titularId);
    const tipos = await tx.cuenta.findMany({
      where: { titularId: p.titularId },
      select: { id: true, tipo: true },
    });
    let fondosDisponibles = 0n;
    for (const c of tipos) {
      if (c.tipo !== 'PRESTAMO') fondosDisponibles += saldos.get(c.id) ?? 0n;
    }

    // 5 · La regla de ParaBank (dominio): pie vs. fondos, después el cociente (J5).
    evaluarPrestamo({
      montoCentavos: p.montoCentavos,
      pieCentavos: p.pieCentavos,
      fondosDisponiblesCentavos: fondosDisponibles,
    });

    // 6 · R1 · el pie sale de UNA cuenta y esa cuenta tiene que alcanzar (I4). ParaBank no
    //     lo comprobaba y dejaba la cuenta de origen en negativo.
    if (p.pieCentavos > 0n) {
      assertFondosSuficientes(saldos.get(p.cuentaOrigenId) ?? 0n, p.pieCentavos, limiteOrigen);
    }

    // 7 · Recién ahora se escribe: la cuenta PRESTAMO y el asiento literal de N3 (J3).
    const cuentaPrestamoId = randomUUID();
    await tx.cuenta.create({
      data: {
        id: cuentaPrestamoId,
        tipo: 'PRESTAMO',
        titularId: p.titularId,
        limiteSobregiroCentavos: 0n,
        creadaEn: p.en,
      },
    });

    const asiento = crearAsientoPrestamo({
      id: randomUUID(),
      cuentaPrestamoId,
      contrapartidaId: contrapartida.id,
      cuentaOrigenId: p.cuentaOrigenId,
      montoCentavos: p.montoCentavos,
      pieCentavos: p.pieCentavos,
    });
    assertBalanceada(asiento);

    await tx.transaccion.create({
      data: { id: asiento.id, concepto: CONCEPTO_ASIENTO_PRESTAMO, creadaEn: p.en },
    });
    await tx.movimiento.createMany({
      data: asiento.entradas.map((e) => ({
        transaccionId: asiento.id,
        cuentaId: e.cuentaId,
        montoCentavos: e.monto,
        creadoEn: p.en,
      })),
    });

    return { cuentaPrestamoId, transaccionId: asiento.id };
  }
}
