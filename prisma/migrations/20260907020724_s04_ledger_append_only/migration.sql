-- S-04 · El ledger append-only deja de ser una convención y pasa a ser un hecho del motor.
-- Ver specs/S-04-esquema.md. Dos mecanismos que cierran riesgos distintos:
--   (a) el rol de la aplicación no tiene UPDATE ni DELETE sobre `movimiento`;
--   (b) un trigger aborta UPDATE, DELETE y TRUNCATE incluso para el dueño de la base.
-- Uno solo no basta: el permiso no ata al dueño, y el trigger se puede desactivar con
-- privilegio. Juntos, destruir evidencia exige dos actos deliberados.

-- ---------------------------------------------------------------------------
-- (a) Rol de la aplicación, sin privilegio sobre el libro mayor.
-- ---------------------------------------------------------------------------
-- Idempotente: el rol es del clúster, no de la base, así que sobrevive a un
-- `migrate reset` y CREATE ROLE lo encontraría existiendo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zerofeebank_app') THEN
    CREATE ROLE zerofeebank_app LOGIN PASSWORD 'zerofeebank_app_local';
  END IF;
END
$$;

-- El nombre de la base se lee del entorno, no se escribe a mano: esta migración tiene que
-- aplicar igual en un clúster donde la base se llame distinto.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO zerofeebank_app', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO zerofeebank_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO zerofeebank_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO zerofeebank_app;

-- El corazón de D3: sobre el libro mayor, la aplicación sólo puede leer y anexar.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "movimiento" FROM zerofeebank_app;

-- El historial de migraciones no es asunto de la aplicación. Condicional a propósito: la
-- shadow database con la que Prisma valida las migraciones no tiene esa tabla, y una
-- migración que sólo aplica en la base real es una migración que nadie puede verificar.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = '_prisma_migrations') THEN
    REVOKE ALL ON TABLE "_prisma_migrations" FROM zerofeebank_app;
  END IF;
END
$$;

-- Las tablas que creen las migraciones siguientes heredan el mismo trato, para que nadie
-- tenga que acordarse de conceder permisos a mano (una compuerta que hay que recordar
-- es una compuerta que no corre).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zerofeebank_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO zerofeebank_app;

-- ---------------------------------------------------------------------------
-- (b) Trigger: nadie modifica ni borra un movimiento, tampoco el dueño.
-- ---------------------------------------------------------------------------
-- ERRCODE propio y estable, 'ZFB01', para que la aplicación y el arnés afirmen sobre un
-- código y no sobre el texto del mensaje (C5 del perfil SUT).
-- NO se reusa 42501 (insufficient_privilege): es el mismo código que devuelve un permiso
-- denegado, y entonces el arnés no podría distinguir cuál de las dos defensas actuó. Con
-- 42501 aquí, quitar el REVOKE entero pasaba en verde — verificado el 2026-09-07.
CREATE OR REPLACE FUNCTION movimiento_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'movimiento es append-only (D3): % rechazado. Una correccion se hace con un movimiento compensatorio.',
    TG_OP
    USING ERRCODE = 'ZFB01';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER movimiento_sin_update
  BEFORE UPDATE ON "movimiento"
  FOR EACH ROW EXECUTE FUNCTION movimiento_append_only();

CREATE TRIGGER movimiento_sin_delete
  BEFORE DELETE ON "movimiento"
  FOR EACH ROW EXECUTE FUNCTION movimiento_append_only();

-- TRUNCATE no dispara triggers FOR EACH ROW: vaciaría la tabla entera sin que (b) se entere.
-- Es el hueco clásico de esta defensa, y por eso lleva su propio trigger de sentencia.
CREATE TRIGGER movimiento_sin_truncate
  BEFORE TRUNCATE ON "movimiento"
  FOR EACH STATEMENT EXECUTE FUNCTION movimiento_append_only();
