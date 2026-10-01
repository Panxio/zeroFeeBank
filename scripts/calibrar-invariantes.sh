#!/usr/bin/env bash
# S-11 · calibración de los invariantes. Ver specs/S-11-invariantes.md § Pilar 5.
#
# Los cinco números de `npm run invariantes` no valen nada hasta que se les ve ponerse
# ROJOS por la razón correcta. Este archivo rompe la app a propósito, un defecto por
# invariante, y comprueba LAS DOS MITADES:
#     (a) el invariante que le toca se pone rojo, y
#     (b) los demás siguen verdes.
# Un defecto que enrojece de más es tan malo como uno que no enrojece: hace
# indistinguibles a dos invariantes, que es la trampa que este repo ya pagó tres veces.
#
# Los defectos se inyectan como DUEÑO de la base, sobre el estado escrito: los invariantes
# son afirmaciones sobre ese estado. Los dos que exigen tocar el código de la app —C3b y
# C6— se inyectan a mano y quedan registrados en la documentación del arnés.
#
# El ledger es append-only incluso para el dueño (S-04): un defecto NO se deshace. Entre
# defecto y defecto se vuelve a /__test__/reset, la única puerta que sabe quitar el
# trigger y reponerlo.
set -uo pipefail
cd "$(dirname "$0")/.."
source scripts/lib-app.sh

CONTENEDOR=zerofeebank-db
IDS="$(mktemp)"; SALIDA="$(mktemp)"
fallos=0

sql() { docker exec -e PGPASSWORD=zerofeebank_local "$CONTENEDOR" psql -v ON_ERROR_STOP=1 \
          -U zerofeebank -d zerofeebank -tAc "$1" 2>&1; }

# Los defectos dejan residuo (boletas cerradas sin asiento) que el test de integración de H5 lee
# entero. Al salir se quita la columna del defecto C3b y se resetea la BD por la COSTURA
# /__test__/reset (nunca por SQL), con el patrón de calibrar-s17-abrir-cuenta.sh.
reset_final() {
  sql "ALTER TABLE cuenta DROP COLUMN IF EXISTS saldo_centavos" >/dev/null
  local codigo
  zfb_app_responde || zfb_levantar_app >/dev/null 2>&1
  codigo="$(zfb_post /__test__/reset)"
  zfb_bajar_app
  if [ "$codigo" = "200" ]; then
    echo "residuo: BD reseteada al salir"
  else
    echo "RESIDUO: no se pudo resetear la BD al salir (reset devolvió '$codigo')" >&2
  fi
}
trap 'reset_final' EXIT

# numeros <archivo> → "i1 i2 i3 i4 i5" leídos de la salida del arnés
numeros() {
  awk '/^  I[1-7] /{ for(i=1;i<=NF;i++) if($i=="OK"||$i=="ROJO") { printf "%s ", $(i-1); break } }' "$1"
}

