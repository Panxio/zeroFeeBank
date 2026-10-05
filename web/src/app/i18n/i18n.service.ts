import { Injectable, effect, signal } from '@angular/core';
import { Catalogo, ClaveCatalogo, EN, ES, interpolar } from './catalogo';

export type Idioma = 'es' | 'en';

@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly idioma = signal<Idioma>(this.obtenerIdiomaInicial());

  constructor() {
    effect(() => {
      const id = this.idioma();
      if (typeof document !== 'undefined') {
        document.documentElement.lang = id;
        document.title = this.t('app.titulo');
      }
      try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.setItem('zfb.idioma', id);
        }
      } catch {
        // sessionStorage puede lanzar en contextos restringidos
      }
    });
  }

  fijar(idioma: Idioma): void {
    if (idioma === 'es' || idioma === 'en') {
      this.idioma.set(idioma);
    }
  }

  t(clave: string, params?: Record<string, string | number>): string {
    const id = this.idioma();
    const catalogoActivo = id === 'en' ? EN : ES;
    const plantilla = (catalogoActivo as Record<string, string>)[clave] ??
                      (ES as Record<string, string>)[clave] ??
                      clave;
    return interpolar(plantilla, params);
  }

  has(clave: string): boolean {
    return clave in ES;
  }

  private obtenerIdiomaInicial(): Idioma {
    // 1. query ?lang=en|es de la URL
    try {
      if (typeof window !== 'undefined' && window.location?.search) {
        const params = new URLSearchParams(window.location.search);
        const langQuery = params.get('lang')?.toLowerCase();
        if (langQuery === 'es' || langQuery === 'en') {
          return langQuery;
        }
      }
    } catch {
      // Ignorar error al acceder a location/search
    }

    // 2. sessionStorage['zfb.idioma']
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const almacenado = window.sessionStorage.getItem('zfb.idioma')?.toLowerCase();
        if (almacenado === 'es' || almacenado === 'en') {
          return almacenado;
        }
      }
    } catch {
      // Ignorar error al acceder a sessionStorage
    }

    // 3. Fallback por defecto: 'es'
    return 'es';
  }
}
