-- S-09 · La boleta pasa de ser una máquina de estados a ser un DOCUMENTO.
-- Ver specs/S-09-boletas.md. Tres grupos de columnas, cada uno con su razón:
--   · beneficiario_* y glosa: el instrumento existe a favor de un tercero. Sin beneficiario,
--     una boleta es indistinguible de una retención interna. Son TEXTO del documento: no hay
--     mantenedor de beneficiarios (decisión del humano, 2026-09-07).
--   · retirador_*: quién podrá cobrar. Se fija AL EMITIR, y el cobro exige que el RUT
--     presentado coincida. Es lo que hace irrevocable el instrumento: el tomador no elige
--     después a quién le paga.
--   · transaccion_emision_id / transaccion_cierre_id: la traza contra el ledger. Los conceptos
--     del asiento son genéricos y dos boletas del mismo monto sobre la misma cuenta serían
--     indistinguibles; sin estas dos columnas un descuadre entre documento y libro mayor no se
--     puede diagnosticar. La de cierre es nula mientras la boleta está VIGENTE.
--
-- Las columnas nacen NOT NULL sin default a propósito: la tabla está vacía, y un default vacío
-- ("") dejaría entrar boletas sin beneficiario que después nadie sabría de dónde salieron.

/*
  Warnings:

  - Added the required column `beneficiario_nombre` to the `boleta` table without a default value. This is not possible if the table is not empty.
  - Added the required column `beneficiario_rut` to the `boleta` table without a default value. This is not possible if the table is not empty.
  - Added the required column `glosa` to the `boleta` table without a default value. This is not possible if the table is not empty.
  - Added the required column `retirador_nombre` to the `boleta` table without a default value. This is not possible if the table is not empty.
  - Added the required column `retirador_rut` to the `boleta` table without a default value. This is not possible if the table is not empty.
  - Added the required column `transaccion_emision_id` to the `boleta` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "boleta" ADD COLUMN     "beneficiario_nombre" TEXT NOT NULL,
ADD COLUMN     "beneficiario_rut" TEXT NOT NULL,
ADD COLUMN     "glosa" TEXT NOT NULL,
ADD COLUMN     "retirador_nombre" TEXT NOT NULL,
ADD COLUMN     "retirador_rut" TEXT NOT NULL,
ADD COLUMN     "transaccion_cierre_id" UUID,
ADD COLUMN     "transaccion_emision_id" UUID NOT NULL;

-- AddForeignKey
ALTER TABLE "boleta" ADD CONSTRAINT "boleta_transaccion_emision_id_fkey" FOREIGN KEY ("transaccion_emision_id") REFERENCES "transaccion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boleta" ADD CONSTRAINT "boleta_transaccion_cierre_id_fkey" FOREIGN KEY ("transaccion_cierre_id") REFERENCES "transaccion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
