import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { obtenerOrigenApp } from './infra/origen-app.js';

/** Puerto de la app. Verificado libre el 2026-09-06; ver S-00 § Constantes. */
const PUERTO_POR_DEFECTO = 3000;

async function main(): Promise<void> {
  const origenApp = obtenerOrigenApp();
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: [origenApp],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    // Entre dos orígenes el script no lee una cabecera no expuesta: sin esto la app no sabe
    // que una respuesta es repetida (S-10 T3, decisión H1).
    exposedHeaders: ['Idempotency-Replayed'],
  });
  const puerto = Number(process.env['PORT'] ?? PUERTO_POR_DEFECTO);

  await app.listen(puerto);
  // eslint-disable-next-line no-console
  console.log(`zeroFeeBank escuchando en http://localhost:${puerto}`);
}

void main();

