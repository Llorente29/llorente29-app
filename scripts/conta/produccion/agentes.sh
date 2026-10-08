#!/usr/bin/env bash
# scripts/conta/produccion/agentes.sh <antes|despues>
#
# W01 · Los agentes de solo lectura contra producción, alrededor del real:
# «Datos maestros e impuestos» (con Terceros dentro) y «Libro diario», los
# mismos del cumplimiento nocturno, con el usuario conta_lectura (RO_DB_URL) y
# sin conceptos ni nombres en el informe (CONTA_ANONIMO=1).
#
# Escribe $AGENTES_DIR/agentes-<etiqueta>.txt (por defecto /tmp), una línea por
# agente, separada por tabuladores:  <agente> <estado> <motivo>
#   verde       corrió y no hay nada en rojo
#   rojo        corrió y hay algo en rojo
#   no-medible  no se ha podido leer (p. ej. «permission denied for table sale»)
#   no-aplica   la tabla que revisa no existe todavía
#
# EL «ANTES» ES LA FOTO DE PARTIDA, NO UNA GUARDA (C04 R4, 08/10). Si la tanda
# es la que da a conta_lectura el permiso que le falta, el agente no puede leer
# antes de aplicarla: se apunta «no-medible» con el motivo y se sigue. Este
# script sale siempre con 0 en el «antes».
# EL «DESPUÉS» ES OBLIGATORIO: sale con 2 si algún agente no se ha podido medir.
# Lo que cuenta (qué se pone en rojo con la tanda) lo decide agentes-comparar.mjs,
# y solo con los agentes medibles en los dos lados.
set -uo pipefail
et="${1:?antes o despues}"
dir="${AGENTES_DIR:-/tmp}"
export CONTA_ANONIMO=1 PGOPTIONS='-c default_transaction_read_only=on'
salida="$dir/agentes-$et.txt"
: > "$salida"

# El motivo: la primera línea de ERROR, sin la ruta del script ni saltos de línea.
motivo() { grep -m1 -E 'ERROR|FATAL|error' "$1" | sed -E 's#^psql:(scripts/conta/)?##; s/[[:space:]]+/ /g' | cut -c1-200; }
# Lee un SQL de agente a un JSON. 0 = leído; 1 = no medible (el motivo, en $dir/err-<et>).
leer() { "$PSQL" "$RO_DB_URL" -X -A -t -v ON_ERROR_STOP=1 -f "$1" > "$2" 2> "$dir/err-$et"; }
# ¿Existe la tabla? Imprime t o f; si ni eso se puede preguntar, falla.
existe() { "$PSQL" "$RO_DB_URL" -X -A -t -v ON_ERROR_STOP=1 -c "select to_regclass('public.$1') is not null" 2> "$dir/err-$et"; }
apunta() { printf '%s\t%s\t%s\n' "$1" "$2" "${3:-}" >> "$salida"; }
juez() { if node "$@" > /dev/null; then echo verde; else echo rojo; fi; }

# «Datos maestros e impuestos», con el volcado de Terceros si existe party.
if ! leer scripts/conta/agente-datos-maestros.sql "$dir/bd-$et.json"; then
  apunta datos no-medible "$(motivo "$dir/err-$et")"
elif ! hay=$(existe party); then
  apunta datos no-medible "$(motivo "$dir/err-$et")"
elif [ "$hay" = "t" ] && ! leer scripts/conta/agente-terceros.sql "$dir/terceros-$et.json"; then
  apunta datos no-medible "$(motivo "$dir/err-$et")"
else
  [ "$hay" = "t" ] || echo null > "$dir/terceros-$et.json"
  apunta datos "$(juez scripts/conta/agente-datos-maestros.mjs "$dir/bd-$et.json" "$dir/agente-datos-$et.md" producción "$dir/terceros-$et.json")"
fi

# «Libro diario».
if ! hay=$(existe journal_entry); then
  apunta libro no-medible "$(motivo "$dir/err-$et")"
elif [ "$hay" != "t" ]; then
  apunta libro no-aplica "no existe public.journal_entry"
elif ! leer scripts/conta/agente-libro.sql "$dir/libro-$et.json"; then
  apunta libro no-medible "$(motivo "$dir/err-$et")"
else
  apunta libro "$(juez scripts/conta/agente-libro.mjs "$dir/libro-$et.json" "$dir/agente-libro-$et.md" producción)"
fi

cat "$salida"
if [ "$et" = "despues" ] && grep -q $'\tno-medible\t' "$salida"; then exit 2; fi
exit 0
