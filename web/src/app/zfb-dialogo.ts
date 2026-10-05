import {
  Component,
  ElementRef,
  HostListener,
  ViewEncapsulation,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { TPipe } from './i18n/t.pipe';

@Component({
  selector: 'zfb-dialogo',
  imports: [TPipe],
  encapsulation: ViewEncapsulation.ShadowDom,
  template: `
    <div class="dialogo-telon" [hidden]="!abierto()" (click)="alClicTelon($event)">
      @if (tipo() === 'confirmar') {
        <div
          class="dialogo"
          id="confirmar-dialogo"
          data-testid="confirmar-dialogo"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirmar-dialogo-titulo"
          [hidden]="!abierto()"
          (keydown)="alPulsarTecla($event)"
        >
          <div class="dialogo-cuerpo">
            <h2 id="confirmar-dialogo-titulo" class="dialogo-titulo">{{ 'dialogo.confirmar.titulo' | t }}</h2>
            <p class="dialogo-mensaje">
              {{ 'dialogo.confirmar.mensajePrefijo' | t }}{{ monto() ? '$ ' + monto() : '' }}{{ 'dialogo.confirmar.mensajeSufijo' | t }}
            </p>
            <div class="dialogo-acciones">
              <button
                type="button"
                id="confirmar-cancelar"
                #botonCancelar
                data-testid="confirmar-cancelar"
                class="boton-cancelar"
                (click)="cancelar()"
              >
                {{ 'dialogo.confirmar.cancelar' | t }}
              </button>
              <button
                type="button"
                id="confirmar-aceptar"
                #botonAceptar
                data-testid="confirmar-aceptar"
                class="boton-aceptar"
                (click)="aceptar()"
              >
                {{ 'dialogo.confirmar.confirmar' | t }}
              </button>
            </div>
          </div>
        </div>
      } @else {
        <div
          class="dialogo"
          id="inactividad-dialogo"
          data-testid="inactividad-dialogo"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inactividad-dialogo-titulo"
          [hidden]="!abierto()"
          (keydown)="alPulsarTecla($event)"
        >
          <div class="dialogo-cuerpo">
            <h2 id="inactividad-dialogo-titulo" class="dialogo-titulo">{{ 'dialogo.inactividad.titulo' | t }}</h2>
            <p class="dialogo-mensaje">
              {{ 'dialogo.inactividad.mensajePrefijo' | t }}<strong id="inactividad-segundos" data-testid="inactividad-segundos" [attr.data-segundos]="segundos()">{{ segundos() }}</strong>{{ 'dialogo.inactividad.mensajeSufijo' | t }}
            </p>
            <p class="sr-only" aria-live="polite">
              {{ 'dialogo.inactividad.srPrefijo' | t }}{{ anuncioSegundos() }}{{ 'dialogo.inactividad.srSufijo' | t }}
            </p>
            <div class="dialogo-acciones">
              <button
                type="button"
                id="inactividad-salir"
                #botonSalir
                data-testid="inactividad-salir"
                class="boton-cancelar"
                (click)="salir()"
              >
                {{ 'dialogo.inactividad.salir' | t }}
              </button>
              <button
                type="button"
                id="inactividad-seguir"
                #botonSeguir
                data-testid="inactividad-seguir"
                class="boton-aceptar"
                (click)="seguir()"
              >
                {{ 'dialogo.inactividad.seguir' | t }}
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: contents;
    }
    .dialogo-telon {
      position: fixed;
      inset: 0;
      background: rgba(14, 14, 13, 0.76);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      display: grid;
      place-items: center;
      z-index: 1000;
      padding: 16px;
    }
    .dialogo-telon[hidden],
    .dialogo[hidden] {
      display: none !important;
    }
    .dialogo {
      background: rgba(28, 27, 25, 0.96);
      border: 1px solid rgba(237, 233, 226, 0.16);
      border-radius: 14px;
      padding: 24px;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
      color: #ede9e2;
      font-family: 'Jost', system-ui, sans-serif;
      box-sizing: border-box;
    }
    .dialogo-titulo {
      margin: 0 0 12px;
      font-family: 'Spectral', Georgia, serif;
      font-style: italic;
      font-weight: 400;
      font-size: 1.5rem;
      line-height: 1.2;
    }
    .dialogo-mensaje {
      margin: 0 0 24px;
      font-size: 0.9375rem;
      line-height: 1.5;
      color: #a8a299;
    }
    strong {
      color: #ede9e2;
      font-weight: 600;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .dialogo-acciones {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
    }
    button {
      font-family: inherit;
      font-size: 0.875rem;
      font-weight: 500;
      padding: 0.7em 1.4em;
      border-radius: 999px;
      cursor: pointer;
      border: 0;
      transition: background-color 160ms ease, transform 160ms ease;
    }
    button:active {
      transform: translateY(1px);
    }
    /* :focus y no :focus-visible: el foco inicial llega por código tras un clic (J3), y Chrome no
       pinta :focus-visible en ese caso. Un contorno gris-blanco que parpadea dos veces y queda fijo. */
    button:focus {
      outline: 1.5px solid rgba(237, 233, 226, 0.75);
      outline-offset: 3px;
      animation: foco-pulso 0.9s ease-in-out 2;
    }
    @keyframes foco-pulso {
      0%, 100% { outline-color: rgba(237, 233, 226, 0.75); }
      50% { outline-color: rgba(237, 233, 226, 0.15); }
    }
    @media (prefers-reduced-motion: reduce) {
      button:focus { animation: none; }
    }
    .boton-cancelar {
      background: rgba(237, 233, 226, 0.1);
      color: #ede9e2;
      border: 1px solid rgba(237, 233, 226, 0.16);
    }
    .boton-cancelar:hover {
      background: rgba(237, 233, 226, 0.18);
    }
    .boton-aceptar {
      background: #ede9e2;
      color: #0e0e0d;
    }
    .boton-aceptar:hover {
      background: #fff;
    }
  `],
})
export class ZfbDialogo {
  readonly tipo = input<'confirmar' | 'inactividad'>('confirmar');
  readonly abierto = input<boolean>(false);
  readonly monto = input<string>('');
  readonly segundos = input<number>(60);
  readonly anuncioSegundos = input<number>(60);

