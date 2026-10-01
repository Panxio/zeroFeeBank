#!/usr/bin/env bash
# S-11 · los cinco invariantes del perfil financiero, en un solo comando. Cierra M1.
# Ver specs/S-11-invariantes.md. El árbitro de esta unidad es este mismo archivo, y por eso
# existe scripts/calibrar-invariantes.sh: un arnés que nunca se vio fallar es una afirmación.
#
#   P  · población        compuerta previa: hay algo que auditar
#   I1 · asiento cuadrado  ninguna transacción suma <> 0, ninguna con menos de 2 movimientos
#   I2 · cuadre global     la suma de TODOS los movimientos del sistema es 0
#   I3 · saldo derivado    ninguna columna de saldo materializada + el saldo EXPUESTO cuadra
#   I4 · sin negativos     ninguna cuenta de cliente bajo su límite pactado
#   I5 · idempotencia      ninguna clave sin transacción, ninguna transacción sin clave
#   I7 · tope otro banco   ningún par (cuenta, día UTC) suma más de 200,00 a otros bancos (S-22)
#   I6 · garantía          saldo de la cuenta GARANTIA == suma de las boletas VIGENTES (D04c)
#                          Se imprime DESPUÉS de I7 a propósito: el vector del calibrador es por orden
#                          de aparición, y así los casos previos sólo ganan un 0 final.
#
# INV_SEMBRAR=0 → no resetea ni mueve plata: audita lo que ya esté en la base (modo CI,
#                 detrás de la batería de integración). Desde S-12 YA NO pide un `seed`: I3b2
#                 obtiene su saldo expuesto por las puertas públicas (registro + apertura de
#                 cuenta + GET /cuentas), que existen siempre. El brazo contra el `seed`
#                 (I3b1) se salta, porque esa costura sólo existe con ZFB_COSTURAS_PRUEBA=1.
set -uo pipefail
cd "$(dirname "$0")/.."
source scripts/lib-app.sh

CONTENEDOR=zerofeebank-db
DUENO=zerofeebank
BD=zerofeebank
SEMBRAR="${INV_SEMBRAR:-1}"
MONTO_TRANSFERENCIA="250.00"   # < al saldo sembrado (1000,00); fijo para que sea reproducible
# I3b2 abre una cuenta de verdad. El monto lleva centavos NO redondos a propósito: un bug de
# división entera o de formato en el borde se ve con 1750,25 y no se ve con 1000,00.
MONTO_APERTURA_I3B2="1750.25"
PASSWORD_I3B2="clave-de-auditoria-larga"
# I7 (S-22 § 8): el tope diario de R9 (specs/S-22-otros-bancos.md § 2). Repetido
# acá a propósito: si el dominio lo cambia y esto no, I7 se pone rojo y alguien lo mira.
TOPE_OTROS_BANCOS_CENTAVOS=20000
# Sale de C2 y no de C1: E5 del calibrador depende del saldo exacto de C1 (75001 = saldo + 1).
MONTO_OTRO_BANCO="50.00"

# Lista de conceptos VERSIONADA junto al resultado (ARNES.md: un check por ausencia versiona
# su lista). Si aparece uno nuevo —S-15 Bill Pay, p. ej.— la compuerta P se pone roja y lo
# nombra, porque I5 no sabría si ese concepto debe nacer con clave o no.
CONCEPTOS_CONOCIDOS="APERTURA_CUENTA,COBRO_BOLETA,DEVOLUCION_BOLETA,EMISION_BOLETA,HISTORIAL_ARNES,OTORGAMIENTO_PRESTAMO,PAGO_SERVICIO,SIEMBRA,SIEMBRA_ARNES,SIEMBRA_BOLETA_COBRO,SIEMBRA_BOLETA_DEVOLUCION,SIEMBRA_BOLETA_EMISION,SIEMBRA_BOLETA_VENCIMIENTO,SIEMBRA_BUSQUEDA,TRANSFERENCIA,TRANSFERENCIA_OTRO_BANCO,VENCIMIENTO_BOLETA"
# De los conocidos, los que OBLIGATORIAMENTE nacen de un POST con Idempotency-Key.
# S-15 añade PAGO_SERVICIO a las DOS listas: es un POST que mueve plata, así que D5 exige
# que su asiento nazca con Idempotency-Key. Si sólo estuviera en la de arriba, I5 dejaría de
# vigilar los pagos y la compuerta seguiría verde sin mirarlos.
CONCEPTOS_CON_CLAVE="'TRANSFERENCIA','APERTURA_CUENTA','EMISION_BOLETA','COBRO_BOLETA','VENCIMIENTO_BOLETA','DEVOLUCION_BOLETA','PAGO_SERVICIO','OTORGAMIENTO_PRESTAMO','TRANSFERENCIA_OTRO_BANCO'"

