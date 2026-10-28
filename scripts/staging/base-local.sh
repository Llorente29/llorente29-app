#!/usr/bin/env bash
# scripts/staging/base-local.sh
#
# W09 (Julio, 28/10) · Una base en local igual a staging-conta, con las
# semillas, para probar SQL (las pruebas de supabase/staging/sql) sin esperar a
# un run. Sin un dato de staging: la ESTRUCTURA sale de la rama
# estructura/staging (estructura-staging.yml) y las filas, de las semillas del
# repositorio.
#
#   scripts/staging/base-local.sh [--sin-semillas] [--esquema <fichero>]
#
# Variables (todas opcionales):
#   PGHOST, PGPORT, PGUSER   el PostgreSQL local, con un usuario que pueda crear
#                            bases y roles (por defecto, lo que diga libpq).
#   BASE                     el nombre de la base (por defecto staging_local).
#                            SE BORRA Y SE CREA DE NUEVO.
#   CLAVE_PRUEBAS            la contraseña de los usuarios de prueba (por
#                            defecto una al azar, que se escribe al final).
#
# Qué hace, en orden:
#   1. la estructura: estructura/staging (o --esquema), limpia para la versión
#      local (la 16 no conoce el `SET transaction_timeout` del pg_dump 17);
#   2. la base nueva, con los roles que nombra (anon, authenticated…) y las
#      extensiones de staging (pgcrypto y uuid-ossp en `extensions`; postgis,
#      pg_trgm y unaccent en `public`). pg_net, pg_cron y vault no existen en
#      local: sus esquemas van vacíos, y lo que los llame falla al ejecutarse,
#      no al cargar;
#   3. la estructura entera, en una transacción;
#   4. las filas de catálogo (datos.sql: plan contable, impuestos, países,
#      funcion_respaldo, el historial…), en otra, sin disparadores;
#   5. las semillas (supabase/seeds), cada una en su transacción, en el orden
#      que dice su CONTENIDO, porque git no lo sabe (entraron todas en el mismo
#      commit, el 23/10):
#        · la C01 primero: crea las cuentas A y B;
#        · después las que se niegan a cargar si hay más cuentas que A y B
#          (su guarda dice «cuentas que no son de prueba»): en staging se
#          aplicaron antes de que existieran C y D. Entre ellas, primero las
#          que no crean ninguna cuenta;
#        · y las demás por pasadas, hasta que en una no entre ninguna más.
#      Una que no carga se dice y se sigue: al final, cuáles no y por qué (el
#      error de su último intento), sin esconder ninguna.
#
# Lo que esto NO es: staging. No tiene sus cuentas (solo las de las semillas),
# ni pg_cron, ni las funciones de borde. Sirve para probar SQL, no para una e2e.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

SEMILLAS=1
ESQUEMA=''
DATOS=''
while [ $# -gt 0 ]; do
  case "$1" in
    --sin-semillas) SEMILLAS=0 ;;
    --esquema) ESQUEMA="$2"; shift ;;
    --datos) DATOS="$2"; shift ;;
    *) echo "Uso: $0 [--sin-semillas] [--esquema <fichero>] [--datos <fichero>]" >&2; exit 2 ;;
  esac
  shift
done
BASE="${BASE:-staging_local}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-15}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
psqlb() { psql -X -q -v ON_ERROR_STOP=1 -d "$BASE" "$@"; }

# 1 · La estructura
if [ -z "$ESQUEMA" ]; then
  git fetch -q origin "refs/heads/estructura/staging:refs/remotes/origin/estructura-staging"
  git show origin/estructura-staging:supabase/staging/esquema.sql > "$TMP/crudo.sql"
  echo "Estructura: estructura/staging ($(git log -1 --format='%h · %s' origin/estructura-staging))."
else
  cp "$ESQUEMA" "$TMP/crudo.sql"; echo "Estructura: $ESQUEMA."
fi
if [ -z "$DATOS" ]; then
  git show origin/estructura-staging:supabase/staging/datos.sql > "$TMP/datos.sql" 2>/dev/null \
    || { echo "✗ estructura/staging no tiene datos.sql todavía: lanza estructura-staging.yml." >&2; exit 1; }
else
  cp "$DATOS" "$TMP/datos.sql"
fi
VERSION=$(psql -X -At -d postgres -c 'show server_version_num')
if [ "$VERSION" -lt 170000 ]; then OPC=--para-16; else OPC=''; fi
node scripts/staging/esquema.mjs limpiar "$TMP/crudo.sql" "$TMP/limpio.sql" $OPC
# public y extensions ya existen en una base nueva: sin chocar.
sed -E 's/^CREATE SCHEMA ([a-z_0-9]+);/CREATE SCHEMA IF NOT EXISTS \1;/' "$TMP/limpio.sql" > "$TMP/esquema.sql"

