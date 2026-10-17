#!/usr/bin/env bash
# scripts/conta/produccion/ensayo-sin-vuelta.sh <tanda.txt> <cuentas.txt> <sin-vuelta.txt> <esperado.txt> <cuentas-antes.csv>
#
# W02 (Julio, 17/10) · El ensayo de la vuelta atrás de una tanda SIN VUELTA
# ATRÁS declarada (manifiesto.sh). Lo llama el paso «ENSAYO · la vuelta atrás
# automática funcionaría» de aplicar-produccion-conta.yml SOLO cuando el
# manifiesto la declara; para cualquier otra tanda ese paso sigue como estaba.
#
# No hay con qué deshacerla, así que no se compara «como antes». Se compara lo
# que hay después de la tanda con lo que el manifiesto dice que habrá
# («esperado:»), medida a medida (cuentas-esperadas.mjs): la tanda tiene que
# hacer exactamente lo que declara, ni más ni menos. Todo en una transacción
# que acaba en ROLLBACK: producción no cambia.
#
# Entorno: PSQL, DB_URL, INFORME. Sale con 0 si entra sin error y todo sale
# como se espera; con 1 si falla o algo no sale como se espera.
set -uo pipefail
tanda="${1:?tanda.txt}"; cuentas="${2:?cuentas.txt}"; sinvuelta="${3:?sin-vuelta.txt}"; esperado="${4:?esperado.txt}"; antes="${5:?cuentas-antes.csv}"
dir="$(mktemp -d)"; trap 'rm -rf "$dir"' EXIT
{
  echo '\set ON_ERROR_STOP 1'
  echo 'begin;'
  while IFS= read -r f; do echo "\\echo '>>> aplica $f'"; echo "\\i $f"; done < "$tanda"
  echo "\\echo '>>> SIN VUELTA ATRÁS, declarada: se cuenta lo que queda y se compara con lo esperado'"
  echo '\pset format csv'
  echo '\pset tuples_only on'
  j=0; while IFS= read -r c; do j=$((j+1)); echo "\\o $dir/cuenta-$j.csv"; echo "\\i $c"; done < "$cuentas"
  echo '\o'
  echo 'rollback;'
} > "$dir/ensayo.sql"
"$PSQL" "$DB_URL" -X -v VERBOSITY=sqlstate -f "$dir/ensayo.sql" > "$dir/ensayo.log" 2>&1
rc=$?
{ echo "## Ensayo de la vuelta atrás: **SIN VUELTA ATRÁS, declarada**"; echo
  while IFS=$'\t' read -r f motivo; do echo "- \`$f\` — **sin vuelta atrás**, a propósito: $motivo"; done < "$sinvuelta"
  echo "- Autorizado a mano en «autorizo» por **${GITHUB_ACTOR:-?}**, desde \`${GITHUB_REF_NAME:-?}\`."
  echo "- En vez de «como antes», se comprueba que la tanda deja exactamente lo esperado (en una transacción, y ROLLBACK)."; echo; } >> "$INFORME"
if [ "$rc" -ne 0 ]; then
  { echo "**La tanda falla dentro del ensayo**, en \`$(grep '^>>>' "$dir/ensayo.log" | tail -1)\`:"; echo; echo '```'; grep -E 'ERROR' "$dir/ensayo.log" | head -10; echo '```'; echo; } >> "$INFORME"
  echo "::error::La tanda sin vuelta atrás falla dentro del ensayo (ver el informe). Así no se lanza el real."
  exit 1
fi
: > "$dir/despues.csv"; j=0
while IFS= read -r c; do j=$((j+1)); sed "s#^#$(basename "$c" .sql),#" "$dir/cuenta-$j.csv" >> "$dir/despues.csv"; done < "$cuentas"
if node scripts/conta/produccion/cuentas-esperadas.mjs "$antes" "$dir/despues.csv" "$esperado" >> "$INFORME"; then
  { echo; echo "**Hace exactamente lo que declara.**"; echo; } >> "$INFORME"
  exit 0
fi
{ echo; echo "**NO hace lo que declara** (arriba, medida a medida). El ensayo para: así no se lanza el real."; echo; } >> "$INFORME"
echo "::error::La tanda sin vuelta atrás no deja lo esperado (ver el informe). Así no se lanza el real."
exit 1
