import type { ApplicationRef } from '@angular/core';
import type { InactividadService } from './inactividad.service';
import type { RelojService } from './reloj.service';

export function registrarCosturas(
  reloj: RelojService,
  inactividad: InactividadService,
  appRef: ApplicationRef,
): void {
  if (typeof window === 'undefined') return;

  const w = window as unknown as {
    __zfb__?: {
      reloj?: {
        fijar: (ms: number) => void;
        avanzar: (ms: number) => void;
        desfijar: () => void;
      };
    };
  };

  w.__zfb__ = {
    reloj: {
      fijar: (ms: number) => {
        reloj.fijar(ms);
        inactividad.reevaluar();
        appRef.tick();
      },
      avanzar: (ms: number) => {
        reloj.avanzar(ms);
        inactividad.reevaluar();
        appRef.tick();
      },
      desfijar: () => {
        reloj.desfijar();
        inactividad.reevaluar();
        appRef.tick();
      },
    },
  };
}
