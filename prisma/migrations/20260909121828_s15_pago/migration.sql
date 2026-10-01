-- CreateTable
CREATE TABLE "pago" (
    "id" UUID NOT NULL,
    "transaccion_id" UUID NOT NULL,
    "cuenta_origen_id" UUID NOT NULL,
    "titular_id" UUID NOT NULL,
    "beneficiario_nombre" TEXT NOT NULL,
    "beneficiario_direccion" TEXT NOT NULL,
    "beneficiario_ciudad" TEXT NOT NULL,
    "beneficiario_estado" TEXT NOT NULL,
    "beneficiario_codigo_postal" TEXT NOT NULL,
    "beneficiario_telefono" TEXT NOT NULL,
    "cuenta_beneficiario" TEXT NOT NULL,
    "pagado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pago_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pago_transaccion_id_key" ON "pago"("transaccion_id");

-- CreateIndex
CREATE INDEX "pago_titular_id_idx" ON "pago"("titular_id");

-- CreateIndex
CREATE INDEX "pago_cuenta_origen_id_idx" ON "pago"("cuenta_origen_id");

-- AddForeignKey
ALTER TABLE "pago" ADD CONSTRAINT "pago_transaccion_id_fkey" FOREIGN KEY ("transaccion_id") REFERENCES "transaccion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago" ADD CONSTRAINT "pago_cuenta_origen_id_fkey" FOREIGN KEY ("cuenta_origen_id") REFERENCES "cuenta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago" ADD CONSTRAINT "pago_titular_id_fkey" FOREIGN KEY ("titular_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