  readonly alAceptar = output<void>();
  readonly alCancelar = output<void>();
  readonly alSeguir = output<void>();
  readonly alSalir = output<void>();

  readonly botonCancelar = viewChild<ElementRef<HTMLButtonElement>>('botonCancelar');
  readonly botonAceptar = viewChild<ElementRef<HTMLButtonElement>>('botonAceptar');
  readonly botonSalir = viewChild<ElementRef<HTMLButtonElement>>('botonSalir');
  readonly botonSeguir = viewChild<ElementRef<HTMLButtonElement>>('botonSeguir');

  private readonly elementRef = inject(ElementRef);
  private enviado = false;

  enfocarInicial(): void {
    if (this.tipo() === 'inactividad') {
      this.botonSeguir()?.nativeElement.focus();
    } else {
      this.enviado = false;
      // Foco inicial en confirmar-cancelar (J3, D2). La anfitriona lo llama tras el render.
      this.botonCancelar()?.nativeElement.focus();
    }
  }

  cancelar(): void {
    this.enviado = false;
    this.alCancelar.emit();
  }

  aceptar(): void {
    // M16: Dos clics sincrónicos en aceptar no generan otra clave ni otro POST
    if (this.enviado) {
      return;
    }
    this.enviado = true;
    this.alAceptar.emit();
  }

  seguir(): void {
    this.alSeguir.emit();
  }

  salir(): void {
    this.alSalir.emit();
  }

  alClicTelon(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('dialogo-telon')) {
      if (this.tipo() === 'confirmar') {
        this.cancelar();
      }
    }
  }

  @HostListener('keydown', ['$event'])
  alPulsarTecla(event: KeyboardEvent): void {
    if (!this.abierto()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (this.tipo() === 'inactividad') {
        this.seguir();
      } else {
        this.cancelar();
      }
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      const shadowRoot = (this.elementRef.nativeElement as HTMLElement).shadowRoot;
      const actual = shadowRoot?.activeElement;

      if (this.tipo() === 'confirmar') {
        const btnCancelar = this.botonCancelar()?.nativeElement;
        const btnAceptar = this.botonAceptar()?.nativeElement;

        if (event.shiftKey) {
          if (actual === btnAceptar) {
            btnCancelar?.focus();
          } else {
            btnAceptar?.focus();
          }
        } else {
          if (actual === btnCancelar) {
            btnAceptar?.focus();
          } else {
            btnCancelar?.focus();
          }
        }
      } else {
        const btnSalir = this.botonSalir()?.nativeElement;
        const btnSeguir = this.botonSeguir()?.nativeElement;

        if (event.shiftKey) {
          if (actual === btnSalir) {
            btnSeguir?.focus();
          } else {
            btnSalir?.focus();
          }
        } else {
          if (actual === btnSeguir) {
            btnSalir?.focus();
          } else {
            btnSeguir?.focus();
          }
        }
      }
    }
  }
}
