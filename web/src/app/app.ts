import {
  AfterViewInit,
  ApplicationRef,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { InactividadService } from './inactividad.service';
import { RelojService } from './reloj.service';
import { registrarCosturas } from './costuras';
import { ZfbDialogo } from './zfb-dialogo';
import { I18nService, Idioma } from './i18n/i18n.service';
import { TPipe } from './i18n/t.pipe';

const SEMILLA = 0x5a4f46; // "ZOF"
function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const azar = mulberry32(SEMILLA);
const perm = new Uint8Array(512);
const valores = new Float32Array(256);
const base = Array.from({ length: 256 }, (_, i) => i);
for (let i = 255; i > 0; i--) {
  const j = Math.floor(azar() * (i + 1));
  const temp = base[i]!;
  base[i] = base[j]!;
  base[j] = temp;
}
for (let i = 0; i < 512; i++) perm[i] = base[i & 255]!;
for (let i = 0; i < 256; i++) valores[i] = azar();

function ruido(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const X = xi & 255, Y = yi & 255;
  const a = valores[perm[X + perm[Y]!]!]!;
  const b = valores[perm[X + 1 + perm[Y]!]!]!;
  const c = valores[perm[X + perm[Y + 1]!]!]!;
  const d = valores[perm[X + 1 + perm[Y + 1]!]!]!;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number): number {
  let s = 0, amp = 0.5;
  for (let o = 0; o < 5; o++) {
    s += amp * ruido(x, y);
    const nx = 1.6 * x + 1.2 * y, ny = -1.2 * x + 1.6 * y;
    x = nx + 3.1;
    y = ny + 1.7;
    amp *= 0.5;
  }
  return s / 0.96875;
}

const suave = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const TINTA = [14, 14, 13] as const;
const CARBON = [44, 42, 39] as const;
const NIEBLA = [168, 162, 153] as const;
const VELOCIDAD = 0.035;
const PASO_MS = 50;
const ORIGEN_AUTH = 'http://localhost:3000';

export interface BoletaDto {
  id: string;
  estado: string;
  monto: string;
  cuentaOrigenId: string;
  beneficiarioRut: string;
  beneficiarioNombre: string;
  glosa: string;
  retiradorRut: string;
  retiradorNombre: string;
  emitidaEn: string;
  venceEn: string;
  fondosLiberados: boolean;
}

export interface MovimientoDto {
  id: string;
  transaccionId: string;
  concepto: string;
  monto: string;
  fecha: string;
}

export interface PagoDto {
  id: string;
  transaccionId: string;
  cuentaOrigenId: string;
  monto: string;
  beneficiarioNombre: string;
  cuentaBeneficiario: string;
  pagadoEn: string;
}

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

const MAPA_CONCEPTOS_MOVIMIENTOS: Record<string, string> = {
  TRANSFERENCIA: 'Transferencia',
  TRANSFERENCIA_OTRO_BANCO: 'Transferencia a otro banco',
  PAGO_SERVICIO: 'Pago de servicio',
  APERTURA_CUENTA: 'Apertura de cuenta',
  EMISION_BOLETA: 'Emisión de boleta',
  COBRO_BOLETA: 'Cobro de boleta',
  VENCIMIENTO_BOLETA: 'Liberación de boleta vencida',
  DEVOLUCION_BOLETA: 'Devolución de boleta',
  OTORGAMIENTO_PRESTAMO: 'Préstamo',
};

const LARGO_ID_CORTO = 6;

@Component({
  selector: 'app-root',
  imports: [ZfbDialogo, TPipe],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, AfterViewInit, OnDestroy {
  readonly i18n = inject(I18nService);
  readonly idiomaActual = this.i18n.idioma;
  readonly t = (clave: string, params?: Record<string, string | number>) => this.i18n.t(clave, params);

  alCambiarIdioma(evento: Event): void {
    const valor = (evento.target as HTMLSelectElement).value;
    this.i18n.fijar(valor as Idioma);
  }

  readonly estadoBruma = signal<'congelado' | 'animando'>(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'congelado'
      : 'animando',
  );

  readonly estadoPopover = signal<'cargando' | 'listo'>('cargando');
  readonly popoverAbierto = signal<boolean>(false);
  readonly emailUsuario = signal<string | null>(null);

  readonly menuCuentasAbierto = signal<boolean>(false);
  readonly menuUsuarioAbierto = signal<boolean>(false);
  readonly hamburguesaAbierta = signal<boolean>(false);

  // Vistas: Resumen, Transferir, Boletas, Abrir cuenta, Movimientos, Pagos o Contacto
  readonly vistaActual = signal<'resumen' | 'transferir' | 'boletas' | 'abrir-cuenta' | 'movimientos' | 'pagos' | 'contacto'>('resumen');

  // Ventanilla pública
  readonly enVentanilla = signal<boolean>(
    typeof window !== 'undefined' && window.location.hash === '#ventanilla',
  );
  readonly ventanillaBoletaId = signal<string>('');
  readonly ventanillaRut = signal<string>('');
  readonly cobrandoVentanilla = signal<boolean>(false);
  readonly exitoVentanilla = signal<{ estado: string; monto: string } | null>(null);
  readonly errorVentanilla = signal<{ codigo: string; mensaje?: string } | null>(null);
  readonly sinRespuestaVentanilla = signal<boolean>(false);
  readonly avisoVentanilla = signal<string | null>(null);

  // Vista Boletas
  readonly estadoBoletas = signal<'cargando' | 'listo' | 'vacio' | 'error'>('cargando');
  readonly pestanaBoletas = signal<'lista' | 'emitir'>('lista');
  readonly boletas = signal<BoletaDto[]>([]);
  readonly errorBoletas = signal<{ codigo?: string; mensaje?: string } | null>(null);

  // Form emitir boleta
  readonly estadoEmitir = signal<'editando' | 'enviando' | 'error'>('editando');
  readonly emitirOrigen = signal<string>('');
  readonly emitirMonto = signal<string>('');
  readonly emitirPlazo = signal<string>('');
  readonly emitirBeneficiarioRut = signal<string>('');
  readonly emitirBeneficiarioNombre = signal<string>('');
  readonly emitirRetiradorRut = signal<string>('');
  readonly emitirRetiradorNombre = signal<string>('');
  readonly emitirGlosa = signal<string>('');
  readonly emitirExito = signal<{ id: string } | null>(null);
  readonly emitirError = signal<{ codigo?: string; mensaje?: string } | null>(null);
  readonly emitirSinRespuesta = signal<boolean>(false);

  // Acciones sobre boletas
  readonly accionEnCurso = signal<boolean>(false);
  readonly accionError = signal<{ codigo: string; boletaId: string; mensaje?: string } | null>(null);
  readonly accionSinRespuesta = signal<boolean>(false);
  readonly errorPdfBoletas = signal<string | null>(null);

  // Vista Abrir cuenta
  readonly estadoAbrirCuenta = signal<'cargando' | 'listo' | 'error'>('cargando');
  readonly errorCargaAbrirCuenta = signal<{ codigo?: string; motivo?: string; mensaje?: string } | null>(null);
  readonly errorEnvioAbrirCuenta = signal<{ codigo?: string; mensaje?: string } | null>(null);
  readonly tipoAbrirCuenta = signal<string>('CORRIENTE');
  readonly montoAbrirCuenta = signal<string>('1000.00');
  readonly origenAbrirCuenta = signal<string>('');
  readonly enviandoAbrirCuenta = signal<boolean>(false);
  private claveAbrirCuenta: string | null = null;

  // Vista Movimientos (S-17)
  readonly estadoMovimientos = signal<'inicial' | 'cargando' | 'listo' | 'vacio' | 'error'>('inicial');
  readonly cargandoMovimientos = signal<boolean>(false);
  readonly movimientos = signal<MovimientoDto[]>([]);
  readonly hayMasMovimientos = signal<boolean>(false);
  readonly errorMovimientos = signal<{ codigo: string; mensaje?: string } | null>(null);
  readonly errorCuentasMovimientos = signal<boolean>(false);

  // Filtros de búsqueda de movimientos
  readonly filtroCuentaId = signal<string>('');
  readonly filtroTransaccionId = signal<string>('');
  readonly filtroDesde = signal<string>('');
  readonly filtroHasta = signal<string>('');
  readonly filtroMonto = signal<string>('');

  // Vista Pagos (S-17)
  readonly estadoPago = signal<'editando' | 'enviando' | 'exito' | 'error' | 'sin-respuesta'>('editando');
  readonly estadoListaPagos = signal<'cargando' | 'listo' | 'vacio' | 'error'>('cargando');
  readonly estadoCuentasPagos = signal<'cargando' | 'listo' | 'error'>('cargando');
  readonly errorCuentasPagos = signal<boolean>(false);
  readonly pagos = signal<PagoDto[]>([]);
  readonly pagoOrigen = signal<string>('');
  readonly pagoMonto = signal<string>('');
  readonly pagoBeneficiarioNombre = signal<string>('');
  readonly pagoBeneficiarioDireccion = signal<string>('');
  readonly pagoBeneficiarioCiudad = signal<string>('');
  readonly pagoBeneficiarioEstado = signal<string>('');
  readonly pagoBeneficiarioCodigoPostal = signal<string>('');
  readonly pagoBeneficiarioTelefono = signal<string>('');
  readonly pagoCuentaBeneficiario = signal<string>('');
  readonly pagoExitosoId = signal<string | null>(null);
  readonly pagoRepetido = signal<boolean>(false);
  readonly errorPago = signal<{ codigo: string; mensaje?: string } | null>(null);
  readonly sinRespuestaPago = signal<boolean>(false);
  readonly modalConfirmacionPagosAbierto = signal<boolean>(false);
  private claveActualPago: string | null = null;
  private enviandoPago = false;
  readonly dialogoConfirmarPagosRef = viewChild<ZfbDialogo>('dialogoConfirmarPagos');
  readonly pagosEnviarRef = viewChild<ElementRef<HTMLButtonElement>>('pagosEnviar');

  // Vista Contacto (S-17)
  readonly estadoContacto = signal<'cargando' | 'listo' | 'error'>('cargando');
  readonly errorCargaContacto = signal<boolean>(false);
  readonly contactoEmail = signal<string>('');
  readonly contactoNombre = signal<string>('');
  readonly contactoApellido = signal<string>('');
  readonly contactoDireccion = signal<string>('');
  readonly contactoCiudad = signal<string>('');
  readonly contactoEstado = signal<string>('');
  readonly contactoCodigoPostal = signal<string>('');
  readonly contactoTelefono = signal<string>('');

  readonly estadoGuardadoContacto = signal<'editando' | 'guardando' | 'guardado' | 'error' | 'sin-respuesta'>('editando');
  readonly errorContacto = signal<{ codigo: string; mensaje?: string } | null>(null);
  readonly sinRespuestaContacto = signal<boolean>(false);
  readonly avisoContactoGuardado = signal<boolean>(false);

  private guardandoContacto = false;
  private temporizadorAvisoContacto?: ReturnType<typeof setTimeout>;

  readonly estadoCuentas = signal<'cargando' | 'listo' | 'vacio' | 'error'>('cargando');
  readonly cuentas = signal<Array<{ id: string; tipo: string; saldo: string }>>([]);
  readonly errorCuentas = signal<{ codigo?: string; motivo?: string; mensaje?: string } | null>(null);
  readonly avisoSesion = signal<{ motivo: string; codigo?: string; mensaje: string } | null>(null);

  // Asistente de transferencia
  readonly pasoActual = signal<'origen' | 'destino' | 'revisar'>('origen');
  readonly origenSeleccionado = signal<string>('');
  readonly modoDestino = signal<'propia' | 'otra' | 'banco'>('propia');
  readonly destinoPropia = signal<string>('');
  readonly destinoOtra = signal<string>('');
  readonly destinoBanco = signal<string>('SANDBOX');
  readonly destinoNumero = signal<string>('');
  readonly destinoTipo = signal<string>('AHORRO');
  readonly monto = signal<string>('');

  readonly CATALOGO_BANCOS: Record<string, string> = {
    ASERCION: 'Banco Aserción',
    FIXTURE: 'Banco Fixture',
    STUB: 'Banco Stub',
    SANDBOX: 'Banco Sandbox',
    MOCK: 'Banco Mock',
  };

  nombreBanco(codigo?: string): string {
    if (!codigo) return '';
    const clave = `banco.${codigo}`;
    return this.i18n.has(clave) ? this.t(clave) : (this.CATALOGO_BANCOS[codigo] ?? codigo);
  }

  readonly estadoTransferencia = signal<'editando' | 'enviando' | 'error'>('editando');
  readonly errorTransferencia = signal<{ codigo?: string; mensaje?: string } | null>(null);
  readonly sinRespuesta = signal<boolean>(false);
  readonly transferenciaExitosa = signal<{
    transaccionId: string;
    monto: string;
    origenId: string;
    destinoId: string;
    repetida: boolean;
  } | null>(null);
  readonly transferenciaOtroBancoExitosa = signal<{
    id: string;
    transaccionId: string;
    cuentaOrigenId: string;
    monto: string;
    banco: string;
    numeroCuenta: string;
    tipoCuenta: string;
    realizadaEn: string;
  } | null>(null);

  readonly modalConfirmacionAbierto = signal<boolean>(false);
  readonly errorPdf = signal<string | null>(null);

  readonly cuentasDestinoPropias = computed(() => {
    const orig = this.origenSeleccionado();
    return this.cuentas().filter((c) => c.id !== orig);
  });

  readonly destinoFinal = computed(() => {
    if (this.modoDestino() === 'propia') {
      return this.destinoPropia().trim();
    }
    if (this.modoDestino() === 'otra') {
      return this.destinoOtra().trim();
    }
    if (this.modoDestino() === 'banco') {
      return `${this.destinoBanco()} - ${this.destinoNumero()}`;
    }
    return '';
  });

  readonly destinoValido = computed(() => {
    if (this.modoDestino() === 'propia') {
      return this.destinoPropia().trim() !== '';
    }
    if (this.modoDestino() === 'otra') {
      return this.destinoOtra().trim() !== '';
    }
    if (this.modoDestino() === 'banco') {
      return this.destinoBanco().trim() !== '';
    }
    return false;
  });

  readonly revisarHabilitado = computed(() => {
    return (
      this.origenSeleccionado().trim() !== '' &&
      this.destinoValido() &&
      this.monto().trim() !== ''
    );
  });

  readonly brumaRef = viewChild<ElementRef<HTMLCanvasElement>>('brumaCanvas');
  readonly loginPopoverRef = viewChild<ElementRef<HTMLElement>>('loginPopover');
  readonly loginMarcoRef = viewChild<ElementRef<HTMLIFrameElement>>('loginMarco');
  readonly loginAbrirRef = viewChild<ElementRef<HTMLButtonElement>>('loginAbrir');
  readonly navCuentasRef = viewChild<ElementRef<HTMLElement>>('navCuentas');
  readonly navResumenRef = viewChild<ElementRef<HTMLElement>>('navResumen');
  readonly navAbrirCuentaRef = viewChild<ElementRef<HTMLElement>>('navAbrirCuenta');
  readonly navTransferirRef = viewChild<ElementRef<HTMLElement>>('navTransferir');
  readonly navMovimientosRef = viewChild<ElementRef<HTMLElement>>('navMovimientos');
  readonly navBoletasRef = viewChild<ElementRef<HTMLElement>>('navBoletas');
  readonly navUsuarioRef = viewChild<ElementRef<HTMLElement>>('navUsuario');
  readonly navHamburguesaRef = viewChild<ElementRef<HTMLElement>>('navHamburguesa');

  readonly tabOrigenRef = viewChild<ElementRef<HTMLButtonElement>>('tabOrigen');
  readonly tabDestinoRef = viewChild<ElementRef<HTMLButtonElement>>('tabDestino');
  readonly tabRevisarRef = viewChild<ElementRef<HTMLButtonElement>>('tabRevisar');
  readonly pestanaBoletasListaRef = viewChild<ElementRef<HTMLButtonElement>>('pestanaBoletasLista');
  readonly pestanaBoletasEmitirRef = viewChild<ElementRef<HTMLButtonElement>>('pestanaBoletasEmitir');
  readonly transferirEnviarRef = viewChild<ElementRef<HTMLButtonElement>>('transferirEnviar');
  readonly dialogoConfirmarRef = viewChild<ZfbDialogo>('dialogoConfirmar');
  readonly dialogoInactividadRef = viewChild<ZfbDialogo>('dialogoInactividad');

  private readonly injector = inject(Injector);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly appRef = inject(ApplicationRef);
  private readonly reloj = inject(RelojService);
  readonly inactividad = inject(InactividadService);

  private elementoFocoPrevio: HTMLElement | null = null;
  private tokenEnMemoria: string | null = null;
  private imagenBruma: ImageData | null = null;
  private movimientoMedia?: MediaQueryList;
  private temporizadorCierreCuentas?: ReturnType<typeof setTimeout>;
  private bucleAnimacion = 0;
  private inicioAnimacion = 0;
  private ultimoCuadro = -Infinity;

  private claveActual: string | null = null;
  private enviandoTransferencia = false;
  private claveVentanilla: string | null = null;
  private claveEmitir: string | null = null;
  private claveAccion = new Map<string, string>();

  constructor() {
    registrarCosturas(this.reloj, this.inactividad, this.appRef);
    this.inactividad.setCallbacks(
      () => this.alAvisoInactividad(),
      () => this.cerrarSesionPorInactividad(),
    );
  }

  ngOnInit(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.alRecibirMensaje);
      window.addEventListener('keydown', this.alPulsarTeclaGlobal);
      window.addEventListener('pointerdown', this.alPointerDownGlobal, { passive: true });
      window.addEventListener('wheel', this.alWheelGlobal, { passive: true });
      window.addEventListener('hashchange', this.alHashChange);
      this.actualizarRutaHash();
    }
  }

  ngAfterViewInit(): void {
    if (typeof window !== 'undefined') {
      this.movimientoMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.movimientoMedia.addEventListener('change', this.aplicarBruma);
      window.addEventListener('resize', this.alRedimensionar);
      this.dimensionarBruma();
      this.aplicarBruma();
      this.generarGrano();
    }
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.bucleAnimacion);
    this.movimientoMedia?.removeEventListener('change', this.aplicarBruma);
    if (this.temporizadorCierreCuentas) {
      clearTimeout(this.temporizadorCierreCuentas);
    }
    this.limpiarTemporizadorAvisoContacto();
    this.inactividad.detener();
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.alRedimensionar);
      window.removeEventListener('message', this.alRecibirMensaje);
      window.removeEventListener('keydown', this.alPulsarTeclaGlobal);
      window.removeEventListener('pointerdown', this.alPointerDownGlobal);
      window.removeEventListener('wheel', this.alWheelGlobal);
      window.removeEventListener('hashchange', this.alHashChange);
    }
  }

  alCambiarPopover(event: Event): void {
    const toggleEvent = event as ToggleEvent;
    const abierto = toggleEvent.newState === 'open';
    this.popoverAbierto.set(abierto);
    if (abierto) {
      this.loginMarcoRef()?.nativeElement.focus();
    }
    // Al cerrar, el popover nativo devuelve el foco a su invocador (login-abrir): no se repite aquí.
  }

  cerrarPopover(): void {
    const popover = this.loginPopoverRef()?.nativeElement;
    if (popover && popover.matches(':popover-open')) {
      popover.hidePopover();
    }
  }

  toggleHamburguesa(): void {
    this.hamburguesaAbierta.update((v) => !v);
  }

  toggleMenuUsuario(): void {
    this.menuUsuarioAbierto.update((v) => !v);
  }

  alEntrarCuentas(): void {
    if (this.temporizadorCierreCuentas) {
      clearTimeout(this.temporizadorCierreCuentas);
      this.temporizadorCierreCuentas = undefined;
    }
    this.menuCuentasAbierto.set(true);
  }

  alSalirCuentas(): void {
    if (this.temporizadorCierreCuentas) {
      clearTimeout(this.temporizadorCierreCuentas);
    }
    this.temporizadorCierreCuentas = setTimeout(() => {
      this.menuCuentasAbierto.set(false);
      this.temporizadorCierreCuentas = undefined;
    }, 300);
  }

  alFlechaAbajoCuentas(event: Event): void {
    event.preventDefault();
    if (this.temporizadorCierreCuentas) {
      clearTimeout(this.temporizadorCierreCuentas);
      this.temporizadorCierreCuentas = undefined;
    }
    this.menuCuentasAbierto.set(true);
    requestAnimationFrame(() => {
      this.navResumenRef()?.nativeElement.focus();
    });
  }

  alActivarCuentas(event: Event): void {
    event.preventDefault();
    if (this.temporizadorCierreCuentas) {
      clearTimeout(this.temporizadorCierreCuentas);
      this.temporizadorCierreCuentas = undefined;
    }
    this.limpiarContacto();
    this.menuCuentasAbierto.set(false);
    this.hamburguesaAbierta.set(false);
    this.vistaActual.set('resumen');
    void this.cargarCuentas();
  }

  alActivarResumen(event: Event): void {
    event.preventDefault();
    if (this.temporizadorCierreCuentas) {
      clearTimeout(this.temporizadorCierreCuentas);
      this.temporizadorCierreCuentas = undefined;
    }
    this.limpiarContacto();
    this.menuCuentasAbierto.set(false);
    this.hamburguesaAbierta.set(false);
    this.vistaActual.set('resumen');
    void this.cargarCuentas();
  }

  alHacerClicMarca(event: Event): void {
    event.preventDefault();
    if (this.emailUsuario()) {
      this.alActivarResumen(event);
    }
  }

  alActivarTransferir(event?: Event): void {
    event?.preventDefault();
    if (this.temporizadorCierreCuentas) {
      clearTimeout(this.temporizadorCierreCuentas);
      this.temporizadorCierreCuentas = undefined;
    }
    this.limpiarContacto();
    this.menuCuentasAbierto.set(false);
    this.hamburguesaAbierta.set(false);
    this.vistaActual.set('transferir');
    this.iniciarAsistente();
    void this.cargarCuentas();
  }

  alActivarBoletas(event?: Event): void {
    event?.preventDefault();
    if (this.temporizadorCierreCuentas) {
      clearTimeout(this.temporizadorCierreCuentas);
      this.temporizadorCierreCuentas = undefined;
    }
    this.limpiarContacto();
    this.menuCuentasAbierto.set(false);
    this.hamburguesaAbierta.set(false);
    this.vistaActual.set('boletas');
    this.pestanaBoletas.set('lista');
    this.estadoEmitir.set('editando');
    this.emitirError.set(null);
    this.emitirSinRespuesta.set(false);
    this.emitirExito.set(null);
    this.accionError.set(null);
    this.accionSinRespuesta.set(false);
    this.errorPdfBoletas.set(null);
    void this.cargarBoletasYcuentas();
  }

  alActivarAbrirCuenta(event?: Event): void {
    event?.preventDefault();
    if (this.temporizadorCierreCuentas) {
      clearTimeout(this.temporizadorCierreCuentas);
      this.temporizadorCierreCuentas = undefined;
    }
    this.limpiarContacto();
    this.menuCuentasAbierto.set(false);
    this.hamburguesaAbierta.set(false);
    this.vistaActual.set('abrir-cuenta');
    this.iniciarAbrirCuenta();
    void this.cargarCuentasParaAbrir();
  }

  iniciarAbrirCuenta(): void {
    this.tipoAbrirCuenta.set('CORRIENTE');
    this.montoAbrirCuenta.set('1000.00');
    this.origenAbrirCuenta.set('');
    this.errorEnvioAbrirCuenta.set(null);
    this.errorCargaAbrirCuenta.set(null);
    this.claveAbrirCuenta = null;
    this.enviandoAbrirCuenta.set(false);
  }

  async cargarCuentasParaAbrir(): Promise<void> {
    if (!this.tokenEnMemoria) return;
    this.estadoAbrirCuenta.set('cargando');
    this.errorCargaAbrirCuenta.set(null);
    this.cdr.detectChanges();

    try {
      const res = await fetch(`${ORIGEN_AUTH}/cuentas`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.tokenEnMemoria}`,
        },
      });

      if (res.status === 401) {
        const cuerpo = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
        const codigo = cuerpo?.codigo;
        if (codigo === 'TOKEN_EXPIRADO' || codigo === 'TOKEN_INVALIDO' || codigo === 'TOKEN_AUSENTE') {
          this.cerrarSesionPorToken(codigo, cuerpo?.mensaje);
          return;
        }
      }

      if (!res.ok) {
        const cuerpo = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
        this.errorCargaAbrirCuenta.set({
          codigo: cuerpo?.codigo,
          mensaje: cuerpo?.mensaje || cuerpo?.codigo || 'Error al obtener la información de tus cuentas.',
        });
        this.estadoAbrirCuenta.set('error');
        this.cdr.detectChanges();
        return;
      }

      const data = (await res.json()) as { cuentas?: Array<{ id: string; tipo: string; saldo: string }> };
      const lista = data?.cuentas ?? [];
      this.cuentas.set(lista);
      this.origenAbrirCuenta.set('');
      this.estadoAbrirCuenta.set('listo');
      this.cdr.detectChanges();
    } catch {
      this.errorCargaAbrirCuenta.set({
        motivo: 'SIN_CONEXION',
        mensaje: 'No se pudo conectar con el servidor para obtener las cuentas.',
      });
      this.estadoAbrirCuenta.set('error');
      this.cdr.detectChanges();
    }
  }

  alEnviarAbrirCuenta(event?: Event): void {
    event?.preventDefault();
    if (this.estadoAbrirCuenta() === 'cargando') return;

    if (!this.claveAbrirCuenta) {
      this.claveAbrirCuenta = crypto.randomUUID();
    }
    const clave = this.claveAbrirCuenta;
    void this.ejecutarAbrirCuenta(clave);
  }

  private async ejecutarAbrirCuenta(clave: string): Promise<void> {
    if (!this.tokenEnMemoria) return;

    this.enviandoAbrirCuenta.set(true);
    this.errorEnvioAbrirCuenta.set(null);
    this.cdr.detectChanges();

    const cuerpo: { tipo: string; monto: string; cuentaOrigenId?: string } = {
      tipo: this.tipoAbrirCuenta(),
      monto: this.montoAbrirCuenta().trim(),
    };
    const origen = this.origenAbrirCuenta().trim();
    if (origen) {
      cuerpo.cuentaOrigenId = origen;
    }

    try {
      const res = await fetch(`${ORIGEN_AUTH}/cuentas`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.tokenEnMemoria}`,
          'Idempotency-Key': clave,
        },
        body: JSON.stringify(cuerpo),
      });

      if (res.status === 201) {
        this.claveAbrirCuenta = null;
        this.enviandoAbrirCuenta.set(false);
        this.vistaActual.set('resumen');
        this.cdr.detectChanges();
        void this.cargarCuentas();
        return;
      }

      if (res.status === 401) {
        this.claveAbrirCuenta = null;
        this.enviandoAbrirCuenta.set(false);
        const errData = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
        this.cerrarSesionPorToken(errData?.codigo || 'TOKEN_AUSENTE', errData?.mensaje);
        return;
      }

      // 4xx u otro rechazo: descartar clave (JA5)
      this.claveAbrirCuenta = null;
      this.enviandoAbrirCuenta.set(false);
      const errData = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
      const codigo = errData?.codigo;
      this.errorEnvioAbrirCuenta.set({
        codigo,
        mensaje: errData?.mensaje || codigo,
      });
      this.cdr.detectChanges();
    } catch {
      this.enviandoAbrirCuenta.set(false);
      this.errorEnvioAbrirCuenta.set({
        codigo: 'ERROR_CONEXION',
        mensaje: 'No se pudo conectar con el servidor.',
      });
      this.cdr.detectChanges();
    }
  }

  alActivarMovimientos(event?: Event): void {
    event?.preventDefault();
    if (this.temporizadorCierreCuentas) {
      clearTimeout(this.temporizadorCierreCuentas);
      this.temporizadorCierreCuentas = undefined;
    }
    this.limpiarContacto();
    this.menuCuentasAbierto.set(false);
    this.hamburguesaAbierta.set(false);
    this.vistaActual.set('movimientos');
    this.iniciarMovimientos();
    void this.cargarCuentasParaMovimientos();
  }

  iniciarMovimientos(): void {
    this.estadoMovimientos.set('inicial');
    this.cargandoMovimientos.set(false);
    this.movimientos.set([]);
    this.hayMasMovimientos.set(false);
    this.errorMovimientos.set(null);
    this.errorCuentasMovimientos.set(false);
    this.cuentas.set([]);
    this.filtroCuentaId.set('');
    this.filtroTransaccionId.set('');
    this.filtroDesde.set('');
    this.filtroHasta.set('');
    this.filtroMonto.set('');
  }

  async cargarCuentasParaMovimientos(): Promise<void> {
    if (!this.tokenEnMemoria) return;
    this.errorCuentasMovimientos.set(false);
    this.cdr.detectChanges();

    try {
      const res = await fetch(`${ORIGEN_AUTH}/cuentas`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.tokenEnMemoria}`,
        },
      });

      if (res.status === 401) {
        const cuerpo = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
        const codigo = cuerpo?.codigo;
        if (codigo === 'TOKEN_EXPIRADO' || codigo === 'TOKEN_INVALIDO' || codigo === 'TOKEN_AUSENTE') {
          this.cerrarSesionPorToken(codigo, cuerpo?.mensaje);
          return;
        }
      }

      if (!res.ok) {
        this.cuentas.set([]);
        this.errorCuentasMovimientos.set(true);
        this.cdr.detectChanges();
        return;
      }

      const data = (await res.json()) as { cuentas?: Array<{ id: string; tipo: string; saldo: string }> };
      const lista = data?.cuentas ?? [];
      this.cuentas.set(lista);
      this.errorCuentasMovimientos.set(false);
      this.cdr.detectChanges();
    } catch {
      this.cuentas.set([]);
      this.errorCuentasMovimientos.set(true);
      this.cdr.detectChanges();
    }
  }

  alBuscarMovimientos(event?: Event): void {
    event?.preventDefault();
    if (this.estadoMovimientos() === 'cargando' || this.cargandoMovimientos()) return;
    void this.ejecutarBusquedaMovimientos();
  }

  private async ejecutarBusquedaMovimientos(): Promise<void> {
    if (!this.tokenEnMemoria) return;
    if (this.cargandoMovimientos()) return;

    this.cargandoMovimientos.set(true);
    this.estadoMovimientos.set('cargando');
    this.errorMovimientos.set(null);
    this.cdr.detectChanges();

    try {
      const params = new URLSearchParams();
      const cuentaId = this.filtroCuentaId().trim();
      if (cuentaId) {
        params.set('cuentaId', cuentaId);
      }
      const transaccionId = this.filtroTransaccionId().trim();
      if (transaccionId) {
        params.set('transaccionId', transaccionId);
      }
      const desde = this.filtroDesde().trim();
      if (desde) {
        params.set('desde', desde);
      }
      const hasta = this.filtroHasta().trim();
      if (hasta) {
        params.set('hasta', hasta);
      }
      const monto = this.filtroMonto().trim();
      if (monto) {
        params.set('monto', monto);
      }

      const queryString = params.toString();
      const url = queryString ? `${ORIGEN_AUTH}/movimientos?${queryString}` : `${ORIGEN_AUTH}/movimientos`;

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.tokenEnMemoria}`,
        },
      });

      if (res.status === 401) {
        const cuerpo = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
        const codigo = cuerpo?.codigo;
        if (codigo === 'TOKEN_EXPIRADO' || codigo === 'TOKEN_INVALIDO' || codigo === 'TOKEN_AUSENTE') {
          this.cerrarSesionPorToken(codigo, cuerpo?.mensaje);
          return;
        }
      }

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
        const codigo = errData?.codigo || 'ERROR_DESCONOCIDO';
        this.errorMovimientos.set({
          codigo,
          mensaje: errData?.mensaje || codigo,
        });
        this.movimientos.set([]);
        this.hayMasMovimientos.set(false);
        this.estadoMovimientos.set('error');
        this.cargandoMovimientos.set(false);
        this.cdr.detectChanges();
        return;
      }

      const data = (await res.json()) as {
        cuentaId: string;
        movimientos: MovimientoDto[];
        devueltos: number;
        hayMas: boolean;
      };

      const lista = data?.movimientos ?? [];
      this.movimientos.set(lista);
      this.hayMasMovimientos.set(Boolean(data?.hayMas));
      if (lista.length === 0) {
        this.estadoMovimientos.set('vacio');
      } else {
        this.estadoMovimientos.set('listo');
      }
      this.cargandoMovimientos.set(false);
      this.cdr.detectChanges();
    } catch {
      this.errorMovimientos.set({
        codigo: 'ERROR_CONEXION',
        mensaje: 'No se pudo conectar con el servidor.',
      });
      this.movimientos.set([]);
      this.hayMasMovimientos.set(false);
      this.estadoMovimientos.set('error');
      this.cargandoMovimientos.set(false);
      this.cdr.detectChanges();
    }
  }

  obtenerRotuloConcepto(codigo: string): string {
    const clave = `movimientos.concepto.${codigo}`;
    return this.i18n.has(clave) ? this.t(clave) : (MAPA_CONCEPTOS_MOVIMIENTOS[codigo] ?? codigo);
  }

  obtenerMontoAbsoluto(monto: string): string {
    if (!monto) return '0.00';
    return monto.startsWith('-') ? monto.slice(1) : monto;
  }

  obtenerSigno(monto: string): 'DEBITO' | 'CREDITO' {
    if (!monto) return 'CREDITO';
    return monto.startsWith('-') ? 'DEBITO' : 'CREDITO';
  }

  textoSigno(monto: string): string {
    const signo = this.obtenerSigno(monto);
    const clave = `movimientos.signo.${signo}`;
    return this.i18n.has(clave) ? this.t(clave) : signo;
  }

  mensajeErrorMovimientos(codigo: string): string {
    const clave = `movimientos.error.${codigo}`;
    if (this.i18n.has(clave)) {
      return this.t(clave);
    }
    return this.t('movimientos.error.DEFAULT');
  }

  // ── S-17 · Pagos ──────────────────────────────────────────────────────────

  alActivarPagos(event?: Event): void {
    event?.preventDefault();
    if (this.temporizadorCierreCuentas) {
      clearTimeout(this.temporizadorCierreCuentas);
      this.temporizadorCierreCuentas = undefined;
    }
    this.limpiarContacto();
    this.menuCuentasAbierto.set(false);
    this.hamburguesaAbierta.set(false);
    this.vistaActual.set('pagos');
    this.iniciarPagos();
    void this.cargarCuentasParaPagos();
    void this.cargarPagos();
  }

  iniciarPagos(): void {
    this.estadoPago.set('editando');
    this.estadoListaPagos.set('cargando');
    this.estadoCuentasPagos.set('cargando');
    this.errorCuentasPagos.set(false);
    this.pagos.set([]);
    this.cuentas.set([]);
    this.pagoOrigen.set('');
    this.pagoMonto.set('');
    this.pagoBeneficiarioNombre.set('');
    this.pagoBeneficiarioDireccion.set('');
    this.pagoBeneficiarioCiudad.set('');
    this.pagoBeneficiarioEstado.set('');
    this.pagoBeneficiarioCodigoPostal.set('');
    this.pagoBeneficiarioTelefono.set('');
    this.pagoCuentaBeneficiario.set('');
    this.pagoExitosoId.set(null);
    this.pagoRepetido.set(false);
    this.errorPago.set(null);
    this.sinRespuestaPago.set(false);
    this.modalConfirmacionPagosAbierto.set(false);
    this.claveActualPago = null;
    this.enviandoPago = false;
  }

  async cargarCuentasParaPagos(): Promise<void> {
    if (!this.tokenEnMemoria) return;
    this.estadoCuentasPagos.set('cargando');
    this.errorCuentasPagos.set(false);
    this.cdr.detectChanges();

    try {
      const res = await fetch(`${ORIGEN_AUTH}/cuentas`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.tokenEnMemoria}`,
        },
      });

      if (res.status === 401) {
        const cuerpo = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
        const codigo = cuerpo?.codigo;
        if (codigo === 'TOKEN_EXPIRADO' || codigo === 'TOKEN_INVALIDO' || codigo === 'TOKEN_AUSENTE') {
          this.cerrarSesionPorToken(codigo, cuerpo?.mensaje);
          return;
        }
      }

      if (!res.ok) {
        this.cuentas.set([]);
        this.errorCuentasPagos.set(true);
        this.estadoCuentasPagos.set('error');
        this.cdr.detectChanges();
        return;
      }

      const data = (await res.json()) as { cuentas?: Array<{ id: string; tipo: string; saldo: string }> };
      const lista = data?.cuentas ?? [];
      this.cuentas.set(lista);
      if (lista.length > 0) {
        if (!this.pagoOrigen() || !lista.some((c) => c.id === this.pagoOrigen())) {
          this.pagoOrigen.set(lista[0].id);
        }
      } else {
        this.pagoOrigen.set('');
      }
      this.errorCuentasPagos.set(false);
      this.estadoCuentasPagos.set('listo');
      this.cdr.detectChanges();
    } catch {
      this.cuentas.set([]);
      this.errorCuentasPagos.set(true);
      this.estadoCuentasPagos.set('error');
      this.cdr.detectChanges();
    }
  }

  async cargarPagos(): Promise<void> {
    if (!this.tokenEnMemoria) return;
    this.estadoListaPagos.set('cargando');
    this.cdr.detectChanges();

    try {
      const res = await fetch(`${ORIGEN_AUTH}/pagos`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.tokenEnMemoria}`,
        },
      });

      if (res.status === 401) {
        const cuerpo = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
        const codigo = cuerpo?.codigo;
        if (codigo === 'TOKEN_EXPIRADO' || codigo === 'TOKEN_INVALIDO' || codigo === 'TOKEN_AUSENTE') {
          this.cerrarSesionPorToken(codigo, cuerpo?.mensaje);
          return;
        }
      }

      if (!res.ok) {
        this.pagos.set([]);
        this.estadoListaPagos.set('error');
        this.cdr.detectChanges();
        return;
      }

      const data = (await res.json()) as { pagos?: PagoDto[] };
      const lista = data?.pagos ?? [];
      this.pagos.set(lista);
      this.estadoListaPagos.set(lista.length === 0 ? 'vacio' : 'listo');
      this.cdr.detectChanges();
    } catch {
      this.pagos.set([]);
      this.estadoListaPagos.set('error');
      this.cdr.detectChanges();
    }
  }

  alEnviarPago(event: Event): void {
    event.preventDefault();
    if (this.estadoPago() === 'enviando' || this.enviandoPago) return;
    this.abrirModalConfirmacionPagos();
  }

  abrirModalConfirmacionPagos(): void {
    if (this.estadoPago() === 'enviando' || this.enviandoPago) return;
    this.modalConfirmacionPagosAbierto.set(true);
    afterNextRender(() => this.dialogoConfirmarPagosRef()?.enfocarInicial(), { injector: this.injector });
  }

  cancelarPago(): void {
    this.modalConfirmacionPagosAbierto.set(false);
    this.pagosEnviarRef()?.nativeElement.focus();
  }

  confirmarPago(): void {
    if (this.estadoPago() === 'enviando' || this.enviandoPago) return;
    this.modalConfirmacionPagosAbierto.set(false);
    this.estadoPago.set('enviando');
    this.errorPago.set(null);
    this.sinRespuestaPago.set(false);
    this.cdr.detectChanges();
    this.claveActualPago = crypto.randomUUID();
    void this.ejecutarPago(this.claveActualPago);
  }

  reintentarPago(): void {
    if (!this.claveActualPago) return;
    if (this.estadoPago() === 'enviando' || this.enviandoPago) return;
    this.estadoPago.set('enviando');
    this.errorPago.set(null);
    this.sinRespuestaPago.set(false);
    this.cdr.detectChanges();
    void this.ejecutarPago(this.claveActualPago);
  }

  private async ejecutarPago(clave: string): Promise<void> {
    if (!this.tokenEnMemoria) return;
    if (this.enviandoPago) return;
    this.enviandoPago = true;

    this.estadoPago.set('enviando');
    this.errorPago.set(null);
    this.sinRespuestaPago.set(false);
    this.cdr.detectChanges();

    const cuerpo = {
      cuentaOrigenId: this.pagoOrigen(),
      monto: this.pagoMonto(),
      beneficiarioNombre: this.pagoBeneficiarioNombre(),
      beneficiarioDireccion: this.pagoBeneficiarioDireccion(),
      beneficiarioCiudad: this.pagoBeneficiarioCiudad(),
      beneficiarioEstado: this.pagoBeneficiarioEstado(),
      beneficiarioCodigoPostal: this.pagoBeneficiarioCodigoPostal(),
      beneficiarioTelefono: this.pagoBeneficiarioTelefono(),
      cuentaBeneficiario: this.pagoCuentaBeneficiario(),
    };

    try {
      const res = await fetch(`${ORIGEN_AUTH}/pagos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.tokenEnMemoria}`,
          'Idempotency-Key': clave,
        },
        body: JSON.stringify(cuerpo),
      });

      this.enviandoPago = false;

      if (res.status === 201) {
        const data = (await res.json()) as PagoDto;
        const repetido =
          res.headers.get('idempotency-replayed') === 'true' ||
          res.headers.get('Idempotency-Replayed') === 'true';

        this.pagoExitosoId.set(data.id);
        this.pagoRepetido.set(repetido);
        this.estadoPago.set('exito');

        this.pagoMonto.set('');
        this.pagoBeneficiarioNombre.set('');
        this.pagoBeneficiarioDireccion.set('');
        this.pagoBeneficiarioCiudad.set('');
        this.pagoBeneficiarioEstado.set('');
        this.pagoBeneficiarioCodigoPostal.set('');
        this.pagoBeneficiarioTelefono.set('');
        this.pagoCuentaBeneficiario.set('');

        this.cdr.detectChanges();

        void this.cargarPagos();
        void this.cargarCuentasParaPagos();
        return;
      }

      if (res.status === 401) {
        const errData = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
        this.cerrarSesionPorToken(errData?.codigo || 'TOKEN_AUSENTE', errData?.mensaje);
        return;
      }

      const errData = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
      const codigo = errData?.codigo || 'ERROR_PAGO';
      this.errorPago.set({
        codigo,
        mensaje: errData?.mensaje || codigo,
      });
      this.estadoPago.set('error');
      this.cdr.detectChanges();
    } catch {
      this.enviandoPago = false;
      this.sinRespuestaPago.set(true);
      this.errorPago.set(null);
      this.estadoPago.set('sin-respuesta');
      this.cdr.detectChanges();
    }
  }

  // ── S-17 · Contacto ───────────────────────────────────────────────────────

  alActivarContacto(event?: Event): void {
    event?.preventDefault();
    if (this.temporizadorCierreCuentas) {
      clearTimeout(this.temporizadorCierreCuentas);
      this.temporizadorCierreCuentas = undefined;
    }
    this.limpiarContacto();
    this.menuCuentasAbierto.set(false);
    this.hamburguesaAbierta.set(false);
    this.vistaActual.set('contacto');
    this.iniciarContacto();
    void this.cargarContacto();
  }

  limpiarTemporizadorAvisoContacto(): void {
    if (this.temporizadorAvisoContacto) {
      clearTimeout(this.temporizadorAvisoContacto);
      this.temporizadorAvisoContacto = undefined;
    }
  }

  limpiarContacto(): void {
    this.limpiarTemporizadorAvisoContacto();
    this.avisoContactoGuardado.set(false);
  }

  iniciarContacto(): void {
    this.limpiarTemporizadorAvisoContacto();
    this.estadoContacto.set('cargando');
    this.errorCargaContacto.set(false);
    this.estadoGuardadoContacto.set('editando');
    this.guardandoContacto = false;
    this.contactoEmail.set(this.emailUsuario() || '');
    this.contactoNombre.set('');
    this.contactoApellido.set('');
    this.contactoDireccion.set('');
    this.contactoCiudad.set('');
    this.contactoEstado.set('');
    this.contactoCodigoPostal.set('');
    this.contactoTelefono.set('');
    this.errorContacto.set(null);
    this.sinRespuestaContacto.set(false);
    this.avisoContactoGuardado.set(false);
  }

  alEditarCampoContacto(): void {
    if (this.estadoGuardadoContacto() !== 'guardando') {
      if (this.estadoGuardadoContacto() !== 'editando') {
        this.estadoGuardadoContacto.set('editando');
      }
    }
  }

  async cargarContacto(): Promise<void> {
    if (!this.tokenEnMemoria) return;
    this.estadoContacto.set('cargando');
    this.errorCargaContacto.set(false);
    this.cdr.detectChanges();

    try {
      const res = await fetch(`${ORIGEN_AUTH}/contacto`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.tokenEnMemoria}`,
        },
      });

      if (res.status === 200) {
        const data = (await res.json()) as ContactoDto;
        this.contactoEmail.set(data.email || this.emailUsuario() || '');
        this.contactoNombre.set(data.nombre ?? '');
        this.contactoApellido.set(data.apellido ?? '');
        this.contactoDireccion.set(data.direccion ?? '');
        this.contactoCiudad.set(data.ciudad ?? '');
        this.contactoEstado.set(data.estado ?? '');
        this.contactoCodigoPostal.set(data.codigoPostal ?? '');
        this.contactoTelefono.set(data.telefono ?? '');

        this.estadoGuardadoContacto.set('editando');
        this.errorContacto.set(null);
        this.sinRespuestaContacto.set(false);
        this.avisoContactoGuardado.set(false);

        this.estadoContacto.set('listo');
        this.cdr.detectChanges();
        return;
      }

      if (res.status === 401) {
        const errData = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
        this.cerrarSesionPorToken(errData?.codigo || 'TOKEN_AUSENTE', errData?.mensaje);
        return;
      }

      this.estadoContacto.set('error');
      this.errorCargaContacto.set(true);
      this.cdr.detectChanges();
    } catch {
      this.estadoContacto.set('error');
      this.errorCargaContacto.set(true);
      this.cdr.detectChanges();
    }
  }

  async alGuardarContacto(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.guardandoContacto || this.estadoGuardadoContacto() === 'guardando') {
      return;
    }
    if (!this.tokenEnMemoria) return;

    this.guardandoContacto = true;
    this.estadoGuardadoContacto.set('guardando');
    this.errorContacto.set(null);
    this.sinRespuestaContacto.set(false);
    this.cdr.detectChanges();

    const cuerpo = {
      nombre: this.contactoNombre(),
      apellido: this.contactoApellido(),
      direccion: this.contactoDireccion(),
      ciudad: this.contactoCiudad(),
      estado: this.contactoEstado(),
      codigoPostal: this.contactoCodigoPostal(),
      telefono: this.contactoTelefono(),
    };

    try {
      const res = await fetch(`${ORIGEN_AUTH}/contacto`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.tokenEnMemoria}`,
        },
        body: JSON.stringify(cuerpo),
      });

      this.guardandoContacto = false;

      if (res.status === 200) {
        const data = (await res.json()) as ContactoDto;
        if (data.email) {
          this.contactoEmail.set(data.email);
        }
        this.contactoNombre.set(data.nombre ?? '');
        this.contactoApellido.set(data.apellido ?? '');
        this.contactoDireccion.set(data.direccion ?? '');
        this.contactoCiudad.set(data.ciudad ?? '');
        this.contactoEstado.set(data.estado ?? '');
        this.contactoCodigoPostal.set(data.codigoPostal ?? '');
        this.contactoTelefono.set(data.telefono ?? '');

        this.estadoGuardadoContacto.set('guardado');
        this.errorContacto.set(null);
        this.sinRespuestaContacto.set(false);
        this.avisoContactoGuardado.set(true);
        this.cdr.detectChanges();

        this.limpiarTemporizadorAvisoContacto();
        this.temporizadorAvisoContacto = setTimeout(() => {
          this.avisoContactoGuardado.set(false);
          this.temporizadorAvisoContacto = undefined;
          this.cdr.detectChanges();
        }, 4000);
        return;
      }

      if (res.status === 401) {
        const errData = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
        this.cerrarSesionPorToken(errData?.codigo || 'TOKEN_AUSENTE', errData?.mensaje);
        return;
      }

      const errData = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
      const codigo = errData?.codigo || 'ERROR_CONTACTO';
      this.errorContacto.set({
        codigo,
        mensaje: errData?.mensaje || codigo,
      });
      this.sinRespuestaContacto.set(false);
      this.estadoGuardadoContacto.set('error');
      this.cdr.detectChanges();
    } catch {
      this.guardandoContacto = false;
      this.sinRespuestaContacto.set(true);
      this.errorContacto.set(null);
      this.estadoGuardadoContacto.set('sin-respuesta');
      this.cdr.detectChanges();
    }
  }

  private alHashChange = (): void => {
    this.actualizarRutaHash();
  };

  actualizarRutaHash(): void {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (this.emailUsuario()) {
      this.enVentanilla.set(false);
    } else {
      const nuevaEnVentanilla = hash === '#ventanilla';
      const anterior = this.enVentanilla();
      this.enVentanilla.set(nuevaEnVentanilla);
      if (!anterior && nuevaEnVentanilla) {
        this.limpiarAlEntrarVentanilla();
      }
      if (anterior && !nuevaEnVentanilla) {
        afterNextRender(() => {
          this.dimensionarBruma();
          this.aplicarBruma();
        }, { injector: this.injector });
      }
    }
  }

  alVolverVentanilla(event: Event): void {
    event.preventDefault();
    history.pushState(null, '', window.location.pathname + window.location.search);
    this.actualizarRutaHash();
  }

  private contadorEntradaVentanilla = 0;

  limpiarAlEntrarVentanilla(): void {
    this.contadorEntradaVentanilla++;
    this.ventanillaBoletaId.set('');
    this.ventanillaRut.set('');
    this.exitoVentanilla.set(null);
    this.errorVentanilla.set(null);
    this.sinRespuestaVentanilla.set(false);
    this.avisoVentanilla.set(null);
    this.claveVentanilla = null;
    this.cobrandoVentanilla.set(false);
  }

  alCobrarVentanilla(): void {
    if (this.ventanillaBoletaId().trim().length === 0) {
      this.avisoVentanilla.set('Ingresa el ID de la boleta.');
      this.exitoVentanilla.set(null);
      this.errorVentanilla.set(null);
      this.sinRespuestaVentanilla.set(false);
      return;
    }
    this.avisoVentanilla.set(null);
    if (!this.claveVentanilla) {
      this.claveVentanilla = crypto.randomUUID();
    }
    const clave = this.claveVentanilla;
    void this.ejecutarCobroVentanilla(clave);
  }

  reintentarVentanilla(): void {
    if (this.ventanillaBoletaId().trim().length === 0) {
      this.avisoVentanilla.set('Ingresa el ID de la boleta.');
      this.exitoVentanilla.set(null);
      this.errorVentanilla.set(null);
      return;
    }
    this.avisoVentanilla.set(null);
    if (!this.claveVentanilla) return;
    void this.ejecutarCobroVentanilla(this.claveVentanilla);
  }

  private async ejecutarCobroVentanilla(clave: string): Promise<void> {
    const entradaId = this.contadorEntradaVentanilla;
    this.cobrandoVentanilla.set(true);
    this.errorVentanilla.set(null);
    this.sinRespuestaVentanilla.set(false);

    const rawId = this.ventanillaBoletaId();
    const idEncoded = encodeURIComponent(rawId);
    const cuerpo = {
      rutRetirador: this.ventanillaRut(),
    };

    try {
      const res = await fetch(`${ORIGEN_AUTH}/boletas/${idEncoded}/cobrar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': clave,
        },
        body: JSON.stringify(cuerpo),
      });

      if (this.contadorEntradaVentanilla !== entradaId) {
        return;
      }

      this.cobrandoVentanilla.set(false);

      if (res.status === 200) {
        this.claveVentanilla = null;
        const data = (await res.json()) as { estado?: string; monto?: string };
        if (this.contadorEntradaVentanilla !== entradaId) return;
        this.exitoVentanilla.set({
          estado: data?.estado || 'COBRADA',
          monto: data?.monto || '',
        });
        return;
      }

      // Rechazo de negocio (4xx)
      this.claveVentanilla = null;
      const err = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
      if (this.contadorEntradaVentanilla !== entradaId) return;
      this.errorVentanilla.set({
        codigo: err?.codigo || 'ERROR',
        mensaje: err?.mensaje || err?.codigo,
      });
    } catch {
      if (this.contadorEntradaVentanilla !== entradaId) {
        return;
      }
      this.cobrandoVentanilla.set(false);
      this.sinRespuestaVentanilla.set(true);
      this.errorVentanilla.set(null);
    }
  }

  textoEstado(b: BoletaDto): string {
    if (b.estado === 'VIGENTE') return this.t('boleta.estado.VIGENTE');
    if (b.estado === 'VENCIDA') {
      return b.fondosLiberados
        ? this.t('boleta.estado.VENCIDA_LIBERADOS')
        : this.t('boleta.estado.VENCIDA_POR_LIBERAR');
    }
    if (b.estado === 'COBRADA') return this.t('boleta.estado.COBRADA');
    if (b.estado === 'DEVUELTA') return this.t('boleta.estado.DEVUELTA');
    return b.estado;
  }

  abreviar(id: string | null | undefined): string {
    if (!id) return '';
    return id.length > LARGO_ID_CORTO ? '…' + id.slice(-LARGO_ID_CORTO) : id;
  }

  textoError(codigo?: string | null, mensaje?: string | null): string {
    const idioma = this.i18n.idioma();
    if (idioma === 'en') {
      if (codigo) {
        const clave = `error.${codigo}`;
        if (this.i18n.has(clave)) {
          return this.t(clave);
        }
      }
      return this.t('error.DEFAULT');
    }

    if (codigo === 'FONDOS_INSUFICIENTES') {
      return 'El saldo disponible de la cuenta de origen no alcanza para este monto.';
    }
    if (codigo === 'MONTO_APERTURA_INSUFICIENTE') {
      return 'El monto de apertura es menor al mínimo requerido para abrir una cuenta.';
    }
    if (codigo === 'TOPE_DIARIO_EXCEDIDO') {
      return 'Este monto supera el tope diario de transferencias a otros bancos para la cuenta de origen.';
    }
    if (codigo === 'MISMA_CUENTA') {
      return 'La cuenta de destino no puede ser la misma que la cuenta de origen.';
    }
    if (mensaje && mensaje.trim().length > 0) {
      return mensaje;
    }
    if (codigo) {
      const clave = `error.${codigo}`;
      if (this.i18n.has(clave)) {
        return this.t(clave);
      }
    }
    return 'No se pudo completar la operación.';
  }

  formatearCuenta(cuentaId: string): string {
    const c = this.cuentas().find((x) => x.id === cuentaId);
    return this.textoTipoCuenta(c?.tipo);
  }

  textoTipoCuenta(tipo?: string): string {
    return tipo === 'AHORRO' ? this.t('cuenta.tipo.ahorro') : this.t('cuenta.tipo.corriente');
  }

  textoAriaCuenta(tipo: string, id: string, saldo: string): string {
    return `${this.textoTipoCuenta(tipo)} ${id} · $ ${saldo}`;
  }

  textoAriaCuentaSinSaldo(tipo: string, id: string): string {
    return `${this.textoTipoCuenta(tipo)} ${id}`;
  }

  textoAvisoSesion(aviso: { motivo: string; codigo?: string; mensaje: string } | null): string {
    if (!aviso) return '';
    if (this.i18n.idioma() === 'en') {
      if (aviso.motivo === 'inactividad') {
        return this.t('sesion.avisoInactividad');
      }
      if (aviso.codigo) {
        return this.t('sesion.cerrada', { codigo: aviso.codigo });
      }
      return this.t('sesion.cerradaGenerica');
    }
    return aviso.mensaje;
  }

  textoErrorCuentas(err: { codigo?: string; motivo?: string; mensaje?: string } | null): string {
    if (this.i18n.idioma() === 'en') {
      if (err?.motivo === 'SIN_RESPUESTA') {
        return this.t('cuentas.errorSinConexion');
      }
      if (err?.codigo && this.i18n.has(`error.${err.codigo}`)) {
        return this.t(`error.${err.codigo}`);
      }
      return this.t('cuentas.errorCarga');
    }
    return err?.mensaje || 'Error al obtener la información de tus cuentas.';
  }

  textoErrorCargaAbrirCuenta(err: { codigo?: string; motivo?: string; mensaje?: string } | null): string {
    if (this.i18n.idioma() === 'en') {
      if (err?.motivo === 'SIN_CONEXION') {
        return this.t('abrirCuenta.errorConexion');
      }
      if (err?.codigo && this.i18n.has(`error.${err.codigo}`)) {
        return this.t(`error.${err.codigo}`);
      }
      return this.t('abrirCuenta.errorCarga');
    }
    return err?.mensaje || 'Error al obtener la información de tus cuentas.';
  }

  textoAvisoVentanilla(aviso: string | null): string {
    if (!aviso) return '';
    if (this.i18n.idioma() === 'en') {
      return this.t('ventanilla.avisoIdRequerido');
    }
    return aviso;
  }

  textoErrorPdfTransferir(errPdf: string | null): string {
    if (!errPdf) return '';
    if (this.i18n.idioma() === 'en') {
      return this.t('transferir.errorPdf');
    }
    return errPdf;
  }

  textoErrorPdfBoletas(errPdf: string | null): string {
    if (!errPdf) return '';
    if (this.i18n.idioma() === 'en') {
      if (errPdf === 'Error de red al descargar el archivo PDF.') {
        return this.t('boletas.errorPdfRed');
      }
      return this.t('boletas.errorPdf');
    }
    return errPdf;
  }

  formatearFechaUtc(iso: string): string {
    if (!iso || iso.length < 16) return '';
    return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
  }

  async cargarBoletasYcuentas(): Promise<void> {
    if (!this.tokenEnMemoria) return;
    this.estadoBoletas.set('cargando');
    this.errorBoletas.set(null);

    try {
      const [resBoletas, resCuentas] = await Promise.all([
        fetch(`${ORIGEN_AUTH}/boletas`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.tokenEnMemoria}` },
        }),
        fetch(`${ORIGEN_AUTH}/cuentas`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.tokenEnMemoria}` },
        }),
      ]);

      if (resBoletas.status === 401) {
        const cuerpo = (await resBoletas.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
        this.cerrarSesionPorToken(cuerpo?.codigo || 'TOKEN_AUSENTE', cuerpo?.mensaje);
        return;
      }
      if (resCuentas.status === 401) {
        const cuerpo = (await resCuentas.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
        this.cerrarSesionPorToken(cuerpo?.codigo || 'TOKEN_AUSENTE', cuerpo?.mensaje);
        return;
      }

      if (!resBoletas.ok || !resCuentas.ok) {
        this.estadoBoletas.set('error');
        return;
      }

      const dataBoletas = (await resBoletas.json()) as { boletas?: BoletaDto[] };
      const dataCuentas = (await resCuentas.json()) as { cuentas?: Array<{ id: string; tipo: string; saldo: string }> };

      const bList = dataBoletas?.boletas ?? [];
      const cList = dataCuentas?.cuentas ?? [];

      this.boletas.set(bList);
      this.cuentas.set(cList);

      if (!this.emitirOrigen() || !cList.some((c) => c.id === this.emitirOrigen())) {
        this.emitirOrigen.set(cList[0]?.id || '');
      }

      if (bList.length === 0) {
        this.estadoBoletas.set('vacio');
      } else {
        this.estadoBoletas.set('listo');
      }
    } catch {
      this.estadoBoletas.set('error');
    }
  }

  async releerBoletas(): Promise<void> {
    if (!this.tokenEnMemoria) return;
    try {
      const [res, resCuentas] = await Promise.all([
        fetch(`${ORIGEN_AUTH}/boletas`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.tokenEnMemoria}` },
        }),
        // Si la relectura de cuentas falla, el selector conserva la lista anterior
        fetch(`${ORIGEN_AUTH}/cuentas`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.tokenEnMemoria}` },
        }).catch(() => null),
      ]);

      if (res.status === 401 || resCuentas?.status === 401) {
        const cuerpo = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
        this.cerrarSesionPorToken(cuerpo?.codigo || 'TOKEN_AUSENTE', cuerpo?.mensaje);
        return;
      }

      if (resCuentas?.ok) {
        const dataCuentas = (await resCuentas.json().catch(() => ({}))) as {
          cuentas?: Array<{ id: string; tipo: string; saldo: string }>;
        };
        const cList = dataCuentas?.cuentas;
        if (Array.isArray(cList) && cList.length > 0) {
          this.cuentas.set(cList);
        }
      }

      if (!res.ok) {
        this.estadoBoletas.set('error');
        this.cdr.detectChanges();
        return;
      }

      const data = (await res.json()) as { boletas?: BoletaDto[] };
      const bList = data?.boletas ?? [];
      this.boletas.set(bList);
      if (bList.length === 0) {
        this.estadoBoletas.set('vacio');
      } else {
        this.estadoBoletas.set('listo');
      }
      this.cdr.detectChanges();
    } catch {
      this.estadoBoletas.set('error');
      this.cdr.detectChanges();
    }
  }

  formatearRutAlSalir(valor: string): string {
    if (!/^[0-9]{1,8}[0-9kK]$/.test(valor)) {
      return valor;
    }
    const cuerpo = valor.slice(0, -1);
    const dv = valor.slice(-1).toUpperCase();
    const cuerpoConPuntos = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${cuerpoConPuntos}-${dv}`;
  }

  alSalirRutBeneficiario(event: Event): void {
    const el = event.target as HTMLInputElement;
    const nuevo = this.formatearRutAlSalir(el.value);
    el.value = nuevo;
    this.emitirBeneficiarioRut.set(nuevo);
  }

  alSalirRutRetirador(event: Event): void {
    const el = event.target as HTMLInputElement;
    const nuevo = this.formatearRutAlSalir(el.value);
    el.value = nuevo;
    this.emitirRetiradorRut.set(nuevo);
  }

  alEmitirBoleta(): void {
    if (!this.claveEmitir) {
      this.claveEmitir = crypto.randomUUID();
    }
    const clave = this.claveEmitir;
    void this.ejecutarEmision(clave);
  }

  reintentarEmitir(): void {
    if (!this.claveEmitir) return;
    void this.ejecutarEmision(this.claveEmitir);
  }

  private async ejecutarEmision(clave: string): Promise<void> {
    if (!this.tokenEnMemoria) return;

    this.estadoEmitir.set('enviando');
    this.emitirError.set(null);
    this.emitirSinRespuesta.set(false);
    this.emitirExito.set(null);
    this.cdr.detectChanges();

    const plazoTrim = this.emitirPlazo().trim();
    const plazoDias = /^\d+$/.test(plazoTrim) ? parseInt(plazoTrim, 10) : this.emitirPlazo();

    const cuerpo = {
      cuentaOrigenId: this.emitirOrigen(),
      monto: this.emitirMonto().trim(),
      plazoDias,
      beneficiarioRut: this.emitirBeneficiarioRut(),
      beneficiarioNombre: this.emitirBeneficiarioNombre(),
      retiradorRut: this.emitirRetiradorRut(),
      retiradorNombre: this.emitirRetiradorNombre(),
      glosa: this.emitirGlosa(),
    };

    try {
      const res = await fetch(`${ORIGEN_AUTH}/boletas`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.tokenEnMemoria}`,
          'Idempotency-Key': clave,
        },
        body: JSON.stringify(cuerpo),
      });

      if (res.status === 201) {
        this.claveEmitir = null;
        const data = (await res.json()) as { id: string };
        this.emitirExito.set({ id: data.id });
        this.estadoEmitir.set('editando');
        this.emitirMonto.set('');
        this.emitirPlazo.set('');
        this.emitirBeneficiarioRut.set('');
        this.emitirBeneficiarioNombre.set('');
        this.emitirRetiradorRut.set('');
        this.emitirRetiradorNombre.set('');
        this.emitirGlosa.set('');
        this.emitirOrigen.set(this.cuentas()[0]?.id || '');
        this.cdr.detectChanges();
        void this.releerBoletas();
        return;
      }

      if (res.status === 401) {
        this.claveEmitir = null;
        const errData = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
        this.cerrarSesionPorToken(errData?.codigo || 'TOKEN_AUSENTE', errData?.mensaje);
        return;
      }

      // Rechazo de negocio (4xx)
      this.claveEmitir = null;
      const errData = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
      const codigo = errData?.codigo;
      this.emitirError.set({
        codigo,
        mensaje: errData?.mensaje || codigo,
      });
      this.estadoEmitir.set('error');
      this.cdr.detectChanges();
      void this.releerBoletas();
    } catch {
      this.emitirSinRespuesta.set(true);
      this.emitirError.set(null);
      this.estadoEmitir.set('error');
      this.cdr.detectChanges();
    }
  }

  async devolverBoleta(id: string): Promise<void> {
    if (!this.tokenEnMemoria) return;

    let clave = this.claveAccion.get(id);
    if (!clave) {
      clave = crypto.randomUUID();
      this.claveAccion.set(id, clave);
    }

    this.accionEnCurso.set(true);
    this.accionError.set(null);
    this.accionSinRespuesta.set(false);

    try {
      const res = await fetch(`${ORIGEN_AUTH}/boletas/${id}/devolver`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.tokenEnMemoria}`,
          'Idempotency-Key': clave,
        },
      });

      this.accionEnCurso.set(false);

      if (res.status === 200) {
        this.claveAccion.delete(id);
        this.cdr.detectChanges();
        void this.releerBoletas();
        return;
      }

      if (res.status === 401) {
        const err = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
        this.cerrarSesionPorToken(err?.codigo || 'TOKEN_AUSENTE', err?.mensaje);
        return;
      }

      // Rechazo de negocio (4xx)
      this.claveAccion.delete(id);
      const err = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
      this.accionError.set({
        codigo: err?.codigo || 'ERROR_ACCION',
        boletaId: id,
        mensaje: err?.mensaje,
      });
      this.cdr.detectChanges();
      void this.releerBoletas();
    } catch {
      this.accionEnCurso.set(false);
      this.accionSinRespuesta.set(true);
      this.accionError.set(null);
      this.cdr.detectChanges();
      void this.releerBoletas();
    }
  }

  async liberarBoleta(id: string): Promise<void> {
    if (!this.tokenEnMemoria) return;

    let clave = this.claveAccion.get(id);
    if (!clave) {
      clave = crypto.randomUUID();
      this.claveAccion.set(id, clave);
    }

    this.accionEnCurso.set(true);
    this.accionError.set(null);
    this.accionSinRespuesta.set(false);

    try {
      const res = await fetch(`${ORIGEN_AUTH}/boletas/${id}/vencer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.tokenEnMemoria}`,
          'Idempotency-Key': clave,
        },
      });

      this.accionEnCurso.set(false);

      if (res.status === 200) {
        this.claveAccion.delete(id);
        this.cdr.detectChanges();
        void this.releerBoletas();
        return;
      }

      if (res.status === 401) {
        const err = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
        this.cerrarSesionPorToken(err?.codigo || 'TOKEN_AUSENTE', err?.mensaje);
        return;
      }

      // Rechazo de negocio (4xx)
      this.claveAccion.delete(id);
      const err = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
      this.accionError.set({
        codigo: err?.codigo || 'ERROR_ACCION',
        boletaId: id,
        mensaje: err?.mensaje,
      });
      this.cdr.detectChanges();
      void this.releerBoletas();
    } catch {
      this.accionEnCurso.set(false);
      this.accionSinRespuesta.set(true);
      this.accionError.set(null);
      this.cdr.detectChanges();
      void this.releerBoletas();
    }
  }

  async descargarPdf(tipo: 'comprobante' | 'resumen', id: string): Promise<void> {
    if (!this.tokenEnMemoria) return;
    this.errorPdfBoletas.set(null);

    try {
      const res = await fetch(`${ORIGEN_AUTH}/boletas/${id}/${tipo}.pdf`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.tokenEnMemoria}`,
        },
      });

      if (res.status === 401) {
        const cuerpo = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
        this.cerrarSesionPorToken(cuerpo?.codigo || 'TOKEN_AUSENTE', cuerpo?.mensaje);
        return;
      }

      if (!res.ok) {
        this.errorPdfBoletas.set('Error al descargar el archivo PDF.');
        this.cdr.detectChanges();
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `boleta-${id}-${tipo}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      this.errorPdfBoletas.set('Error de red al descargar el archivo PDF.');
      this.cdr.detectChanges();
    }
  }

  private limpiarEstadoBoletas(): void {
    this.boletas.set([]);
    this.estadoBoletas.set('cargando');
    this.errorBoletas.set(null);
    this.claveEmitir = null;
    this.claveAccion.clear();
    this.emitirExito.set(null);
    this.emitirError.set(null);
    this.emitirSinRespuesta.set(false);
    this.estadoEmitir.set('editando');
    this.accionError.set(null);
    this.accionSinRespuesta.set(false);
    this.errorPdfBoletas.set(null);
  }

  async copiarId(id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      // Ignorar fallo de portapapeles
    }
  }

  async cargarCuentas(): Promise<void> {
    if (!this.tokenEnMemoria) return;
    this.estadoCuentas.set('cargando');
    this.errorCuentas.set(null);

    try {
      const res = await fetch(`${ORIGEN_AUTH}/cuentas`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.tokenEnMemoria}`,
        },
      });

      if (res.status === 401) {
        const cuerpo = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
        const codigo = cuerpo?.codigo;
        if (codigo === 'TOKEN_EXPIRADO' || codigo === 'TOKEN_INVALIDO' || codigo === 'TOKEN_AUSENTE') {
          this.cerrarSesionPorToken(codigo, cuerpo?.mensaje);
          return;
        }
      }

      if (!res.ok) {
        const cuerpo = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
        const codigo = cuerpo?.codigo; // sin código del API no se inventa uno (C5)
        this.errorCuentas.set({
          codigo,
          mensaje: cuerpo?.mensaje || codigo,
        });
        this.estadoCuentas.set('error');
        return;
      }

      const data = (await res.json()) as { cuentas?: Array<{ id: string; tipo: string; saldo: string }> };
      const lista = data?.cuentas ?? [];
      if (lista.length === 0) {
        this.cuentas.set([]);
        this.estadoCuentas.set('vacio');
      } else {
        this.cuentas.set(lista);
        this.estadoCuentas.set('listo');
        if (!this.origenSeleccionado() || !lista.some((c) => c.id === this.origenSeleccionado())) {
          const primerId = lista[0]?.id || '';
          this.origenSeleccionado.set(primerId);
          const destinos = lista.filter((c) => c.id !== primerId);
          this.destinoPropia.set(destinos[0]?.id || '');
        }
      }
    } catch {
      this.errorCuentas.set({
        motivo: 'SIN_RESPUESTA',
        mensaje: 'Sin conexión con el servidor.',
      });
      this.estadoCuentas.set('error');
    }
  }

  iniciarAsistente(): void {
    this.pasoActual.set('origen');
    const lista = this.cuentas();
    const primerId = lista[0]?.id || '';
    this.origenSeleccionado.set(primerId);
    this.modoDestino.set('propia');
    const destinos = lista.filter((c) => c.id !== primerId);
    this.destinoPropia.set(destinos[0]?.id || '');
    this.destinoOtra.set('');
    this.destinoBanco.set('SANDBOX');
    this.destinoNumero.set('');
    this.destinoTipo.set('AHORRO');
    this.monto.set('');
    this.estadoTransferencia.set('editando');
    this.errorTransferencia.set(null);
    this.sinRespuesta.set(false);
    this.claveActual = null;
    this.enviandoTransferencia = false;
  }

  alCambiarOrigen(nuevoOrigen: string): void {
    this.origenSeleccionado.set(nuevoOrigen);
    const destinos = this.cuentas().filter((c) => c.id !== nuevoOrigen);
    if (!destinos.some((c) => c.id === this.destinoPropia())) {
      this.destinoPropia.set(destinos[0]?.id || '');
    }
  }

  irAPaso(paso: 'origen' | 'destino' | 'revisar'): void {
    if (paso === 'revisar' && !this.revisarHabilitado()) {
      return;
    }
    this.pasoActual.set(paso);
  }

  alHacerClicPaso(paso: 'origen' | 'destino' | 'revisar'): void {
    if (paso === 'revisar' && !this.revisarHabilitado()) {
      return;
    }
    this.irAPaso(paso);
  }

  alHacerClicDestinoSiguiente(): void {
    if (!this.revisarHabilitado()) {
      return;
    }
    this.irAPaso('revisar');
  }

  alPulsarTeclaTab(event: KeyboardEvent): void {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();

    const todosLosPasos: Array<'origen' | 'destino' | 'revisar'> = ['origen', 'destino', 'revisar'];
    const habilitados = todosLosPasos.filter((p) => {
      if (p === 'origen') return true;
      if (p === 'destino') return this.origenSeleccionado().trim() !== '';
      if (p === 'revisar') return this.revisarHabilitado();
      return false;
    });

    const indiceActual = habilitados.indexOf(this.pasoActual());
    if (indiceActual === -1) return;

    let nuevoIndice: number;
    if (event.key === 'ArrowRight') {
      nuevoIndice = (indiceActual + 1) % habilitados.length;
    } else {
      nuevoIndice = (indiceActual - 1 + habilitados.length) % habilitados.length;
    }

    const nuevoPaso = habilitados[nuevoIndice]!;
    this.irAPaso(nuevoPaso);
    this.enfocarTab(nuevoPaso);
  }

  private enfocarTab(paso: 'origen' | 'destino' | 'revisar'): void {
    if (paso === 'origen') {
      this.tabOrigenRef()?.nativeElement.focus();
    } else if (paso === 'destino') {
      this.tabDestinoRef()?.nativeElement.focus();
    } else if (paso === 'revisar') {
      this.tabRevisarRef()?.nativeElement.focus();
    }
  }

  private limpiarAvisosAccionBoletas(): void {
    this.accionError.set(null);
    this.accionSinRespuesta.set(false);
    this.errorPdfBoletas.set(null);
  }

  alSeleccionarPestanaBoletas(pestana: 'lista' | 'emitir'): void {
    if (this.pestanaBoletas() === pestana) return;
    this.limpiarAvisosAccionBoletas();
    this.pestanaBoletas.set(pestana);
    this.cdr.detectChanges();
  }

  alPulsarTeclaPestanaBoletas(event: KeyboardEvent): void {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    this.limpiarAvisosAccionBoletas();
    if (this.pestanaBoletas() === 'lista') {
      this.pestanaBoletas.set('emitir');
      this.cdr.detectChanges();
      this.pestanaBoletasEmitirRef()?.nativeElement.focus();
    } else {
      this.pestanaBoletas.set('lista');
      this.cdr.detectChanges();
      this.pestanaBoletasListaRef()?.nativeElement.focus();
    }
  }

  abrirModalConfirmacion(): void {
    if (this.estadoTransferencia() === 'enviando') return;
    this.modalConfirmacionAbierto.set(true);
    // El diálogo sigue con [hidden] hasta el próximo render: el foco se da después, no con esperas.
    afterNextRender(() => this.dialogoConfirmarRef()?.enfocarInicial(), { injector: this.injector });
  }

  cancelarTransferencia(): void {
    this.modalConfirmacionAbierto.set(false);
    this.transferirEnviarRef()?.nativeElement.focus();
  }

  confirmarTransferencia(): void {
    this.modalConfirmacionAbierto.set(false);
    this.estadoTransferencia.set('enviando');
    this.errorTransferencia.set(null);
    this.sinRespuesta.set(false);
    this.cdr.detectChanges();
    this.claveActual = crypto.randomUUID();
    void this.ejecutarTransferencia(this.claveActual);
  }

  reintentarTransferencia(): void {
    if (!this.claveActual) return;
    void this.ejecutarTransferencia(this.claveActual);
  }

  nuevaTransferencia(): void {
    this.transferenciaExitosa.set(null);
    this.transferenciaOtroBancoExitosa.set(null);
    this.errorPdf.set(null);
    this.iniciarAsistente();
  }

  private async ejecutarTransferencia(clave: string): Promise<void> {
    if (!this.tokenEnMemoria) return;
    if (this.enviandoTransferencia) return;
    this.enviandoTransferencia = true;

    this.estadoTransferencia.set('enviando');
    this.errorTransferencia.set(null);
    this.sinRespuesta.set(false);
    this.cdr.detectChanges();

    if (this.modoDestino() === 'banco') {
      const cuerpo = {
        cuentaOrigenId: this.origenSeleccionado(),
        monto: this.monto().trim(),
        banco: this.destinoBanco(),
        numeroCuenta: this.destinoNumero(),
        tipoCuenta: this.destinoTipo(),
      };

      try {
        const res = await fetch(`${ORIGEN_AUTH}/transferencias/otros-bancos`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.tokenEnMemoria}`,
            'Idempotency-Key': clave,
          },
          body: JSON.stringify(cuerpo),
        });

        this.enviandoTransferencia = false;

        if (res.status === 201) {
          const data = (await res.json()) as { id: string };

          // JT6: La confirmación se relee, no se reconstruye.
          const resDetalle = await fetch(`${ORIGEN_AUTH}/transferencias/otros-bancos/${data.id}`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${this.tokenEnMemoria}`,
            },
          });

          if (resDetalle.status === 200) {
            const detalle = (await resDetalle.json()) as {
              id: string;
              transaccionId: string;
              cuentaOrigenId: string;
              monto: string;
              banco: string;
              numeroCuenta: string;
              tipoCuenta: string;
              realizadaEn: string;
            };
            this.transferenciaOtroBancoExitosa.set(detalle);
            this.estadoTransferencia.set('editando');
            return;
          }

          if (resDetalle.status === 401) {
            const errData = (await resDetalle.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
            this.cerrarSesionPorToken(errData?.codigo || 'TOKEN_AUSENTE', errData?.mensaje);
            return;
          }
        }

        if (res.status === 401) {
          const errData = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
          this.cerrarSesionPorToken(errData?.codigo || 'TOKEN_AUSENTE', errData?.mensaje);
          return;
        }

        const errData = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
        const codigo = errData?.codigo;
        this.errorTransferencia.set({
          codigo,
          mensaje: errData?.mensaje || codigo,
        });
        this.estadoTransferencia.set('error');
      } catch {
        this.enviandoTransferencia = false;
        this.sinRespuesta.set(true);
        this.errorTransferencia.set(null);
        this.estadoTransferencia.set('error');
      }
      return;
    }

    const cuerpo = {
      origenId: this.origenSeleccionado(),
      destinoId: this.destinoFinal(),
      monto: this.monto().trim(),
    };

    try {
      const res = await fetch(`${ORIGEN_AUTH}/transferencias`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.tokenEnMemoria}`,
          'Idempotency-Key': clave,
        },
        body: JSON.stringify(cuerpo),
      });

      this.enviandoTransferencia = false;

      if (res.status === 201) {
        const data = (await res.json()) as { transaccionId: string; monto: string };
        const repetida =
          res.headers.get('idempotency-replayed') === 'true' ||
          res.headers.get('Idempotency-Replayed') === 'true';

        this.transferenciaExitosa.set({
          transaccionId: data.transaccionId,
          monto: this.monto().trim(),
          origenId: this.origenSeleccionado(),
          destinoId: this.destinoFinal(),
          repetida,
        });
        this.estadoTransferencia.set('editando');
        return;
      }

      if (res.status === 401) {
        const errData = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
        this.cerrarSesionPorToken(errData?.codigo || 'TOKEN_AUSENTE', errData?.mensaje);
        return;
      }

      const errData = (await res.json().catch(() => ({}))) as { codigo?: string; mensaje?: string };
      const codigo = errData?.codigo;
      this.errorTransferencia.set({
        codigo,
        mensaje: errData?.mensaje || codigo,
      });
      this.estadoTransferencia.set('error');
    } catch {
      this.enviandoTransferencia = false;
      this.sinRespuesta.set(true);
      this.errorTransferencia.set(null);
      this.estadoTransferencia.set('error');
    }
  }

  descargarComprobantePdf(transaccionId: string): void {
    this.errorPdf.set(null);
    // Sincrónicamente en el clic, ANTES de cualquier await (P1, J7, H2)
    const ventana = window.open('about:blank', '_blank');

    void (async () => {
      try {
        const res = await fetch(`${ORIGEN_AUTH}/transferencias/${transaccionId}/comprobante.pdf`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.tokenEnMemoria}`,
          },
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (ventana) {
          ventana.location.href = url;
        }
      } catch {
        if (ventana && !ventana.closed) {
          ventana.close();
        }
        this.errorPdf.set('No se pudo generar el comprobante PDF.');
      }
    })();
  }

  private cerrarSesionPorToken(codigo: string, mensaje?: string): void {
    this.inactividad.detener();
    this.tokenEnMemoria = null;
    this.emailUsuario.set(null);
    this.menuCuentasAbierto.set(false);
    this.menuUsuarioAbierto.set(false);
    this.hamburguesaAbierta.set(false);
    this.cuentas.set([]);
    this.vistaActual.set('resumen');
    this.elementoFocoPrevio = null;
    this.limpiarEstadoBoletas();
    this.iniciarAbrirCuenta();
    this.iniciarMovimientos();
    this.iniciarPagos();
    this.iniciarContacto();
    this.actualizarRutaHash();
    this.avisoSesion.set({
      motivo: 'token',
      codigo,
      mensaje: mensaje || `Sesión cerrada: ${codigo}`,
    });
    afterNextRender(() => this.loginAbrirRef()?.nativeElement.focus(), { injector: this.injector });
  }

  cerrarSesion(): void {
    this.inactividad.detener();
    this.tokenEnMemoria = null;
    this.emailUsuario.set(null);
    this.menuCuentasAbierto.set(false);
    this.menuUsuarioAbierto.set(false);
    this.hamburguesaAbierta.set(false);
    this.cuentas.set([]);
    this.vistaActual.set('resumen');
    this.elementoFocoPrevio = null;
    this.avisoSesion.set(null);
    this.limpiarEstadoBoletas();
    this.iniciarAbrirCuenta();
    this.iniciarMovimientos();
    this.iniciarPagos();
    this.iniciarContacto();
    this.actualizarRutaHash();
    afterNextRender(() => this.loginAbrirRef()?.nativeElement.focus(), { injector: this.injector });
  }

  private alAvisoInactividad(): void {
    if (this.modalConfirmacionAbierto()) {
      this.modalConfirmacionAbierto.set(false);
      this.elementoFocoPrevio = this.transferirEnviarRef()?.nativeElement ?? null;
    } else {
      let f = document.activeElement as HTMLElement | null;
      while (f?.shadowRoot?.activeElement) {
        f = f.shadowRoot.activeElement as HTMLElement;
      }
      this.elementoFocoPrevio = f;
    }
    afterNextRender(() => this.dialogoInactividadRef()?.enfocarInicial(), { injector: this.injector });
  }

  seguirInactividad(): void {
    this.inactividad.reiniciar();
    if (this.elementoFocoPrevio) {
      const el = this.elementoFocoPrevio;
      this.elementoFocoPrevio = null;
      el.focus();
    }
  }

  salirInactividad(): void {
    this.cerrarSesionPorInactividad();
  }

  private cerrarSesionPorInactividad(): void {
    this.inactividad.detener();
    this.tokenEnMemoria = null;
    this.emailUsuario.set(null);
    this.menuCuentasAbierto.set(false);
    this.menuUsuarioAbierto.set(false);
    this.hamburguesaAbierta.set(false);
    this.cuentas.set([]);
    this.vistaActual.set('resumen');
    this.modalConfirmacionAbierto.set(false);
    this.elementoFocoPrevio = null;
    this.limpiarEstadoBoletas();
    this.iniciarAbrirCuenta();
    this.actualizarRutaHash();
    this.avisoSesion.set({
      motivo: 'inactividad',
      mensaje: 'Tu sesión se cerró por inactividad.',
    });
    afterNextRender(() => this.loginAbrirRef()?.nativeElement.focus(), { injector: this.injector });
  }

  private alPointerDownGlobal = (): void => {
    if (this.inactividad.estaActiva() && !this.inactividad.dialogoAbierto()) {
      this.inactividad.registrarActividad();
    }
  };

  private alWheelGlobal = (): void => {
    if (this.inactividad.estaActiva() && !this.inactividad.dialogoAbierto()) {
      this.inactividad.registrarActividad();
    }
  };

  private alPulsarTeclaGlobal = (event: KeyboardEvent): void => {
    if (this.inactividad.dialogoAbierto()) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.seguirInactividad();
        return;
      }
      return;
    }

    if (this.inactividad.estaActiva()) {
      this.inactividad.registrarActividad();
    }

    if (event.key === 'Escape') {
      if (this.modalConfirmacionAbierto()) {
        event.preventDefault();
        this.cancelarTransferencia();
        return;
      }
      if (this.hamburguesaAbierta()) {
        event.preventDefault();
        this.hamburguesaAbierta.set(false);
        this.navHamburguesaRef()?.nativeElement.focus();
        return;
      }
      if (this.menuUsuarioAbierto()) {
        event.preventDefault();
        this.menuUsuarioAbierto.set(false);
        this.navUsuarioRef()?.nativeElement.focus();
        return;
      }
      if (this.menuCuentasAbierto()) {
        event.preventDefault();
        this.menuCuentasAbierto.set(false);
        this.navCuentasRef()?.nativeElement.focus();
        return;
      }
    }
  };

  private alRecibirMensaje = (event: MessageEvent): void => {
    // 1. event.origin ≠ origen de auth
    if (event.origin !== ORIGEN_AUTH) {
      return;
    }

    // 2. event.source ≠ contentWindow de login-marco
    const marco = this.loginMarcoRef()?.nativeElement;
    if (!marco || event.source !== marco.contentWindow) {
      return;
    }

    const data = event.data as Record<string, unknown> | null;
    if (!data || typeof data !== 'object') {
      return;
    }

    // 3. v ≠ 1
    if (data['v'] !== 1) {
      return;
    }

    const tipo = data['tipo'];

    // 4. Tipo de mensaje
    if (tipo === 'zfb.auth.listo') {
      this.estadoPopover.set('listo');
      return;
    }

    if (tipo === 'zfb.auth.cerrar') {
      this.cerrarPopover();
      return;
    }

    if (tipo === 'zfb.auth.sesion') {
      const token = data['token'];
      const expiraEn = data['expiraEn'];
      // 5. token y expiraEn deben ser strings no vacíos
      if (
        typeof token !== 'string' ||
        token.trim() === '' ||
        typeof expiraEn !== 'string' ||
        expiraEn.trim() === ''
      ) {
        return;
      }
      this.inactividad.iniciar();
      void this.iniciarSesion(token);
      return;
    }

    // Cualquier otro tipo se descarta en silencio
  };

  private async iniciarSesion(token: string): Promise<void> {
    try {
      const res = await fetch(`${ORIGEN_AUTH}/auth/yo`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        return;
      }

      const usuario = (await res.json()) as { id?: string; email?: string };
      if (!usuario || typeof usuario.email !== 'string') {
        return;
      }

      this.tokenEnMemoria = token;
      this.emailUsuario.set(usuario.email);
      this.avisoSesion.set(null);
      this.vistaActual.set('resumen');
      this.actualizarRutaHash();

      const popover = this.loginPopoverRef()?.nativeElement;
      if (popover && popover.matches(':popover-open')) {
        popover.hidePopover();
      }

      void this.cargarCuentas();
    } catch {
      // Error de red: descartar en silencio
    }
  }

  private alRedimensionar = (): void => {
    this.dimensionarBruma();
    this.aplicarBruma();
  };

  private dimensionarBruma(): void {
    const canvas = this.brumaRef()?.nativeElement;
    if (!canvas) return;
    const ancho = Math.max(96, Math.round(window.innerWidth / 7));
    const alto = Math.max(64, Math.round((ancho * window.innerHeight) / window.innerWidth));
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      this.imagenBruma = ctx.createImageData(ancho, alto);
    }
  }

  private dibujarBruma(t: number): void {
    const canvas = this.brumaRef()?.nativeElement;
    if (!canvas || !this.imagenBruma) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width,
      h = canvas.height,
      datos = this.imagenBruma.data,
      asp = w / h;
    let k = 0;
    for (let j = 0; j < h; j++) {
      const ny = j / h;
      for (let i = 0; i < w; i++) {
        const nx = i / w;
        const px = nx * asp * 2.2,
          py = ny * 2.2;
        const qx = fbm(px + t * 0.9, py + t * 0.25);
        const qy = fbm(px + 5.2 - t * 0.35, py + 1.3 + t * 0.5);
        const d = fbm(px + 1.7 * qx + t * 0.2, py + 1.7 * qy - t * 0.1);
        const cx = ((nx - 0.5) * asp) / 0.62,
          cy = (ny - 0.5) / 0.34;
        const claro = suave(0.55, 1.35, Math.sqrt(cx * cx + cy * cy));
        let dens = Math.max(0, (d - 0.26) / 0.55);
        dens = Math.min(1, dens * dens * (0.12 + 0.88 * claro) * 1.6);
        const vx = nx - 0.5,
          vy = ny - 0.5;
        const vineta = 1 - 1.1 * (vx * vx + vy * vy);
        const tramo = dens < 0.4 ? dens / 0.4 : (dens - 0.4) / 0.6;
        const desde = dens < 0.4 ? TINTA : CARBON,
          hasta = dens < 0.4 ? CARBON : NIEBLA;
        for (let c = 0; c < 3; c++) {
          const col = desde[c]! + (hasta[c]! - desde[c]!) * tramo;
          datos[k + c] = TINTA[c]! + (col - TINTA[c]!) * vineta;
        }
        datos[k + 3] = 255;
        k += 4;
      }
    }
    ctx.putImageData(this.imagenBruma, 0, 0);
  }

  private generarGrano(): void {
    const g = document.createElement('canvas');
    g.width = g.height = 160;
    const gctx = g.getContext('2d');
    if (!gctx) return;
    const gi = gctx.createImageData(160, 160);
    const r = mulberry32(SEMILLA ^ 0x9e3779b9);
    for (let i = 0; i < gi.data.length; i += 4) {
      const v = Math.round(r() * 255);
      gi.data[i] = gi.data[i + 1] = gi.data[i + 2] = v;
      gi.data[i + 3] = 255;
    }
    gctx.putImageData(gi, 0, 0);
    const portadaEl = document.querySelector('.portada') as HTMLElement | null;
    portadaEl?.style.setProperty('--grano', `url(${g.toDataURL()})`);
  }

  private aplicarBruma = (): void => {
    cancelAnimationFrame(this.bucleAnimacion);
    const reduce = this.movimientoMedia?.matches ?? false;
    if (reduce) {
      this.dibujarBruma(0);
      this.estadoBruma.set('congelado');
      const canvas = this.brumaRef()?.nativeElement;
      if (canvas) canvas.dataset['estado'] = 'congelado';
    } else {
      this.inicioAnimacion = performance.now();
      this.ultimoCuadro = -Infinity;
      this.estadoBruma.set('animando');
      const canvas = this.brumaRef()?.nativeElement;
      if (canvas) canvas.dataset['estado'] = 'animando';
      this.bucleAnimacion = requestAnimationFrame(this.animarCuadro);
    }
  };

  private animarCuadro = (ahora: number): void => {
    if (ahora - this.ultimoCuadro >= PASO_MS) {
      this.dibujarBruma(((ahora - this.inicioAnimacion) / 1000) * VELOCIDAD);
      this.ultimoCuadro = ahora;
    }
    this.bucleAnimacion = requestAnimationFrame(this.animarCuadro);
  };
}
