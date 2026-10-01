import { Global, Module } from '@nestjs/common';
import { RelojService } from './reloj.js';

/**
 * DEUDA-reloj · el reloj inyectable, en un módulo GLOBAL y con UNA SOLA instancia.
 *
 * Los servicios que fechan con el reloj (Auth, Transferencias, Cuentas, Pagos, Boletas y
 * Costuras) lo reciben desde acá. Que sea global y no un `providers: [RelojService]` por
 * módulo no es cosmético: `POST /__test__/reloj` fija la instancia que vive en CosturasModule,
 * y si cada módulo tuviera la suya, los servicios leerían un reloj que nadie fija y F1–F6
 * quedarían en rojo aunque el código "use el reloj".
 */
@Global()
@Module({
  providers: [RelojService],
  exports: [RelojService],
})
export class RelojModule {}
