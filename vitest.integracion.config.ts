import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.int.spec.ts'],
    // Estos tests SÍ tocan la base: el timeout del dominio (2 s) no aplica acá.
    testTimeout: 30_000,
    // En serie: dos suites que lanzan 20 transacciones a la vez sobre el mismo Postgres se
    // estorban, y un fallo por contención de conexiones se leería como un fallo de bloqueo.
    fileParallelism: false,
    environment: 'node',
    setupFiles: ['test/entorno.ts'],
  },
});
