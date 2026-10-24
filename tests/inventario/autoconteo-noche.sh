#!/usr/bin/env bash
# tests/inventario/autoconteo-noche.sh
#
# Lo que la prueba de staging NO puede probar porque corre dentro de una
# transacción con ROLLBACK (supabase/staging/sql/20261129_autoconteo_prueba.sql):
#
#   · LA NOCHE DE VERDAD: `call autoconteo_cierre_nocturno()` fuera de
#     transacción, como lo llama pg_cron. Con un conteo que falla a propósito,
#     el procedimiento TIENE QUE TERMINAR EN ERROR (pg_cron en rojo) y aun así
#     dejar CONFIRMADO lo que sí aplicó (COMMIT por conteo), apuntado el fallo
#     en la fila y su aviso en system_alert_queue.
#   · LA 0390 con las 23 filas de producción tal como se midieron el 21/10:
#     anula las 23; con una fila tocada, para y no anula ninguna; y su vuelta
#     atrás las deja como estaban.
#   · LAS DOS VUELTAS ATRÁS: después de la .down.sql de la 0400, las cuatro
#     funciones tienen la MISMA huella md5 que en producción el 21/10 y no
#     queda nada de lo añadido.
#
# Sobre una base de juguete (base-de-juguete.sql): las tablas de conteo con las
# columnas de producción y stubs de lo que la 0400 no toca. Necesita un
# PostgreSQL (16 o 17) local; no toca ninguna base de verdad.
#
#   PGPORT=55432 PGHOST=/tmp tests/inventario/autoconteo-noche.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=autoconteo_juguete_$$
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -U "${PGUSER:-postgres}" -d "$DB")
# Cada fichero de la tanda en UNA transacción, como psql -1 en el workflow.
PSQL1=("${PSQL[@]}" -1)
dropdb -U "${PGUSER:-postgres}" --if-exists "$DB" >/dev/null 2>&1 || true
createdb -U "${PGUSER:-postgres}" "$DB"
trap 'dropdb -U "${PGUSER:-postgres}" --if-exists "$DB" >/dev/null 2>&1 || true' EXIT

