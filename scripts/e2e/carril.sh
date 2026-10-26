#!/usr/bin/env bash
# scripts/e2e/carril.sh — cada e2e con sus propias cuentas (W02, paso 1c).
#
#   carril.sh coger          coge un carril libre (espera su turno si están todos
#                            cogidos) y deja su número en $CARRIL_DIR/numero
#   carril.sh barrera-entrar no deja migrar staging mientras dura: lo coge cada
#                            fichero de pruebas antes de empezar, y el clon
#   carril.sh barrera-salir  lo suelta (al acabar el fichero, pase lo que pase)
#   carril.sh clonar         copia la plantilla de prueba en ese carril (y le pone
#                            a sus usuarios la contraseña de un solo uso)
#   carril.sh borrar         borra lo del carril (también lo que dejó un run
#                            cortado que usó el mismo número)
#   carril.sh soltar         borra y suelta (pase lo que pase: if: always())
#   carril.sh plantilla-coger   TRANSICIÓN: espera a que ninguna e2e de las de
#                            antes (e2e.cerrojo) esté escribiendo en la plantilla
#                            y coge ese cerrojo para el rato del clon
#   carril.sh plantilla-soltar  lo suelta (clonar lo hace al acabar; soltar, siempre)
#   carril.sh migrar-coger   aplicar-staging-conta: espera a que acaben los
#                            ficheros de prueba en marcha y no deja empezar
#                            ninguno mientras aplica
#   carril.sh migrar-soltar  lo suelta
#   carril.sh ensayo [N]     clona en N (4001 por defecto) DENTRO de una
#                            transacción que se deshace: lo que tarda y cuánto copia
#
# Entorno: DB_URL; CARRIL_DIR (por defecto $RUNNER_TEMP/carril); CARRIL_YO (quién:
# «run 123 · trozo 2/4 · conta/b02…», sale en pg_stat_activity); CLAVE_PRUEBAS
# (clonar). Opcionales: PSQL, CARRIL_MAX (2), y lo que espera cada uno, en
# minutos: CARRIL_ESPERA_MIN (15: a que quede un carril libre), CARRIL_BARRERA_MIN
# (20: un fichero, a que acabe de aplicarse algo) y CARRIL_MIGRAR_MIN (15: la
# aplicación, a que acaben los ficheros en marcha). Nadie espera para siempre:
# al acabarse su espera falla en rojo diciendo quién tiene lo que esperaba.
#
# EL TOPE (W02, 17/10). CARRIL_MAX es cuántos trozos corren A LA VEZ en todo
# staging, de todas las ramas. Con 4 a la vez la Micro se satura (ocupación
# p95 2.312 ms/s contra 578 con 2; run 484) y las pruebas caen por tiempo, cada
# vuelta unas. El que llega con los carriles cogidos espera su turno. En el
# workflow sale de la variable del repositorio E2E_CARRILES (vacía = 2): si
# staging pasa a Small, se pone a 4 allí, sin tocar el código.
#
# CÓMO SE CIERRA SIN TABLAS NI CADUCIDADES. Dos cerrojos consultivos de
# Postgres, cada uno en un psql en segundo plano (un «guardián»):
#   · (4203, N) exclusivo, todo el job: el carril N es de este job y de nadie más.
#   · (4202, 0) la BARRERA: COMPARTIDO por cada fichero de pruebas mientras
#     corre (y por el clon), EXCLUSIVO por quien migra. Postgres pone en cola a
#     un fichero nuevo si hay alguien esperando para migrar: no se cuela nadie,
#     y quien migra entra en cuanto acaban los ficheros en marcha.
# Si el runner muere, se cae la conexión y Postgres los suelta solo. Si el
# psql se cuelga, el job tiene su timeout y al acabar mata los procesos.
#
# LA COLA (V03, respuesta 6, 26/10). Hasta hoy la e2e cogía (4202,0) para TODO
# el job: una entera de hora y media dejaba a la aplicación esperando 40 min y
# rindiéndose, y mientras esperaba ninguna e2e nueva podía entrar. C y D
# estuvieron casi 3 horas parados. Ahora la barrera es por FICHERO
# (scripts/e2e/por-fichero.sh): la aplicación espera, como mucho, a que acabe
# el fichero más largo en marcha (unos 5,5 min), entra, y los ficheros
# siguientes continúan. Nunca se aplica nada en mitad de un fichero.
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
# caducidad corta. Orden siempre el mismo —primero la barrera (4202,0),
# luego e2e.cerrojo— en el clon y en aplicar-staging-conta: así no hay
# abrazo mortal.
# Cuando no quede ninguna rama vieja, CARRIL_CERROJO_VIEJO=0 lo apaga.
set -euo pipefail