rojos=0
paso()  { printf '  %-30s %6s  %s\n' "$1" "$2" "$3"; }
verde() { paso "$1" "$2" "OK    $3"; }
rojo()  { paso "$1" "$2" "ROJO  $3"; rojos=$((rojos + 1)); }

sql() { docker exec -e PGPASSWORD=zerofeebank_local "$CONTENEDOR" psql -v ON_ERROR_STOP=1 \
          -U "$DUENO" -d "$BD" -tAc "$1" 2>&1; }
detalle() { sed 's/^/        · /' ; }

trap 'zfb_bajar_app' EXIT

echo "S-11 · invariantes I1–I7   (sembrar=${SEMBRAR})"

# ── 0 · base y app arriba ────────────────────────────────────────────────────────────
docker compose up -d --wait >/dev/null 2>&1 || { echo "  la BD no levanta"; exit 1; }
zfb_levantar_app || exit 1

# ── 1 · POBLACIÓN ────────────────────────────────────────────────────────────────────
# Se siembra por las puertas públicas, nunca con INSERT: un arnés que se fabrica su propia
# población no mide el camino que la app usa de verdad.
exigir_http() {  # exigir_http <esperado> <etiqueta> <codigo-recibido>
  if [ "$3" != "$1" ]; then
    echo "  la siembra falló en [$2]: HTTP $3, esperaba $1"
    head -c 300 "$ZFB_CUERPO" | detalle
    echo; echo "S-11: abortado en la siembra. Los cinco números no se imprimen porque no"
    echo "      significarían nada (specs/S-11-invariantes.md § Pilar 3, paso 3)."
    exit 1
  fi
}

