import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import pg from 'pg';

const { Pool } = pg;

/**
 * S-07 · Decisión 1: Conexión con el DSN de dueño para resetear el ledger.
 *
 * S-04 dejó en `movimiento` un trigger BEFORE TRUNCATE que aborta con ZFB01 incluso
 * para el dueño de la base, más un REVOKE UPDATE, DELETE, TRUNCATE al rol de la app.
 * La conexión normal no puede vaciar el ledger.
 *
 * Reset corre sobre esta segunda conexión, con el DSN de dueño (DATABASE_URL_MIGRACION),
 * y quita el trigger, vacía, y lo vuelve a poner dentro de una sola transacción.
 *
 * La segunda conexión se abre al arrancar y se cierra al apagar, no una por petición.
 */
@Injectable()
export class CosturasDuenoDbService implements OnModuleInit, OnModuleDestroy {
  private readonly pool: pg.Pool;

  constructor() {
    const dsn = process.env['DATABASE_URL_MIGRACION'];
    if (dsn === undefined || dsn.trim() === '') {
      throw new Error(
        'DATABASE_URL_MIGRACION no está definida. Ver .env y docker-compose.yml.',
      );
    }
    this.pool = new Pool({ connectionString: dsn });

    // Sin este oyente, un cliente OCIOSO que se cae —porque alguien bajó la base— hace que
    // el pool emita 'error', y un 'error' sin oyente en Node MATA EL PROCESO. Eso rompe el
    // invariante H3 de S-00: la app tiene que seguir en pie con la base caída para poder
    // reportarlo por /health. Defecto de la entrega de S-07, encontrado el 2026-09-07 por
    // `npm run verify:s00` — el árbitro de OTRA unidad. El arnés de S-07 no lo veía: por eso
    // la batería se corre entera y no sólo el runner de lo que se acaba de tocar.
    this.pool.on('error', (error) => {
      // eslint-disable-next-line no-console
      console.error('[costuras] la conexión de dueño se cayó:', error.message);
    });
  }

  async onModuleInit(): Promise<void> {
    // NO se conecta al arrancar, por la misma razón que PrismaService no lo hace: la app
    // tiene que levantar con la base caída. La conexión se pide cuando se usa.
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  async vaciarBase(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DROP TRIGGER IF EXISTS movimiento_sin_truncate ON "movimiento"',
      );
      await client.query(
        'TRUNCATE TABLE "movimiento","transaccion","boleta","clave_idempotencia","cuenta","usuario" RESTART IDENTITY CASCADE',
      );
      await client.query(`
        CREATE TRIGGER movimiento_sin_truncate
          BEFORE TRUNCATE ON "movimiento"
          FOR EACH STATEMENT EXECUTE FUNCTION movimiento_append_only()
      `);
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignorar fallo de rollback secundario
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
