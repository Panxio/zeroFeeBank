import type { TipoApertura } from './cuentas.constants.js';

export interface CuentaCreadaRespuestaDto {
  id: string;
  tipo: TipoApertura;
  saldo: string;
  abiertaEn: string;
  transaccionId: string;
}

export interface CuentaResumenDto {
  id: string;
  tipo: string;
  saldo: string;
  abiertaEn: string;
}

export interface ResumenCuentasRespuestaDto {
  cuentas: CuentaResumenDto[];
}
