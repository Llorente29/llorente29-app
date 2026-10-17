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
# R9 (Julio, 13/10) · Y DESPUÉS CUENTA. Deshacer sin error no es estar como
# antes: el 13/10 los seis .down.sql salieron bien y los 24 asientos de ventas
# retirados no volvieron (lo hizo el cierre de las 08:07, una hora después).
# Con CUENTAS (lo que la tanda declara en su manifiesto, manifiesto.sh) y
# CUENTAS_ANTES (tomado antes de la tanda, cuentas.sh), vuelve a tomarlo con la
# misma vara y lo compara (cuentas-comparar.mjs). Sin CUENTAS_ANTES, no puede
# decir que está como antes, y no lo dice.
#
# Entorno: PSQL, DB_URL, INFORME, CUENTAS y CUENTAS_ANTES, SIN_VUELTA (lo
# declarado sin vuelta atrás, «ruta<TAB>motivo»: solo cambia el mensaje) y, si los .down.sql
# no están en supabase/vuelta-atras, VUELTA_ATRAS_DIR (el ensayo de staging,
# C04 R4). Sale con:
#   0  deshecho todo Y las cuentas iguales que antes de la tanda;
#   1  algún .down.sql falta o falla: queda aplicado a medias;
#   3  deshecho todo, pero las cuentas NO salen iguales (o no se han podido
#      tomar): no está como antes, y el informe dice cuánto falta.
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
    # W02: si el manifiesto lo declaró sin vuelta atrás, se dice así, con su motivo.
    motivo="$( [ -s "${SIN_VUELTA:-/nonexistent}" ] && awk -F'\t' -v f="$f" '$1 == f { print $2 }' "$SIN_VUELTA" || true)"
    if [ -n "$motivo" ]; then
      echo "| $((i+1)) | \`$f\` | **sin vuelta atrás declarada: queda aplicado** ($motivo) |" >> "$INFORME"
      echo "::error::$f va sin vuelta atrás, declarada ($motivo): queda aplicado, y lo anterior también."
    else
      echo "| $((i+1)) | \`$f\` | **sin vuelta atrás: queda aplicado** |" >> "$INFORME"
      echo "::error::$f no tiene $down: queda aplicado, y lo anterior también."
    fi
    fallo=1; continue
  fi
  node scripts/conta/produccion/analizar.mjs baja "$down" > "$tmp"
  # D01 R2: de un error, solo fichero, línea y código (sin DETAIL: el registro es público).
  if "$PSQL" "$DB_URL" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -1 -f "$down" -f "$tmp"; then
    echo "| $((i+1)) | \`$f\` | deshecho con \`$down\` |" >> "$INFORME"
  else
    echo "| $((i+1)) | \`$f\` | **la vuelta atrás FALLA: queda aplicado** |" >> "$INFORME"
    echo "::error::Falla $down: $f queda aplicado, y lo anterior también."
    fallo=1
  fi
done
echo >> "$INFORME"
[ "$fallo" -eq 0 ] || exit 1

# Después de deshacer, contar con la misma vara que antes de la tanda.
{ echo "### ¿Está como antes de la tanda?"; echo; } >> "$INFORME"
if [ -z "${CUENTAS:-}" ] || [ ! -s "${CUENTAS:-/nonexistent}" ] || [ ! -s "${CUENTAS_ANTES:-/nonexistent}" ]; then
  echo "**No se puede decir**: la tanda no declara qué cuenta, o no se tomó antes de aplicarla." >> "$INFORME"; echo >> "$INFORME"
  exit 3
fi
despues="$(mktemp)"
if ! bash scripts/conta/produccion/cuentas.sh "$CUENTAS" "$despues" 2>"$tmp"; then
  echo "**No se han podido tomar las cuentas después de deshacer** ($(head -1 "$tmp")): no se puede decir que está como antes." >> "$INFORME"; echo >> "$INFORME"
  exit 3
fi
cp "$despues" "${CUENTAS_DESPUES:-/tmp/cuentas-tras-deshacer.csv}" 2>/dev/null || true
if node scripts/conta/produccion/cuentas-comparar.mjs "$CUENTAS_ANTES" "$despues" "Antes de la tanda" "Tras deshacer" >> "$INFORME"; then
  echo >> "$INFORME"; echo "**Sí: las cuentas salen iguales que antes de la tanda.**" >> "$INFORME"; echo >> "$INFORME"
  exit 0
fi
echo >> "$INFORME"; echo "**NO: deshecho sin error, pero las cuentas no salen iguales** (arriba, cuánto falta)." >> "$INFORME"; echo >> "$INFORME"
exit 3
