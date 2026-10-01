-- DEUDA-reloj (specs/DEUDA-reloj.md § 2.1): las fechas de negocio las escribe la app con el
-- reloj inyectado (C2), nunca Postgres. Sin DEFAULT, un escritor que olvide la fecha choca con
-- NOT NULL en vez de quedar fechado en silencio con la hora de pared.

-- AlterTable
ALTER TABLE "cuenta" ALTER COLUMN "creada_en" DROP DEFAULT;

-- AlterTable
ALTER TABLE "movimiento" ALTER COLUMN "creado_en" DROP DEFAULT;

-- AlterTable
ALTER TABLE "pago" ALTER COLUMN "pagado_en" DROP DEFAULT;

-- AlterTable
ALTER TABLE "transaccion" ALTER COLUMN "creada_en" DROP DEFAULT;

-- AlterTable
ALTER TABLE "usuario" ALTER COLUMN "creado_en" DROP DEFAULT;
