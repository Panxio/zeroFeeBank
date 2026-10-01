import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service.js';
import { IdempotencyKeyReusadaError } from './errores-de-dinero.js';

export interface ResultadoIdempotente<T> {
  esReplay: boolean;
  estadoHttp: number;
  respuesta: T;
}

export interface PeticionIdempotente<T extends object> {
  /** La clave que mandó el cliente, ya recortada y validada por el controlador. */
  clave: string;
  /** `POST /transferencias`. La misma clave en dos endpoints distintos no debe colisionar. */
  endpoint: string;
  /** Lo que identifica a ESTA petición: la misma clave con otro cuerpo es un error, no un replay. */
  huellaDe: unknown;
  /** El código que se guarda y que el replay devuelve tal cual. */
  estadoHttp: number;
  /** El trabajo que mueve plata. Corre DENTRO de la transacción y sólo si no hubo replay. */
  operacion: (tx: Prisma.TransactionClient) => Promise<T>;
  /** Comprueba que lo guardado en `jsonb` sigue teniendo la forma del contrato. */
  esRespuestaValida: (valor: unknown) => valor is T;
  /** Rearma la respuesta en el orden del contrato: `jsonb` no conserva el orden de las claves. */
  reconstruir: (valor: T) => T;
}

/**
 * D5 · idempotencia, el mecanismo, para CUALQUIER POST que mueva plata.
 *
 * Nació dentro de S-06 atado a la transferencia. S-12 estrenó el segundo POST de dinero y la
 * alternativa era copiar el candado consultivo, la consulta de la clave y la comparación de
 * huella en otro servicio: dos implementaciones del mismo mecanismo crítico que se
 * desincronizan la primera vez que una se arregla. Se generalizó acá, y el árbitro de que la
 * generalización no rompió nada es `npm run test:idempotencia` (9/9), que no se tocó.
 *
 * El orden de los pasos NO es negociable y es el de specs/S-06-idempotencia.md:
 *   1. abrir la transacción
 *   2. pg_advisory_xact_lock sobre la clave — ANTES de leerla, o dos peticiones simultáneas
 *      con la misma clave leen «no existe» las dos y ejecutan las dos
 *   3. leer la clave: si está y la huella coincide, es replay; si está y la huella difiere, 409
 *   4. recién entonces ejecutar la operación
 *   5. persistir clave + resultado en la MISMA transacción que movió la plata
 */
@Injectable()
export class IdempotenciaEjecutor {
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar<T extends object>(p: PeticionIdempotente<T>): Promise<ResultadoIdempotente<T>> {
    const huellaPeticion = createHash('sha256').update(JSON.stringify(p.huellaDe)).digest('hex');

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${p.clave}))`);

        const existente = await tx.claveIdempotencia.findUnique({ where: { clave: p.clave } });

        if (existente !== null) {
          if (existente.huellaPeticion !== huellaPeticion) {
            throw new IdempotencyKeyReusadaError();
          }
          if (!p.esRespuestaValida(existente.respuesta)) {
            throw new Error('Respuesta en clave_idempotencia corrupta');
          }
          return {
            esReplay: true,
            estadoHttp: existente.estadoHttp,
            respuesta: p.reconstruir(existente.respuesta),
          };
        }

        const respuesta = await p.operacion(tx);

        await tx.claveIdempotencia.create({
          data: {
            clave: p.clave,
            endpoint: p.endpoint,
            huellaPeticion,
            estadoHttp: p.estadoHttp,
            respuesta: { ...respuesta },
          },
        });

        return { esReplay: false, estadoHttp: p.estadoHttp, respuesta };
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  }
}
