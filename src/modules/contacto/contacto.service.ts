import { Injectable } from '@nestjs/common';
import type { ErrorDeNegocio } from '../../domain/errores.js';
import { PrismaService } from '../../infra/prisma.service.js';
import {
  ContactoApellidoInvalidoError,
  ContactoCiudadInvalidaError,
  ContactoCodigoPostalInvalidoError,
  ContactoDireccionInvalidaError,
  ContactoEstadoInvalidoError,
  ContactoNombreInvalidoError,
  ContactoTelefonoInvalidoError,
  EmailNoModificableError,
} from './contacto.errors.js';

export interface ContactoDto {
  email: string;
  nombre: string | null;
  apellido: string | null;
  direccion: string | null;
  ciudad: string | null;
  estado: string | null;
  codigoPostal: string | null;
  telefono: string | null;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function validarCampo(
  cuerpo: unknown,
  campo: string,
  max: number,
  ErrorClass: new () => ErrorDeNegocio,
): string {
  if (!esObjeto(cuerpo) || !(campo in cuerpo)) {
    throw new ErrorClass();
  }
  const valor = cuerpo[campo];
  if (typeof valor !== 'string') {
    throw new ErrorClass();
  }
  const recortado = valor.trim();
  if (recortado.length < 1 || recortado.length > max) {
    throw new ErrorClass();
  }
  return recortado;
}

@Injectable()
export class ContactoService {
  constructor(private readonly prisma: PrismaService) {}

  async obtenerContacto(titularId: string): Promise<ContactoDto> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: titularId },
      select: {
        email: true,
        nombre: true,
        apellido: true,
        direccion: true,
        ciudad: true,
        estado: true,
        codigoPostal: true,
        telefono: true,
      },
    });

    if (!usuario) {
      throw new Error('Usuario no encontrado');
    }

    return {
      email: usuario.email,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      direccion: usuario.direccion,
      ciudad: usuario.ciudad,
      estado: usuario.estado,
      codigoPostal: usuario.codigoPostal,
      telefono: usuario.telefono,
    };
  }

  async actualizarContacto(
    titularId: string,
    titularEmail: string,
    cuerpo: unknown,
  ): Promise<ContactoDto> {
    // 2. Precedencia J4: el email se comprueba ANTES que los siete campos
    if (esObjeto(cuerpo) && 'email' in cuerpo && cuerpo['email'] !== titularEmail) {
      throw new EmailNoModificableError();
    }

    // 3..9. Precedencia fija: nombre -> apellido -> direccion -> ciudad -> estado -> codigoPostal -> telefono
    const nombre = validarCampo(cuerpo, 'nombre', 50, ContactoNombreInvalidoError);
    const apellido = validarCampo(cuerpo, 'apellido', 50, ContactoApellidoInvalidoError);
    const direccion = validarCampo(cuerpo, 'direccion', 100, ContactoDireccionInvalidaError);
    const ciudad = validarCampo(cuerpo, 'ciudad', 50, ContactoCiudadInvalidaError);
    const estado = validarCampo(cuerpo, 'estado', 50, ContactoEstadoInvalidoError);
    const codigoPostal = validarCampo(cuerpo, 'codigoPostal', 20, ContactoCodigoPostalInvalidoError);
    const telefono = validarCampo(cuerpo, 'telefono', 20, ContactoTelefonoInvalidoError);

    // 10. Reemplazo atómico en BD (J7): todo o nada
    const actualizado = await this.prisma.usuario.update({
      where: { id: titularId },
      data: {
        nombre,
        apellido,
        direccion,
        ciudad,
        estado,
        codigoPostal,
        telefono,
      },
      select: {
        email: true,
        nombre: true,
        apellido: true,
        direccion: true,
        ciudad: true,
        estado: true,
        codigoPostal: true,
        telefono: true,
      },
    });

    return {
      email: actualizado.email,
      nombre: actualizado.nombre,
      apellido: actualizado.apellido,
      direccion: actualizado.direccion,
      ciudad: actualizado.ciudad,
      estado: actualizado.estado,
      codigoPostal: actualizado.codigoPostal,
      telefono: actualizado.telefono,
    };
  }
}
