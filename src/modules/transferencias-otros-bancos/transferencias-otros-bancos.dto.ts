/**
 * DTOs de S-22 · transferencia a otro banco.
 * Ver specs/S-22-otros-bancos.md § 3.
 */

export interface TransferenciaOtroBancoPeticionDto {
  cuentaOrigenId: string;
  monto: string;
  banco: string;
  numeroCuenta: string;
  tipoCuenta: string;
}

export interface TransferenciaOtroBancoRespuestaDto {
  id: string;
  transaccionId: string;
  cuentaOrigenId: string;
  monto: string;
  banco: string;
  numeroCuenta: string;
  tipoCuenta: string;
  realizadaEn: string;
}

export function esRespuestaValida(valor: unknown): valor is TransferenciaOtroBancoRespuestaDto {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    'id' in valor &&
    typeof valor.id === 'string' &&
    'transaccionId' in valor &&
    typeof valor.transaccionId === 'string' &&
    'cuentaOrigenId' in valor &&
    typeof valor.cuentaOrigenId === 'string' &&
    'monto' in valor &&
    typeof valor.monto === 'string' &&
    'banco' in valor &&
    typeof valor.banco === 'string' &&
    'numeroCuenta' in valor &&
    typeof valor.numeroCuenta === 'string' &&
    'tipoCuenta' in valor &&
    typeof valor.tipoCuenta === 'string' &&
    'realizadaEn' in valor &&
    typeof valor.realizadaEn === 'string'
  );
}
