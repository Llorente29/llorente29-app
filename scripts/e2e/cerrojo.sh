#!/usr/bin/env bash
# scripts/e2e/cerrojo.sh — el cerrojo de las e2e en staging (e2e.cerrojo).
#
#   cerrojo.sh coger    espera a que esté libre (o caducado) y lo coge
#   cerrojo.sh soltar   lo suelta, solo si lo tiene quien lo pide
#
# Entorno: DB_URL, CERROJO_YO (quién lo coge). Opcionales: PSQL,
# CERROJO_INTENTOS (120), CERROJO_PAUSA (30 s) y CERROJO_MINUTOS (50: lo que
# dura como mucho; si un run muere sin soltarlo, caduca solo).
#
# 13/10 (lo encontró A): con `psql -A -t`, la salida del UPDATE … RETURNING es
# «cogido» Y DETRÁS «UPDATE 1». Se comparaba la salida entera con «cogido» y
# nunca casaba: el run cogía el cerrojo, no se enteraba y lo renovaba cada 30 s,
# y todos esperaban una hora. Ahora: -q (sin la etiqueta) Y se busca la línea
# exacta (es_cogido), que casa aunque la etiqueta salga. Lo prueba
# tests/unit/e2e/cerrojo.test.ts con un psql que imprime las dos líneas.
set -euo pipefail

PSQL=${PSQL:-/usr/lib/postgresql/17/bin/psql}
INTENTOS=${CERROJO_INTENTOS:-120}
PAUSA=${CERROJO_PAUSA:-30}
MINUTOS=${CERROJO_MINUTOS:-50}
: "${DB_URL:?Falta DB_URL}" "${CERROJO_YO:?Falta CERROJO_YO}"

# ¿Dice la salida de psql que lo hemos cogido? Una LÍNEA «cogido», haya lo que haya alrededor.
es_cogido() { printf '%s\n' "$1" | grep -qx 'cogido'; }

coger() {
  local i r otro
  for i in $(seq 1 "$INTENTOS"); do
    r=$("$PSQL" "$DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 -v yo="$CERROJO_YO" -v minutos="$MINUTOS" <<'SQL'
update e2e.cerrojo set quien = :'yo', desde = now(), hasta = now() + make_interval(mins => :'minutos'::int)
 where id = 1 and (quien is null or hasta < now() or quien = :'yo')
returning 'cogido';
SQL
    )
    if es_cogido "$r"; then echo "Cerrojo cogido ($CERROJO_YO) en el intento $i."; return 0; fi
    otro=$("$PSQL" "$DB_URL" -X -q -A -t -c "select quien || ' · desde ' || to_char(desde at time zone 'Europe/Madrid', 'HH24:MI') || ' · caduca ' || to_char(hasta at time zone 'Europe/Madrid', 'HH24:MI') from e2e.cerrojo where id = 1")
    echo "Espera ($i de $INTENTOS): el cerrojo lo tiene ${otro:-nadie}."
    sleep "$PAUSA"
  done
  echo "::error::$INTENTOS intentos esperando el cerrojo de las e2e. No se lanza nada."
  return 1
}

soltar() {
  local r
  r=$("$PSQL" "$DB_URL" -X -q -A -t -v yo="$CERROJO_YO" <<'SQL'
update e2e.cerrojo set quien = null, desde = null, hasta = null where id = 1 and quien = :'yo'
returning 'soltado';
SQL
  ) || { echo "::warning::No se ha podido soltar el cerrojo: caduca solo a los $MINUTOS minutos."; return 0; }
  if printf '%s\n' "$r" | grep -qx 'soltado'; then echo "Cerrojo soltado ($CERROJO_YO)."; else echo "Este run no tenía el cerrojo: nada que soltar."; fi
}

case "${1:-}" in
  coger) coger ;;
  soltar) soltar ;;
  *) echo "uso: cerrojo.sh coger|soltar" >&2; exit 2 ;;
esac
