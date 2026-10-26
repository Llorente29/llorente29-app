#!/usr/bin/env bash
# scripts/conta/staging/de-verdad.sh <rama> <fichero.sql>...
#
# W06 (26/10) · Aplica DE VERDAD en staging lo que la rama solo añade (W05), y
# deja escrito en w06_staging qué fue y cómo estaba ANTES cada definición que
# tocó. compara.sh lo lee en el push siguiente: lo que ya está en staging se
# deshace primero y se comprueba que vuelve a como estaba antes de ir de verdad
# (si no, la vuelta atrás quitaría algo que «antes» ya tenía, y saldría distinto
# sin estar mal; o, al revés, se quedaría algo y nadie lo vería).
#
# Cada fichero, en su transacción (-1), como antes del W06. El registro, con
# lo que había la PRIMERA vez que la rama lo cambió: una definición que ya
# está registrada no se pisa.
#
# Entorno: PSQL, DB_URL. Imprime una línea por fichero aplicado.
set -euo pipefail
rama="${1:?rama}"; shift
[ "$#" -gt 0 ] || exit 0
FOTO=scripts/conta/staging/foto-definiciones.sql
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
q() { "$PSQL" "$DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

q <<'SQL'
create schema if not exists w06_staging;
comment on schema w06_staging is 'W06 · Solo staging: qué fue de verdad desde cada rama (W05) y cómo estaba antes. Lo lee scripts/conta/staging/compara.sh.';
create table if not exists w06_staging.de_verdad (
  rama text not null, fichero text not null, md5 text not null, cuando timestamptz not null default now(),
  primary key (rama, fichero));
create table if not exists w06_staging.antes_de_verdad (
  rama text not null, clave text not null, valor text,   -- valor vacío: no existía
  primary key (rama, clave));
SQL

q -A -t --csv -f "$FOTO" > "$T/antes.csv"
for f in "$@"; do
  q -1 -f "$f"
  echo "insert into w06_staging.de_verdad (rama, fichero, md5) values (:'rama', :'f', :'md5')
        on conflict (rama, fichero) do update set md5 = excluded.md5, cuando = now();" \
    | q -v rama="$rama" -v f="$f" -v md5="$(md5sum "$f" | cut -d' ' -f1)"
  echo "aplicado de verdad: $f"
done
q -A -t --csv -f "$FOTO" > "$T/despues.csv"
node scripts/conta/staging/definiciones-comparar.mjs delta "$T/antes.csv" "$T/despues.csv" > "$T/delta.csv"
n=$(grep -c . "$T/delta.csv" || true)
q -v rama="$rama" <<SQL
create temp table d (clave text, valor text);
\copy d from '$T/delta.csv' with (format csv)
insert into w06_staging.antes_de_verdad (rama, clave, valor)
select :'rama', clave, valor from d
on conflict (rama, clave) do nothing;
SQL
echo "Registradas $n definiciones que la rama cambió en staging, con cómo estaban antes."
