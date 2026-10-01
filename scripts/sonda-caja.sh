#!/usr/bin/env bash
# S-12 · el árbitro de UNA carrera concreta: las PRIMERAS aperturas del sistema, a la vez,
# cuando la cuenta de caja todavía no existe.
#
# Por qué existe como script y no como caso de vitest: para reproducir el escenario hay que
# dejar el sistema SIN caja, y lo único que la borra es `/__test__/reset`, una costura de otra
# unidad que sólo existe con ZFB_COSTURAS_PRUEBA=1. Meter eso dentro de test/cuentas.int.spec.ts
# lo ataría a una costura ajena y a una variable de entorno.
#
# ⚠️ ESTA SONDA ES PROBABILÍSTICA, Y ESO ESTÁ MEDIDO, NO SUPUESTO. El defecto sólo aparece si
# dos transacciones llegan al INSERT de la caja antes de que ninguna cierre; si una alcanza a
# commitear primero, la otra ve la caja y no hay conflicto. La primera versión de esta sonda
# lanzaba DOS aperturas en UNA ronda: vio el defecto una vez y lo dejó pasar a la siguiente,
# sobre el mismo código roto. Un árbitro que sólo a veces mira dice VERDE.
# Por eso corre RONDAS rondas de APERTURAS simultáneas, y la tasa de detección con el código
# roto está medida y anotada junto al resultado.
#
#   npm run sonda:caja                    · RONDAS=3 APERTURAS=4 npm run sonda:caja
set -uo pipefail
cd "$(dirname "$0")/.."
source scripts/lib-app.sh

PASSWORD="clave-de-sonda-larga"
RONDAS="${RONDAS:-3}"
APERTURAS="${APERTURAS:-4}"
rojos=0

sql_caja() {
  docker exec -e PGPASSWORD=zerofeebank_local zerofeebank-db psql -U zerofeebank \
    -d zerofeebank -tAc "SELECT count(*) FROM cuenta WHERE codigo='CAJA';"
}

trap 'zfb_bajar_app' EXIT

echo "S-12 · sonda de la carrera de la caja   ($RONDAS rondas x $APERTURAS aperturas simultáneas)"

docker compose up -d --wait >/dev/null 2>&1 || { echo "  la BD no levanta"; exit 1; }
zfb_levantar_app || exit 1

for ronda in $(seq 1 "$RONDAS"); do
  # 1 · dejar el sistema sin caja. Si el reset no está disponible, la sonda NO se salta en
  #     silencio: se declara imposible y se pone roja. Un check que no mira algo dice VERDE.
  codigo=$(zfb_post /__test__/reset)
  if [ "$codigo" != "200" ]; then
    echo "  no se pudo resetear (HTTP $codigo): esta sonda necesita ZFB_COSTURAS_PRUEBA=1"
    echo "S-12 sonda: NO CONCLUYENTE — se cuenta como roja, no como verde"
    exit 1
  fi
  if [ "$(sql_caja)" != "0" ]; then
    echo "S-12 sonda: NO CONCLUYENTE — la caja sobrevivió al reset"; exit 1
  fi

  # 2 · titulares nuevos, por las puertas públicas
  TOKENS=()
  for n in $(seq 1 "$APERTURAS"); do
    email="sonda-caja-r$ronda-$n-$(date +%s%N)@zerofeebank.local"
    cred="{\"email\":\"$email\",\"password\":\"$PASSWORD\"}"
    [ "$(zfb_post /auth/registro "$cred")" = "201" ] || { echo "  registro $n falló"; exit 1; }
    [ "$(zfb_post /auth/login "$cred")" = "200" ]    || { echo "  login $n falló"; exit 1; }
    TOKENS+=("$(zfb_json "$(cat "$ZFB_CUERPO")" 'd.token')")
  done

  # 3 · las aperturas, SIMULTÁNEAS. Cada una con su propio archivo: compartir $ZFB_CUERPO
  #     entre varios curl en paralelo mezclaría las respuestas.
  PIDS=(); SALIDAS=()
  for n in $(seq 1 "$APERTURAS"); do
    f=$(mktemp); SALIDAS+=("$f")
    curl -s -o "$f" -w '%{http_code}' -X POST "${ZFB_BASE}/cuentas" \
      -H "Authorization: Bearer ${TOKENS[$((n-1))]}" \
      -H "Idempotency-Key: sonda-caja-r$ronda-$n" \
      -H 'Content-Type: application/json' -d '{"tipo":"CORRIENTE"}' > "$f.code" &
    PIDS+=($!)
  done
  # `wait` a secas espera a TODOS los hijos, y esta sonda tiene uno más: la propia app, que
  # zfb_levantar_app dejó corriendo en segundo plano. Sin los PIDs explícitos la sonda se
  # cuelga hasta el timeout esperando a que muera el servidor que ella misma encendió.
  wait "${PIDS[@]}"

  codigos=""
  for n in $(seq 1 "$APERTURAS"); do
    f="${SALIDAS[$((n-1))]}"; c=$(cat "$f.code")
    codigos="$codigos $c"
    if [ "$c" != "201" ]; then
      rojos=$((rojos + 1))
      echo "  ronda $ronda · la apertura $n no fue 201: $(head -c 160 "$f")"
    fi
  done

  # 4 · y una sola caja, no varias. El índice único lo garantiza, pero se afirma igual: es el
  #     invariante que hace que I2 pueda dar 0.
  n_cajas=$(sql_caja)
  echo "  ronda $ronda · HTTP:$codigos · cajas: $n_cajas"
  [ "$n_cajas" = "1" ] || { rojos=$((rojos + 1)); echo "  ronda $ronda · se esperaba exactamente 1 caja"; }
done

echo
total=$(( RONDAS * (APERTURAS + 1) ))
if [ "$rojos" -eq 0 ]; then echo "S-12 sonda: $total/$total en verde"
else echo "S-12 sonda: $rojos de $total comprobaciones en ROJO"; fi
exit "$rojos"
