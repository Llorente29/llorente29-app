#!/usr/bin/env bash
# scripts/conta/staging/agentes-rojos.sh <prefijo de cuenta>
#
# DM1·4 (03/11) · Los jueces de agentes.sh (agente-datos-maestros.mjs y
# agente-libro.mjs, en anónimo) sobre lo que volcó agentes-volcar.sql, y
# cuántos hallazgos EN ROJO son de la cuenta que empieza por <prefijo> (los 8
# primeros caracteres de su account_id, como los escribe el informe anónimo).
# Imprime «<rojos de datos> <rojos del libro>». Los rojos de otras cuentas no
# cuentan: la prueba mira solo lo suyo.
set -uo pipefail
p="${1:?el prefijo de la cuenta}"
export CONTA_ANONIMO=1
node scripts/conta/agente-datos-maestros.mjs /tmp/prueba-agente-datos.json /tmp/prueba-agente-datos.md producción /tmp/prueba-agente-terceros.json > /dev/null 2>&1
node scripts/conta/agente-libro.mjs /tmp/prueba-agente-libro.json /tmp/prueba-agente-libro.md producción > /dev/null 2>&1
d=$(grep -s '| rojo |' /tmp/prueba-agente-datos.md | grep -c "| $p |")
l=$(grep -s '| rojo |' /tmp/prueba-agente-libro.md | grep -c "| $p |")
[ -s /tmp/prueba-agente-datos.md ] && [ -s /tmp/prueba-agente-libro.md ] || { echo "-1 -1"; exit 0; }
echo "$d $l"
