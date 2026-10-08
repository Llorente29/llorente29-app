#!/usr/bin/env bash
# scripts/conta/produccion/ensayo-vuelta-atras.sh
#
# C04 R4 · La vuelta atrás automática del W01, probada EN VIVO en staging-conta
# (modo «ensayo-de-vuelta-atras» de aplicar-staging-conta.yml). Hace lo mismo
# que el real de producción con una tanda de ejemplo
# (supabase/staging/ensayo-vuelta-atras/): aplica cada fichero con su registro
# en el historial, en una transacción por fichero; comprueba que está; FUERZA
# que la comprobación de después falle; deja que deshacer.sh —el mismo de
# producción— lo quite en orden inverso; y compara la foto de antes con la de
# después, tomada igual a los dos lados (regla 31). En verde solo si la foto es
# idéntica y no queda ni rastro de la tanda.
#
# Entorno: PSQL, DB_URL, INFORME. Sale con 0 si staging queda como estaba.
set -uo pipefail
DIR=supabase/staging/ensayo-vuelta-atras
tanda=("$DIR/20990101T0100_ensayo_tabla.sql" "$DIR/20990101T0110_ensayo_funcion.sql")
foto() {
  "$PSQL" "$DB_URL" -X -A -t -v ON_ERROR_STOP=1 -c "
    select md5(concat_ws('#',
      (select string_agg(c.relname || ':' || c.relkind, ',' order by c.relname) from pg_class c where c.relnamespace = 'public'::regnamespace),
      (select string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc), ',' order by p.oid::regprocedure::text) from pg_proc p where p.pronamespace = 'public'::regnamespace),
      (select string_agg(version || ':' || coalesce(array_to_string(statements, ''), ''), ',' order by version) from supabase_migrations.schema_migrations)))"
}
{ echo "## Ensayo de vuelta atrás (staging-conta)"; echo; } >> "$INFORME"
antes=$(foto) || { echo "::error::No se ha podido tomar la foto de antes."; exit 1; }
echo "- Foto de antes: \`$antes\` (tablas y funciones de \`public\` e historial de migraciones)." >> "$INFORME"
if "$PSQL" "$DB_URL" -X -A -t -c "select to_regclass('public.ensayo_vuelta_atras')" | grep -q ensayo; then
  echo "::error::staging ya tiene la tabla del ensayo (de una ejecución anterior que no acabó). No se ensaya sobre restos."; exit 1
fi

# 1 · Aplicar, como el real: fichero + registro en una transacción.
: > /tmp/aplicados.txt
reg="$(mktemp)"; trap 'rm -f "$reg"' EXIT
for f in "${tanda[@]}"; do
  node scripts/conta/produccion/analizar.mjs registro "$f" "ensayo de vuelta atrás · run ${GITHUB_RUN_ID:-local}" > "$reg"
  if "$PSQL" "$DB_URL" -X -v ON_ERROR_STOP=1 -1 -f "$f" -f "$reg"; then
    echo "$f" >> /tmp/aplicados.txt
    echo "- Aplicado con su registro: \`$f\`." >> "$INFORME"
  else
    echo "::error::No se ha podido aplicar $f: el ensayo no llega a la vuelta atrás."; exit 1
  fi
done
puesto=$("$PSQL" "$DB_URL" -X -A -t -v ON_ERROR_STOP=1 -c "select public.ensayo_vuelta_atras_cuenta() || '/' || (select count(*) from supabase_migrations.schema_migrations where version like '20990101T%')")
echo "- Está puesto: la función cuenta $puesto (filas / registros en el historial)." >> "$INFORME"
[ "$puesto" = "1/2" ] || { echo "::error::Lo aplicado no está como debe ($puesto)."; exit 1; }

# 2 · La comprobación de después, forzada a fallar: lo que haría el workflow de producción.
echo "- Comprobación de después **forzada en rojo** (ensayo): se deshace lo aplicado." >> "$INFORME"; echo >> "$INFORME"
VUELTA_ATRAS_DIR="$DIR" bash scripts/conta/produccion/deshacer.sh /tmp/aplicados.txt; deshecho=$?

# 3 · La foto de después, con la misma vara.
despues=$(foto) || { echo "::error::No se ha podido tomar la foto de después."; exit 1; }
echo "- Foto de después: \`$despues\`." >> "$INFORME"
if [ "$deshecho" -eq 0 ] && [ "$antes" = "$despues" ]; then
  echo "- **Staging queda exactamente como estaba** (foto idéntica): la vuelta atrás automática funciona." >> "$INFORME"
  exit 0
fi
echo "- **Staging NO queda como estaba** (deshacer salió con $deshecho; fotos $antes ≠ $despues)." >> "$INFORME"
echo "::error::El ensayo de vuelta atrás falla: staging no queda como estaba."
exit 1
