import { Injectable } from '@angular/core';

export class RelojNoFijadoError extends Error {
  constructor(mensaje = 'El reloj no está fijado') {
    super(mensaje);
    this.name = 'RELOJ_NO_FIJADO';
  }
}

@Injectable({ providedIn: 'root' })
export class RelojService {
  private instante: number | null = null;

  ahora(): number {
    if (this.instante !== null) {
      return this.instante;
    }
    return Date.now();
  }

  fijar(ms: number): void {
    this.instante = ms;
  }

  avanzar(ms: number): void {
    if (this.instante === null) {
      throw new RelojNoFijadoError();
    }
    this.instante += ms;
  }

  desfijar(): void {
    this.instante = null;
  }

  estaFijado(): boolean {
    return this.instante !== null;
  }
}
