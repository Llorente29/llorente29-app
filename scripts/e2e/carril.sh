#!/usr/bin/env bash
# scripts/e2e/carril.sh — cada e2e con sus propias cuentas (W02, paso 1c).
#
#   carril.sh coger          espera a que nadie esté migrando staging, coge un
#                            carril libre y deja su número en $CARRIL_DIR/numero
#   carril.sh clonar         copia la plantilla de prueba en ese carril (y le pone
#                            a sus usuarios la contraseña de un solo uso)
#   carril.sh borrar         borra lo del carril (también lo que dejó un run
#                            cortado que usó el mismo número)
#   carril.sh soltar         borra y suelta (pase lo que pase: if: always())
#   carril.sh plantilla-coger   TRANSICIÓN: espera a que ninguna e2e de las de
#                            antes (e2e.cerrojo) esté escribiendo en la plantilla
#                            y coge ese cerrojo para el rato del clon
#   carril.sh plantilla-soltar  lo suelta (clonar lo hace al acabar; soltar, siempre)
#   carril.sh migrar-coger   aplicar-staging-conta: espera a que acaben las e2e
#                            en marcha y no deja empezar ninguna mientras aplica
#   carril.sh migrar-soltar  lo suelta
#   carril.sh ensayo [N]     clona en N (4001 por defecto) DENTRO de una
#                            transacción que se deshace: lo que tarda y cuánto copia
#
# Entorno: DB_URL; CARRIL_DIR (por defecto $RUNNER_TEMP/carril); CARRIL_YO (quién:
# «run 123 · trozo 2/4 · conta/b02…», sale en pg_stat_activity); CLAVE_PRUEBAS
# (clonar). Opcionales: PSQL, CARRIL_ESPERA_MIN (40: lo que espera a que nadie
# migre y, aparte, lo que espera a que quede un carril libre), CARRIL_MAX (2).
#
# EL TOPE (W02, 17/10). CARRIL_MAX es cuántos trozos corren A LA VEZ en todo
# staging, de todas las ramas. Con 4 a la vez la Micro se satura (ocupación
# p95 2.312 ms/s contra 578 con 2; run 484) y las pruebas caen por tiempo, cada
# vuelta unas. El que llega con los carriles cogidos espera su turno. En el
# workflow sale de la variable del repositorio E2E_CARRILES (vacía = 2): si
# staging pasa a Small, se pone a 4 allí, sin tocar el código.
#
# CÓMO SE CIERRA SIN TABLAS NI CADUCIDADES. Dos cerrojos consultivos de
# Postgres que mantiene un psql en segundo plano mientras dura el job:
#   · (4202, 0) COMPARTIDO por cada e2e, EXCLUSIVO por quien migra. Postgres
#     pone en cola a una e2e nueva si hay alguien esperando para migrar: no se
#     cuela nadie y quien migra no espera para siempre.
#   · (4203, N) exclusivo: el carril N es de este job y de nadie más.
# Si el runner muere, se cae la conexión y Postgres los suelta solo. Si el
# psql se cuelga, el job tiene su timeout y al acabar mata los procesos.
#
# Por qué no el cerrojo de antes (e2e.cerrojo): aquel ponía en fila TODAS las
# e2e porque compartían las cuentas A y B. Con un carril cada una, solo hace
# falta esperar mientras se aplica algo a staging (mediana 0,6 min).
#
# LA TRANSICIÓN (mientras quede una rama con la e2e de antes). La e2e de antes
# no tiene carril: corre en las cuentas de la plantilla y ESCRIBE en ellas,
# cogiendo e2e.cerrojo para toda su duración. El clon las lee. Para no copiar
# una plantilla a medio escribir, el carril coge también e2e.cerrojo, solo
# desde que acaba de esperar hasta que termina el clon (segundos), con
# caducidad corta. Orden siempre el mismo —primero (4202,0), luego
# e2e.cerrojo— aquí y en aplicar-staging-conta: así no hay abrazo mortal.
# Cuando no quede ninguna rama vieja, CARRIL_CERROJO_VIEJO=0 lo apaga.
set -euo pipefail

