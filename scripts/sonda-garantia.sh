#!/usr/bin/env bash
# S-09 · el árbitro de UNA carrera concreta: las PRIMERAS emisiones del sistema, a la vez,
# cuando la cuenta de garantía todavía no existe.
#
# Es la misma forma de defecto que `sonda:caja` cazó sobre la otra cuenta de
# sistema: un `create` con catch del P2002 aborta la transacción entera en PostgreSQL y el
# segundo cliente recibe un 500. S-09 estrena la segunda cuenta de sistema del proyecto, así
# que la carrera vuelve a estar disponible, y un mecanismo que sólo se probó en un sitio no
# está probado en el otro.
#
# Por qué es un script y no un caso de vitest: para reproducir el escenario hay que dejar el
# sistema SIN cuenta de garantía, y lo único que la borra es `/__test__/reset`, una costura de
# otra unidad que sólo existe con ZFB_COSTURAS_PRUEBA=1.
#
# ⚠️ ES PROBABILÍSTICA, y por eso corre RONDAS rondas: el defecto sólo aparece si dos
# transacciones llegan al INSERT antes de que ninguna cierre. La regla aplica
# entera: un árbitro probabilístico DECLARA SU TASA DE DETECCIÓN junto al resultado, y esa
# tasa se mide rompiendo la app a propósito.
#
#   npm run sonda:garantia          · RONDAS=3 EMISIONES=4 npm run sonda:garantia
set -uo pipefail
cd "$(dirname "$0")/.."
source scripts/lib-app.sh

PASSWORD="clave-de-sonda-larga"
RONDAS="${RONDAS:-3}"
EMISIONES="${EMISIONES:-4}"
RUT_BEN="12345678-5"
RUT_RET="9876543-3"
rojos=0

sql() {
  docker exec -e PGPASSWORD=zerofeebank_local zerofeebank-db psql -U zerofeebank \
    -d zerofeebank -tAc "$1"
}

trap 'zfb_bajar_app' EXIT

echo "S-09 · sonda de la carrera de la garantía   ($RONDAS rondas x $EMISIONES emisiones simultáneas)"

docker compose up -d --wait >/dev/null 2>&1 || { echo "  la BD no levanta"; exit 1; }
zfb_levantar_app || exit 1

for ronda in $(seq 1 "$RONDAS"); do
  # 1 · dejar el sistema sin cuenta de garantía. Si el reset no está, la sonda se declara
  #     imposible y se pone ROJA: un check que no mira algo dice VERDE.
  codigo=$(zfb_post /__test__/reset)
  if [ "$codigo" != "200" ]; then
    echo "  no se pudo resetear (HTTP $codigo): esta sonda necesita ZFB_COSTURAS_PRUEBA=1"
    echo "S-09 sonda: NO CONCLUYENTE — se cuenta como roja, no como verde"
    exit 1
  fi
  if [ "$(sql "SELECT count(*) FROM cuenta WHERE codigo='GARANTIA';")" != "0" ]; then
    echo "S-09 sonda: NO CONCLUYENTE — la garantía sobrevivió al reset"; exit 1
  fi

  # 2 · un titular con una cuenta fondeada, por las puertas públicas
  email="sonda-garantia-r$ronda-$(date +%s%N)@zerofeebank.local"
  cred="{\"email\":\"$email\",\"password\":\"$PASSWORD\"}"
  [ "$(zfb_post /auth/registro "$cred")" = "201" ] || { echo "  registro falló"; exit 1; }
  [ "$(zfb_post /auth/login "$cred")" = "200" ]    || { echo "  login falló"; exit 1; }
  TOKEN="$(zfb_json "$(cat "$ZFB_CUERPO")" 'd.token')"
  [ "$(zfb_post /cuentas '{"tipo":"CORRIENTE","monto":"5000.00"}' \
        -H "Authorization: Bearer $TOKEN" -H "Idempotency-Key: sonda-gar-cta-r$ronda")" = "201" ] \
    || { echo "  la apertura falló: $(head -c 160 "$ZFB_CUERPO")"; exit 1; }
  CUENTA="$(zfb_json "$(cat "$ZFB_CUERPO")" 'd.id')"

  # 3 · las emisiones, SIMULTÁNEAS, todas contra una garantía que aún no existe.
  PIDS=(); SALIDAS=()
  for n in $(seq 1 "$EMISIONES"); do
    f=$(mktemp); SALIDAS+=("$f")
    cuerpo="{\"cuentaOrigenId\":\"$CUENTA\",\"monto\":\"100.00\",\"plazoDias\":30,
             \"beneficiarioRut\":\"$RUT_BEN\",\"beneficiarioNombre\":\"Constructora Andes SpA\",
             \"glosa\":\"Fiel cumplimiento contrato $ronda-$n\",
             \"retiradorRut\":\"$RUT_RET\",\"retiradorNombre\":\"Ana Soto\"}"
    curl -s -o "$f" -w '%{http_code}' -X POST "${ZFB_BASE}/boletas" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Idempotency-Key: sonda-gar-r$ronda-$n" \
      -H 'Content-Type: application/json' -d "$cuerpo" > "$f.code" &
    PIDS+=($!)
  done
  # PIDs explícitos: `wait` a secas esperaría también a la app que esta sonda encendió.
  wait "${PIDS[@]}"

  codigos=""
  for n in $(seq 1 "$EMISIONES"); do
    f="${SALIDAS[$((n-1))]}"; c=$(cat "$f.code")
    codigos="$codigos $c"
    if [ "$c" != "201" ]; then
      rojos=$((rojos + 1))
      echo "  ronda $ronda · la emisión $n no fue 201: $(head -c 200 "$f")"
    fi
  done

  # 4 · una sola cuenta de garantía, y el cuadre V3: su saldo es la suma de las vigentes.
  n_gar=$(sql "SELECT count(*) FROM cuenta WHERE codigo='GARANTIA';")
  saldo_gar=$(sql "SELECT COALESCE(SUM(m.monto_centavos),0) FROM movimiento m
                   JOIN cuenta c ON c.id=m.cuenta_id WHERE c.codigo='GARANTIA';")
  suma_vig=$(sql "SELECT COALESCE(SUM(monto_centavos),0) FROM boleta WHERE estado='VIGENTE';")
  echo "  ronda $ronda · HTTP:$codigos · cuentas garantía: $n_gar · saldo: $saldo_gar · boletas vigentes: $suma_vig"
  [ "$n_gar" = "1" ] || { rojos=$((rojos + 1)); echo "  ronda $ronda · se esperaba exactamente 1 cuenta de garantía"; }
  [ "$saldo_gar" = "$suma_vig" ] || { rojos=$((rojos + 1)); echo "  ronda $ronda · V3 ROTO: la garantía no cuadra con las boletas vigentes"; }
done

echo
total=$(( RONDAS * (EMISIONES + 2) ))
if [ "$rojos" -eq 0 ]; then echo "S-09 sonda: $total/$total en verde"
else echo "S-09 sonda: $rojos de $total comprobaciones en ROJO"; fi
exit "$rojos"
