# BIBLIOTECA DEL CALIBRADOR. No se ejecuta sola: se hace `source` desde un calibrador
# concreto (scripts/calibrar-s14.sh y los que vengan).
#
# Implementación compartida del calibrador genérico:
# calibrar-s13.sh y calibrar-s18.sh son dos implementaciones del MISMO mecanismo, y la de
# S-18 es mejor porque comprueba las dos mitades. El de S-14 habría sido la tercera copia.
#
# Qué NO hace, a propósito: no decide qué se inyecta ni qué brazo debe cazarlo. Eso se
# define en la spec. Esto es sólo la mecánica de romper, correr,
# leer los rojos y restaurar.
#
# Contrato para quien la usa:
#   CAL_ARNES        ruta del *.int.spec.ts que hace de árbitro
#   CAL_ARCHIVOS     array de archivos que se respaldan y se restauran entre defectos
#   CAL_PREFIJOS     regex de los códigos de brazo (p. ej. 'A-G'); por defecto A-Z
# y después:
#   cal_iniciar · parchar <archivo> <viejo> <nuevo> · probar <nombre> <brazos...> · cal_cerrar

set -uo pipefail

CAL_PREFIJOS="${CAL_PREFIJOS:-A-Z}"
cal_ok=0
cal_total=0
CAL_RESPALDO=""

cal_iniciar() {
  CAL_RESPALDO="$(mktemp -d)"
  local i=0
  for archivo in "${CAL_ARCHIVOS[@]}"; do
    if [ ! -f "$archivo" ]; then
      echo "ABORTA: no existe $archivo. ¿Está la entrega en el árbol?" >&2
      exit 1
    fi
    cp "$archivo" "$CAL_RESPALDO/$i"
    i=$((i + 1))
  done
  trap 'cal_restaurar; rm -rf "$CAL_RESPALDO"; cal_limpiar_residuo' EXIT
}

# Restaurar el código no restaura los DATOS: el ledger es append-only y cada defecto deja sus
# asientos. Por ejemplo, en intermitencias previas: L4 de S-15 asienta
# pagos contra GARANTIA, y H3 de boletas (cuadre global) cazaba el residuo en la batería
# siguiente. Quien ensucia, limpia: reset al salir, y si no queda limpio, el calibrador sale
# en ROJO — un residuo que no se ve envenena al árbitro de otra unidad.
cal_limpiar_residuo() {
  # shellcheck source=scripts/lib-app.sh
  source scripts/lib-app.sh
  local codigo filas
  zfb_build_si_hace_falta && zfb_levantar_app >/dev/null || {
    echo "RESIDUO: la app no levantó para resetear; la BD quedó sucia" >&2; exit 1; }
  codigo="$(zfb_post /__test__/reset)"
  filas="$(docker exec -e PGPASSWORD=zerofeebank_local zerofeebank-db psql -U zerofeebank \
    -d zerofeebank -tAc 'SELECT count(*) FROM movimiento' 2>&1)"
  zfb_bajar_app
  if [ "$codigo" != "200" ] || [ "$filas" != "0" ]; then
    echo "RESIDUO: reset HTTP $codigo, movimientos tras el reset: $filas — la BD quedó sucia" >&2
    exit 1
  fi
  echo "residuo: BD reseteada tras calibrar (0 movimientos)"
}

cal_restaurar() {
  local i=0
  for archivo in "${CAL_ARCHIVOS[@]}"; do
    cp "$CAL_RESPALDO/$i" "$archivo"
    i=$((i + 1))
  done
}

# parchar <archivo> <viejo> <nuevo> → falla ruidosamente si el texto ancla no está una vez
parchar() {
  python3 - "$1" "$2" "$3" <<'PY'
import io,sys
p,v,n=sys.argv[1],sys.argv[2],sys.argv[3]
s=io.open(p,encoding='utf-8').read()
if s.count(v)!=1:
    print(f"  PARCHE NO APLICABLE en {p}: el texto ancla aparece {s.count(v)} veces"); sys.exit(1)
io.open(p,'w',encoding='utf-8').write(s.replace(v,n))
PY
}

