#!/usr/bin/env bash
# Inventario de Edge Functions: DESPLEGADAS vs CARPETAS DEL REPO.
#
# POR QUE EXISTE (19/08/2026): `last-catalog-sync` llevaba desplegada desde el
# 12/08 sin una linea en el repositorio. Al buscar por que el espejo de
# catalogos no cuadraba, se leyo el repo, se encontro solo la funcion vieja
# (`lastapp-sync-catalog`) y se razono dos horas sobre la equivocada. Costo
# tres afirmaciones falsas y 35 filas del espejo corrompidas.
#
# Ese mismo dia habia pasado dos veces mas, en pequeno: `hubriseSku.ts` y
# `lastapp-set-price` desplegados distintos del repo. Media hora de guion
# contra horas de diagnostico a ciegas.
#
# USO:
#   supabase functions list --output json | ./scripts/edge-functions-inventario.sh
#
# Sin la CLI de Supabase, pasale un fichero con un slug por linea:
#   ./scripts/edge-functions-inventario.sh slugs.txt
#
# Salida: tres bloques. El primero es el peligroso.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FUNCS_DIR="$REPO_DIR/supabase/functions"

entrada="$(cat "${1:-/dev/stdin}")"

# Acepta JSON de la CLI o una lista plana de slugs.
if printf '%s' "$entrada" | head -c 1 | grep -q '[[{]'; then
  desplegadas="$(printf '%s' "$entrada" | grep -oE '"slug"[[:space:]]*:[[:space:]]*"[^"]+"' | sed 's/.*"\([^"]*\)"$/\1/')"
else
  desplegadas="$(printf '%s' "$entrada" | sed '/^[[:space:]]*$/d' | tr -d '\r')"
fi

# Carpetas del repo, excluyendo las compartidas (_shared y similares).
enrepo="$(find "$FUNCS_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | grep -v '^_' | sort)"
desplegadas="$(printf '%s\n' "$desplegadas" | sort -u)"

echo "== VIVAS SIN CODIGO (desplegadas, sin carpeta en el repo) =="
echo "   Nadie puede leerlas, revisarlas ni reproducirlas. Traerlas al repo."
sinCodigo="$(comm -23 <(printf '%s\n' "$desplegadas") <(printf '%s\n' "$enrepo"))"
if [ -z "$sinCodigo" ]; then echo "   (ninguna)"; else printf '   %s\n' $sinCodigo; fi

echo
echo "== CODIGO SIN DESPLEGAR (carpeta en el repo, no desplegada) =="
echo "   Puede ser trabajo en curso, o una funcion retirada que nadie limpio."
sinDesplegar="$(comm -13 <(printf '%s\n' "$desplegadas") <(printf '%s\n' "$enrepo"))"
if [ -z "$sinDesplegar" ]; then echo "   (ninguna)"; else printf '   %s\n' $sinDesplegar; fi

echo
echo "== RESUMEN =="
echo "   desplegadas: $(printf '%s\n' "$desplegadas" | grep -c . || true)"
echo "   en el repo:  $(printf '%s\n' "$enrepo" | grep -c . || true)"
echo "   vivas sin codigo: $(printf '%s\n' "$sinCodigo" | grep -c . || true)"
echo
echo "NOTA: coincidir de nombre NO garantiza que el codigo desplegado sea el del"
echo "repo. Para eso hace falta 'supabase functions download <slug>' y comparar"
echo "md5. Este guion detecta el agujero grande, no la deriva byte a byte."
