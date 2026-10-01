export interface SolicitarPrestamoDto {
  cuentaOrigenId: string;
  monto: string;
  pie: string;
}

export interface PrestamoRespuestaDto {
  cuentaPrestamoId: string;
  transaccionId: string;
  cuentaOrigenId: string;
  monto: string;
  pie: string;
  otorgadoEn: string;
}
