import {
  type ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ErrorDeNegocio } from '../domain/errores.js';

/**
 * Traduce los errores de negocio (C5) a HTTP. Registrado GLOBALMENTE en AppModule.
 *
 * Vivía en src/modules/transferencias/ mientras hubo un solo módulo con errores. Se movió
 * acá antes de S-07 y S-08, por una razón de independencia y no de estética: si cada módulo
 * tuviera que registrar su propio filtro, o extender éste, las unidades que se construyen
 * en paralelo tocarían archivos comunes y se pisarían entre sí.
 *
 * EL MAPA DE ABAJO ES EL CONTRATO. Un código que no esté en él sale como 500, a propósito:
 * así un código inventado se ve rojo en el arnés en vez de colarse con un
 * 400 razonable. La lista se versiona junto con las specs que la definen.
 */
@Catch()
export class ErroresHttpFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof ErrorDeNegocio) {
      const status = this.obtenerEstadoHttp(exception.codigo);
      response.status(status).json({
        codigo: exception.codigo,
        mensaje: exception.message,
      });
      return;
    }

    // ── El cuerpo que ni siquiera se pudo parsear (borde 8 de specs/S-08-auth.md) ──
    // express.json() falla ANTES de que exista un controlador, Nest envuelve el SyntaxError
    // en una BadRequestException y DESCARTA la causa: no queda `type`, ni `cause`, ni marca
    // alguna salvo el texto del mensaje. Salía con 400 pero sin `codigo`, violando C5.
    //
    // El discriminante NO es el texto del mensaje (cambia entre versiones de Node y de
    // Express, y un check así nace frágil): es ESTRUCTURAL. Si el parseo falló, el cuerpo
    // nunca llegó a existir. Medido el 2026-09-07 con sonda y control:
    //   JSON roto            → BadRequestException · body undefined
    //   EMAIL_INVALIDO       → ErrorDeNegocio      · body {...} (y {} con cuerpo vacío)
    //   ruta inexistente     → NotFoundException   · body {...}
    // Se acota además a los métodos que llevan cuerpo, para que un GET no caiga acá.
    const peticion = ctx.getRequest<{ body?: unknown; method?: string }>();
    const METODOS_CON_CUERPO = ['POST', 'PUT', 'PATCH'];
    if (
      exception instanceof BadRequestException &&
      peticion.body === undefined &&
      METODOS_CON_CUERPO.includes(peticion.method ?? '')
    ) {
      response.status(HttpStatus.BAD_REQUEST).json({
        codigo: 'CUERPO_INVALIDO',
        mensaje: 'el cuerpo de la petición no es JSON válido',
      });
      return;
    }

    // Lo que Nest ya sabe traducir se deja pasar TAL CUAL. Sin esto, la NotFoundException
    // que el router lanza cuando una ruta no existe sale como 500, y el 404 de toda la app
    // deja de existir. Se descubrió el 2026-09-07 con el brazo A1 del arnés de S-07, sobre
    // este mismo archivo: el filtro colgaba de un solo controlador y nunca veía un 404.
    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const correlacionId = randomUUID();
    // eslint-disable-next-line no-console
    console.error(`[${correlacionId}] Error interno no controlado:`, exception);

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      codigo: 'ERROR_INTERNO',
      mensaje: 'Error interno del servidor',
      correlacionId,
    });
  }

  private obtenerEstadoHttp(codigo: string): number {
    switch (codigo) {
      // ── S-06 · transferencias ────────────────────────────────────────────────
      case 'IDEMPOTENCY_KEY_AUSENTE':
      case 'IDEMPOTENCY_KEY_INVALIDA':
      case 'MONTO_INVALIDO':
      case 'MISMA_CUENTA':
        return HttpStatus.BAD_REQUEST; // 400
      case 'CUENTA_NO_ENCONTRADA':
        return HttpStatus.NOT_FOUND; // 404
      case 'IDEMPOTENCY_KEY_REUSADA':
      case 'FONDOS_INSUFICIENTES':
        return HttpStatus.CONFLICT; // 409

      // ── S-07 · costuras de prueba (specs/S-07-costuras.md) ───────────────────
      case 'ESCENARIO_DESCONOCIDO':
      case 'RELOJ_PETICION_INVALIDA':
      case 'RELOJ_INSTANTE_INVALIDO':
      case 'RELOJ_AVANCE_INVALIDO':
      case 'RELOJ_NO_FIJADO':
        return HttpStatus.BAD_REQUEST; // 400

      // ── S-08 · auth (specs/S-08-auth.md) ─────────────────────────────────────
      case 'EMAIL_INVALIDO':
      case 'PASSWORD_DEBIL':
        return HttpStatus.BAD_REQUEST; // 400
      case 'CREDENCIALES_INVALIDAS':
      case 'TOKEN_AUSENTE':
      case 'TOKEN_INVALIDO':
      case 'TOKEN_EXPIRADO':
        return HttpStatus.UNAUTHORIZED; // 401
      case 'EMAIL_YA_REGISTRADO':
        return HttpStatus.CONFLICT; // 409

      // ── S-12 · cuentas (specs/S-12-cuentas.md) ───────────────────────────────
      // CUENTA_NO_ENCONTRADA, FONDOS_INSUFICIENTES, MONTO_INVALIDO, TOKEN_* y las
      // IDEMPOTENCY_KEY_* ya están arriba: S-12 los reutiliza tal cual, no los duplica.
      case 'TIPO_CUENTA_NO_PERMITIDO':
      case 'MONTO_APERTURA_INSUFICIENTE':
      case 'CUENTA_ORIGEN_REQUERIDA':
        return HttpStatus.BAD_REQUEST; // 400

      // ── S-09 · boletas de garantía (specs/S-09-boletas.md) ──────────────────
      // CUENTA_NO_ENCONTRADA, MONTO_INVALIDO, FONDOS_INSUFICIENTES, TOKEN_* y las
      // IDEMPOTENCY_KEY_* ya están arriba: S-09 los reutiliza tal cual, no los duplica.
      case 'PLAZO_INVALIDO':
      case 'RUT_INVALIDO':
      case 'NOMBRE_INVALIDO':
      case 'GLOSA_INVALIDA':
        return HttpStatus.BAD_REQUEST; // 400
      case 'RETIRADOR_NO_AUTORIZADO':
        // 403 y no 404 a propósito: quien cobra ya tiene el documento en la mano, así que no
        // hay existencia que ocultar. Lo que se le dice es «existe, pero no eres tú quien
        // retira». Un 404 mandaría al beneficiario legítimo a buscar un id equivocado.
        return HttpStatus.FORBIDDEN; // 403
      case 'BOLETA_NO_ENCONTRADA':
        // Ajena e inexistente responden IDÉNTICO (misma línea roja que S-12): un 403 acá
        // confirmaría qué boletas existen y dejaría barrer el espacio de ids.
        return HttpStatus.NOT_FOUND; // 404
      case 'TRANSICION_INVALIDA':
      case 'BOLETA_NO_VENCIDA':
        return HttpStatus.CONFLICT; // 409

      // ── S-13 · búsqueda de movimientos (specs/S-13-movimientos.md) ──────────
      // CUENTA_NO_ENCONTRADA, MONTO_INVALIDO y TOKEN_* ya están arriba: S-13 los reutiliza.
      // Registrados acá de antemano, para que la implementación del módulo no tenga que tocar
      // este archivo: se movió acá justamente para que ningún módulo lo edite y las
      // unidades en paralelo no se pisen.
      case 'CUENTA_ID_REQUERIDO':
      case 'CUENTA_ID_INVALIDO':
      case 'TRANSACCION_ID_INVALIDO':
      case 'FECHA_INVALIDA':
      case 'RANGO_INVALIDO':
        return HttpStatus.BAD_REQUEST; // 400

      // ── S-14 · datos de contacto (specs/S-14-contacto.md) ────────────────────
      // TOKEN_* ya están arriba: S-14 los reutiliza tal cual. Registrados de
      // antemano, por la misma razón que los de S-13: si la implementación tuviera que
      // editar este archivo, dos unidades en paralelo pisarían el mismo fichero.
      // Un código por campo, y no un CONTACTO_INVALIDO genérico, a propósito (§ J8 de la
      // spec): con uno solo, la suite y la pantalla tendrían que leer el mensaje en prosa
      // para saber qué campo marcar en rojo — justo lo que C5 existe para evitar.
      case 'EMAIL_NO_MODIFICABLE':
      case 'CONTACTO_NOMBRE_INVALIDO':
      case 'CONTACTO_APELLIDO_INVALIDO':
      case 'CONTACTO_DIRECCION_INVALIDA':
      case 'CONTACTO_CIUDAD_INVALIDA':
      case 'CONTACTO_ESTADO_INVALIDO':
      case 'CONTACTO_CODIGO_POSTAL_INVALIDO':
      case 'CONTACTO_TELEFONO_INVALIDO':
        return HttpStatus.BAD_REQUEST; // 400

      // ── S-15 · pago a terceros / Bill Pay (specs/S-15-billpay.md) ───────────
      // TOKEN_*, IDEMPOTENCY_KEY_*, CUENTA_NO_ENCONTRADA, MONTO_INVALIDO,
      // FONDOS_INSUFICIENTES y CUERPO_INVALIDO ya están arriba: S-15 los reutiliza tal
      // cual, y eso es a propósito. Un `PAGO_FONDOS_INSUFICIENTES` propio sería un
      // segundo nombre para la misma situación, y C5 pide códigos estables, no códigos
      // abundantes.
      // Registrados de antemano, por el mismo motivo que S-13 y S-14:
      // si la implementación tuviera que editar este archivo, S-14 y S-15 —que se construyen
      // EN PARALELO— pisarían el mismo fichero.
      // Un código por campo y no un PAGO_BENEFICIARIO_INVALIDO genérico, misma razón que
      // en S-14 (§ J8): con uno solo, la pantalla tendría que leer el mensaje en prosa
      // para saber qué campo marcar en rojo.
      case 'PAGO_BENEFICIARIO_NOMBRE_INVALIDO':
      case 'PAGO_BENEFICIARIO_DIRECCION_INVALIDA':
      case 'PAGO_BENEFICIARIO_CIUDAD_INVALIDA':
      case 'PAGO_BENEFICIARIO_ESTADO_INVALIDO':
      case 'PAGO_BENEFICIARIO_CODIGO_POSTAL_INVALIDO':
      case 'PAGO_BENEFICIARIO_TELEFONO_INVALIDO':
      case 'PAGO_CUENTA_BENEFICIARIO_INVALIDA':
        return HttpStatus.BAD_REQUEST; // 400

      // ── S-19 · comprobantes en PDF (specs/S-19-comprobantes-pdf.md) ─────────
      // BOLETA_NO_ENCONTRADA y TOKEN_* ya están arriba. Registrados de antemano:
      // la implementación del módulo no toca src/infra/.
      case 'TRANSFERENCIA_NO_ENCONTRADA':
        // Ajena, recibida, de otro concepto e inexistente responden IDÉNTICO (P-b, J3).
        return HttpStatus.NOT_FOUND; // 404
      case 'BOLETA_NO_CERRADA':
        // Sin asiento de cierre no hay fecha de cierre que imprimir (J4).
        return HttpStatus.CONFLICT; // 409

      // ── S-16 · préstamo (specs/S-16-prestamo.md) ─────────────────────────────
      // MONTO_INVALIDO, CUENTA_NO_ENCONTRADA y FONDOS_INSUFICIENTES ya están arriba.
      case 'PRESTAMO_PIE_INVALIDO':
        return HttpStatus.BAD_REQUEST; // 400
      case 'PRESTAMO_PIE_SUPERA_FONDOS':
      case 'PRESTAMO_FONDOS_INSUFICIENTES':
        // J4: un rechazo de negocio, como FONDOS_INSUFICIENTES (ParaBank daba 200 approved:false).
        return HttpStatus.CONFLICT; // 409

      // ── S-22 · transferencias a otros bancos (specs/S-22-otros-bancos.md) ───
      // TRANSFERENCIA_NO_ENCONTRADA ya está arriba (S-19): se reutiliza tal cual.
      case 'BANCO_NO_PERMITIDO':
      case 'NUMERO_CUENTA_EXTERNA_INVALIDO':
      case 'TIPO_CUENTA_EXTERNA_INVALIDO':
        return HttpStatus.BAD_REQUEST; // 400
      case 'TOPE_DIARIO_EXCEDIDO':
        return HttpStatus.CONFLICT; // 409

      default:
        return HttpStatus.INTERNAL_SERVER_ERROR; // 500
    }
  }
}
