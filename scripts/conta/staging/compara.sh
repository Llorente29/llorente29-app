#!/usr/bin/env bash
# scripts/conta/staging/compara.sh <manifiesto> <patrón de ficheros> [rama del registro]
#
# W06 (Julio, 26/10) · EN STAGING, LO MISMO QUE EL ENSAYO DE PRODUCCIÓN, Y
# ALGO MÁS. Dos veces seguidas (el #230 y el #241) el ensayo de producción paró
# una tanda que había salido en verde en staging, porque staging no comparaba
# nada antes y después de deshacerla. Esto lo hace con la tanda de la rama
# (supabase/produccion/tandas/<producto>/<rama>/aplicar.txt), todo en UNA
# transacción que acaba en ROLLBACK (staging no cambia):
#
#   1. cuenta antes («cuenta:» del manifiesto) y la foto de las definiciones
#      (foto-definiciones.sql: funciones, índices, columnas, almacenes…);
#   2. aplica la tanda (y la foto otra vez: lo que toca, para que se vea);
#   3. la deshace con sus .down.sql, en orden inverso;
#   4. cuenta y foto después;
#   5. compara: las cuentas con cuentas-comparar.mjs (la misma vara que el
#      ensayo de producción) y las definiciones con definiciones-comparar.mjs.
#
# Si algo no vuelve, PARA, con la tabla de lo que cambia en el REGISTRO DEL JOB
# (no solo en el resumen ni en el artefacto, que desde las sesiones no se
# pueden leer) y en una anotación ::error, que sí se lee desde fuera.
#
# Una tanda SIN VUELTA ATRÁS declarada (W02) no puede volver «como antes»: se
# hace lo mismo que en producción (ensayo-sin-vuelta.sh, contra «esperado:»).
#
# LO QUE YA FUE DE VERDAD A STAGING (W05). Lo que solo añade va de verdad
# desde la rama; en el push siguiente ya está, y «antes» lo tendría: la vuelta
# atrás lo quitaría y saldría distinto sin estar mal. Por eso el paso de W05
# deja escrito en w06_staging qué ficheros fueron de verdad y cómo estaba cada
# definición que tocaron ANTES de ir. Aquí, si la rama tiene alguno: se
# deshacen primero (sus .down.sql), se comprueba que lo que tocaron vuelve a
# como estaba antes de ir de verdad, y desde ahí el ciclo de arriba.
#
# Entorno: PSQL, DB_URL; INFORME (opcional, Markdown); VUELTA_ATRAS_DIR (por
# defecto supabase/vuelta-atras); COMPARA_PREVIO (opcional: un .sql que se pasa
# al empezar la transacción, solo para la prueba de este script).
# Sale con 0 si todo vuelve; con 1 si algo no vuelve o falla.
set -uo pipefail
m="${1:?manifiesto}"; pat="${2:?patrón}"; rama="${3:-}"
VA="${VUELTA_ATRAS_DIR:-supabase/vuelta-atras}"
INFORME="${INFORME:-/dev/null}"
FOTO=scripts/conta/staging/foto-definiciones.sql
CMP=scripts/conta/staging/definiciones-comparar.mjs
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
salida() { tee -a "$INFORME"; }   # lo mismo al registro del job y al informe
# Las anotaciones ::error/::warning, salvo en la prueba del comparador
# (COMPARA_SIN_ANOTAR=1): ahí el rojo de las rotas es lo esperado.
anota() { if [ -n "${COMPARA_SIN_ANOTAR:-}" ]; then echo "(anotación callada en la prueba) $*"; else echo "$@"; fi; }

bash scripts/conta/produccion/manifiesto.sh "$m" "$T/tanda.txt" "$T/cuentas.txt" "$pat" si "$T/sin-vuelta.txt" "$T/esperado.txt" || exit 1
{ echo "## Staging compara como el ensayo de producción: \`$m\`"; echo; } | salida

