// Prisma 7 movió la configuración fuera del schema y dejó de cargar .env por su cuenta.
// `process.loadEnvFile` es la API nativa de Node para eso: no hace falta dotenv (Pilar 0,
// peldaño 3). En CI, donde las variables vienen del entorno, no hay .env y no debe fallar.
import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

if (existsSync('.env')) process.loadEnvFile('.env');

// Las migraciones corren como DUEÑO de la base, no con el rol de la aplicación: el rol de
// app existe justamente para NO poder alterar el esquema ni tocar el ledger (S-04, E3).
const url = process.env['DATABASE_URL_MIGRACION'];
if (url === undefined || url === '') {
  throw new Error('DATABASE_URL_MIGRACION no está definida. Ver .env y specs/S-04-esquema.md.');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url },
});
