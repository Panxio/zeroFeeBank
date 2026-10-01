import { ApplicationRef, Injectable, inject, signal } from '@angular/core';
import { RelojService } from './reloj.service';

const AVISO_INACTIVIDAD_MS = 90_000;
const CIERRE_INACTIVIDAD_MS = 150_000;
const TIC_MS = 1_000;

@Injectable({ providedIn: 'root' })
export class InactividadService {
  private readonly reloj = inject(RelojService);
  private readonly appRef = inject(ApplicationRef);

  readonly sesionActiva = signal<boolean>(false);
  readonly dialogoAbierto = signal<boolean>(false);
  readonly segundosRestantes = signal<number>(60);
  readonly anuncioSegundos = signal<number>(60);

  private ultimaActividad = 0;
  private intervalo?: ReturnType<typeof setInterval>;
  private onAviso?: () => void;
  private onCierre?: () => void;

  setCallbacks(onAviso: () => void, onCierre: () => void): void {
    this.onAviso = onAviso;
    this.onCierre = onCierre;
  }

  estaActiva(): boolean {
    return this.sesionActiva();
  }

  iniciar(): void {
    this.sesionActiva.set(true);
    this.dialogoAbierto.set(false);
    this.ultimaActividad = this.reloj.ahora();
    this.segundosRestantes.set(60);
    this.anuncioSegundos.set(60);
    if (this.intervalo) {
      clearInterval(this.intervalo);
    }
    this.intervalo = setInterval(() => {
      this.reevaluar();
    }, TIC_MS);
  }

  detener(): void {
    this.sesionActiva.set(false);
    this.dialogoAbierto.set(false);
    if (this.intervalo) {
      clearInterval(this.intervalo);
      this.intervalo = undefined;
    }
  }

  registrarActividad(): void {
    if (this.sesionActiva() && !this.dialogoAbierto()) {
      this.ultimaActividad = this.reloj.ahora();
    }
  }

  reiniciar(): void {
    this.ultimaActividad = this.reloj.ahora();
    this.dialogoAbierto.set(false);
    this.segundosRestantes.set(60);
    this.anuncioSegundos.set(60);
    this.reevaluar();
  }

  reevaluar(): void {
    if (!this.sesionActiva()) {
      return;
    }

    const ahora = this.reloj.ahora();
    const inactivo = ahora - this.ultimaActividad;

    if (inactivo >= CIERRE_INACTIVIDAD_MS) {
      this.dialogoAbierto.set(false);
      this.detener();
      this.onCierre?.();
      this.appRef.tick();
      return;
    }

    if (inactivo >= AVISO_INACTIVIDAD_MS) {
      const seg = Math.max(1, Math.ceil((CIERRE_INACTIVIDAD_MS - inactivo) / 1000));
      this.segundosRestantes.set(seg);
      const anuncio = Math.max(10, Math.ceil(seg / 10) * 10);
      this.anuncioSegundos.set(anuncio);

      const eraAbierto = this.dialogoAbierto();
      if (!eraAbierto) {
        this.dialogoAbierto.set(true);
        this.onAviso?.();
      }

      this.appRef.tick();
      return;
    }

    // inactivo < AVISO_INACTIVIDAD_MS
    if (this.dialogoAbierto()) {
      this.dialogoAbierto.set(false);
      this.appRef.tick();
    }
  }
}
