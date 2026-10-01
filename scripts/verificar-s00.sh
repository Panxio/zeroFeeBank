#!/usr/bin/env bash
# Árbitro de S-00, a dos brazos. El árbitro de esta unidad no es el test runner:
# es el build y el proceso corriendo. Ver specs/S-00-esqueleto.md § Pilar 5.
#
#   verde : BD arriba   -> /health 200 db=up
#   rojo  : BD abajo    -> /health 503 db=down, y la app sigue viva
#
# Sale 0 sólo si LOS DOS brazos dan lo esperado. Un /health que siempre dijera
# "up" pasaría el verde; uno que siempre dijera "down" pasaría el rojo. Hacen falta
# los dos para que el chequeo signifique algo.
set -uo pipefail
cd "$(dirname "$0")/.."

URL="http://localhost:${PORT:-3000}/health"
LOG="$(mktemp)"
fallos=0

paso() { printf '  %-34s %s\n' "$1" "$2"; }
esperar() {  # esperar <codigo> <estado-db> <etiqueta>
  local esperado_http="$1" esperado_db="$2" etiqueta="$3" cuerpo codigo
  cuerpo=$(curl -s -o /tmp/s00.body -w '%{http_code}' "$URL" 2>/dev/null) || cuerpo="000"
  codigo="$cuerpo"; cuerpo=$(cat /tmp/s00.body 2>/dev/null)
  if [ "$codigo" = "$esperado_http" ] && [[ "$cuerpo" == *"\"db\":\"$esperado_db\""* ]]; then
    paso "$etiqueta" "OK   HTTP $codigo $cuerpo"
  else
    paso "$etiqueta" "FALLA esperaba HTTP $esperado_http db=$esperado_db, obtuvo HTTP $codigo $cuerpo"
    fallos=$((fallos + 1))
  fi
}

limpiar() { [ -n "${APP_PID:-}" ] && kill "$APP_PID" 2>/dev/null; docker compose up -d --wait >/dev/null 2>&1; }
trap limpiar EXIT

echo "S-00 · verificación a dos brazos"
npm run build >/dev/null 2>&1 || { echo "  build FALLA"; exit 1; }
paso "build" "OK   exit 0"

docker compose up -d --wait >/dev/null 2>&1 || { echo "  la BD no levanta"; exit 1; }
node --env-file=.env dist/main.js >"$LOG" 2>&1 &
APP_PID=$!
for _ in $(seq 1 30); do curl -s -o /dev/null "$URL" && break; sleep 1; done

esperar 200 up   "brazo verde  · BD arriba"

docker compose stop db >/dev/null 2>&1
sleep 2
esperar 503 down "brazo rojo   · BD abajo"

if kill -0 "$APP_PID" 2>/dev/null; then
  paso "la app sobrevive a la BD (H3)" "OK   proceso vivo"
else
  paso "la app sobrevive a la BD (H3)" "FALLA el proceso murió"; fallos=$((fallos + 1))
fi

docker compose up -d --wait >/dev/null 2>&1
sleep 1
esperar 200 up   "vuelve sola  · BD restaurada"

echo
if [ "$fallos" -eq 0 ]; then echo "S-00: 4/4 brazos OK"; else echo "S-00: $fallos brazo(s) en rojo"; fi
exit "$fallos"