# W02 · sin vuelta atrás declarada: lo mismo que producción, contra lo esperado.
if [ -s "$T/sin-vuelta.txt" ]; then
  bash scripts/conta/produccion/cuentas.sh "$T/cuentas.txt" "$T/cuentas-antes.csv" || { echo "::error::No se han podido tomar las cuentas de antes."; exit 1; }
  inf="$T/informe-sin-vuelta.md"; : > "$inf"
  INFORME="$inf" bash scripts/conta/produccion/ensayo-sin-vuelta.sh "$T/tanda.txt" "$T/cuentas.txt" "$T/sin-vuelta.txt" "$T/esperado.txt" "$T/cuentas-antes.csv"
  rc=$?
  salida < "$inf"
  exit "$rc"
fi

# Lo que la rama ya tiene de verdad en staging (W05), en el orden de la tanda.
: > "$T/de-verdad.txt"
if [ -n "$rama" ] && [ "$("$PSQL" "$DB_URL" -X -A -t -c "select to_regclass('w06_staging.de_verdad') is not null")" = "t" ]; then
  echo "select fichero from w06_staging.de_verdad where rama = :'rama';" \
    | "$PSQL" "$DB_URL" -X -A -t -v ON_ERROR_STOP=1 -v rama="$rama" > "$T/registrados.txt" || exit 1
  while IFS= read -r f; do grep -qxF "$f" "$T/registrados.txt" && echo "$f"; done < "$T/tanda.txt" > "$T/de-verdad.txt" || true
  echo "select clave, valor from w06_staging.antes_de_verdad where rama = :'rama' order by clave;" \
    | "$PSQL" "$DB_URL" -X -A -t --csv -v ON_ERROR_STOP=1 -v rama="$rama" > "$T/registro.csv" || exit 1
fi

down() { echo "$VA/$(basename "$1" .sql).down.sql"; }
sin=""
while IFS= read -r f; do [ -f "$(down "$f")" ] || sin="$sin $f"; done < "$T/tanda.txt"

{
  echo '\set ON_ERROR_STOP 1'
  echo 'begin;'
  [ -n "${COMPARA_PREVIO:-}" ] && { echo "\\echo '>>> previo $COMPARA_PREVIO'"; echo "\\i $COMPARA_PREVIO"; }
  echo '\pset format csv'
  echo '\pset tuples_only on'
  if [ -s "$T/de-verdad.txt" ]; then
    tac "$T/de-verdad.txt" | while IFS= read -r f; do
      d="$(down "$f")"; [ -f "$d" ] || continue
      echo "\\echo '>>> deshace lo que ya fue de verdad: $f'"; echo "\\i $d"
    done
    echo "\\o $T/foto-registro.csv"; echo "\\i $FOTO"; echo '\o'
  fi
  echo "\\echo '>>> antes: cuentas y definiciones'"
  j=0; while IFS= read -r c; do j=$((j+1)); echo "\\o $T/cuenta-antes-$j.csv"; echo "\\i $c"; done < "$T/cuentas.txt"
  echo "\\o $T/foto-antes.csv"; echo "\\i $FOTO"; echo '\o'
  while IFS= read -r f; do echo "\\echo '>>> aplica $f'"; echo "\\i $f"; done < "$T/tanda.txt"
  echo "\\o $T/foto-con.csv"; echo "\\i $FOTO"; echo '\o'
  tac "$T/tanda.txt" | while IFS= read -r f; do
    d="$(down "$f")"
    if [ -f "$d" ]; then echo "\\echo '>>> deshace $f'"; echo "\\i $d"; else echo "\\echo '>>> SIN VUELTA ATRÁS: $f'"; fi
  done
  echo "\\echo '>>> después: cuentas y definiciones'"
  j=0; while IFS= read -r c; do j=$((j+1)); echo "\\o $T/cuenta-despues-$j.csv"; echo "\\i $c"; done < "$T/cuentas.txt"
  echo "\\o $T/foto-despues.csv"; echo "\\i $FOTO"; echo '\o'
  echo 'rollback;'
  echo "\\echo '>>> ROLLBACK: staging no cambia.'"
} > "$T/compara.sql"

