export interface MovimientoItemDto {
  id: string;
  transaccionId: string;
  concepto: string;
  monto: string;
  fecha: string;
}

export interface BuscarMovimientosRespuestaDto {
  cuentaId: string;
  movimientos: MovimientoItemDto[];
  devueltos: number;
  hayMas: boolean;
}

export interface BuscarMovimientosParams {
  titularId: string;
  cuentaId: string;
  transaccionId?: string | undefined;
  desde?: string | undefined;
  hasta?: string | undefined;
  montoCentavos?: bigint | undefined;
}