if [ "$SEMBRAR" = "1" ]; then
  exigir_http 200 "reset" "$(zfb_post /__test__/reset)"
  exigir_http 201 "seed"  "$(zfb_post /__test__/seed '{"escenario":"dos-cuentas"}')"
  s=$(cat "$ZFB_CUERPO")
  C1=$(zfb_json "$s" 'd.cuentas[0].id'); C2=$(zfb_json "$s" 'd.cuentas[1].id')
  # S-18: la puerta de las transferencias ahora pide identificarse. El titular de las dos
  # cuentas es el usuario que sembró la costura, y su token se forja con el secreto porque
  # el hash de la semilla no permite login (ver zfb_forjar_token).
  AUT="Authorization: Bearer $(zfb_forjar_token "$(zfb_json "$s" 'd.usuarioId')")"
  cuerpo="{\"origenId\":\"$C1\",\"destinoId\":\"$C2\",\"monto\":\"$MONTO_TRANSFERENCIA\"}"

  exigir_http 201 "transferencia" \
    "$(zfb_post /transferencias "$cuerpo" -H 'Idempotency-Key: s11-transferencia' -H "$AUT")"
  # El replay: la misma clave otra vez. Sin él, I5 no tendría nada que decir.
  # S-06 § contrato: el replay devuelve 201 —el MISMO código guardado—, no 200. El testigo
  # de que hubo replay es el header, no el código; afirmar sobre el código habría dejado
  # pasar una segunda ejecución real, que devuelve 201 igual.
  exigir_http 201 "replay de la misma clave" \
    "$(zfb_post /transferencias "$cuerpo" -H 'Idempotency-Key: s11-transferencia' -H "$AUT")"
  if ! grep -qi '^idempotency-replayed: *true' "$ZFB_CABECERAS"; then
    echo "  la siembra falló: la segunda llamada con la misma clave NO fue un replay"
    echo "  (sin el header Idempotency-Replayed: true se ejecutó de nuevo)"; exit 1
  fi
  # Y una que DEBE ser rechazada: si ésta escribiera algo, I1/I4 lo verían. Es el control
  # negativo de la siembra, y le importa lo que dice negar (aviso cuatro del prompt).
  malo="{\"origenId\":\"$C2\",\"destinoId\":\"$C1\",\"monto\":\"9999.00\"}"
  codigo=$(zfb_post /transferencias "$malo" -H 'Idempotency-Key: s11-sin-fondos' -H "$AUT")
  # ENDURECIDO en S-18: antes bastaba con que NO fuera 201, y con el token obligatorio un
  # 401 habría pasado por «rechazada» sin que nadie mirara los fondos. El control negativo
  # tiene que importar lo que dice negar, así que ahora se exige el 409 exacto.
  if [ "$codigo" != "409" ]; then
    echo "  la siembra falló: la transferencia sin fondos devolvió HTTP $codigo, esperaba 409"
    head -c 300 "$ZFB_CUERPO" | detalle; echo; exit 1
  fi
  # S-22: una transferencia a otro banco, o I7 sale verde mirando nada (compuerta P la exige).
  ob="{\"cuentaOrigenId\":\"$C2\",\"monto\":\"$MONTO_OTRO_BANCO\",\"banco\":\"ASERCION\",\"numeroCuenta\":\"000123\",\"tipoCuenta\":\"AHORRO\"}"
  exigir_http 201 "transferencia a otro banco" \
    "$(zfb_post /transferencias/otros-bancos "$ob" -H 'Idempotency-Key: s11-otro-banco' -H "$AUT")"
  # El calibrador necesita los ids de lo que se sembró para poder inyectarle defectos.
  # Se escriben sólo si alguien los pide; nadie más los mira.
  [ -n "${INV_IDS_A:-}" ] && printf 'C1=%s\nC2=%s\nSIS=%s\n' \
     "$C1" "$C2" "$(zfb_json "$s" 'd.cuentaSistemaId')" > "$INV_IDS_A"
fi

# ── I3b1 · el saldo que DECLARA la costura `seed` ────────────────────────────────────
# Se queda, y no es deuda: el escenario siembra 100000 y lo declara en otro lugar A PROPÓSITO,
# así que si alguien cambia uno y no el otro, este brazo lo caza. Si el `seed` calculara el
# saldo con la misma consulta que el endpoint, compararía la consulta consigo misma.
# Sólo corre con siembra: es una costura de prueba y no existe sin ZFB_COSTURAS_PRUEBA=1.
sh=""
if [ "$SEMBRAR" = "1" ]; then
  exigir_http 201 "seed de I3b1" "$(zfb_post /__test__/seed '{"escenario":"cuenta-con-historial"}')"
  sh=$(cat "$ZFB_CUERPO")
  # S-23: el escenario de boletas entra a la población auditada. Sin esto, I5 nunca vio
  # que sus asientos no traen clave: la batería daba 6/6 sobre una base donde el escenario no
  # estaba, y con él sembrado I5 se ponía rojo. Va después de capturar `sh` de I3b1.
  exigir_http 201 "seed de S-23" "$(zfb_post /__test__/seed '{"escenario":"boletas-en-cada-estado"}')"
fi

