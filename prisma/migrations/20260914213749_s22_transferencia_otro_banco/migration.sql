-- S-22 · transferencia a otro banco (specs/S-22-otros-bancos.md § 4). Sin DEFAULT en la fecha
-- (DEUDA-reloj): la escribe la app con el reloj inyectado. Sin monto: vive en el ledger (D2).

-- CreateTable
CREATE TABLE "transferencia_otro_banco" (
    "id" UUID NOT NULL,
    "transaccion_id" UUID NOT NULL,
    "cuenta_origen_id" UUID NOT NULL,
    "titular_id" UUID NOT NULL,
    "banco" TEXT NOT NULL,
    "numero_cuenta" TEXT NOT NULL,
    "tipo_cuenta" TEXT NOT NULL,
    "realizada_en" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transferencia_otro_banco_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transferencia_otro_banco_transaccion_id_key" ON "transferencia_otro_banco"("transaccion_id");

-- CreateIndex
CREATE INDEX "transferencia_otro_banco_titular_id_idx" ON "transferencia_otro_banco"("titular_id");

-- CreateIndex
CREATE INDEX "transferencia_otro_banco_cuenta_origen_id_idx" ON "transferencia_otro_banco"("cuenta_origen_id");

-- AddForeignKey
ALTER TABLE "transferencia_otro_banco" ADD CONSTRAINT "transferencia_otro_banco_transaccion_id_fkey" FOREIGN KEY ("transaccion_id") REFERENCES "transaccion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencia_otro_banco" ADD CONSTRAINT "transferencia_otro_banco_cuenta_origen_id_fkey" FOREIGN KEY ("cuenta_origen_id") REFERENCES "cuenta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transferencia_otro_banco" ADD CONSTRAINT "transferencia_otro_banco_titular_id_fkey" FOREIGN KEY ("titular_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
