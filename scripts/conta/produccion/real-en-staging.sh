#!/usr/bin/env bash
# scripts/conta/produccion/real-en-staging.sh <real-con-fallo|real>
#
# R9 (Julio, 13/10) · El REAL de producción, en staging-conta, con las mismas
# piezas que el workflow de producción: manifiesto.sh (la tanda y lo que
# cuenta), cuentas.sh, el registro en el historial en la misma transacción que
# cada fichero (analizar.mjs registro), deshacer.sh y cuentas-comparar.mjs.
#
#   0. Preparar: si staging tiene la tanda puesta (run 144), se deshace con la
#      vuelta atrás de producción (supabase/produccion/vuelta-atras.txt), y
#      supabase/staging/sql/20261020_r9_preparar.sql deja a la empresa A con
#      días propuestos enteros, como estaba Foodint el 13/10.
#   1. Antes: lo que la tanda declara que cuenta, D1 y el recuento de serie.
#   2. Aplicar fichero a fichero, cada uno con su registro, parando al primer
#      fallo (si uno falla, se deshace lo aplicado y sale en rojo).
#   3. real-con-fallo: la comprobación de después, FORZADA en rojo; deshacer.sh
#      lo quita en orden inverso y vuelve a contar; D1 y recuento, como el paso
#      «Después de la vuelta atrás» de producción. En verde solo si deshacer.sh
#      sale con 0 (deshecho Y contado igual), y D1 y el recuento son los de antes.
#      real: lo que cuenta, antes ↔ con la tanda, y D1. En verde si todo entra.
#
# No espera al minuto: si arranca entre los :04 y los :11, espera a los :12
# para que el cierre del día (a los :07) no cambie lo que se cuenta.
# Entorno: PSQL, DB_URL, INFORME. Sale con 0 si el modo sale como debe.
set -uo pipefail
modo="${1:?real-con-fallo o real}"
case "$modo" in real-con-fallo|real) ;; *) echo "::error::Modo desconocido: $modo"; exit 1 ;; esac
M=supabase/staging/tanda-de-produccion.txt
PAT='^supabase/(migrations|staging/sql)/[A-Za-z0-9_./-]+\.sql$'
T=/tmp/rs; rm -rf "$T"; mkdir -p "$T"
export CUENTAS="$T/cuentas.txt" CUENTAS_ANTES="$T/cuentas-antes.csv" CUENTAS_DESPUES="$T/cuentas-tras-deshacer.csv"
# Las vueltas atrás de producción y la de la 0125 de staging, en una carpeta: deshacer.sh busca ahí.
export VUELTA_ATRAS_DIR="$T/vuelta-atras"; rm -rf "$VUELTA_ATRAS_DIR"; mkdir -p "$VUELTA_ATRAS_DIR"
cp supabase/vuelta-atras/*.down.sql supabase/staging/vuelta-atras/*.down.sql "$VUELTA_ATRAS_DIR/"
q() { "$PSQL" "$DB_URL" -X -A -t -v ON_ERROR_STOP=1 "$@"; }
# El informe va al resumen del paso, que no siempre se puede leer de fuera: también al registro.
inicio=$(wc -l < "$INFORME" 2>/dev/null || echo 0)
trap 'echo "──── informe ────"; tail -n +$((inicio+1)) "$INFORME"' EXIT

# Guarda: al otro lado NO hay producción (ni Foodint ni Folvy Interno), antes de tocar nada.
if [ "$(q -c "select count(*) from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')")" != "0" ]; then
  echo "::error::La base tiene cuentas de producción: esto es solo para staging. No se toca nada."; exit 1
fi
{ echo "## La tanda de producción en staging · modo **$modo**"; echo; } >> "$INFORME"
bash scripts/conta/produccion/manifiesto.sh "$M" "$T/tanda.txt" "$CUENTAS" "$PAT" si || exit 1

m=$((10#$(date -u +%M)))
if [ "$m" -ge 4 ] && [ "$m" -le 11 ]; then
  echo "Son los :$(date -u +%M): espero a los :12 (el cierre del día corre a los :07)."
  while m=$((10#$(date -u +%M))); [ "$m" -ge 4 ] && [ "$m" -le 11 ]; do sleep 20; done
fi

# 0 · Preparar.
if [ "$(q -c "select to_regclass('public.conta_ventas_canal') is not null")" = "t" ]; then
  echo "- Staging tiene la tanda puesta: se deshace con la vuelta atrás de producción, en orden." >> "$INFORME"
  grep -vE '^\s*(#|$|cuenta:)' supabase/produccion/vuelta-atras.txt | while IFS= read -r d; do
    # La 0125 de staging, si está, va antes que la 0120 (orden inverso).
    if [ "$(basename "$d")" = "20261020T0120_ventas_por_plataforma_foodint.down.sql" ]; then
      f=supabase/staging/vuelta-atras/20261020T0125_ventas_por_plataforma_regla_a.down.sql
      node scripts/conta/produccion/analizar.mjs baja "$f" > "$T/baja.sql"
      q -1 -f "$f" -f "$T/baja.sql" >/dev/null || { echo "::error::Preparar: falla $f"; exit 1; }
    fi
    node scripts/conta/produccion/analizar.mjs baja "$d" > "$T/baja.sql"
    if ! q -1 -f "$d" -f "$T/baja.sql" > "$T/prep.log" 2>&1; then
      cat "$T/prep.log"; echo "::error::Preparar: la vuelta atrás $d falla en staging: no se puede dejar como estaba producción."; exit 1
    fi
    grep -o 'NOTICE: .*' "$T/prep.log" | sed 's/^/  /'
    echo "  - deshecho: \`$(basename "$d")\`" >> "$INFORME"
  done || exit 1
fi
q -1 -f supabase/staging/sql/20261020_r9_preparar.sql > "$T/prep.log" 2>&1 || { cat "$T/prep.log"; echo "::error::Preparar staging falla."; exit 1; }
grep -o 'Preparar staging (R9): .*' "$T/prep.log" | sed 's/^/- /' >> "$INFORME"; echo >> "$INFORME"

# 1 · Antes.
bash scripts/conta/produccion/cuentas.sh "$CUENTAS" "$CUENTAS_ANTES" || { echo "::error::No se han podido tomar las cuentas de antes."; exit 1; }
q --csv -f scripts/conta/produccion/d1.sql > "$T/d1-antes.csv" || exit 1
q --csv -f scripts/conta/produccion/recuento-serie.sql > "$T/recuento-antes.csv" || exit 1
{ echo "### Antes"; echo; node scripts/conta/produccion/cuentas-comparar.mjs "$CUENTAS_ANTES"; echo; } >> "$INFORME"

# 2 · Aplicar, como el real: fichero + registro en una transacción.
: > "$T/aplicados.txt"
{ echo "### Aplicación"; echo; echo '| # | Fichero | Resultado |'; echo '|---|---|---|'; } >> "$INFORME"
i=0; fallo=0
while IFS= read -r f; do
  i=$((i+1))
  # W02 (16/10): si el manifiesto de staging ya lo aplicó y lo registró
  # («staging aplicar · …»), ese registro no es el del real: fuera, en la misma
  # transacción, y el insert de abajo es exactamente el de producción.
  v=$(basename "$f" .sql)
  printf "delete from supabase_migrations.schema_migrations where version = '%s' and created_by like 'staging aplicar%%';\n" "$v" > "$T/registro.sql"
  node scripts/conta/produccion/analizar.mjs registro "$f" "staging ${modo} · run ${GITHUB_RUN_ID:-local}" >> "$T/registro.sql"
  echo "::group::[$i] $f"
  if q -1 -f "$f" -f "$T/registro.sql" > "$T/f.log" 2>&1; then
    cat "$T/f.log"; cp "$T/f.log" "$T/f-$i.log"; echo "::endgroup::"
    echo "$f" >> "$T/aplicados.txt"
    echo "| $i | \`$f\` | aplicado |" >> "$INFORME"
  else
    cat "$T/f.log"; echo "::endgroup::"
    echo "| $i | \`$f\` | **FALLÓ, revertido entero** · $(grep -m1 ERROR "$T/f.log" | cut -c1-300) |" >> "$INFORME"
    echo "::error::FALLÓ [$i] $f: $(grep -m1 ERROR "$T/f.log" | cut -c1-500)"
    fallo=1; break
  fi
done < "$T/tanda.txt"
echo >> "$INFORME"
grep -h -o 'Rehacer las ventas por plataforma: .*' "$T"/f-*.log 2>/dev/null | sed 's/^/- /' >> "$INFORME" || true

if [ "$fallo" -ne 0 ]; then
  echo "- Un fichero falló: se deshace lo aplicado (la misma vuelta atrás)." >> "$INFORME"
  bash scripts/conta/produccion/deshacer.sh "$T/aplicados.txt"
  exit 1
fi

bash scripts/conta/produccion/cuentas.sh "$CUENTAS" "$T/cuentas-con-tanda.csv"
{ echo "### Con la tanda (cambiar es lo esperado)"; echo
  node scripts/conta/produccion/cuentas-comparar.mjs "$CUENTAS_ANTES" "$T/cuentas-con-tanda.csv" "Antes" "Con la tanda" | sed '$d'; echo; } >> "$INFORME"

d1() {
  q --csv -f scripts/conta/produccion/d1.sql > "$T/d1-despues.csv" || return 1
  node scripts/conta/produccion/d1-comparar.mjs "$T/d1-antes.csv" "$T/d1-despues.csv" > "$T/d1.txt"; local r=$?
  echo "- **D1 (antes ↔ ahora):** $(head -1 "$T/d1.txt")" >> "$INFORME"
  return $r
}

if [ "$modo" = "real" ]; then
  d1 || { echo "::error::D1 da diferencias."; exit 1; }
  echo "- **Real en verde**: la tanda entera, con su registro." >> "$INFORME"
  exit 0
fi

# 3 · real-con-fallo: la comprobación de después, forzada en rojo.
{ echo "### Comprobación de después **forzada en rojo** (staging, a propósito): se deshace lo aplicado"; echo; } >> "$INFORME"
bash scripts/conta/produccion/deshacer.sh "$T/aplicados.txt"; rc=$?
ok=1
[ "$rc" -eq 0 ] || ok=0
d1 || ok=0
q --csv -f scripts/conta/produccion/recuento-serie.sql > "$T/recuento-tras.csv" || ok=0
if cmp -s "$T/recuento-antes.csv" "$T/recuento-tras.csv"; then echo "- **Filas de serie (antes ↔ tras deshacer):** iguales." >> "$INFORME"
else echo "- **Filas de serie (antes ↔ tras deshacer): distintas.**" >> "$INFORME"; ok=0; fi
quedan=$(q -c "select count(*) from supabase_migrations.schema_migrations where version like '20261020T01%'")
echo "- Registros de la tanda que quedan en el historial: **$quedan**." >> "$INFORME"
[ "$quedan" = "0" ] || ok=0
if [ "$ok" -eq 1 ]; then
  echo "- **Vuelta atrás entera y contada: staging queda como antes de la tanda** (deshacer.sh salió con 0)." >> "$INFORME"
  exit 0
fi
echo "- **Staging NO queda como antes** (deshacer.sh salió con $rc)." >> "$INFORME"
echo "::error::La vuelta atrás no deja staging como estaba (deshacer.sh salió con $rc)."
exit 1
