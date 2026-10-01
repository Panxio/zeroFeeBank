import { Injectable } from '@nestjs/common';
import { RelojNoFijadoError } from '../modules/costuras/costuras.errors.js';

/**
 * S-07 · Decisión 2: El reloj es un servicio inyectable en src/infra/, y la app entera lo usa.
 *
 * RelojService con ahora(): Date. Estado interno: un Date | null. Nulo = hora real.
 * En producción existe igual, siempre con el reloj real, y fijar() nunca se llama porque
 * el módulo que lo expone por HTTP no está montado.
 */
@Injectable()
export class RelojService {
  private instante: Date | null = null;

  ahora(): Date {
    if (this.instante !== null) {
      return new Date(this.instante.getTime());
    }
    return new Date();
  }

  fijar(fecha: Date): void {
    this.instante = new Date(fecha.getTime());
  }

  desfijar(): void {
    this.instante = null;
  }

  estaFijado(): boolean {
    return this.instante !== null;
  }

  avanzar(ms: number): Date {
    if (this.instante === null) {
      throw new RelojNoFijadoError();
    }
    this.instante = new Date(this.instante.getTime() + ms);
    return new Date(this.instante.getTime());
  }
}