# ── compuerta P, primera mitad · ¿HABÍA algo que auditar? ────────────────────────────
# Se mide ANTES de que I3b2 abra su cuenta, y la razón es una regresión medida el 2026-09-07:
# I3b2 abre una cuenta por la puerta pública y eso crea una clave de idempotencia. Con la
# medición después, `n_cla` nunca podía volver a ser 0, y el defecto G2 del calibrador —una
# base sin claves que auditar— dejó de abortar: el calibrador pasó de 11/11 a 10/11 y lo
# nombró. La compuerta pregunta si había algo que auditar, no si el propio arnés se fabricó
# algo para poder mirar.
n_mov=$(sql "SELECT count(*) FROM movimiento;")
n_cli=$(sql "SELECT count(*) FROM cuenta WHERE tipo <> 'SISTEMA';")
n_cla=$(sql "SELECT count(*) FROM clave_idempotencia;")
n_ob=$(sql "SELECT count(*) FROM transaccion WHERE concepto = 'TRANSFERENCIA_OTRO_BANCO';")
n_vig=$(sql "SELECT count(*) FROM boleta WHERE estado = 'VIGENTE';")
saldo_gar=$(sql "SELECT COALESCE(SUM(m.monto_centavos),0) FROM movimiento m JOIN cuenta c ON c.id = m.cuenta_id
                 WHERE c.codigo = 'GARANTIA';")

echo "  población · movimientos=$n_mov cuentas_cliente=$n_cli claves=$n_cla otros_bancos=$n_ob boletas_vigentes=$n_vig"

falta_poblacion=0
[ "$n_mov" -ge 1 ] || { echo "  P · sin movimientos que auditar"; falta_poblacion=1; }
[ "$n_cli" -ge 1 ] || { echo "  P · sin cuentas de cliente que auditar"; falta_poblacion=1; }
[ "$n_cla" -ge 1 ] || { echo "  P · sin claves de idempotencia que auditar"; falta_poblacion=1; }
# I7 y la población de otros bancos: con SEMBRAR=1 la siembra CREA esa transferencia,
# así que un cero significa que la siembra se rompió y sigue siendo aborto duro. Con
# SEMBRAR=0 el árbitro audita una base que ya existe —la que dejó otra corrida— y esa base
# puede no tener ninguna transferencia interbancaria sin que nada esté mal. Ahí I7 no se
# declara verde: se declara SIN POBLACIÓN, se nombra en el resumen y no cuenta como auditado.
# Un invariante que nadie miró no dice "no sé": diría VERDE, y por eso se dice en voz alta.
i7_sin_poblacion=0
if [ "$n_ob" -ge 1 ]; then :
elif [ "$SEMBRAR" = "0" ]; then
  echo "  P · sin transferencias a otros bancos: I7 queda SIN POBLACIÓN (modo auditoría)"
  i7_sin_poblacion=1
else
  echo "  P · sin transferencias a otros bancos que auditar (I7)"; falta_poblacion=1
fi
# I6, mismo criterio que I7: con siembra el escenario `boletas-en-cada-estado` CREA
# boletas VIGENTES, así que un cero es siembra rota y aborta. Sin siembra, una base sin
# VIGENTES y con GARANTIA en 0 no tiene nada que auditar: se dice en voz alta. Pero sin VIGENTES
# y con plata en GARANTIA NO es «sin población»: es justo el defecto que I6 existe para cazar.
i6_sin_poblacion=0
if [ "$n_vig" -ge 1 ]; then :
elif [ "$SEMBRAR" = "0" ] && [ "$saldo_gar" = "0" ]; then
  echo "  P · sin boletas VIGENTES y GARANTIA en 0: I6 queda SIN POBLACIÓN (modo auditoría)"
  i6_sin_poblacion=1
elif [ "$SEMBRAR" = "0" ]; then :
else
  echo "  P · sin boletas VIGENTES que auditar (I6)"; falta_poblacion=1
fi
if [ "$falta_poblacion" -ne 0 ]; then
  echo; echo "S-11: abortado en la compuerta de población. Cinco ceros sobre una base vacía"
  echo "      se ven idénticos a cinco verdes, y no lo son."
  exit 1
fi

# ── I3b2 · el saldo que EXPONE GET /cuentas (S-12), por las puertas públicas ─────────
# El hueco que cierra: hasta S-12, I3 sólo miraba una costura de prueba. Lo que el cliente ve
# de verdad —el resumen de cuentas— no lo vigilaba nadie, y es justo donde un segundo
# SUM(monto_centavos) desincronizado produciría un saldo que miente.
EMAIL_I3B2="inv-$(date +%s%N)@zerofeebank.local"
CRED_I3B2="{\"email\":\"$EMAIL_I3B2\",\"password\":\"$PASSWORD_I3B2\"}"
exigir_http 201 "registro de I3b2" "$(zfb_post /auth/registro "$CRED_I3B2")"
exigir_http 200 "login de I3b2"    "$(zfb_post /auth/login "$CRED_I3B2")"
TOKEN_I3B2=$(zfb_json "$(cat "$ZFB_CUERPO")" 'd.token')
exigir_http 201 "apertura de I3b2" "$(zfb_post /cuentas \
  "{\"tipo\":\"CORRIENTE\",\"monto\":\"$MONTO_APERTURA_I3B2\"}" \
  -H "Authorization: Bearer $TOKEN_I3B2" -H "Idempotency-Key: i3b2-$(date +%s%N)")"
exigir_http 200 "resumen de I3b2" "$(zfb_get /cuentas -H "Authorization: Bearer $TOKEN_I3B2")"
sc=$(cat "$ZFB_CUERPO")

# ── compuerta P, segunda mitad · ¿conozco todos los conceptos? ───────────────────────
# Ésta va DESPUÉS de I3b2 a propósito: APERTURA_CUENTA sólo existe en la base una vez que
# I3b2 abrió su cuenta, y un check por ausencia que no ve el término que dice vigilar es
# decoración. Los conteos se rehacen para que los números que acompañan a I1–I5 describan
# lo que esos invariantes examinan de verdad, y no un retrato anterior.
n_mov=$(sql "SELECT count(*) FROM movimiento;")
n_cli=$(sql "SELECT count(*) FROM cuenta WHERE tipo <> 'SISTEMA';")
n_cla=$(sql "SELECT count(*) FROM clave_idempotencia;")
conceptos=$(sql "SELECT COALESCE(string_agg(DISTINCT concepto, ',' ORDER BY concepto),'(ninguno)') FROM transaccion;")

echo "              tras I3b2 · movimientos=$n_mov cuentas_cliente=$n_cli claves=$n_cla"
echo "              conceptos=[$conceptos]"
echo "              lista versionada=[$CONCEPTOS_CONOCIDOS] · con clave obligatoria=[${CONCEPTOS_CON_CLAVE//\'/}]"

falta_poblacion=0
for c in ${conceptos//,/ }; do
  case ",$CONCEPTOS_CONOCIDOS," in
    *",$c,"*) ;;
    *) echo "  P · concepto FUERA de la lista versionada: $c — I5 no sabe si debe nacer con clave"
       falta_poblacion=1 ;;
  esac
