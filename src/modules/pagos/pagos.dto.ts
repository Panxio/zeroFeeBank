import type { NombreCampoBeneficiario } from './pagos.constants.js';

/**
 * La respuesta 201 de specs/S-15 § 3: SIETE claves exactas, ni una más (brazo A5).
 * El monto viaja como STRING decimal, nunca como número (D1, J10).
 */
export interface PagoRespuestaDto {
  id: string;
  transaccionId: string;
  cuentaOrigenId: string;
  monto: string;
  beneficiarioNombre: string;
  cuentaBeneficiario: string;
  pagadoEn: string;
}

export interface ListaPagosRespuestaDto {
  pagos: PagoRespuestaDto[];
}

/** Los siete campos del beneficiario, ya validados y TRIMMEADOS. */
export type Beneficiario = Record<NombreCampoBeneficiario, string>;