PSQL=${PSQL:-/usr/lib/postgresql/17/bin/psql}
AQUI=$(cd "$(dirname "$0")" && pwd)
SQL="$AQUI/carril"
CARRIL_DIR=${CARRIL_DIR:-${RUNNER_TEMP:-/tmp}/carril}
ESPERA_MIN=${CARRIL_ESPERA_MIN:-15}
BARRERA_MIN=${CARRIL_BARRERA_MIN:-20}
MIGRAR_MIN=${CARRIL_MIGRAR_MIN:-15}
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

# El psql que mantiene un cerrojo. Cada guardián tiene sus ficheros con su
# nombre ($CARRIL_DIR/<nombre>.{app,log,pid}): el del carril («guardian») vive
# todo el job; el de la barrera («barrera»), lo que dura un fichero. Escribe
# una línea por cosa que pasa en su .log y se queda durmiendo hasta que lo matan.
guardian() {
  local modo=$1 app nombre=${3:-guardian} espera=${4:-$ESPERA_MIN}
  # Solo ASCII y 63 bytes como mucho: lo que cabe en application_name.
  app=$(printf '%s' "$2" | LC_ALL=C tr -cd '\40-\176' | cut -c1-63)
  echo "$app" > "$CARRIL_DIR/$nombre.app"
  : > "$CARRIL_DIR/$nombre.log"
  # Dos horas de latido en tramos de 20 s (ver guardian_e2e.sql).
  [ -s "$CARRIL_DIR/latido.sql" ] || for _ in $(seq 360); do echo 'select pg_sleep(20);'; done > "$CARRIL_DIR/latido.sql"
  PGAPPNAME="$app" stdbuf -oL -eL "$PSQL" "$DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 -v espera="${espera}min" -v max="$MAX" -v quien="$app" \
    -f "$SQL/guardian_${modo}.sql" -f "$CARRIL_DIR/latido.sql" > "$CARRIL_DIR/$nombre.log" 2>&1 &
  echo $! > "$CARRIL_DIR/$nombre.pid"
}

