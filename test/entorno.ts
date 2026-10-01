// Vitest no carga el .env por su cuenta. `process.loadEnvFile` es la API nativa de Node
// (Pilar 0, peldaño 3): no hace falta dotenv.
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
