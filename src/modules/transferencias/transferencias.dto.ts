export interface TransferenciaRequestDto {
  origenId: string;
  destinoId: string;
  monto: string;
}

export interface TransferenciaRespuestaDto {
  transaccionId: string;
  origenId: string;
  destinoId: string;
  monto: string;
}

