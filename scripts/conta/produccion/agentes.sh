#!/usr/bin/env bash
# scripts/conta/produccion/agentes.sh <antes|despues>
#
# W01 · Los agentes de solo lectura contra producción, alrededor del real:
# «Datos maestros e impuestos» y «Libro diario», los mismos del cumplimiento
# nocturno, con el usuario conta_lectura (RO_DB_URL) y sin conceptos ni
# nombres en el informe (CONTA_ANONIMO=1). Escribe /tmp/agentes-<etiqueta>.txt
# con «datos=<0|1> libro=<0|1>» (0 = en verde): lo que cuenta es lo que está en
# rojo DESPUÉS y no lo estaba ANTES.
set -uo pipefail
et="${1:?antes o despues}"
export CONTA_ANONIMO=1 PGOPTIONS='-c default_transaction_read_only=on'
"$PSQL" "$RO_DB_URL" -X -A -t -v ON_ERROR_STOP=1 -f scripts/conta/agente-datos-maestros.sql > "/tmp/bd-$et.json" || exit 2
if [ "$("$PSQL" "$RO_DB_URL" -X -A -t -v ON_ERROR_STOP=1 -c "select to_regclass('public.party') is not null")" = "t" ]; then
  "$PSQL" "$RO_DB_URL" -X -A -t -v ON_ERROR_STOP=1 -f scripts/conta/agente-terceros.sql > "/tmp/terceros-$et.json" || exit 2
else
  echo null > "/tmp/terceros-$et.json"
fi
node scripts/conta/agente-datos-maestros.mjs "/tmp/bd-$et.json" "/tmp/agente-datos-$et.md" producción "/tmp/terceros-$et.json" > /dev/null; datos=$?
libro=0
if [ "$("$PSQL" "$RO_DB_URL" -X -A -t -v ON_ERROR_STOP=1 -c "select to_regclass('public.journal_entry') is not null")" = "t" ]; then
  "$PSQL" "$RO_DB_URL" -X -A -t -v ON_ERROR_STOP=1 -f scripts/conta/agente-libro.sql > "/tmp/libro-$et.json" || exit 2
  node scripts/conta/agente-libro.mjs "/tmp/libro-$et.json" "/tmp/agente-libro-$et.md" producción > /dev/null; libro=$?
fi
[ "$datos" -eq 0 ] || datos=1
[ "$libro" -eq 0 ] || libro=1
echo "datos=$datos libro=$libro" > "/tmp/agentes-$et.txt"
cat "/tmp/agentes-$et.txt"
