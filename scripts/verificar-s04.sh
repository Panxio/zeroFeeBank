#!/usr/bin/env bash
# Árbitro de S-04, a seis brazos. Ver specs/S-04-esquema.md § Pilar 5.
#
# El árbitro de esta unidad no es un test runner: es la base de datos. Lo que se comprueba
# es que la migración aplica en limpio y que el motor RECHAZA lo que D3 prohíbe — no que
# el código de la app se abstenga de hacerlo.
#
# Los brazos 3 a 5 hablan con la base como lo hacen la app y el dueño, con las credenciales
# reales de .env: un arnés que se fabrica su propia conexión no mide la que se usa.
set -uo pipefail
cd "$(dirname "$0")/.."

CONTENEDOR=zerofeebank-db
DUENO=zerofeebank
APP=zerofeebank_app
BD=zerofeebank
fallos=0

paso() { printf '  %-46s %s\n' "$1" "$2"; }
ok()   { paso "$1" "OK   $2"; }
falla(){ paso "$1" "FALLA $2"; fallos=$((fallos + 1)); }

# sql <rol> <sentencia>  → imprime la salida; devuelve el exit de psql
# VERBOSITY verbose hace que psql imprima el SQLSTATE junto al mensaje. Es lo que permite
# afirmar sobre el CÓDIGO del error y no sobre su texto (C5): el texto puede cambiar,
# traducirse o mejorarse sin romper una sola comprobación.
sql() { docker exec -e PGPASSWORD="$2" "$CONTENEDOR" psql -v ON_ERROR_STOP=1 -U "$1" -d "$BD" \
          -c '\set VERBOSITY verbose' -tAc "$3" 2>&1; }
como_dueno() { sql "$DUENO" zerofeebank_local "$1"; }
como_app()   { sql "$APP"   zerofeebank_app_local "$1"; }

# rechaza <fn> <sentencia> <etiqueta> <patrón-esperado>
# Verde SÓLO si la base la rechaza Y el rechazo viene del mecanismo que este brazo mide.
# Sin el patrón, quitar el REVOKE entero pasaba en verde porque el trigger rechazaba
# igual: el arnés veía "rechazado" y no miraba quién lo rechazó (calibración 2026-09-07).
rechaza() {
  local salida
  if salida=$("$1" "$2"); then
    falla "$3" "la base la ACEPTÓ; debía rechazarla"
  elif ! echo "$salida" | grep -q "$4"; then
    falla "$3" "rechazada por el mecanismo equivocado (esperaba /$4/): $(echo "$salida" | grep -m1 -oE 'ERROR:.*' | cut -c1-60)"
  else
    ok "$3" "rechazado: $(echo "$salida" | grep -m1 -oE 'ERROR:.*' | cut -c1-64)"
  fi
}

echo "S-04 · verificación a seis brazos"

# --- brazo 1 · la migración aplica desde una base vacía ------------------------------
docker compose up -d --wait >/dev/null 2>&1 || { echo "  la BD no levanta"; exit 1; }
if PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="${CONSENTIMIENTO_RESET:-}" \
   npx prisma migrate reset --force >/dev/null 2>&1; then
  ok "1 · migración aplica desde cero" "exit 0"
else
  # Aborta aquí a propósito: si la base no se reseteó, los brazos siguientes correrían
  # sobre un estado que nadie verificó, y darían verde sin significar nada.
  falla "1 · migración aplica desde cero" "migrate reset devolvió error; el resto no se corre"
  echo; echo "S-04: 1 comprobación en rojo (abortado en el brazo 1)"; exit 1
fi

# --- brazo 2 · sin desfase entre esquema y base -------------------------------------
if npx prisma migrate status 2>&1 | grep -q "Database schema is up to date"; then
  ok "2 · sin desfase (migrate status)" "al día"
else
  falla "2 · sin desfase (migrate status)" "$(npx prisma migrate status 2>&1 | tail -1)"
fi

# --- datos mínimos para poder intentar escribir. Suman 0: partida doble (D2). ---------
CU=11111111-1111-1111-1111-111111111111
CD=22222222-2222-2222-2222-222222222222
TX=33333333-3333-3333-3333-333333333333
como_dueno "INSERT INTO cuenta (id,tipo,creada_en) VALUES ('$CU','CORRIENTE',now()),('$CD','SISTEMA',now());
            INSERT INTO transaccion (id,concepto,creada_en) VALUES ('$TX','ARNES_S04',now());" >/dev/null

