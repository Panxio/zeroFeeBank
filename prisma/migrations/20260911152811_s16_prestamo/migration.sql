-- S-16 (specs/S-16-prestamo.md): la cuenta que abre un préstamo aprobado. Sólo se AGREGA un valor;
-- ningún dato existente cambia.

-- AlterEnum
ALTER TYPE "tipo_cuenta" ADD VALUE 'PRESTAMO';
