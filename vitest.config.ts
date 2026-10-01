import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // El dominio es puro: sin base de datos, sin red, sin framework.
    // Si un test de dominio tarda más que esto, algo se coló que no debía.
    testTimeout: 2000,
    environment: 'node',
  },
});