# 2 · La base, los roles y las extensiones
dropdb --if-exists "$BASE"
createdb "$BASE"
{
  echo "do \$\$ declare r text; begin"
  for r in $(node scripts/staging/esquema.mjs roles "$TMP/esquema.sql") anon authenticated service_role authenticator; do
    echo "  if not exists (select 1 from pg_roles where rolname = '$r') then execute format('create role %I nologin', '$r'); end if;"
  done
  echo "end \$\$;"
  echo "grant anon, authenticated, service_role to authenticator;"
  echo "create schema if not exists extensions;"
  echo "create extension if not exists pgcrypto with schema extensions;"
  echo 'create extension if not exists "uuid-ossp" with schema extensions;'
  echo "create extension if not exists postgis with schema public;"
  echo "create extension if not exists pg_trgm with schema public;"
  echo "create extension if not exists unaccent with schema public;"
  echo "create schema if not exists net; create schema if not exists cron; create schema if not exists vault; create schema if not exists storage;"
  echo "alter database \"$BASE\" set search_path = \"\$user\", public, extensions;"
} > "$TMP/preparar.sql"
psqlb -f "$TMP/preparar.sql"

# 3 · La estructura, entera y en una transacción
psqlb -1 -f "$TMP/esquema.sql" > "$TMP/carga.log" 2>&1 || { tail -20 "$TMP/carga.log" >&2; echo "✗ La estructura no carga (arriba, el error)." >&2; exit 1; }
echo "Estructura cargada: $(psql -X -At -d "$BASE" -c "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'") tablas y $(psql -X -At -d "$BASE" -c "select count(*) from pg_proc where pronamespace = 'public'::regnamespace") funciones en public."

# 4 · Las filas de catálogo, sin disparadores ni claves ajenas (replica)
psqlb -1 -f "$TMP/datos.sql" > "$TMP/datos.log" 2>&1 || { tail -20 "$TMP/datos.log" >&2; echo "✗ Las filas de catálogo no cargan (arriba, el error)." >&2; exit 1; }
echo "Catálogos cargados: $(grep -c '^COPY ' "$TMP/datos.sql") tablas, $(($(wc -l < "$TMP/datos.sql") - 2 * $(grep -c '^COPY ' "$TMP/datos.sql") - 3)) filas."

# 5 · Las semillas, en el orden que dice su contenido (arriba, en la cabecera).
if [ "$SEMILLAS" = 1 ]; then
  CLAVE="${CLAVE_PRUEBAS:-$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 16)}"
  HASH=$(echo "select extensions.crypt(:'clave', extensions.gen_salt('bf', 10));" | psql -X -At -d "$BASE" -v clave="$CLAVE")
  C01=supabase/seeds/conta/seed_c01_staging.sql
  git ls-files 'supabase/seeds/*.sql' | grep -vx "$C01" > "$TMP/resto.txt"
  { echo "$C01"
    xargs grep -l 'cuentas que no son de prueba' < "$TMP/resto.txt" > "$TMP/guarda.txt" || true
    xargs grep -L 'insert into \(public\.\)\?accounts' < "$TMP/guarda.txt" || true
    xargs grep -l 'insert into \(public\.\)\?accounts' < "$TMP/guarda.txt" || true
    xargs grep -L 'cuentas que no son de prueba' < "$TMP/resto.txt" || true
  } > "$TMP/pendientes.txt"
  mkdir -p "$TMP/errores"
  cargadas=0; pasada=0
  while :; do
    pasada=$((pasada + 1)); : > "$TMP/siguen.txt"; n=0
    while read -r f; do
      sed "s|__HASH_CLAVE_PRUEBAS__|$HASH|g" "$f" > "$TMP/semilla.sql"
      if psqlb -1 -f "$TMP/semilla.sql" > "$TMP/semilla.log" 2>&1; then n=$((n + 1))
      else echo "$f" >> "$TMP/siguen.txt"; grep -m1 'ERROR' "$TMP/semilla.log" | sed 's/^psql:[^ ]* //' > "$TMP/errores/$(echo "$f" | tr / _)"; fi
    done < "$TMP/pendientes.txt"
    cargadas=$((cargadas + n)); cp "$TMP/siguen.txt" "$TMP/pendientes.txt"
    echo "  pasada $pasada: entran $n."
    [ "$n" -eq 0 ] || [ ! -s "$TMP/pendientes.txt" ] && break
  done
  echo "Semillas: $cargadas cargadas, $(wc -l < "$TMP/pendientes.txt") no."
  while read -r f; do echo "  ✗ $f: $(cat "$TMP/errores/$(echo "$f" | tr / _)")"; done < "$TMP/pendientes.txt"
  [ -n "${CLAVE_PRUEBAS:-}" ] || echo "Contraseña de los usuarios de prueba: $CLAVE"
fi
echo "Lista: psql -d $BASE"
