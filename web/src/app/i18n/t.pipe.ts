import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from './i18n.service';

@Pipe({
  name: 't',
  standalone: true,
  pure: false,
})
export class TPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(clave: string | null | undefined, params?: Record<string, string | number>): string {
    if (!clave) return '';
    // Consumir el signal idioma() para reactividad ante cambios de idioma
    this.i18n.idioma();
    return this.i18n.t(clave, params);
  }
}
