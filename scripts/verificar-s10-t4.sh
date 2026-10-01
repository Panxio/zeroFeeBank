#!/usr/bin/env bash
# Levanta el ARTEFACTO entregado de S-10 · T4 y corre su árbitro (scripts/verificar-s10-t4.mjs).
#   backend : npm run build → node dist/main.js en :3000, con ZFB_ORIGEN_APP=http://localhost:4200
#   frontend pruebas   : ng build --configuration "$ZFB_WEB_CONFIG" (por defecto pruebas) → :4200
#   frontend producción: ng build --configuration production --output-path dist/web-prod → :4201 (para RL1)
# Aborta si :3000, :4200 o :4201 ya están ocupados: medir un servidor viejo es medir otra cosa.
# La salida entera queda en $ZFB_LOG (un rojo que no se guarda no existió).
set -uo pipefail
cd "$(dirname "$0")/.."
ZFB_LOG="${ZFB_LOG:-/tmp/verificar-s10-t4.log}"
ZFB_WEB_CONFIG="${ZFB_WEB_CONFIG:-pruebas}"
ZFB_DIST_PROD="web/dist/web-prod"
: > "$ZFB_LOG"

libre() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
for p in 3000 4200 4201; do libre "$p" || { echo "ABORTA: el puerto $p ya está ocupado"; exit 2; }; done

limpiar() {
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null;
  [ -n "${WEB_PID:-}" ] && kill "$WEB_PID" 2>/dev/null;
  [ -n "${WEB_PROD_PID:-}" ] && kill "$WEB_PROD_PID" 2>/dev/null;
}
trap limpiar EXIT

docker compose up -d --wait >>"$ZFB_LOG" 2>&1 || { echo "ROJO: la BD no levanta"; exit 1; }
npm run build >>"$ZFB_LOG" 2>&1 || { echo "ROJO: build del backend (ver $ZFB_LOG)"; exit 1; }
(cd web && npx ng build --configuration "$ZFB_WEB_CONFIG") >>"$ZFB_LOG" 2>&1 || { echo "ROJO: build de web/ ($ZFB_WEB_CONFIG) (ver $ZFB_LOG)"; exit 1; }
(cd web && npx ng build --configuration production --output-path dist/web-prod) >>"$ZFB_LOG" 2>&1 || { echo "ROJO: build de web/ (production) (ver $ZFB_LOG)"; exit 1; }

ZFB_ORIGEN_APP=http://localhost:4200 node --env-file=.env dist/main.js >>"$ZFB_LOG" 2>&1 &
API_PID=$!
python3 -m http.server 4200 --directory web/dist/web/browser >>"$ZFB_LOG" 2>&1 &
WEB_PID=$!
python3 -m http.server 4201 --directory web/dist/web-prod/browser >>"$ZFB_LOG" 2>&1 &
WEB_PROD_PID=$!

for _ in $(seq 1 30); do
  curl -sf -o /dev/null http://localhost:3000/health && \
  curl -sf -o /dev/null http://localhost:4200/ && \
  curl -sf -o /dev/null http://localhost:4201/ && break
  sleep 1
done
curl -sf -o /dev/null http://localhost:3000/health || { echo "ROJO: el backend no arrancó (ver $ZFB_LOG)"; exit 1; }
curl -sf -o /dev/null http://localhost:4200/ || { echo "ROJO: el frontend de pruebas (:4200) no arrancó (ver $ZFB_LOG)"; exit 1; }
curl -sf -o /dev/null http://localhost:4201/ || { echo "ROJO: el frontend de producción (:4201) no arrancó (ver $ZFB_LOG)"; exit 1; }

node scripts/verificar-s10-t4.mjs "$ZFB_DIST_PROD" 2>&1 | tee -a "$ZFB_LOG"
exit "${PIPESTATUS[0]}"