DOWN360=supabase/vuelta-atras/20261129T0400_autoconteo_se_aplica_entero.down.sql
ORIG=$(mktemp)
# Las cuatro funciones de producción, tal cual las guarda la vuelta atrás.
python3 - "$DOWN360" > "$ORIG" <<'PY'
import re, sys
t = open(sys.argv[1], encoding='utf-8').read()
for m in re.finditer(r'CREATE OR REPLACE FUNCTION public\.\w+\(.*?\$function\$\n;', t, re.S):
    print(m.group(0).replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION', 1))
PY

"${PSQL[@]}" -f tests/inventario/base-de-juguete.sql >/dev/null
"${PSQL[@]}" -f "$ORIG" >/dev/null
"${PSQL[@]}" -f tests/inventario/autoconteo-noche-siembra.sql >/dev/null

echo "· huellas de producción (antes)"
"${PSQL[@]}" -At -c "select string_agg(proname || '=' || md5(pg_get_functiondef(oid)), ' ' order by proname) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('apply_inventory_count','close_inventory_count','autoclose_daily_count','cron_autoclose_daily_counts')" | tee /tmp/huellas-antes.$$

echo "· la 0390 con una fila tocada: tiene que parar sin anular nada"
"${PSQL[@]}" -c "update public.inventory_count set status = 'en_revision' where code = 'INV-00316'"
if "${PSQL1[@]}" -f supabase/migrations/20261129T0390_autoconteo_anula_atascados.sql 2>/tmp/err350.$$; then
  echo "FALLA: la 0390 ha seguido con una fila tocada"; exit 1
fi
grep -q "INV-00316" /tmp/err350.$$ || { echo "FALLA: la 0390 no dice qué fila"; cat /tmp/err350.$$; exit 1; }
[ "$("${PSQL[@]}" -At -c "select count(*) from public.inventory_count where status = 'anulado'")" = 0 ] || { echo "FALLA: ha anulado algo"; exit 1; }
"${PSQL[@]}" -c "update public.inventory_count set status = 'contando' where code = 'INV-00316'"

echo "· la 0390 de verdad"
"${PSQL1[@]}" -f supabase/migrations/20261129T0390_autoconteo_anula_atascados.sql
[ "$("${PSQL[@]}" -At -c "select count(*) from public.inventory_count where status = 'anulado'")" = 23 ] || { echo "FALLA: no son 23"; exit 1; }
echo "· su vuelta atrás"
"${PSQL1[@]}" -f supabase/vuelta-atras/20261129T0390_autoconteo_anula_atascados.down.sql
FOTO="select md5(string_agg(id || status || coalesce(notes, '') || updated_at, '|' order by id)) from public.inventory_count"
[ "$("${PSQL[@]}" -At -c "$FOTO")" = "$("${PSQL[@]}" -At -c "select m from public._foto_siembra")" ] \
  || { echo "FALLA: la vuelta atrás de la 0390 no deja las filas byte a byte"; exit 1; }
[ "$("${PSQL[@]}" -At -c "select to_regclass('public.autoconteo_anulacion_20261021') is null")" = t ] || { echo "FALLA: queda la copia"; exit 1; }
"${PSQL1[@]}" -f supabase/migrations/20261129T0390_autoconteo_anula_atascados.sql

echo "· la 0400"
"${PSQL1[@]}" -f supabase/migrations/20261129T0400_autoconteo_se_aplica_entero.sql
"${PSQL[@]}" -f tests/inventario/autoconteo-noche-casos.sql >/dev/null

echo "· la noche de verdad (fuera de transacción): tiene que acabar en ERROR"
if "${PSQL[@]}" -c "call public.autoconteo_cierre_nocturno()" 2>/tmp/err-noche.$$; then
  echo "FALLA: la noche con un conteo roto ha terminado bien (pg_cron lo contaría verde)"; exit 1
fi
grep -q "Autoconteo de la noche: 1 sin aplicar" /tmp/err-noche.$$ || { echo "FALLA: el error no dice lo que es"; cat /tmp/err-noche.$$; exit 1; }
"${PSQL[@]}" -f tests/inventario/autoconteo-noche-comprobar.sql
"${PSQL[@]}" -At --csv -c "select clave, valor from public.autoconteo_vigia()" > /tmp/vigia.$$

echo "· la vuelta atrás de la 0400"
"${PSQL[@]}" -c "drop function public.rebase_count_system_qty(uuid); alter function public._rebase_juguete(uuid) rename to rebase_count_system_qty;"
"${PSQL1[@]}" -f "$DOWN360"
"${PSQL[@]}" -At -c "select string_agg(proname || '=' || md5(pg_get_functiondef(oid)), ' ' order by proname) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('apply_inventory_count','close_inventory_count','autoclose_daily_count','cron_autoclose_daily_counts')" > /tmp/huellas-despues.$$
esperadas=$(python3 -c "import json;h=json.load(open('tests/inventario/autoconteo-huellas.json'));print(' '.join(k+'='+h[k] for k in sorted(h) if k not in ('medido','para')))")
[ "$esperadas" = "$(cat /tmp/huellas-antes.$$)" ] || { echo "FALLA: lo copiado no es lo de producción del 21/10"; exit 1; }
diff /tmp/huellas-antes.$$ /tmp/huellas-despues.$$ || { echo "FALLA: después de la vuelta atrás las funciones no son las de producción"; exit 1; }
quedan=$("${PSQL[@]}" -At -c "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('_close_inventory_count_core','_apply_inventory_count_core','_autoconteo_aplicar','autoconteo_cierre_nocturno','autoconteos_sin_aplicar','autoconteo_vigia')
  union all select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'inventory_count' and column_name like 'auto_appl%'")
[ "$(echo $quedan)" = "0 0" ] || { echo "FALLA: la vuelta atrás deja cosas: $quedan"; exit 1; }
echo "huellas de producción después de la vuelta atrás: $(cat /tmp/huellas-despues.$$)"
[ -z "${GUARDAR_VIGIA:-}" ] || cp /tmp/vigia.$$ "$GUARDAR_VIGIA"
rm -f /tmp/*.$$ "$ORIG"
echo "EN VERDE: la noche acaba en error con lo bueno confirmado; la 0390 para con una fila tocada y anula 23 sin ella; las dos vueltas atrás dejan producción como estaba."
