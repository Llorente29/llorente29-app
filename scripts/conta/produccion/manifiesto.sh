#!/usr/bin/env bash
# scripts/conta/produccion/manifiesto.sh <manifiesto> <tanda.txt> <cuentas.txt> <patrón de ficheros> [cuentas obligatorias: si|no]
#
# R9 (Julio, 13/10) · Lee un manifiesto de tanda. Cada línea que no es
# comentario es un fichero de la tanda, en orden, salvo las que empiezan por
# «cuenta:», que DECLARAN qué se cuenta antes y después de la tanda:
#
#   cuenta: scripts/conta/produccion/cuentas/ventas-del-dia.sql
#
# Lo declarado lo toma el workflow antes de la tanda y, si la comprobación de
# después falla y se deshace sola, deshacer.sh lo vuelve a tomar y lo compara:
# «producción está como antes» solo sale si coincide. El ensayo de la vuelta
# atrás también lo compara, dentro de su transacción.
#
# Para (sale con 1) si una ruta no es del patrón o no existe, si una cuenta no
# es de scripts/conta/produccion/cuentas/, o si la tanda no declara ninguna y
# son obligatorias (la tanda de aplicar: «para todas las tandas»).
set -euo pipefail
m="${1:?manifiesto}"; tanda="${2:?tanda.txt}"; cuentas="${3:?cuentas.txt}"; pat="${4:?patrón}"; oblig="${5:-si}"
grep -vE '^\s*(#|$)' "$m" | sed -E 's/\s+$//' > "$tanda.todo" || true
grep -E '^cuenta:' "$tanda.todo" | sed -E 's/^cuenta:\s*//' > "$cuentas" || true
grep -vE '^cuenta:' "$tanda.todo" > "$tanda" || true
rm -f "$tanda.todo"
mal=0
[ -s "$tanda" ] || { echo "::error::El manifiesto $m no lista ningún fichero."; exit 1; }
while IFS= read -r f; do
  if ! printf '%s' "$f" | grep -qE "$pat" || printf '%s' "$f" | grep -q '\.\.'; then echo "::error::Ruta no permitida: $f"; mal=1; continue; fi
  [ -f "$f" ] || { echo "::error::No existe: $f"; mal=1; }
done < "$tanda"
while IFS= read -r c; do
  if ! printf '%s' "$c" | grep -qE '^scripts/conta/produccion/cuentas/[A-Za-z0-9_-]+\.sql$'; then echo "::error::Cuenta no permitida (va en scripts/conta/produccion/cuentas/): $c"; mal=1; continue; fi
  [ -f "$c" ] || { echo "::error::No existe la cuenta: $c"; mal=1; }
done < "$cuentas"
if [ "$oblig" = "si" ] && [ ! -s "$cuentas" ]; then
  echo "::error::El manifiesto $m no declara qué cuenta antes y después («cuenta: scripts/conta/produccion/cuentas/<f>.sql»). Sin eso, una vuelta atrás no puede decir que todo está como antes."
  mal=1
fi
[ "$mal" -eq 0 ] || exit 1
echo "Tanda ($m), $(wc -l < "$tanda") ficheros:"; nl -ba "$tanda"
if [ -s "$cuentas" ]; then echo "Cuenta antes y después:"; sed 's/^/  - /' "$cuentas"; fi
