import { ErrorDeNegocio } from '../errores.js';

export class FondosInsuficientesError extends ErrorDeNegocio {
  readonly codigo = 'FONDOS_INSUFICIENTES';
  constructor(
    readonly saldoCentavos: bigint,
    readonly montoCentavos: bigint,
    readonly limiteSobregiroCentavos: bigint,
  ) {
    super(
      `saldo ${saldoCentavos} y limite ${limiteSobregiroCentavos} no alcanzan para ${montoCentavos}`,
    );
  }
}

/**
 * I4 · ninguna cuenta de cliente queda bajo su límite pactado.
 *
 * Todo en `bigint`: con `number`, un monto sobre 2^53 se redondea y un rechazo se vuelve un
 * permiso sin que nada avise (D1).
 *
 * El límite se expresa POSITIVO ("puede quedar hasta 500 en descubierto") y por eso se resta:
 * un límite de 0 significa que la cuenta no puede bajar de cero.
 */
export function assertFondosSuficientes(
  saldoCentavos: bigint,
  montoCentavos: bigint,
  limiteSobregiroCentavos: bigint,
): void {
  if (limiteSobregiroCentavos < 0n) {
    // No es un rechazo de negocio: es una cuenta mal configurada. Se distingue a propósito
    // del FondosInsuficientesError, que sí es una respuesta legítima al usuario.
    throw new RangeError(`limite de sobregiro negativo: ${limiteSobregiroCentavos}`);
  }
  // `>=`, no `>`: un saldo exactamente igual al monto alcanza. Con `>` queda plata muerta.
  if (saldoCentavos - montoCentavos >= -limiteSobregiroCentavos) return;
  throw new FondosInsuficientesError(saldoCentavos, montoCentavos, limiteSobregiroCentavos);
}