done
if [ "$falta_poblacion" -ne 0 ]; then
  echo; echo "S-11: abortado en la compuerta de población. Cinco ceros sobre una base vacía"
  echo "      se ven idénticos a cinco verdes, y no lo son."
  exit 1
fi

echo
# ── I1 · asiento cuadrado (D2) ───────────────────────────────────────────────────────
Q_I1="SELECT t.id, count(m.id) AS n, COALESCE(SUM(m.monto_centavos),0) AS suma
      FROM transaccion t LEFT JOIN movimiento m ON m.transaccion_id = t.id
      GROUP BY t.id HAVING COALESCE(SUM(m.monto_centavos),0) <> 0 OR count(m.id) < 2"
n_tx=$(sql "SELECT count(*) FROM transaccion;")
i1=$(sql "SELECT count(*) FROM ($Q_I1) x;")
if [ "$i1" = "0" ]; then verde "I1 · asiento cuadrado" "$i1" "$n_tx transacciones examinadas"
else rojo "I1 · asiento cuadrado" "$i1" "de $n_tx transacciones — abajo, con n= y suma="
     sql "SELECT 'tx '||t.id||'  n='||count(m.id)||'  suma='||COALESCE(SUM(m.monto_centavos),0)
          FROM transaccion t LEFT JOIN movimiento m ON m.transaccion_id=t.id
          GROUP BY t.id HAVING COALESCE(SUM(m.monto_centavos),0)<>0 OR count(m.id)<2 LIMIT 10" | detalle