# --- brazo 3 · el rol de app SÍ puede anexar ----------------------------------------
if como_app "INSERT INTO movimiento (id,transaccion_id,cuenta_id,monto_centavos,creado_en) VALUES
             (gen_random_uuid(),'$TX','$CU',-1000,now()),
             (gen_random_uuid(),'$TX','$CD', 1000,now());" >/dev/null; then
  suma=$(como_dueno "SELECT COALESCE(SUM(monto_centavos),-1) FROM movimiento WHERE transaccion_id='$TX';")
  if [ "$suma" = "0" ]; then ok "3 · rol de app anexa (suma 0)" "2 movimientos, suma $suma"
  else falla "3 · rol de app anexa (suma 0)" "suma $suma, esperaba 0"; fi
else
  falla "3 · rol de app anexa (suma 0)" "el INSERT fue rechazado"
fi

# --- brazo 4 · el rol de app NO puede modificar ni borrar ---------------------------
antes=$(como_dueno "SELECT count(*) FROM movimiento;")
# El rechazo tiene que venir del PERMISO, no del trigger: son dos defensas y esta mide la (a).
# 42501 = insufficient_privilege, el código del permiso denegado.
rechaza como_app "UPDATE movimiento SET monto_centavos = 0;" "4a · app: UPDATE sobre el ledger" "ERROR:  42501"
rechaza como_app "DELETE FROM movimiento;"                   "4b · app: DELETE sobre el ledger" "ERROR:  42501"
# Y se mira el catálogo directamente: la ausencia del privilegio, no uno de sus efectos.
privs=$(como_dueno "SELECT COALESCE(string_agg(privilege_type,','ORDER BY privilege_type),'ninguno')
                    FROM information_schema.role_table_grants
                    WHERE table_name='movimiento' AND grantee='$APP';")
if [ "$privs" = "INSERT,SELECT" ]; then
  ok "4c · privilegios del rol de app (E3)" "$privs"
else
  falla "4c · privilegios del rol de app (E3)" "tiene [$privs], esperaba [INSERT,SELECT]"
fi

# --- brazo 5 · el DUEÑO tampoco puede (trigger), ni con TRUNCATE --------------------
# Acá el rechazo tiene que venir del TRIGGER, y se afirma sobre su código estable ZFB01,
# no sobre el texto del mensaje (C5).
# ZFB01 = el código propio del trigger. Distinto de 42501 a propósito: si fueran el mismo,
# el arnés no podría decir cuál de las dos defensas actuó.
rechaza como_dueno "UPDATE movimiento SET monto_centavos = 0;" "5a · dueño: UPDATE (trigger)" "ERROR:  ZFB01"
rechaza como_dueno "DELETE FROM movimiento;"                   "5b · dueño: DELETE (trigger)" "ERROR:  ZFB01"
rechaza como_dueno "TRUNCATE movimiento;"                      "5c · dueño: TRUNCATE (trigger)" "ERROR:  ZFB01"

despues=$(como_dueno "SELECT count(*) FROM movimiento;")
if [ "$antes" = "$despues" ] && [ "$antes" = "2" ]; then
  ok "5d · el ledger quedó intacto" "$despues movimientos, igual que antes"
else
  falla "5d · el ledger quedó intacto" "antes $antes, después $despues"
fi

# --- brazo 6 · regla de dependencia del dominio (compuerta dura del perfil) ---------
# Lista de términos versionada junto al resultado (ARNES.md): @nestjs/ · @prisma/ · express
n=$(grep -rnE "from '(@nestjs/|@prisma/|express)" src/domain/ | wc -l)
if [ "$n" -eq 0 ]; then ok "6 · src/domain/ sin framework ni BD" "0 coincidencias"
else falla "6 · src/domain/ sin framework ni BD" "$n import(s) prohibidos"; fi

echo
total=6
if [ "$fallos" -eq 0 ]; then echo "S-04: $total/$total brazos OK"; else echo "S-04: $fallos comprobación(es) en rojo"; fi
exit "$fallos"
