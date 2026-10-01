import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ErroresHttpFilter } from './infra/errores-http.filter.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BoletasModule } from './modules/boletas/boletas.module.js';
import { ComprobantesModule } from './modules/comprobantes/comprobantes.module.js';
import { ContactoModule } from './modules/contacto/contacto.module.js';
import { CosturasModule } from './modules/costuras/costuras.module.js';
import { CuentasModule } from './modules/cuentas/cuentas.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { PagosModule } from './modules/pagos/pagos.module.js';
import { MovimientosModule } from './modules/movimientos/movimientos.module.js';
import { PrestamosModule } from './modules/prestamos/prestamos.module.js';
import { TransferenciasModule } from './modules/transferencias/transferencias.module.js';
import { TransferenciasOtrosBancosModule } from './modules/transferencias-otros-bancos/transferencias-otros-bancos.module.js';

/**
 * El filtro de errores de negocio se registra una sola vez, para toda la app. Antes colgaba
 * del controlador de transferencias; se subió acá para que los módulos de
 * S-07 y S-08 no tengan que registrarlo cada uno (ver src/infra/errores-http.filter.ts).
 */
@Module({
  imports: [
    HealthModule,
    TransferenciasModule,
    CosturasModule.paraEntorno(),
    AuthModule,
    CuentasModule,
    BoletasModule,
    MovimientosModule,
    ContactoModule,
    PagosModule,
    ComprobantesModule,
    PrestamosModule,
    TransferenciasOtrosBancosModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ErroresHttpFilter }],
})
export class AppModule {}