fi

# ── I2 · cuadre global ───────────────────────────────────────────────────────────────
# Corolario declarado de I1 (spec § I2): no puede ponerse rojo con I1 en verde. Lo que
# aporta es la FORMA de la consulta —sin GROUP BY— y el número que imprime: el descuadre.
total=$(sql "SELECT COALESCE(SUM(monto_centavos),0) FROM movimiento;")
if [ "$total" = "0" ]; then verde "I2 · cuadre global" "0" "suma de $n_mov movimientos = 0 centavos"
else rojo "I2 · cuadre global" "1" "al sistema le sobran/faltan $total centavos"; fi

# ── I3 · saldo derivado ──────────────────────────────────────────────────────────────
i3a=$(sql "SELECT count(*) FROM information_schema.columns
           WHERE table_schema='public' AND table_name='cuenta' AND column_name ~ 'saldo';")
i3b=0; n_comparadas=0

# El saldo del ledger en CENTAVOS, para el brazo que compara contra la costura `seed`.
saldo_centavos() { sql "SELECT COALESCE(SUM(monto_centavos),0) FROM movimiento WHERE cuenta_id='$1';"; }
# El mismo saldo formateado como el string decimal del borde (D1), armado con aritmética
# ENTERA en SQL: una división en coma flotante acá metería el error que I3 existe para cazar.
saldo_decimal() {
  sql "SELECT CASE WHEN s<0 THEN '-' ELSE '' END || (abs(s)/100)::text || '.' ||
       lpad((abs(s)%100)::text,2,'0')
       FROM (SELECT COALESCE(SUM(monto_centavos),0)::bigint AS s
             FROM movimiento WHERE cuenta_id='$1') x;"
}

# b1 · contra lo que DECLARA el seed (centavos). Sólo con siembra.
if [ -n "$sh" ]; then
  for i in $(seq 0 $(( $(zfb_json "$sh" 'd.cuentas.length') - 1 ))); do
    cid=$(zfb_json "$sh" "d.cuentas[$i].id"); exp=$(zfb_json "$sh" "d.cuentas[$i].saldoCentavos")
    real=$(saldo_centavos "$cid")
    n_comparadas=$((n_comparadas + 1))
    if [ "$exp" != "$real" ]; then
      i3b=$((i3b + 1)); echo "        · [b1 seed] cuenta $cid expone $exp, el ledger dice $real"
    fi
  done
else
  echo "        · [b1 seed] omitido: sin siembra no hay costura de prueba que interrogar"
fi

# b2 · contra lo que EXPONE GET /cuentas (string decimal).
for i in $(seq 0 $(( $(zfb_json "$sc" 'd.cuentas.length') - 1 ))); do
  cid=$(zfb_json "$sc" "d.cuentas[$i].id"); exp=$(zfb_json "$sc" "d.cuentas[$i].saldo")
  real=$(saldo_decimal "$cid")
  n_comparadas=$((n_comparadas + 1))
  if [ "$exp" != "$real" ]; then
    i3b=$((i3b + 1)); echo "        · [b2 GET /cuentas] cuenta $cid expone $exp, el ledger dice $real"
  fi
done

i3=$((i3a + i3b))
if [ "$i3" = "0" ]; then verde "I3 · saldo derivado" "$i3" "0 columnas de saldo · $n_comparadas saldos expuestos cuadran (b1+b2)"
else rojo "I3 · saldo derivado" "$i3" "(a) $i3a columna(s) de saldo · (b) $i3b de $n_comparadas saldos expuestos mienten"
     [ "$i3a" -gt 0 ] && sql "SELECT 'columna materializada: cuenta.'||column_name FROM information_schema.columns
                              WHERE table_schema='public' AND table_name='cuenta' AND column_name ~ 'saldo';" | detalle
fi

# ── I4 · sin negativos indebidos ─────────────────────────────────────────────────────
# Las cuentas de SISTEMA se excluyen a propósito: su saldo negativo es la contrapartida
# del mundo exterior, y es justo lo que hace que I2 pueda dar 0.
Q_I4="SELECT c.id, COALESCE(SUM(m.monto_centavos),0) AS saldo, c.limite_sobregiro_centavos AS lim
      FROM cuenta c LEFT JOIN movimiento m ON m.cuenta_id = c.id
      WHERE c.tipo <> 'SISTEMA'
      GROUP BY c.id, c.limite_sobregiro_centavos
      HAVING COALESCE(SUM(m.monto_centavos),0) < -c.limite_sobregiro_centavos"
i4=$(sql "SELECT count(*) FROM ($Q_I4) x;")
if [ "$i4" = "0" ]; then verde "I4 · sin negativos indebidos" "$i4" "$n_cli cuentas de cliente (SISTEMA excluidas)"
else rojo "I4 · sin negativos indebidos" "$i4" "de $n_cli cuentas de cliente"
     sql "SELECT 'cuenta '||x.id||'  saldo='||x.saldo||'  limite='||x.lim FROM ($Q_I4) x LIMIT 10" | detalle
fi

# ── I5 · idempotencia ────────────────────────────────────────────────────────────────
i5a=$(sql "SELECT count(*) FROM clave_idempotencia k
           WHERE NOT EXISTS (SELECT 1 FROM transaccion t WHERE t.id::text = k.respuesta->>'transaccionId');")
i5b=$(sql "SELECT count(*) FROM transaccion t WHERE t.concepto IN ($CONCEPTOS_CON_CLAVE)
           AND NOT EXISTS (SELECT 1 FROM clave_idempotencia k WHERE k.respuesta->>'transaccionId' = t.id::text);")
n_con_clave=$(sql "SELECT count(*) FROM transaccion WHERE concepto IN ($CONCEPTOS_CON_CLAVE);")
i5=$((i5a + i5b))
if [ "$i5" = "0" ]; then verde "I5 · idempotencia" "$i5" "$n_cla claves · $n_con_clave transacciones con clave obligatoria"
else rojo "I5 · idempotencia" "$i5" "(a) $i5a clave(s) sin transacción · (b) $i5b transacción(es) que ninguna clave reclama"
     sql "SELECT 'clave sin transaccion: '||clave FROM clave_idempotencia k
          WHERE NOT EXISTS (SELECT 1 FROM transaccion t WHERE t.id::text = k.respuesta->>'transaccionId') LIMIT 5" | detalle
     sql "SELECT 'transaccion sin clave: '||t.id||' ('||t.concepto||')' FROM transaccion t
          WHERE t.concepto IN ($CONCEPTOS_CON_CLAVE) AND NOT EXISTS
          (SELECT 1 FROM clave_idempotencia k WHERE k.respuesta->>'transaccionId'=t.id::text) LIMIT 5" | detalle
fi

# ── I7 · tope diario a otros bancos (S-22) ───────────────────────────────────────────
# La misma cuenta que hace el service (§ 5): SUM(-monto) de los movimientos de la cuenta con
# concepto TRANSFERENCIA_OTRO_BANCO, agrupado por día UTC (creada_en se guarda en UTC). La
# contrapartida OTROS_BANCOS es SISTEMA y se excluye: su suma es negativa y no es un origen.
Q_I7="SELECT m.cuenta_id, date_trunc('day', t.creada_en) AS dia, SUM(-m.monto_centavos) AS total
      FROM movimiento m JOIN transaccion t ON t.id = m.transaccion_id JOIN cuenta c ON c.id = m.cuenta_id
      WHERE t.concepto = 'TRANSFERENCIA_OTRO_BANCO' AND c.tipo <> 'SISTEMA'
      GROUP BY m.cuenta_id, date_trunc('day', t.creada_en)
      HAVING SUM(-m.monto_centavos) > $TOPE_OTROS_BANCOS_CENTAVOS"
if [ "$i7_sin_poblacion" -eq 1 ]; then
  paso "I7 · tope diario otros bancos" "-" "SIN POBLACIÓN  0 transferencias a otros bancos: NO se audita"
else
  i7=$(sql "SELECT count(*) FROM ($Q_I7) x;")
  if [ "$i7" = "0" ]; then
    verde "I7 · tope diario otros bancos" "$i7" "$n_ob transferencias a otros bancos · tope $TOPE_OTROS_BANCOS_CENTAVOS"
  else
    rojo "I7 · tope diario otros bancos" "$i7" "par(es) cuenta-día sobre $TOPE_OTROS_BANCOS_CENTAVOS"
    sql "SELECT 'cuenta '||x.cuenta_id||'  dia='||x.dia::date||'  total='||x.total FROM ($Q_I7) x LIMIT 10" | detalle
  fi
fi

# ── I6 · saldo de GARANTIA == boletas VIGENTES (D04c) ──────────────────────────
# La emisión mueve el monto cuenta → GARANTIA; cobro, vencimiento y devolución lo sacan. Por
# tanto, en todo instante, lo que hay en GARANTIA es exactamente lo de las boletas sin cerrar.
# Un cobro que no libera, una emisión que no inmoviliza o una boleta VIGENTE sin fondos rompen
# la igualdad sin descuadrar I1 ni I2. Límite declarado: es un chequeo AGREGADO; dos errores
# opuestos que se compensan no se ven aquí.
saldo_gar=$(sql "SELECT COALESCE(SUM(m.monto_centavos),0) FROM movimiento m JOIN cuenta c ON c.id = m.cuenta_id
                 WHERE c.codigo = 'GARANTIA';")
sum_vig=$(sql "SELECT COALESCE(SUM(monto_centavos),0) FROM boleta WHERE estado = 'VIGENTE';")
if [ "$i6_sin_poblacion" -eq 1 ]; then
  paso "I6 · garantía == vigentes" "-" "SIN POBLACIÓN  0 boletas VIGENTES y GARANTIA en 0: NO se audita"
elif [ "$saldo_gar" = "$sum_vig" ]; then
  verde "I6 · garantía == vigentes" "0" "GARANTIA $saldo_gar = suma de $n_vig boleta(s) VIGENTE(S)"
else
  rojo "I6 · garantía == vigentes" "1" "GARANTIA tiene $saldo_gar y las $n_vig boleta(s) VIGENTE(S) suman $sum_vig"
fi

echo
sin_txt=""; n_sin=0
[ "$i7_sin_poblacion" -eq 1 ] && { sin_txt="$sin_txt · I7 SIN POBLACIÓN"; n_sin=$((n_sin + 1)); }
[ "$i6_sin_poblacion" -eq 1 ] && { sin_txt="$sin_txt · I6 SIN POBLACIÓN"; n_sin=$((n_sin + 1)); }
auditados=$((7 - n_sin))
if [ "$rojos" -ne 0 ]; then echo "S-11: $rojos de $auditados invariantes en ROJO"
elif [ "$n_sin" -gt 0 ]; then echo "S-11: $auditados/$auditados invariantes en verde$sin_txt"
else echo "S-11: 7/7 invariantes en verde (I1–I7)"; fi
exit "$rojos"