PSQL=${PSQL:-/usr/lib/postgresql/17/bin/psql}
AQUI=$(cd "$(dirname "$0")" && pwd)
SQL="$AQUI/carril"
CARRIL_DIR=${CARRIL_DIR:-${RUNNER_TEMP:-/tmp}/carril}
ESPERA_MIN=${CARRIL_ESPERA_MIN:-40}
MAX=${CARRIL_MAX:-2}
VIEJO=${CARRIL_CERROJO_VIEJO:-1}
: "${DB_URL:?Falta DB_URL}"
mkdir -p "$CARRIL_DIR"

# psql de un tiro contra staging, con quién es en application_name.
q() { PGAPPNAME="e2e-carril · ${CARRIL_YO:-?}" "$PSQL" "$DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

numero() {
  [ -s "$CARRIL_DIR/numero" ] || { echo "::error::No hay carril cogido (falta $CARRIL_DIR/numero)." >&2; exit 1; }
  cat "$CARRIL_DIR/numero"
}

# El psql que mantiene los cerrojos. Escribe una línea por cosa que pasa en
# $CARRIL_DIR/guardian.log y se queda durmiendo hasta que lo matan.
guardian() {
  local modo=$1 app
  # Solo ASCII y 63 bytes como mucho: lo que cabe en application_name.
  app=$(printf '%s' "$2" | LC_ALL=C tr -cd '\40-\176' | cut -c1-63)
  GUARDIAN_APP=$app; echo "$app" > "$CARRIL_DIR/guardian.app"
  : > "$CARRIL_DIR/guardian.log"
  # Dos horas de latido en tramos de 20 s (ver guardian_e2e.sql).
  for _ in $(seq 360); do echo 'select pg_sleep(20);'; done > "$CARRIL_DIR/latido.sql"
  PGAPPNAME="$app" stdbuf -oL -eL "$PSQL" "$DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 -v espera="${ESPERA_MIN}min" -v max="$MAX" -v quien="$app" \
    -f "$SQL/guardian_${modo}.sql" -f "$CARRIL_DIR/latido.sql" > "$CARRIL_DIR/guardian.log" 2>&1 &
  echo $! > "$CARRIL_DIR/guardian.pid"
}

# Espera a que el guardián diga «$1 …» (o muera). Devuelve la línea.
esperar_linea() {
  local que=$1 linea pid
  pid=$(cat "$CARRIL_DIR/guardian.pid")
  while :; do
    linea=$(grep -m1 "^$que" "$CARRIL_DIR/guardian.log" || true)
    [ -n "$linea" ] && { echo "$linea"; return 0; }
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "::error::El guardián del carril se ha parado sin «$que»:" >&2
      cat "$CARRIL_DIR/guardian.log" >&2
      return 1
    fi
    sleep 1
  done
}

# Quién tiene (o espera) el cerrojo de migrar: para decir a quién se espera.
quien_hay() {
  q -A -t -c "select string_agg(distinct a.application_name || case when l.granted then '' else ' (esperando)' end
                                || ' · ' || l.mode, ' | ')
                from pg_locks l join pg_stat_activity a on a.pid = l.pid
               where l.locktype = 'advisory' and l.classid = 4202 and l.objid = 0" 2>/dev/null || true
}

# Quién tiene los carriles: para decir a quién se espera.
quien_carriles() {
  q -A -t -c "select string_agg(a.application_name, ' | ' order by l.objid)
                from pg_locks l join pg_stat_activity a on a.pid = l.pid
               where l.locktype = 'advisory' and l.classid = 4203 and l.granted" 2>/dev/null || true
}

# Suelta los cerrojos: termina en el servidor el proceso del guardián (si no,
# con el pooler, su consulta seguiría viva con los cerrojos) y mata el psql.
matar_guardian() {
  [ -s "$CARRIL_DIR/guardian.pid" ] || return 0
  GUARDIAN_APP=${GUARDIAN_APP:-$(cat "$CARRIL_DIR/guardian.app" 2>/dev/null || true)}
  local pid bpid; pid=$(cat "$CARRIL_DIR/guardian.pid")
  bpid=$(grep -m1 '^pid ' "$CARRIL_DIR/guardian.log" 2>/dev/null | awk '{print $2}' || true)
  if [ -n "$bpid" ]; then
    q -A -t -c "select pg_terminate_backend($bpid) from pg_stat_activity where pid = $bpid and application_name = '$(sed "s/'/''/g" <<< "$GUARDIAN_APP")'" > /dev/null 2>&1 \
      || echo "::warning::No he podido terminar el proceso $bpid del guardián en el servidor: se suelta al acabar su tramo (20 s)."
  fi
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$CARRIL_DIR/guardian.pid"
}

