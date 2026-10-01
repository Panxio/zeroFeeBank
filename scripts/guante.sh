#!/usr/bin/env bash
# El guante de restricciones de zeroFeeBank — las compuertas DURAS del perfil que se
# comprueban por ausencia, en un solo comando. Ver especificación § Guante de restricciones.
#
# ARNES.md: un check por ausencia VERSIONA SU LISTA DE TÉRMINOS junto al resultado. Por eso
# cada compuerta imprime los términos que buscó: un guante que estrecha su lista en silencio
# se pone verde sin que nadie se entere.
#
# Lo que este script NO cubre, y a nombre de quién queda (no es un fallo tolerado: es una
# compuerta cuyo árbitro todavía no existe, y se nombra):
#   · D4 bloqueo bajo concurrencia   -> test de concurrencia de S-05 (meta M2)
#   · D5 idempotencia                -> test de S-06 (meta M3)
#   · I1–I5 invariantes del ledger   -> `npm run invariantes` (S-11, meta M1) — YA EXISTE
#   · append-only del ledger EN LA BD -> npm run verify:s04 (no se duplica acá)
set -uo pipefail
cd "$(dirname "$0")/.."
fallos=0

# compuerta <etiqueta> <ruta> <regex-egrep>
compuerta() {
  local etiqueta="$1" ruta="$2" patron="$3" n
  n=$(grep -rnE "$patron" "$ruta" 2>/dev/null | grep -v '\.spec\.ts:' | wc -l)
  if [ "$n" -eq 0 ]; then
    printf '  %-44s OK   0 coincidencias\n' "$etiqueta"
  else
    printf '  %-44s FALLA %s coincidencia(s):\n' "$etiqueta" "$n"
    grep -rnE "$patron" "$ruta" 2>/dev/null | grep -v '\.spec\.ts:' | sed 's/^/      /'
    fallos=$((fallos + 1))
  fi
  printf '  %-44s      términos: %s\n' "" "$patron"
}

echo "Guante de restricciones · $(date +%F)"
echo

# G1 · regla de dependencia: el dominio no conoce el framework ni la base (perfil, D-estructura)
compuerta "G1 dominio sin framework ni BD" src/domain/ "from '(@nestjs/|@prisma/|express|pg)"

# G2 · determinismo del dominio (C2 del perfil SUT): el reloj y el azar se inyectan
# `new Date(<algo>)` se permite, como en G6 (derivar un instante de otro es
# aritmética; S-22 § 5 lo necesita en `diaUtcDe`). Se prohíbe el vacío, y `Reflect.construct(Date`
# en toda forma: `Reflect.construct(Date, [])` lee el
# reloj sin que `new Date(` lo vea. Calibrado con ocho sondas.
compuerta "G2 dominio sin reloj ni azar" src/domain/ "(Date\.now\(|new Date\(\s*\)|Math\.random\(|Reflect\.construct\(\s*Date)"

# G3 · D1: el dinero nunca es coma flotante ni number
compuerta "G3 dinero sin coma flotante" src/ "(parseFloat|toFixed|Number\((monto|centavos)|(monto|centavos)[A-Za-z]*\s*:\s*number)"

# G4 · D3 en el código: nadie escribe una mutación del ledger, ni siquiera para intentarlo
compuerta "G4 ledger append-only en el código" src/ "movimiento\.(update|delete|updateMany|deleteMany)"

# G6 · C2 del perfil SUT fuera del dominio: los MÓDULOS que dependen del tiempo no le
# preguntan la hora al sistema. `RelojService` existe desde S-07 justamente para eso, y sin
# él probar un vencimiento exige esperar treinta días o mentirle a la base.
# Acotado a src/modules/boletas/ a propósito: es la única unidad cuyo comportamiento depende
# del reloj (S-09, V6). El día que otra lo haga, se agrega su ruta acá, no se generaliza a
# src/ — auth firma tokens contra el reloj de pared a propósito, y esa decisión está escrita.
# `new Date(<algo>)` NO se prohíbe: derivar un instante de otro recibido es aritmética, no
# leer el reloj. Lo que se prohíbe es `new Date()` sin argumentos y `Date.now()`.
compuerta "G6 boletas sin reloj de pared" src/modules/boletas/ "(Date\.now\(|new Date\(\))"

# G5 · D1 en el esquema: toda columna monetaria del SQL entregado es BIGINT.
# Se comprueba el tipo DE CADA columna monetaria, no la ausencia de una lista de tipos malos:
# una lista de prohibidos siempre se queda corta, y además el nombre va entre comillas en el
# SQL que genera Prisma, lo que ya dejó pasar un DOUBLE PRECISION en la calibración (2026-09-07).
# Número de columnas monetarias que HOY existen. Versionado a mano y a propósito: sin él,
# renombrar una columna la saca del patrón y el guante baja de 3 a 2 y sigue verde — un check
# por ausencia no sabe cuántas cosas debería estar viendo (calibración 2026-09-07).
# Se sube esta cifra en el mismo commit que añade una columna monetaria.
COLS_MONETARIAS_ESPERADAS=3
cols=$(grep -rhoE '"[a-z_]*(monto|centavos|saldo|limite)[a-z_]*" +[A-Z][A-Z ]*' prisma/migrations/*/migration.sql)
total=$(echo "$cols" | grep -c . )
malas=$(echo "$cols" | grep -vc 'BIGINT')
if [ "$total" -ge "$COLS_MONETARIAS_ESPERADAS" ] && [ "$malas" -eq 0 ]; then
  printf '  %-44s OK   %s columna(s) monetaria(s) (>= %s), todas BIGINT\n' "G5 columnas monetarias en BIGINT" "$total" "$COLS_MONETARIAS_ESPERADAS"
elif [ "$total" -lt "$COLS_MONETARIAS_ESPERADAS" ]; then
  printf '  %-44s FALLA ve %s columna(s) monetaria(s) y esperaba al menos %s: o se borró una, o el patrón dejó de verla\n' "G5 columnas monetarias en BIGINT" "$total" "$COLS_MONETARIAS_ESPERADAS"
  fallos=$((fallos + 1))
else
  printf '  %-44s FALLA %s de %s columna(s) no son BIGINT:\n' "G5 columnas monetarias en BIGINT" "$malas" "$total"
  echo "$cols" | grep -v 'BIGINT' | sed 's/^/      /'
  fallos=$((fallos + 1))
fi
printf '  %-44s      términos: monto|centavos|saldo|limite -> deben ser BIGINT\n' ""

echo
echo "  Sin cubrir por este guante (su árbitro se nombra, no se da por bueno):"
echo "    D4 concurrencia -> S-05/M2 · D5 idempotencia -> S-06/M3 · I1–I5 -> npm run invariantes (S-11/M1)"
echo "    append-only en la BD -> npm run verify:s04"
echo
if [ "$fallos" -eq 0 ]; then echo "Guante: 6/6 compuertas OK"; else echo "Guante: $fallos compuerta(s) en rojo"; fi
exit "$fallos"
