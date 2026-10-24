#!/usr/bin/env bash
# scripts/conta/produccion/manifiesto.sh <manifiesto> <tanda.txt> <cuentas.txt> <patrón de ficheros> [cuentas obligatorias: si|no] [sin-vuelta.txt] [esperado.txt]
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
# W02 (Julio, 17/10) · UNA TANDA SIN VUELTA ATRÁS, A PROPÓSITO. Hay tandas que
# no pueden volver a como estaban (la 0200 borra el secreto de antes: no hay a
# qué volver). Se declaran, y entonces el ensayo no compara «como antes» sino
# «lo que se espera después», línea a línea:
#
#   sin-vuelta-atras: supabase/migrations/<f>.sql · motivo: <por qué>
#   esperado: <cuenta> · <clave> = <valor>        (o «= como antes»)
#
# <cuenta> es el nombre del fichero de cuenta sin carpeta ni «.sql» y <clave>,
# la clave que saca (las mismas que imprime cuentas-comparar.mjs). Cada medida
# de las cuentas declaradas tiene que tener su «esperado:» (lo comprueba
# cuentas-esperadas.mjs al comparar: una medida sin esperado PARA).
# Cerrojos, todos aquí: la ruta está en la tanda; lleva motivo; NO tiene
# .down.sql (decir «sin vuelta atrás» y tenerla es contradecirse); va SOLA en
# su tanda; hay al menos un «esperado:»; solo en la tanda de aplicar. Un
# «esperado:» sin «sin-vuelta-atras:» también para. Y el workflow le exige
# «autorizo» siempre, diga lo que diga el analizador.
#
# Para (sale con 1) si una ruta no es del patrón o no existe, si una cuenta no
# es de scripts/conta/produccion/cuentas/, o si la tanda no declara ninguna y
# son obligatorias (la tanda de aplicar: «para todas las tandas»).
set -euo pipefail
m="${1:?manifiesto}"; tanda="${2:?tanda.txt}"; cuentas="${3:?cuentas.txt}"; pat="${4:?patrón}"; oblig="${5:-si}"
sinvuelta="${6:-$tanda.sin-vuelta}"; esperado="${7:-$tanda.esperado}"
DIRECTIVA='^(cuenta|sin-vuelta-atras|esperado):'
grep -vE '^\s*(#|$)' "$m" | sed -E 's/\s+$//' > "$tanda.todo" || true
grep -E '^cuenta:' "$tanda.todo" | sed -E 's/^cuenta:\s*//' > "$cuentas" || true
grep -E '^sin-vuelta-atras:' "$tanda.todo" | sed -E 's/^sin-vuelta-atras:\s*//' > "$sinvuelta.crudo" || true
grep -E '^esperado:' "$tanda.todo" | sed -E 's/^esperado:\s*//' > "$esperado" || true
grep -vE "$DIRECTIVA" "$tanda.todo" > "$tanda" || true
rm -f "$tanda.todo"
mal=0
[ -s "$tanda" ] || { echo "::error::El manifiesto $m no lista ningún fichero."; rm -f "$sinvuelta.crudo"; exit 1; }
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

# W02 · sin vuelta atrás, declarada: «<ruta>\t<motivo>» en $sinvuelta.
: > "$sinvuelta"
if [ -s "$sinvuelta.crudo" ]; then
  if [ "$oblig" != "si" ]; then echo "::error::«sin-vuelta-atras:» solo vale en la tanda de aplicar, no en $m."; mal=1; fi
  if [ "$(wc -l < "$sinvuelta.crudo")" -ne 1 ]; then echo "::error::Más de un «sin-vuelta-atras:» en $m: una tanda sin vuelta atrás va sola."; mal=1; fi
  if [ "$(wc -l < "$tanda")" -ne 1 ]; then echo "::error::La tanda de $m declara «sin-vuelta-atras:» y lleva $(wc -l < "$tanda") ficheros: una tanda sin vuelta atrás va SOLA."; mal=1; fi
  while IFS= read -r l; do
    ruta="$(printf '%s' "$l" | sed -E 's/\s*·\s*motivo:.*$//')"
    motivo="$(printf '%s' "$l" | sed -nE 's/^.*·\s*motivo:\s*(.*)$/\1/p')"
    [ -n "$(printf '%s' "$motivo" | tr -d '[:space:]')" ] || { echo "::error::«sin-vuelta-atras: $ruta» sin motivo («· motivo: <por qué>»)."; mal=1; }
    grep -qxF "$ruta" "$tanda" || { echo "::error::«sin-vuelta-atras: $ruta»: ese fichero no está en la tanda."; mal=1; }
    down="supabase/vuelta-atras/$(basename "$ruta" .sql).down.sql"
    [ ! -f "$down" ] || { echo "::error::«sin-vuelta-atras: $ruta», pero existe $down: o tiene vuelta atrás o no la tiene."; mal=1; }
    printf '%s\t%s\n' "$ruta" "$motivo" >> "$sinvuelta"
  done < "$sinvuelta.crudo"
  [ -s "$esperado" ] || { echo "::error::$m declara «sin-vuelta-atras:» sin ningún «esperado:»: sin lo esperado, el ensayo no puede comprobar que la tanda hace lo que dice."; mal=1; }
elif [ -s "$esperado" ]; then
  echo "::error::$m lleva «esperado:» sin «sin-vuelta-atras:»: lo esperado solo sustituye al «como antes» en una tanda sin vuelta atrás declarada."; mal=1
fi
rm -f "$sinvuelta.crudo"
# Cada «esperado:», con su forma y de una cuenta declarada.
while IFS= read -r e; do
  if ! printf '%s' "$e" | grep -qE '^[A-Za-z0-9_-]+ · .+ = .+$'; then echo "::error::«esperado: $e»: va «<cuenta> · <clave> = <valor>» (o «= como antes»)."; mal=1; continue; fi
  cta="${e%% · *}"
  grep -qxF "scripts/conta/produccion/cuentas/$cta.sql" "$cuentas" || { echo "::error::«esperado: $e»: la cuenta $cta no está declarada con «cuenta:»."; mal=1; }
done < "$esperado"

[ "$mal" -eq 0 ] || exit 1
echo "Tanda ($m), $(wc -l < "$tanda") ficheros:"; nl -ba "$tanda"
if [ -s "$cuentas" ]; then echo "Cuenta antes y después:"; sed 's/^/  - /' "$cuentas"; fi
if [ -s "$sinvuelta" ]; then
  echo "SIN VUELTA ATRÁS, declarada:"; sed -E 's/\t/ · motivo: /; s/^/  - /' "$sinvuelta"
  echo "Lo esperado después de la tanda:"; sed 's/^/  - /' "$esperado"
fi
