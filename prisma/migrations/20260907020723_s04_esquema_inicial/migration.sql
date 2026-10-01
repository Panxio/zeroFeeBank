-- CreateEnum
CREATE TYPE "tipo_cuenta" AS ENUM ('CORRIENTE', 'AHORRO', 'SISTEMA');

-- CreateEnum
CREATE TYPE "estado_boleta" AS ENUM ('VIGENTE', 'COBRADA', 'VENCIDA', 'DEVUELTA');

-- CreateTable
CREATE TABLE "usuario" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cuenta" (
    "id" UUID NOT NULL,
    "tipo" "tipo_cuenta" NOT NULL,
    "titular_id" UUID,
    "codigo" TEXT,
    "limite_sobregiro_centavos" BIGINT NOT NULL DEFAULT 0,
    "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cuenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaccion" (
    "id" UUID NOT NULL,
    "concepto" TEXT NOT NULL,
    "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaccion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimiento" (
    "id" UUID NOT NULL,
    "transaccion_id" UUID NOT NULL,
    "cuenta_id" UUID NOT NULL,
    "monto_centavos" BIGINT NOT NULL,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boleta" (
    "id" UUID NOT NULL,
    "cuenta_id" UUID NOT NULL,
    "monto_centavos" BIGINT NOT NULL,
    "estado" "estado_boleta" NOT NULL,
    "emitida_en" TIMESTAMP(3) NOT NULL,
    "vence_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boleta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clave_idempotencia" (
    "clave" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "huella_peticion" TEXT NOT NULL,
    "estado_http" INTEGER NOT NULL,
    "respuesta" JSONB NOT NULL,
    "creada_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clave_idempotencia_pkey" PRIMARY KEY ("clave")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "cuenta_codigo_key" ON "cuenta"("codigo");

-- CreateIndex
CREATE INDEX "cuenta_titular_id_idx" ON "cuenta"("titular_id");

-- CreateIndex
CREATE INDEX "movimiento_cuenta_id_idx" ON "movimiento"("cuenta_id");

-- CreateIndex
CREATE INDEX "movimiento_transaccion_id_idx" ON "movimiento"("transaccion_id");

-- CreateIndex
CREATE INDEX "boleta_cuenta_id_idx" ON "boleta"("cuenta_id");

-- AddForeignKey
ALTER TABLE "cuenta" ADD CONSTRAINT "cuenta_titular_id_fkey" FOREIGN KEY ("titular_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento" ADD CONSTRAINT "movimiento_transaccion_id_fkey" FOREIGN KEY ("transaccion_id") REFERENCES "transaccion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimiento" ADD CONSTRAINT "movimiento_cuenta_id_fkey" FOREIGN KEY ("cuenta_id") REFERENCES "cuenta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boleta" ADD CONSTRAINT "boleta_cuenta_id_fkey" FOREIGN KEY ("cuenta_id") REFERENCES "cuenta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
