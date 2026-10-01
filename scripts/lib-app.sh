#!/usr/bin/env bash
# Arranque de la app para los árbitros que la necesitan viva (S-11 y su calibrador).
# No es un árbitro: es la parte aburrida que los dos comparten. Se sourcea, no se ejecuta.
#
# Por qué existe: `verificar-s00.sh` levanta la app para MEDIRLA (ése es su objeto de
# estudio). S-11 la levanta sólo para poder hablarle. Copiar sus 12 líneas en dos archivos
# más era la alternativa; esto es una menos.

ZFB_PUERTO="${PORT:-3000}"
ZFB_BASE="http://localhost:${ZFB_PUERTO}"
ZFB_APP_PID=""
ZFB_LOG=""

zfb_app_responde() { curl -s -o /dev/null --max-time 2 "${ZFB_BASE}/health"; }

# Reconstruye sólo si el dist está ausente o más viejo que las fuentes. El build tarda
# ~15 s y la meta de pared de S-11 es 60 s: rehacerlo siempre se lo comía entero.
zfb_build_si_hace_falta() {
  if [ ! -f dist/main.js ] || [ -n "$(find src prisma -name '*.ts' -newer dist/main.js -print -quit 2>/dev/null)" ]; then
    npm run build >/dev/null 2>&1 || return 1
  fi
  return 0
}

# Deja la app corriendo. Si ya había una, NO levanta otra y no se la apropia:
# la que estaba la apagará quien la encendió.
zfb_levantar_app() {
  if zfb_app_responde; then
    echo "  app ya estaba arriba en ${ZFB_BASE} (no se toca)"
    return 0
  fi
  zfb_build_si_hace_falta || { echo "  build FALLA"; return 1; }
  ZFB_LOG="$(mktemp)"
  node --env-file=.env dist/main.js >"$ZFB_LOG" 2>&1 &
  ZFB_APP_PID=$!
  for _ in $(seq 1 30); do zfb_app_responde && break; sleep 1; done
  if ! zfb_app_responde; then
    echo "  la app no levantó. Últimas líneas del log:"; tail -5 "$ZFB_LOG" | sed 's/^/    /'
    return 1
  fi
  echo "  app levantada por este arnés (pid $ZFB_APP_PID)"
  return 0
}

zfb_bajar_app() { [ -n "$ZFB_APP_PID" ] && kill "$ZFB_APP_PID" 2>/dev/null; return 0; }

# zfb_post <ruta> [json] [args-curl...]  → IMPRIME el código HTTP y deja el cuerpo en
# el archivo $ZFB_CUERPO. Al revés de lo natural, y a propósito: los llamadores lo usan
# dentro de $( ), y una subshell no puede devolver una variable al padre — el primer
# intento asignaba ZFB_HTTP ahí dentro y llegaba vacío.
ZFB_CUERPO="$(mktemp)"
ZFB_CABECERAS="$(mktemp)"
zfb_post() {
  local ruta="$1" cuerpo="${2:-}"
  if [ -n "$cuerpo" ]; then
    curl -s -o "$ZFB_CUERPO" -D "$ZFB_CABECERAS" -w '%{http_code}' -X POST "${ZFB_BASE}${ruta}" \
      -H 'Content-Type: application/json' -d "$cuerpo" "${@:3}"
  else
    curl -s -o "$ZFB_CUERPO" -D "$ZFB_CABECERAS" -w '%{http_code}' -X POST "${ZFB_BASE}${ruta}" "${@:3}"
  fi
}

# zfb_get <ruta> [args-curl...]  → mismo contrato que zfb_post: imprime el código HTTP y
# deja el cuerpo en $ZFB_CUERPO. Lo estrenó I3b2 (S-12), que audita GET /cuentas.
zfb_get() {
  local ruta="$1"
  curl -s -o "$ZFB_CUERPO" -D "$ZFB_CABECERAS" -w '%{http_code}' "${ZFB_BASE}${ruta}" "${@:2}"
}

# zfb_json <json> <expresión js sobre `d`>  → extrae un campo sin depender de jq
zfb_json() { node -e 'const d=JSON.parse(process.argv[1]);process.stdout.write(String(eval(process.argv[2])))' "$1" "$2"; }

# zfb_forjar_token <usuarioId> [segundos-de-vigencia]  → imprime el token de S-08.
#
# S-18: POST /transferencias exige identificarse, así que los árbitros que siembran por esa
# puerta necesitan un token del titular. El usuario que crea `/__test__/seed` lleva el hash
# '!NO-UTILIZABLE-S07!' a propósito —no se puede hacer login con él—, así que el token se
# FORJA con el secreto, igual que hacen los arneses de S-13 y de S-06. El formato es el de la
# Decisión 2 de S-08: base64url({sub,exp}) + '.' + HMAC-SHA256 del mismo texto.
zfb_forjar_token() {
  local sub="$1" vigencia="${2:-3600}" secreto exp carga firma
  secreto="$(grep -E '^ZFB_AUTH_SECRET=' .env | head -1 | cut -d= -f2- | tr -d '"'"'"'')"
  [ -n "$secreto" ] || { echo "zfb_forjar_token: ZFB_AUTH_SECRET no está en .env" >&2; return 1; }
  exp=$(( $(date +%s) + vigencia ))
  carga="$(printf '{"sub":"%s","exp":%s}' "$sub" "$exp" | base64 -w0 | tr '+/' '-_' | tr -d '=')"
  firma="$(printf '%s' "$carga" | openssl dgst -sha256 -hmac "$secreto" -binary | base64 -w0 | tr '+/' '-_' | tr -d '=')"
  printf '%s.%s' "$carga" "$firma"
}
