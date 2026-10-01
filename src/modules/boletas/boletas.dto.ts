import { formatMoney } from '../../domain/money/money.js';
import { estadoEn, type Estado } from '../../domain/boleta/boleta.js';

export interface BoletaDto {
  id: string;
  estado: string;
  monto: string;
  cuentaOrigenId: string;
  beneficiarioRut: string;
  beneficiarioNombre: string;
  glosa: string;
  retiradorRut: string;
  retiradorNombre: string;
  emitidaEn: string;
  venceEn: string;
  /**
   * S-23 (J1) · true si y sólo si la boleta tiene asiento de cierre. Sale de
   * `transaccionCierreId`, NO del estado calculado por `estadoEn` (J2): una VENCIDA
   * por liberar y una ya liberada calculan igual, y ahí está el hueco de HU-02 § 6.
   */
  fondosLiberados: boolean;
}

export interface BoletaConTransaccionDto extends BoletaDto {
  transaccionId: string;
}

export interface BoletasListadoDto {
  boletas: BoletaDto[];
}

export function reconstruirBoletaConTransaccion(dto: BoletaConTransaccionDto): BoletaConTransaccionDto {
  // S-23 (J3) · una respuesta guardada ANTES de este campo no lo trae: el guard de replay
  // (`esBoletaConTransaccionDto`) no lo exige y aquí se COMPLETA. Es exacto: una respuesta
  // guardada dice VIGENTE sólo cuando emite, y los tres cierres responden COBRADA, VENCIDA
  // o DEVUELTA. Una respuesta que sí trae el campo pasa tal cual.
  const traido =
    typeof dto.fondosLiberados === 'boolean' ? dto.fondosLiberados : dto.estado !== 'VIGENTE';
  return {
    id: dto.id,
    estado: dto.estado,
    monto: dto.monto,
    cuentaOrigenId: dto.cuentaOrigenId,
    beneficiarioRut: dto.beneficiarioRut,
    beneficiarioNombre: dto.beneficiarioNombre,
    glosa: dto.glosa,
    retiradorRut: dto.retiradorRut,
    retiradorNombre: dto.retiradorNombre,
    emitidaEn: dto.emitidaEn,
    venceEn: dto.venceEn,
    fondosLiberados: traido,
    transaccionId: dto.transaccionId,
  };
}

export function esBoletaConTransaccionDto(valor: unknown): valor is BoletaConTransaccionDto {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    'id' in valor &&
    typeof valor.id === 'string' &&
    'estado' in valor &&
    typeof valor.estado === 'string' &&
    'monto' in valor &&
    typeof valor.monto === 'string' &&
    'cuentaOrigenId' in valor &&
    typeof valor.cuentaOrigenId === 'string' &&
    'beneficiarioRut' in valor &&
    typeof valor.beneficiarioRut === 'string' &&
    'beneficiarioNombre' in valor &&
    typeof valor.beneficiarioNombre === 'string' &&
    'glosa' in valor &&
    typeof valor.glosa === 'string' &&
    'retiradorRut' in valor &&
    typeof valor.retiradorRut === 'string' &&
    'retiradorNombre' in valor &&
    typeof valor.retiradorNombre === 'string' &&
    'emitidaEn' in valor &&
    typeof valor.emitidaEn === 'string' &&
    'venceEn' in valor &&
    typeof valor.venceEn === 'string' &&
    'transaccionId' in valor &&
    typeof valor.transaccionId === 'string'
  );
}

export function armarBoletaDto(
  boleta: {
    id: string;
    cuentaId: string;
    montoCentavos: bigint;
    estado: Estado;
    emitidaEn: Date;
    venceEn: Date;
    beneficiarioRut: string;
    beneficiarioNombre: string;
    glosa: string;
    retiradorRut: string;
    retiradorNombre: string;
    transaccionCierreId: string | null;
  },
  ahora: Date,
): BoletaDto {
  const estadoCalculado = estadoEn(
    {
      id: boleta.id,
      monto: boleta.montoCentavos,
      emitidaEn: boleta.emitidaEn,
      venceEn: boleta.venceEn,
      estado: boleta.estado,
    },
    ahora,
  );

  return {
    id: boleta.id,
    estado: estadoCalculado,
    monto: formatMoney(boleta.montoCentavos),
    cuentaOrigenId: boleta.cuentaId,
    beneficiarioRut: boleta.beneficiarioRut,
    beneficiarioNombre: boleta.beneficiarioNombre,
    glosa: boleta.glosa,
    retiradorRut: boleta.retiradorRut,
    retiradorNombre: boleta.retiradorNombre,
    emitidaEn: boleta.emitidaEn.toISOString(),
    venceEn: boleta.venceEn.toISOString(),
    // J2: el asiento de cierre, no el estado calculado. Es equivalente al estado
    // PERSISTIDO !== 'VIGENTE' (sólo un cierre saca a una boleta de VIGENTE en la base).
    fondosLiberados: boleta.transaccionCierreId !== null,
  };
}