coger() {
  guardian e2e "e2e-carril ${CARRIL_YO:-?}"
  local t0 n otros; t0=$(date +%s)
  otros=$(quien_hay)
  [ -n "$otros" ] && echo "Cerrojo de migrar ahora: $otros"
  esperar_linea 'migrar-libre' > /dev/null || { echo "::error::Sin el cerrojo compartido en ${ESPERA_MIN} min. Lo tiene: $(quien_hay)"; matar_guardian; exit 1; }
  echo "Nadie migra staging (esperado $(( $(date +%s) - t0 )) s)."
  local t1; t1=$(date +%s)
  n=$(esperar_linea 'carril ' | awk '{print $2}') || { matar_guardian; exit 1; }
  if [ -z "$n" ] || [ "$n" = 0 ]; then
    echo "::error::Los $MAX carriles siguen cogidos tras ${ESPERA_MIN} min de espera. Los tienen: $(quien_carriles)"
    matar_guardian; exit 1
  fi
  echo "$n" > "$CARRIL_DIR/numero"
  if grep -q '^carril-espera' "$CARRIL_DIR/guardian.log"; then
    echo "Carril $n cogido tras $(( $(date +%s) - t1 )) s en cola: estaban los $MAX cogidos (${CARRIL_YO:-?})."
  else
    echo "Carril $n cogido (${CARRIL_YO:-?})."
  fi
}

# Los parámetros, en un fichero: psql sustituye :'variable' en lo que lee de
# un fichero, no en -c. La clave y la semilla no salen nunca por pantalla.
parametros() {
  printf '%s\n' '\o /dev/null' \
    "select set_config('e2e.carril', :'carril', true), set_config('e2e.clave', :'clave', true), set_config('e2e.semilla', :'semilla', true);" \
    '\o' > "$CARRIL_DIR/parametros.sql"
}

# El cerrojo de antes, para el rato del clon (ver LA TRANSICIÓN, arriba).
# Caduca a los 10 min: si el job muere entre coger y soltar, no para a nadie más.
plantilla_yo() { echo "carril $(numero) clonando · ${CARRIL_YO:-?}"; }
plantilla_coger() {
  [ "$VIEJO" = 1 ] || { echo "Cerrojo de antes: apagado (CARRIL_CERROJO_VIEJO=0)."; return 0; }
  local t0; t0=$(date +%s)
  CERROJO_YO=$(plantilla_yo) CERROJO_MINUTOS=10 CERROJO_INTENTOS=$(( ESPERA_MIN * 2 )) CERROJO_PAUSA=${CERROJO_PAUSA:-30} PSQL="$PSQL" \
    "$AQUI/cerrojo.sh" coger || { echo "::error::Una e2e de las de antes lleva ${ESPERA_MIN} min escribiendo en la plantilla."; return 1; }
  echo "Ninguna e2e de antes escribe en la plantilla (esperado $(( $(date +%s) - t0 )) s)."
}
plantilla_soltar() {
  [ "$VIEJO" = 1 ] || return 0
  [ -s "$CARRIL_DIR/numero" ] || return 0
  CERROJO_YO=$(plantilla_yo) PSQL="$PSQL" "$AQUI/cerrojo.sh" soltar || true
}

clonar() {
  local n; n=$(numero)
  : "${CLAVE_PRUEBAS:?Falta CLAVE_PRUEBAS}"
  local t0; t0=$(date +%s%N)
  parametros
  # Una foto de la plantilla (REPEATABLE READ) y una sola transacción: o el
  # carril entero o nada. La semilla del R02 va dentro, con los ids del carril.
  q -1 -v carril="$n" -v clave="$CLAVE_PRUEBAS" -v semilla="$(cat "$AQUI/../../supabase/seeds/reparto/seed_r02_e2e.sql")" \
    -c 'set transaction isolation level repeatable read' \
    -f "$CARRIL_DIR/parametros.sql" -f "$SQL/comun.sql" -f "$SQL/clonar.sql" -f "$SQL/semilla.sql" \
    -c '\pset footer off' -c "select count(*) || ' tablas, ' || sum(filas) || ' filas' as copiado from _informe" > "$CARRIL_DIR/clonar.log" \
    || { echo "::error::No se ha podido clonar el carril $n (arriba, el error de psql)."; plantilla_soltar; return 1; }
  plantilla_soltar
  echo "Carril $n clonado en $(( ($(date +%s%N) - t0) / 1000000 )) ms: $(grep -E 'tablas, ' "$CARRIL_DIR/clonar.log" | tr -d ' ')."
}