# calibrar <etiqueta> <esperado "i1 i2 i3 i4 i5"> <sql-de-inyección>
calibrar() {
  local etiqueta="$1" esperado="$2" inyeccion="$3" base obtenido
  printf '\n── %s\n' "$etiqueta"

  # Control: verde ANTES de inyectar. Sin esto, un rojo posterior podría venir de arrastre.
  INV_IDS_A="$IDS" bash scripts/invariantes.sh >"$SALIDA" 2>&1
  base=$(numeros "$SALIDA")
  if [ "$base" != "0 0 0 0 0 0 0 " ]; then
    echo "   control PREVIO en rojo [$base] — se aborta: el rojo de después no probaría nada"
    tail -12 "$SALIDA" | sed 's/^/     /'; fallos=$((fallos + 1)); return
  fi
  echo "   control previo   0 0 0 0 0 0 0   (verde sobre lo que no debe tocar)"

  # Los ids salen de la siembra que acaba de correr, así que la inyección se escribe con
  # marcadores (@C1@) y se resuelve AQUÍ. Escribirla con $C1 la resolvía en la llamada,
  # cuando todavía no había ids.
  # shellcheck disable=SC1090
  source "$IDS"
  inyeccion=${inyeccion//@C1@/$C1}; inyeccion=${inyeccion//@C2@/$C2}; inyeccion=${inyeccion//@SIS@/$SIS}
  local salida_sql; salida_sql=$(sql "$inyeccion")
  if echo "$salida_sql" | grep -q '^ERROR'; then
    echo "   la inyección no entró: $salida_sql"; fallos=$((fallos + 1)); return
  fi

  INV_SEMBRAR=0 bash scripts/invariantes.sh >"$SALIDA" 2>&1
  obtenido=$(numeros "$SALIDA")
  # La población se imprime SIEMPRE, y no es decoración: en los controles negativos —los que
  # esperan todo verde— es el único testigo de que las filas inyectadas se examinaron de
  # verdad. Un verde sobre una fila que nadie miró se ve igual que un verde correcto.
  grep -m1 'población ·' "$SALIDA" | sed 's/^  población ·/   examinado      /'
  if [ "$obtenido" = "$esperado " ]; then
    echo "   con el defecto   $obtenido  ✔ el resultado es exactamente el que la spec declara"
  else
    echo "   con el defecto   $obtenido  ✘ esperaba [$esperado]"
    grep -E '^ +I[1-7]|^ +· ' "$SALIDA" | sed 's/^/     /'
    fallos=$((fallos + 1))
  fi
}

# calibrar_aborta <etiqueta> <patrón que debe aparecer> <sql-de-inyección>
# Para los defectos que la compuerta P tiene que atajar ANTES de imprimir los cinco números.
# No comparten forma con los otros: acá el acierto es que NO haya cinco números.
calibrar_aborta() {
  local etiqueta="$1" patron="$2" inyeccion="$3"
  printf '\n── %s\n' "$etiqueta"
  INV_IDS_A="$IDS" bash scripts/invariantes.sh >"$SALIDA" 2>&1
  if [ "$(numeros "$SALIDA")" != "0 0 0 0 0 0 0 " ]; then
    echo "   control PREVIO en rojo — se aborta"; fallos=$((fallos + 1)); return
  fi
  echo "   control previo   0 0 0 0 0 0 0   (verde sobre lo que no debe tocar)"
  # shellcheck disable=SC1090
  source "$IDS"
  sql "$inyeccion" >/dev/null
  INV_SEMBRAR=0 bash scripts/invariantes.sh >"$SALIDA" 2>&1
  if [ "$(numeros "$SALIDA")" != "" ]; then
    echo "   con el defecto   $(numeros "$SALIDA")  ✘ imprimió los números; P debía atajarlo antes"
    fallos=$((fallos + 1)); return
  fi
  if grep -q "$patron" "$SALIDA"; then
    echo "   con el defecto   —  ✔ P abortó, y nombró la causa:"
    grep -m1 "$patron" "$SALIDA" | sed 's/^ */     /'
  else
    echo "   con el defecto   —  ✘ abortó, pero sin nombrar /$patron/"
    tail -6 "$SALIDA" | sed 's/^/     /'; fallos=$((fallos + 1))
  fi
}

# calibrar_sin_ob <etiqueta> <patrón esperado en el resumen> <exit esperado> [sql extra]
# En modo auditoría (INV_SEMBRAR=0) una base sin ninguna
# transferencia a otro banco ya no aborta; I7 se declara SIN POBLACIÓN. Lo que hay que probar
# no es que pase —eso es fácil— sino que el resto SIGUE mirando: por eso G4 mete un descuadre
# en esa misma base y exige que I1 se ponga rojo igual. Un invariante saltado no puede
# convertir al arnés en decoración.
calibrar_sin_ob() {
  local etiqueta="$1" patron="$2" exit_esperado="$3" extra="${4:-}" ex
  printf '\n── %s\n' "$etiqueta"
  INV_IDS_A="$IDS" bash scripts/invariantes.sh >"$SALIDA" 2>&1
  if [ "$(numeros "$SALIDA")" != "0 0 0 0 0 0 0 " ]; then
    echo "   control PREVIO en rojo — se aborta"; fallos=$((fallos + 1)); return
  fi
  echo "   control previo   0 0 0 0 0 0 0   (con otros bancos en la base: I7 auditado y verde)"
  # shellcheck disable=SC1090
  source "$IDS"
  # Se deja la base SIN transferencias interbancarias reetiquetando el asiento, no borrándolo:
  # el ledger es append-only y un trigger de la BD rechaza el DELETE sobre `movimiento` (D3).
  # Se midió: `DELETE` devuelve «movimiento es append-only (D3): DELETE rechazado». TRANSFERENCIA
  # está en las dos listas versionadas igual que TRANSFERENCIA_OTRO_BANCO, así que la base queda
  # cuadrada y con clave; lo único que cambia es lo que esta calibración mide: n_ob = 0.
  # El error NO se manda a /dev/null: una inyección que no entra y nadie ve produce un verde falso.
  local salida_sql; salida_sql=$(sql "UPDATE transaccion SET concepto = 'TRANSFERENCIA'
                                      WHERE concepto = 'TRANSFERENCIA_OTRO_BANCO';")
  if echo "$salida_sql" | grep -q '^ERROR'; then
    echo "   la inyección no entró: $salida_sql"; fallos=$((fallos + 1)); return
  fi
  [ -n "$extra" ] && { extra=${extra//@C1@/$C1}; extra=${extra//@SIS@/$SIS}; sql "$extra" >/dev/null; }
  INV_SEMBRAR=0 bash scripts/invariantes.sh >"$SALIDA" 2>&1; ex=$?
  grep -m1 'población ·' "$SALIDA" | sed 's/^  población ·/   examinado      /'
  if [ "$ex" = "$exit_esperado" ] && grep -q "$patron" "$SALIDA"; then
    echo "   sin otros bancos exit $ex  ✔ $(grep -m1 "$patron" "$SALIDA" | sed 's/^ *//')"
  else
    echo "   sin otros bancos exit $ex  ✘ esperaba exit $exit_esperado y /$patron/"
    tail -10 "$SALIDA" | sed 's/^/     /'; fallos=$((fallos + 1))
  fi
}

echo "S-11 · calibración: veintiún casos de estado + dos de código (éstos, a mano)"
docker compose up -d --wait >/dev/null 2>&1 || { echo "  la BD no levanta"; exit 1; }
zfb_levantar_app || exit 1

# ── E1 · dos asientos descuadrados que se COMPENSAN entre sí ─────────────────────────
# El descuadre por transacción existe, pero el global sigue en 0. Es el único defecto que
# separa I1 de I2, y por eso va primero: sin él los dos serían el mismo chequeo con dos
# nombres.
calibrar "E1 · dos asientos descuadrados que se compensan → sólo I1        [B4]" "2 0 0 0 0 0 0" "
  INSERT INTO transaccion (id,concepto,creada_en) VALUES
    ('e1000000-0000-4000-8000-000000000001','SIEMBRA',now()),
    ('e1000000-0000-4000-8000-000000000002','SIEMBRA',now());
  INSERT INTO movimiento (id,transaccion_id,cuenta_id,monto_centavos,creado_en) VALUES
    (gen_random_uuid(),'e1000000-0000-4000-8000-000000000001','@C1@',-1000,now()),
    (gen_random_uuid(),'e1000000-0000-4000-8000-000000000002','@SIS@', 1000,now());"

# ── E2 · un movimiento solitario ─────────────────────────────────────────────────────
# I1 e I2 se ponen rojos JUNTOS, y está declarado en la spec: transaccion_id es NOT NULL,
# así que la suma global es la suma de las sumas. Lo que los distingue es lo que imprimen.
calibrar "E2 · un movimiento sin contrapartida → I1 e I2 (corolario)       [B4]" "1 1 0 0 0 0 0" "
  INSERT INTO transaccion (id,concepto,creada_en) VALUES
    ('e2000000-0000-4000-8000-000000000001','SIEMBRA',now());
  INSERT INTO movimiento (id,transaccion_id,cuenta_id,monto_centavos,creado_en) VALUES
    (gen_random_uuid(),'e2000000-0000-4000-8000-000000000001','@C1@',-1000,now());"

# ── E4 · una columna de saldo materializada ─────────────────────────────────────────
# El esquema lo dice con todas las letras: «si un día aparece una columna saldo acá, es un
# defecto, no una optimización». Esto comprueba que alguien la esté mirando.
calibrar "E4 · columna de saldo materializada en cuenta → sólo I3          [B9]" "0 0 1 0 0 0 0" "
  ALTER TABLE cuenta ADD COLUMN saldo_centavos BIGINT;"
sql "ALTER TABLE cuenta DROP COLUMN IF EXISTS saldo_centavos" >/dev/null

# ── E5 · una cuenta de cliente bajo su límite ────────────────────────────────────────
# Asiento CUADRADO: I1 e I2 no tienen nada que decir. Es el defecto que sólo I4 ve.
# 75001 = el saldo que quedó tras la transferencia sembrada (100000 − 25000) más un centavo.
calibrar "E5 · cuenta de cliente bajo su límite → sólo I4                  [B6]" "0 0 0 1 0 0 0" "
  INSERT INTO transaccion (id,concepto,creada_en) VALUES
    ('e5000000-0000-4000-8000-000000000001','SIEMBRA',now());
  INSERT INTO movimiento (id,transaccion_id,cuenta_id,monto_centavos,creado_en) VALUES
    (gen_random_uuid(),'e5000000-0000-4000-8000-000000000001','@C1@',-75001,now()),
    (gen_random_uuid(),'e5000000-0000-4000-8000-000000000001','@SIS@', 75001,now());"

# ── E7 · una transferencia que ninguna clave reclama ─────────────────────────────────
# Es la forma que tiene en la base un cobro duplicado: plata que se movió dos veces y una
# de las dos no tiene clave que la explique. Cuadra perfecto; sólo I5 la ve.
calibrar "E7 · transferencia que ninguna clave reclama → sólo I5 (b)       [B8]" "0 0 0 0 1 0 0" "
  INSERT INTO transaccion (id,concepto,creada_en) VALUES
    ('e7000000-0000-4000-8000-000000000001','TRANSFERENCIA',now());
  INSERT INTO movimiento (id,transaccion_id,cuenta_id,monto_centavos,creado_en) VALUES
    (gen_random_uuid(),'e7000000-0000-4000-8000-000000000001','@C1@',-1000,now()),
    (gen_random_uuid(),'e7000000-0000-4000-8000-000000000001','@C2@', 1000,now());"

# ── E3 · un asiento huérfano: transacción sin NINGÚN movimiento ──────────────────────
# El GROUP BY natural sale de `movimiento` y esta fila no aparecería ahí. La consulta de I1
# arranca de `transaccion` con LEFT JOIN justamente por esto: una transacción que no escribió
# nada es un asiento que se abrió y se perdió, no un no-evento.
calibrar "E3 · transacción sin ningún movimiento → sólo I1                  [B3]" "1 0 0 0 0 0 0" "
  INSERT INTO transaccion (id,concepto,creada_en) VALUES
    ('e3000000-0000-4000-8000-000000000001','SIEMBRA',now());"

# ── E6 · CONTROL NEGATIVO: una cuenta DENTRO de su límite pactado ────────────────────
# Debe quedar VERDE. Junto con E5 prueba que I4 compara contra la columna
# limite_sobregiro_centavos y no contra un 0 escrito a mano: misma forma, saldo negativo,
# y el veredicto cambia sólo porque el límite cambió. Un control negativo tiene que
# importar lo que dice negar (aviso cuatro del prompt).
calibrar "E6 · cuenta en −3000 con límite 5000 → TODO VERDE (control)       [B6]" "0 0 0 0 0 0 0" "
  INSERT INTO cuenta (id,tipo,titular_id,limite_sobregiro_centavos,creada_en) VALUES
    ('e6000000-0000-4000-8000-0000000000c1','CORRIENTE',NULL,5000,now());
  INSERT INTO transaccion (id,concepto,creada_en) VALUES
    ('e6000000-0000-4000-8000-000000000001','SIEMBRA',now());
  INSERT INTO movimiento (id,transaccion_id,cuenta_id,monto_centavos,creado_en) VALUES
    (gen_random_uuid(),'e6000000-0000-4000-8000-000000000001','e6000000-0000-4000-8000-0000000000c1',-3000,now()),
    (gen_random_uuid(),'e6000000-0000-4000-8000-000000000001','@SIS@', 3000,now());"

# ── E8 · una clave que apunta a una transacción que no existe ────────────────────────
# La otra mitad de I5, y no la cubre E7: ahí sobraba una transacción, acá sobra una clave.
# Es lo que queda cuando el ledger revierte y el registro de la clave no.
calibrar "E8 · clave sin transacción que la respalde → sólo I5 (a)          [B7]" "0 0 0 0 1 0 0" "
  INSERT INTO clave_idempotencia (clave,endpoint,huella_peticion,estado_http,respuesta,creada_en)
  VALUES ('e8-clave-huerfana','POST /transferencias','sin-huella',201,
          '{\"transaccionId\":\"e8000000-0000-4000-8000-00000000dead\"}'::jsonb, now());"

# ── E9 · CONTROL NEGATIVO: una cuenta de cliente sin ningún movimiento ───────────────
# Saldo 0 legítimo. Si I4 usara un JOIN normal en vez de LEFT JOIN, esta cuenta
# desaparecería de la consulta y el verde sería por no mirarla. La línea «examinado» de
# arriba es la que lo distingue: cuentas_cliente tiene que SUBIR.
calibrar "E9 · cuenta de cliente sin movimientos → TODO VERDE (control)     [B2]" "0 0 0 0 0 0 0" "
  INSERT INTO cuenta (id,tipo,titular_id,limite_sobregiro_centavos,creada_en) VALUES
    ('e9000000-0000-4000-8000-0000000000c1','CORRIENTE',NULL,0,now());"

# ── E10–E12 · I7, tope diario a otros bancos (S-22 § 8) ──────────────────────────────
# Dos asientos por caso, no uno: I7 tiene que SUMAR por (cuenta, día UTC), y un solo asiento
# de 20001 lo cazaría también un chequeo por fila. Fechas fijas, no now(): el caso no puede
# depender de la hora a la que corre. Cada asiento con su clave, o I5 (b) se pondría rojo y
# el defecto dejaría de ser sólo de I7.
ob_asiento() {  # ob_asiento <n> <centavos> <instante>
  printf "INSERT INTO transaccion (id,concepto,creada_en) VALUES ('%s','TRANSFERENCIA_OTRO_BANCO','%s');
  INSERT INTO movimiento (id,transaccion_id,cuenta_id,monto_centavos,creado_en) VALUES
    (gen_random_uuid(),'%s','@C1@',-%s,'%s'), (gen_random_uuid(),'%s','@SIS@',%s,'%s');
  INSERT INTO clave_idempotencia (clave,endpoint,huella_peticion,estado_http,respuesta,creada_en)
  VALUES ('i7-%s','POST /transferencias/otros-bancos','sin-huella',201,
          '{\"transaccionId\":\"%s\"}'::jsonb,'%s');\n" \
    "$1" "$3" "$1" "$2" "$3" "$1" "$2" "$3" "$1" "$1" "$3"
}
calibrar "E10 · 15000 + 5001 el mismo día UTC → sólo I7                     [S-22]" "0 0 0 0 0 1 0" "
  $(ob_asiento e1000000-0000-4000-8000-0000000000a1 15000 '2026-10-01 10:00:00')
  $(ob_asiento e1000000-0000-4000-8000-0000000000a2 5001  '2026-10-01 18:00:00')"
calibrar "E11 · 15000 + 5000 el mismo día (tope exacto) → TODO VERDE (control) [S-22]" "0 0 0 0 0 0 0" "
  $(ob_asiento e1100000-0000-4000-8000-0000000000a1 15000 '2026-10-01 10:00:00')
  $(ob_asiento e1100000-0000-4000-8000-0000000000a2 5000  '2026-10-01 18:00:00')"
calibrar "E12 · 15000 a las 23:59:59.999 + 5001 al día siguiente → VERDE      [S-22]" "0 0 0 0 0 0 0" "
  $(ob_asiento e1200000-0000-4000-8000-0000000000a1 15000 '2026-10-01 23:59:59.999')
  $(ob_asiento e1200000-0000-4000-8000-0000000000a2 5001  '2026-10-02 00:00:00.000')"

# ── E13–E15 · I6, saldo de GARANTIA == boletas VIGENTES (D04c) ──────────────────────────
# Los tres son asientos o filas CUADRADOS para I1–I5: sólo I6 puede verlos. E13 y E14 son las
# dos direcciones del descuadre (boleta sin fondos / fondos sin boleta). E15 es el control que
# le importa lo que dice negar: la MISMA fila que E13 con estado COBRADA no debe enrojecer,
# o I6 no estaría filtrando por estado sino comparando contra todas las boletas. La emisión
# de la fila inyectada reutiliza cualquier transacción existente: sólo importa el FK.
boleta_sql() {  # boleta_sql <id> <estado> <centavos>
  printf "INSERT INTO boleta (id,cuenta_id,monto_centavos,estado,emitida_en,vence_en,beneficiario_rut,
    beneficiario_nombre,glosa,retirador_rut,retirador_nombre,transaccion_emision_id)
  VALUES ('%s','@C1@',%s,'%s',now(),now() + interval '30 days','11111111-1','Cal I6','cal-i6',
    '11111111-1','Cal I6',(SELECT id FROM transaccion ORDER BY id LIMIT 1));\n" "$1" "$3" "$2"
}
calibrar "E13 · boleta VIGENTE que no inmovilizó fondos → sólo I6            [D04c]" "0 0 0 0 0 0 1" "
  $(boleta_sql e1300000-0000-4000-8000-0000000000b1 VIGENTE 5000)"
calibrar "E14 · fondos en GARANTIA sin boleta que los explique → sólo I6     [D04c]" "0 0 0 0 0 0 1" "
  INSERT INTO transaccion (id,concepto,creada_en) VALUES
    ('e1400000-0000-4000-8000-000000000001','SIEMBRA',now());
  INSERT INTO movimiento (id,transaccion_id,cuenta_id,monto_centavos,creado_en) VALUES
    (gen_random_uuid(),'e1400000-0000-4000-8000-000000000001','@C1@',-1000,now()),
    (gen_random_uuid(),'e1400000-0000-4000-8000-000000000001',
     (SELECT id FROM cuenta WHERE codigo='GARANTIA'), 1000, now());"
calibrar "E15 · la misma fila de E13 pero COBRADA → TODO VERDE (control)     [D04c]" "0 0 0 0 0 0 0" "
  $(boleta_sql e1500000-0000-4000-8000-0000000000b1 COBRADA 5000)"
# G6: sin ninguna VIGENTE y con plata en GARANTIA NO es «sin población»: es el defecto de I6.
calibrar "G6 · todas las boletas cerradas y GARANTIA con plata → I6 ROJO     [D04c]" "0 0 0 0 0 0 1" "
  UPDATE boleta SET estado = 'COBRADA' WHERE estado = 'VIGENTE';"

# ── G1 · un concepto de dinero que la lista versionada no conoce ─────────────────────
# El día que S-15 (Bill Pay) escriba en el ledger, I5 no sabrá si ese concepto debe nacer
# con clave. La compuerta se pone roja y lo NOMBRA, en vez de dar cinco verdes sobre algo
# que dejó de cubrir. Es la forma #2 del patrón: el check que dejó de mirar se ve igual de
# verde que el que mira.
calibrar_aborta "G1 · concepto fuera de la lista versionada → P aborta          [B11]" "concepto FUERA de la lista" "
  INSERT INTO transaccion (id,concepto,creada_en) VALUES
    ('50000000-0000-4000-8000-000000000001','BILL_PAY',now());"

# ── G2 · una base sin nada que auditar ───────────────────────────────────────────────
# Cinco ceros sobre una base vacía se ven idénticos a cinco verdes. Este es el defecto que
# convierte a todo el arnés en decoración, y el único que no se caza mirando un invariante.
calibrar_aborta "G2 · sin claves que auditar → P aborta                         [B1]" "sin claves de idempotencia" "
  DELETE FROM clave_idempotencia;"

# ── G3 y G4 · ajuste en la compuerta de I7 ──────────────────────────────────────────
# G3: en modo auditoría, una base legítima sin transferencias interbancarias ya no aborta.
# G4: y esa misma base, con un descuadre metido a mano, SIGUE dando rojo en I1. Sin G4, G3
# solo probaría que el arnés aprendió a callarse.
calibrar_sin_ob "G3 · auditoría sin otros bancos → I7 SIN POBLACIÓN, exit 0     [s64]" \
  "I7 SIN POBLACIÓN" 0

# exit 2, no 1: I1 e I2 se ponen rojos JUNTOS ante un movimiento huérfano, y está declarado
# arriba en E1: «S-11: 2 de 6 invariantes en ROJO».
calibrar_sin_ob "G4 · lo mismo, con un descuadre → I1 e I2 rojos igual, exit 2  [s64]" \
  "invariantes en ROJO" 2 "
  INSERT INTO transaccion (id,concepto,creada_en) VALUES
    ('64000000-0000-4000-8000-000000000001','SIEMBRA',now());
  INSERT INTO movimiento (id,transaccion_id,cuenta_id,monto_centavos,creado_en) VALUES
    (gen_random_uuid(),'64000000-0000-4000-8000-000000000001','@C1@',-1000,now());"

# ── G5 · ajuste en la compuerta de I6 ────────────────────────────────────────────────
# En modo auditoría, una base legítima sin boletas VIGENTES y con GARANTIA vaciada (por un
# asiento compensatorio, porque el ledger es append-only) declara I6 SIN POBLACIÓN y sale 0.
# G6 (arriba) es su contraparte: sin VIGENTES pero con plata en GARANTIA sigue rojo.
printf '\n── G5 · sin VIGENTES y GARANTIA vacía → I6 SIN POBLACIÓN, exit 0   [D04c]\n'
INV_IDS_A="$IDS" bash scripts/invariantes.sh >"$SALIDA" 2>&1
if [ "$(numeros "$SALIDA")" != "0 0 0 0 0 0 0 " ]; then
  echo "   control PREVIO en rojo — se aborta"; fallos=$((fallos + 1))
else
  echo "   control previo   0 0 0 0 0 0 0   (I6 auditado y verde)"
  salida_sql=$(sql "
    UPDATE boleta SET estado = 'COBRADA' WHERE estado = 'VIGENTE';
    INSERT INTO transaccion (id,concepto,creada_en) VALUES ('65000000-0000-4000-8000-000000000001','SIEMBRA',now());
    WITH g AS (SELECT (SELECT id FROM cuenta WHERE codigo = 'GARANTIA') AS gid,
                      COALESCE(SUM(monto_centavos),0) AS s FROM movimiento
               WHERE cuenta_id = (SELECT id FROM cuenta WHERE codigo = 'GARANTIA'))
    INSERT INTO movimiento (id,transaccion_id,cuenta_id,monto_centavos,creado_en)
      SELECT gen_random_uuid(),'65000000-0000-4000-8000-000000000001'::uuid,gid,-s,now() FROM g
      UNION ALL
      SELECT gen_random_uuid(),'65000000-0000-4000-8000-000000000001',
             (SELECT id FROM cuenta WHERE codigo = 'CAJA'),s,now() FROM g;")
  if echo "$salida_sql" | grep -q '^ERROR'; then
    echo "   la inyección no entró: $salida_sql"; fallos=$((fallos + 1))
  else
    INV_SEMBRAR=0 bash scripts/invariantes.sh >"$SALIDA" 2>&1; ex=$?
    grep -m1 'población ·' "$SALIDA" | sed 's/^  población ·/   examinado      /'
    if [ "$ex" = "0" ] && grep -q 'I6 SIN POBLACIÓN' "$SALIDA"; then
      echo "   sin VIGENTES     exit $ex  ✔ $(grep -m1 'I6 SIN POBLACIÓN' "$SALIDA" | sed 's/^ *//')"
    else
      echo "   sin VIGENTES     exit $ex  ✘ esperaba exit 0 y /I6 SIN POBLACIÓN/"
      tail -10 "$SALIDA" | sed 's/^/     /'; fallos=$((fallos + 1))
    fi
  fi
fi

echo
if [ "$fallos" -eq 0 ]; then
  echo "S-11 calibración: 21/21 defectos de estado se comportaron como la spec declara"
  echo "  (A1 y A2 se inyectan en el CÓDIGO de la app; medidos a mano)"
else
  echo "S-11 calibración: $fallos de 21 defectos NO se comportaron como la spec dice"
fi
exit "$fallos"
