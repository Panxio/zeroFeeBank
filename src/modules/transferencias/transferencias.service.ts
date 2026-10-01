import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma.service.js';
import { RelojService } from '../../infra/reloj.js';
import { assertFondosSuficientes } from '../../domain/transferencia/fondos.js';
import { assertBalanceada, crearTransferencia } from '../../domain/ledger/ledger.js';
import { SaldosRepository } from '../../infra/saldos.repository.js';
import { CuentaNoEncontradaError } from './transferencias.errors.js';

export interface Peticion {
  transaccionId: string;
  origenId: string;
  destinoId: string;
  montoCentavos: bigint;
  /**
   * Etiqueta del asiento en el ledger. Por defecto 'TRANSFERENCIA'; S-12 abre una cuenta
   * fondeándola desde otra del mismo titular y ese asiento es 'APERTURA_CUENTA'.
   *
   * NO es cosmético: la lista de conceptos está VERSIONADA en scripts/invariantes.sh, y un
   * concepto que no esté en ella pone roja la compuerta de población — porque I5 no sabría si
   * ese asiento debe nacer con Idempotency-Key o no.
   */
  concepto?: string;
  /**
   * DEUDA-reloj · instante del asiento. Quien ya tiene su propio `ahora` (apertura, pago,
   * boleta) lo pasa para que asiento y documento compartan la fecha al milisegundo; si no
   * viene, el respaldo es el reloj inyectado — no el de pared (C2).
   */
  en?: Date;
  /**
   * S-22 · lo que tiene que leerse BAJO el candado de las cuentas y antes de fondos: el tope
   * diario a otros bancos (specs/S-22-otros-bancos.md § 5). Leer el acumulado antes del
   * `FOR UPDATE` deja pasar el tope con dos peticiones simultáneas (CA14), y bloquear el
   * origen por fuera del motor crearía un segundo orden de bloqueo (D4). Por eso corre acá,
   * entre el paso 2 y el 3. Si lanza, la transacción entera revierte, como con fondos.
   */
  trasBloquear?: (tx: Prisma.TransactionClient) => Promise<void>;
}

/**
 * S-05 · el caso de uso que mueve plata. Ver specs/S-05-transferencia.md.
 *
 * No tiene controller a propósito: D5 exige idempotencia en todo POST que mueva plata, y la
 * idempotencia es S-06. Publicar la puerta antes que el cerrojo sería entregar el cobro
 * duplicado que D5 previene.
 */
@Injectable()
export class TransferenciasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly saldos: SaldosRepository,
    // El valor por defecto existe para el arnés de concurrencia, que construye el servicio a
    // mano con dos argumentos (sin Nest). Nest siempre inyecta el tercero. No es un reloj de
    // pared suelto: sin fijar, `RelojService.ahora()` da la hora real, igual que en producción.
    private readonly reloj: RelojService = new RelojService(),
  ) {}

  async transferirEn(
    tx: Prisma.TransactionClient,
    p: Peticion,
  ): Promise<{ transaccionId: string }> {
    // 1 · Lo que se puede rechazar sin la base, se rechaza sin la base: monto > 0 (D6) y
    //     origen != destino. Los lanza el dominio, que es donde vive la regla.
    const asiento = crearTransferencia({
      id: p.transaccionId,
      origen: p.origenId,
      destino: p.destinoId,
      monto: p.montoCentavos,
    });
    assertBalanceada(asiento);

    // 2 · Orden de bloqueo ESTABLE por id ascendente, no por el orden de la petición (D4).
    //     Dos transferencias cruzadas A->B y B->A que bloqueen por aparición se abrazan en
    //     deadlock. Este `sort` es lo único que lo impide.
    const enOrden = [p.origenId, p.destinoId].sort();

    const limites = new Map<string, bigint>();
    for (const cuentaId of enOrden) {
      // Dos consultas separadas, una por cuenta, a propósito: un `IN (...) ORDER BY id
      // FOR UPDATE` deja el orden real en manos del plan de ejecución, y el plan no es un
      // contrato. Acá el orden lo fija el bucle.
      const filas = await tx.$queryRaw<Array<{ limite_sobregiro_centavos: bigint }>>(
        Prisma.sql`SELECT limite_sobregiro_centavos FROM cuenta WHERE id = ${cuentaId}::uuid FOR UPDATE`,
      );
      const fila = filas[0];
      if (fila === undefined) throw new CuentaNoEncontradaError(cuentaId);
      limites.set(cuentaId, fila.limite_sobregiro_centavos);
    }

    // 2b · S-22: reglas que dependen de lo ya escrito en estas cuentas (el tope diario). Bajo
    //      el candado y antes de fondos: por eso TOPE_DIARIO_EXCEDIDO precede a FONDOS (J12).
    if (p.trasBloquear) await p.trasBloquear(tx);

    // 3 · El saldo se DERIVA del ledger (D2) y se deriva AQUÍ: después del bloqueo y dentro
    //     de la misma transacción. Leerlo antes deja el código funcionando, los tests
    //     secuenciales verdes y la cuenta en descubierto.
    //     La consulta ya no vive acá: es SaldosRepository, el único lugar del sistema donde
    //     se define «saldo» (S-12). Lo que sí sigue viviendo acá es CUÁNDO se llama.
    const saldo = await this.saldos.saldoDeCuenta(tx, p.origenId);

    // 4 · Si no alcanza, `throw`: la transacción entera revierte y T3 (no se escribe nada)
    //     se cumple sola, sin código de limpieza que alguien pueda olvidar.
    assertFondosSuficientes(saldo, p.montoCentavos, limites.get(p.origenId) ?? 0n);

    // 5 · Recién ahora se escribe. Dos movimientos que suman 0 (D2). Un solo instante para la
    //     transacción y cada movimiento, del reloj inyectado (C2).
    const ahora = p.en ?? this.reloj.ahora();
    await tx.transaccion.create({
      data: { id: asiento.id, concepto: p.concepto ?? 'TRANSFERENCIA', creadaEn: ahora },
    });
    await tx.movimiento.createMany({
      data: asiento.entradas.map((e) => ({
        transaccionId: asiento.id,
        cuentaId: e.cuentaId,
        montoCentavos: e.monto,
        creadoEn: ahora,
      })),
    });

    return { transaccionId: asiento.id };
  }

  async transferir(p: Peticion): Promise<{ transaccionId: string }> {
    return this.prisma.$transaction(async (tx) => this.transferirEn(tx, p));
  }
}