# ancla_ausente <nombre>
#
# Cuando el texto ancla de un defecto ya no está (otra unidad movió el código), el calibrador
# NO podía inyectarlo y el denominador se encogía en silencio: «15/17» que en realidad eran 2
# perdidos de 19 (deuda BITÁCORA #130). Acá el defecto perdido CUENTA: suma al total (corre
# igualmente), no al aprobado, y el número final dice la verdad. De scripts/calibrar-pdf.sh;
# los calibradores con su copia local la redefinen igual (name shadowing después del source).
ancla_ausente() {
  cal_total=$((cal_total+1))
  printf '  %-52s FALLA ancla ausente: defecto NO inyectado\n' "$1"
  cal_restaurar
}

# declarar_no_inyectable <nombre> <razón>
#
# Para un defecto de la tabla que NO se puede inyectar sobre la entrega que llegó. La regla
# del repo (specs/S-14 § 8, y así se hizo con E5 en S-18): se DECLARA y NO se cuenta como
# aprobado — nunca se sustituye por otro defecto que sí calce, porque eso sería elegir la
# pregunta después de ver la respuesta. Suma al total y no al aprobado: el número que sale
# al final sigue siendo el número real.
declarar_no_inyectable() {
  cal_total=$((cal_total+1))
  printf '  %-50s %s\n' "$1" "NO INYECTABLE — declarado, no aprobado"
  printf '  %-50s   %s\n' "" "$2"
}

# probar <nombre> <brazos-que-DEBEN-ponerse-rojos...>   (el parche ya está aplicado)
#
# Comprueba las DOS mitades: no basta con que los brazos
# declarados se pongan rojos; los que NO se declararon tienen que seguir verdes. Un defecto
# que pone rojo medio arnés no prueba que ningún brazo mida algo en particular.
probar() {
  local nombre="$1"; shift
  local esperados=("$@")
  cal_total=$((cal_total+1))
  local salida rojos faltan="" sobran=""
  salida="$(npx vitest run --config vitest.integracion.config.ts "$CAL_ARNES" \
            --reporter=verbose 2>&1 | grep -E '^\s+×' || true)"
  for brazo in "${esperados[@]}"; do
    grep -q "> $brazo · " <<<"$salida" || faltan+="$brazo "
  done
  while read -r linea; do
    [ -z "$linea" ] && continue
    local cod; cod="$(sed -E "s/.*> ([$CAL_PREFIJOS][0-9]+) · .*/\1/" <<<"$linea")"
    [[ "$cod" == "$linea" ]] && continue
    local declarado=no
    for brazo in "${esperados[@]}"; do [[ "$cod" == "$brazo" ]] && declarado=si; done
    [[ "$declarado" == "no" ]] && sobran+="$cod "
  done <<<"$salida"
  rojos="$(grep -c '×' <<<"$salida" || true)"
  if [ -z "$faltan" ] && [ -z "$sobran" ]; then
    cal_ok=$((cal_ok+1))
    printf '  %-52s OK    %s rojos · cazado por: %s\n' "$nombre" "$rojos" "${esperados[*]}"
  else
    printf '  %-52s FALLA %s rojos\n' "$nombre" "$rojos"
    [ -n "$faltan" ] && printf '  %-52s       NO se pusieron rojos: %s\n' "" "$faltan"
    [ -n "$sobran" ] && printf '  %-52s       rojos NO declarados: %s\n' "" "$sobran"
  fi
  cal_restaurar
}

cal_cerrar() {
  echo
  echo "$1: $cal_ok/$cal_total defectos con el resultado EXACTO que declara la spec"
  [ "$cal_ok" = "$cal_total" ]
}