"$PSQL" "$DB_URL" -X -v VERBOSITY=sqlstate -f "$T/compara.sql" > "$T/compara.log" 2>&1
rc=$?
grep -E '^>>>' "$T/compara.log"
if [ "$rc" -ne 0 ]; then
  ult=$(grep '^>>>' "$T/compara.log" | tail -1)
  { echo "**FALLA** en \`$ult\` (ROLLBACK: staging no cambia):"; echo; echo '```'; grep -E 'ERROR|psql:' "$T/compara.log" | head -12; echo '```'; echo
    [ -s "$T/de-verdad.txt" ] && echo "Antes se deshizo lo que ya fue de verdad desde la rama ($(paste -sd' ' "$T/de-verdad.txt")): si la tanda no entra encima, lo más probable es que su vuelta atrás no lo quite todo."
    echo; } | salida
  anota "::error title=Staging compara::Falla en «$ult»: $(grep -E 'ERROR' "$T/compara.log" | head -2 | tr '\n' ' ' | cut -c1-600)"
  exit 1
fi

pegar() { : > "$2"; local j=0 c; while IFS= read -r c; do j=$((j+1)); sed "s#^#$(basename "$c" .sql),#" "$T/$1-$j.csv" >> "$2"; done < "$T/cuentas.txt"; }
pegar cuenta-antes "$T/cuentas-antes.csv"
pegar cuenta-despues "$T/cuentas-despues.csv"

mal=0
if [ -s "$T/de-verdad.txt" ]; then
  { echo "### Lo que ya fue de verdad a staging (W05), deshecho primero"; echo; sed 's/^/- `/; s/$/`/' "$T/de-verdad.txt"; echo; } | salida
  node "$CMP" registro "$T/foto-registro.csv" "$T/registro.csv" > "$T/registro.md" || mal=1
  salida < "$T/registro.md"; echo | salida
fi

{ echo "### Lo que toca la tanda (antes ↔ con la tanda; aquí cambiar es lo esperado)"; echo; } | salida
node "$CMP" toca "$T/foto-antes.csv" "$T/foto-con.csv" | salida
echo | salida

node scripts/conta/produccion/cuentas-comparar.mjs "$T/cuentas-antes.csv" "$T/cuentas-despues.csv" "Antes de la tanda" "Tanda y vuelta atrás" > "$T/cuentas.md"; rc_c=$?
node "$CMP" "$T/foto-antes.csv" "$T/foto-despues.csv" "Antes de la tanda" "Tanda y vuelta atrás" > "$T/definiciones.md"; rc_d=$?
{ echo "### Lo que la tanda declara que cuenta (antes ↔ tanda y vuelta atrás)"; echo; cat "$T/cuentas.md"; echo
  echo "### Las definiciones (antes ↔ tanda y vuelta atrás)"; echo; cat "$T/definiciones.md"; echo; } | salida
[ "$rc_c" -eq 0 ] || mal=1
[ "$rc_d" -eq 0 ] || mal=1

if [ -n "$sin" ]; then
  echo "- **Sin \`.down.sql\`:**$sin. En producción, el ensayo lo avisa y la vuelta atrás automática no estaría completa." | salida
  anota "::warning title=Staging compara::Sin vuelta atrás:$sin"
fi

if [ "$mal" -ne 0 ]; then
  echo "## **La vuelta atrás NO deja todo como estaba**: el ensayo de producción pararía igual." | salida
  # Las anotaciones se leen desde fuera aunque el registro no se pueda descargar.
  r=$( { tail -1 "$T/cuentas.md" | grep -F '**' ; tail -1 "$T/definiciones.md" | grep -F '**'; [ -f "$T/registro.md" ] && tail -1 "$T/registro.md" | grep -F '**'; } | tr '\n' ' ')
  dif=$(grep -hE '^\| [^Q-]' "$T/definiciones.md" "$T/cuentas.md" "$T/registro.md" 2>/dev/null | grep -E 'no estaba antes|ya no está|distinta|faltan|sobran|no se midió' | head -12 | sed -E 's/^\| ([^|]*) \|.*\| ([^|]*) \|$/\1: \2/' | tr '\n' ';' | cut -c1-900)
  anota "::error title=Staging compara::La vuelta atrás no deja todo como estaba. ${r}— ${dif}"
  exit 1
fi
echo "## La vuelta atrás deja todo como estaba: cuentas y definiciones, iguales." | salida
exit 0