# Espera a que el guardián <nombre> diga «$1 …» (o muera). Devuelve la línea.
esperar_linea() {
  local que=$1 nombre=${2:-guardian} linea pid
  pid=$(cat "$CARRIL_DIR/$nombre.pid")
  while :; do
    linea=$(grep -m1 "^$que" "$CARRIL_DIR/$nombre.log" || true)
    [ -n "$linea" ] && { echo "$linea"; return 0; }
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "::error::El guardián «$nombre» se ha parado sin «$que»:" >&2
      cat "$CARRIL_DIR/$nombre.log" >&2
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

# Suelta el cerrojo del guardián <nombre>: termina en el servidor su proceso
# (si no, con el pooler, su consulta seguiría viva con el cerrojo) y mata el psql.
matar_guardian() {
  local nombre=${1:-guardian} app pid bpid
  [ -s "$CARRIL_DIR/$nombre.pid" ] || return 0
  app=$(cat "$CARRIL_DIR/$nombre.app" 2>/dev/null || true)
  pid=$(cat "$CARRIL_DIR/$nombre.pid")
  bpid=$(grep -m1 '^pid ' "$CARRIL_DIR/$nombre.log" 2>/dev/null | awk '{print $2}' || true)
  if [ -n "$bpid" ]; then
    q -A -t -c "select pg_terminate_backend($bpid) from pg_stat_activity where pid = $bpid and application_name = '$(sed "s/'/''/g" <<< "$app")'" > /dev/null 2>&1 \
      || echo "::warning::No he podido terminar el proceso $bpid del guardián «$nombre» en el servidor: se suelta al acabar su tramo (20 s)."
  fi
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$CARRIL_DIR/$nombre.pid"
}

coger() {
  guardian e2e "e2e-carril ${CARRIL_YO:-?}"
  local t0 n; t0=$(date +%s)
  n=$(esperar_linea 'carril ' | awk '{print $2}') || { matar_guardian; exit 1; }
  if [ -z "$n" ] || [ "$n" = 0 ]; then
    echo "::error::Los $MAX carriles siguen cogidos tras ${ESPERA_MIN} min de espera. Los tienen: $(quien_carriles)"
    matar_guardian; exit 1
  fi
  echo "$n" > "$CARRIL_DIR/numero"
  if grep -q '^carril-espera' "$CARRIL_DIR/guardian.log"; then
    echo "::notice title=Espera al carril::Carril $n cogido tras $(( $(date +%s) - t0 )) s en cola: estaban los $MAX cogidos (${CARRIL_YO:-?})."
  else
    echo "::notice title=Espera al carril::Carril $n cogido en $(( $(date +%s) - t0 )) s (${CARRIL_YO:-?})."
  fi
}

# La barrera, para un fichero de pruebas (o el clon). Escribe en
# $CARRIL_DIR/barrera.espera los segundos que ha esperado.
barrera_yo() { echo "e2e-barrera ${CARRIL_YO:-?}${BARRERA_QUE:+ · $BARRERA_QUE}"; }
barrera_entrar() {
  matar_guardian barrera
  guardian barrera "$(barrera_yo)" barrera "$BARRERA_MIN"
  local t0 otros; t0=$(date +%s)
  esperar_linea 'dentro' barrera > /dev/null || {
    otros=$(quien_hay)
    echo "::error::Sin la barrera en ${BARRERA_MIN} min: se está aplicando algo a staging. La tienen: ${otros:-nadie}"
    matar_guardian barrera; return 1
  }
  local e=$(( $(date +%s) - t0 ))
  echo "$e" > "$CARRIL_DIR/barrera.espera"
  if [ "$e" -ge 5 ]; then echo "Barrera cogida tras $e s: se estaba aplicando algo a staging."; fi
}
barrera_salir() { matar_guardian barrera; }

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
    # Borrar también escribe en staging: con la barrera, para no hacerlo en
    # mitad de una aplicación (el 26/10, un borrar a las 13:22:39 cayó dentro
    # del ensayo de vuelta atrás y le cambió las cuentas).
    if BARRERA_QUE=borrar barrera_entrar; then
      borrar || echo "::warning::No se ha podido borrar el carril $(cat "$CARRIL_DIR/numero"): lo borra el próximo que lo coja."
    else
      echo "::warning::Sin la barrera no se borra el carril $(cat "$CARRIL_DIR/numero"): lo borra el próximo que lo coja."
    fi
  fi
  matar_guardian barrera
  matar_guardian
  rm -f "$CARRIL_DIR/numero"
  echo "Carril soltado."
}

migrar_coger() {
  guardian migrar "e2e-migrar ${CARRIL_YO:-?}" guardian "$MIGRAR_MIN"
  local t0; t0=$(date +%s)
  local otros; otros=$(quien_hay)
  [ -n "$otros" ] && echo "Esperando a que acaben: $otros"
  esperar_linea 'migrar-cogido' > /dev/null || { echo "::error::Sin el cerrojo de migrar en ${MIGRAR_MIN} min. Lo tienen: $(quien_hay)"; matar_guardian; exit 1; }
  echo "::notice title=Espera de la aplicación::Cerrojo de migrar cogido tras $(( $(date +%s) - t0 )) s: ningún fichero de prueba está corriendo en staging."
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
  barrera-entrar) barrera_entrar ;;
  barrera-salir) barrera_salir ;;
  clonar) clonar ;;
  borrar) borrar ;;
  soltar) soltar ;;
  plantilla-coger) plantilla_coger ;;
  plantilla-soltar) plantilla_soltar ;;
  migrar-coger) migrar_coger ;;
  migrar-soltar) migrar_soltar ;;
  ensayo) ensayo "${2:-}" ;;
  *) echo "uso: carril.sh coger|barrera-entrar|barrera-salir|clonar|borrar|soltar|plantilla-coger|plantilla-soltar|migrar-coger|migrar-soltar|ensayo [N]" >&2; exit 2 ;;
esac
