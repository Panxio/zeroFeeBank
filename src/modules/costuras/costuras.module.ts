import { type DynamicModule, Module } from '@nestjs/common';
import { CuentasSistemaRepository } from '../../infra/cuentas-sistema.repository.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { RelojModule } from '../../infra/reloj.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CosturasController } from './costuras.controller.js';
import { CosturasDuenoDbService } from './costuras.dueno-db.service.js';
import { CosturasService } from './costuras.service.js';

/**
 * S-07 · costuras de prueba. Ver specs/S-07-costuras.md.
 *
 * La FIRMA de `paraEntorno` no cambia, porque AppModule y el arnés la llaman.
 *
 * POR QUÉ UN MÓDULO DINÁMICO Y NO UN `@Module` estático con un ternario adentro:
 *   el decorador se evalúa UNA sola vez, al importar el archivo. Con un ternario adentro, la
 *   decisión queda congelada en el primer import y el arnés no podría levantar una segunda
 *   aplicación con el flag apagado dentro del mismo proceso: comprobaría el 404 sobre la misma
 *   app de siempre y se pondría verde sin mirar nada.
 *   Leyendo el entorno DENTRO del método, cada llamada decide de nuevo.
 *
 * Con el flag apagado no se monta ningún controlador y el 404 lo da el router de Nest por sí
 * solo: no hay una línea de código entre quien llama y el `reset`. Eso es V1 de la spec.
 */
@Module({})
export class CosturasModule {
  static paraEntorno(): DynamicModule {
    const encendido = process.env['ZFB_COSTURAS_PRUEBA'] === '1';

    if (!encendido) {
      return {
        module: CosturasModule,
        global: true,
        imports: [RelojModule],
      };
    }

    const dsnMigracion = process.env['DATABASE_URL_MIGRACION'];
    if (dsnMigracion === undefined || dsnMigracion.trim() === '') {
      throw new Error(
        'DATABASE_URL_MIGRACION no está definida. Ver .env y docker-compose.yml.',
      );
    }

    return {
      module: CosturasModule,
      global: true,
      imports: [RelojModule, AuthModule],
      controllers: [CosturasController],
      // S-23 · CuentasSistemaRepository es el ÚNICO mecanismo de creación de GARANTIA y
      // CAJA (mismo que usa BoletasService, J5); AuthService hashea la contraseña real
      // del escenario con el mismo scrypt de /auth/registro.
      providers: [PrismaService, CosturasDuenoDbService, CosturasService, CuentasSistemaRepository],
    };
  }
}