borrar() {
  local n; n=$(numero)
  local t0; t0=$(date +%s%N)
  parametros
  # Sin -c con variables (ver parametros): clave y semilla vacías, no hacen falta.
  q -1 -A -t -v carril="$n" -v clave= -v semilla= \
    -f "$CARRIL_DIR/parametros.sql" -f "$SQL/comun.sql" -f "$SQL/borrar.sql" \
    -c "select coalesce(sum(filas), 0) || ' filas en ' || count(*) || ' tablas' from _informe where filas > 0" > "$CARRIL_DIR/borrar.log" \
    || { echo "::error::No se ha podido borrar el carril $n (arriba, el error de psql)."; return 1; }
  echo "Carril $n borrado en $(( ($(date +%s%N) - t0) / 1000000 )) ms: $(tail -1 "$CARRIL_DIR/borrar.log")."
}

soltar() {
  plantilla_soltar
  if [ -s "$CARRIL_DIR/numero" ]; then
    borrar || echo "::warning::No se ha podido borrar el carril $(cat "$CARRIL_DIR/numero"): lo borra el próximo que lo coja."
  fi
  matar_guardian
  rm -f "$CARRIL_DIR/numero"
  echo "Carril soltado."
}

migrar_coger() {
  guardian migrar "e2e-migrar ${CARRIL_YO:-?}"
  local t0; t0=$(date +%s)
  local otros; otros=$(quien_hay)
  [ -n "$otros" ] && echo "Esperando a que acaben: $otros"
  esperar_linea 'migrar-cogido' > /dev/null || { echo "::error::Sin el cerrojo de migrar en ${ESPERA_MIN} min. Lo tienen: $(quien_hay)"; matar_guardian; exit 1; }
  echo "Cerrojo de migrar cogido (esperado $(( $(date +%s) - t0 )) s): ninguna e2e de carril está tocando staging."
}

migrar_soltar() { matar_guardian; echo "Cerrojo de migrar soltado."; }

ensayo() {
  local n=${1:-4001} t0; t0=$(date +%s%N)
  # Lo mismo que clonar, pero se deshace: begin … rollback, sin -1.
  {
    echo "begin isolation level repeatable read;"
    echo "\\o /dev/null"
    echo "select set_config('e2e.carril', :'carril', true), set_config('e2e.clave', 'ensayo-sin-uso', true), set_config('e2e.semilla', :'semilla', true);"
    echo "\\o"
    echo "\\i $SQL/comun.sql"
    echo "\\i $SQL/clonar.sql"
    echo "\\i $SQL/semilla.sql"
    echo "\\pset footer off"
    echo "select tabla, filas from _informe order by filas desc, tabla;"
    echo "rollback;"
  } > "$CARRIL_DIR/ensayo.sql"
  q -v carril="$n" -v semilla="$(cat "$AQUI/../../supabase/seeds/reparto/seed_r02_e2e.sql")" -f "$CARRIL_DIR/ensayo.sql"
  echo "Ensayo del carril $n (deshecho) en $(( ($(date +%s%N) - t0) / 1000000 )) ms."
}

case "${1:-}" in
  coger) coger ;;
  clonar) clonar ;;
  borrar) borrar ;;
  soltar) soltar ;;
  plantilla-coger) plantilla_coger ;;
  plantilla-soltar) plantilla_soltar ;;
  migrar-coger) migrar_coger ;;
  migrar-soltar) migrar_soltar ;;
  ensayo) ensayo "${2:-}" ;;
  *) echo "uso: carril.sh coger|clonar|borrar|soltar|plantilla-coger|plantilla-soltar|migrar-coger|migrar-soltar|ensayo [N]" >&2; exit 2 ;;
esac
