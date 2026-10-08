#!/usr/bin/env bash
# scripts/conta/produccion/deshacer.sh <aplicados.txt>
#
# W01 · La vuelta atrás AUTOMÁTICA: si la comprobación de después del real
# falla, aplica los .down.sql de lo que este run ha aplicado, en ORDEN INVERSO,
# cada uno en su transacción junto con la baja de su registro en el historial.
# Para en el primero que falte o falle: deshacer uno anterior con uno posterior
# todavía puesto puede romper más de lo que arregla. Lo que queda a medias va
# al informe, fila a fila.
#
# Entorno: PSQL, DB_URL, INFORME y, si los .down.sql no están en
# supabase/vuelta-atras, VUELTA_ATRAS_DIR (el ensayo de staging, C04 R4).
# Sale con 0 si lo ha deshecho todo.
set -uo pipefail
lista="${1:?falta la lista de aplicados}"
mapfile -t ap < <(grep -v '^\s*$' "$lista")
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
{ echo "## Vuelta atrás automática"; echo; echo '| # | Deshace | Resultado |'; echo '|---|---|---|'; } >> "$INFORME"
fallo=0
for ((i=${#ap[@]}-1; i>=0; i--)); do
  f="${ap[$i]}"
  down="${VUELTA_ATRAS_DIR:-supabase/vuelta-atras}/$(basename "$f" .sql).down.sql"
  if [ "$fallo" -ne 0 ]; then echo "| $((i+1)) | \`$f\` | **queda aplicado** (la vuelta atrás paró antes) |" >> "$INFORME"; continue; fi
  if [ ! -f "$down" ]; then
    echo "| $((i+1)) | \`$f\` | **sin vuelta atrás: queda aplicado** |" >> "$INFORME"
    echo "::error::$f no tiene $down: queda aplicado, y lo anterior también."
    fallo=1; continue
  fi
  node scripts/conta/produccion/analizar.mjs baja "$down" > "$tmp"
  if "$PSQL" "$DB_URL" -X -v ON_ERROR_STOP=1 -1 -f "$down" -f "$tmp"; then
    echo "| $((i+1)) | \`$f\` | deshecho con \`$down\` |" >> "$INFORME"
  else
    echo "| $((i+1)) | \`$f\` | **la vuelta atrás FALLA: queda aplicado** |" >> "$INFORME"
    echo "::error::Falla $down: $f queda aplicado, y lo anterior también."
    fallo=1
  fi
done
echo >> "$INFORME"
exit "$fallo"
