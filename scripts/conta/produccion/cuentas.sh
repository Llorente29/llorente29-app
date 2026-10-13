#!/usr/bin/env bash
# scripts/conta/produccion/cuentas.sh <cuentas.txt> <salida.csv>
#
# R9 · Toma las cuentas que declara la tanda (manifiesto.sh), SOLO LEYENDO, y
# las escribe en una línea por medida: «<fichero>,<clave>,<valor>». La misma
# vara a los dos lados (regla 31): el mismo fichero, tomado igual, antes de la
# tanda y después de deshacerla. Entorno: PSQL, DB_URL.
set -euo pipefail
lista="${1:?cuentas.txt}"; salida="${2:?salida.csv}"
: > "$salida"
while IFS= read -r c; do
  [ -n "$c" ] || continue
  PGOPTIONS="${PGOPTIONS:-} -c default_transaction_read_only=on" "$PSQL" "$DB_URL" -X -A -t --csv -v ON_ERROR_STOP=1 -f "$c" | sed "s#^#$(basename "$c" .sql),#" >> "$salida"
done < "$lista"
