#!/usr/bin/env bash
# tests/conta/diez/libro-iva-local/ejecutar.sh
#
# I01b · El importador de los libros de IVA de Diez (libros-iva-importar.sql),
# ENTERO, contra un Postgres local con el esquema mínimo (esquema.sql: los
# nombres de columna medidos en producción el 18/10) y datos inventados. Los
# cinco caminos: ensayo (verde, nada escrito), real (escribe), real otra vez
# (no duplica), testigo que no casa (rojo, deshecho, código ≠ 0) y una cuota
# cambiada (rechazo, rojo, nada escrito). No toca staging ni producción.
#
#   PGHOST=/ruta/al/socket PGPORT=54329 PGUSER=postgres bash tests/conta/diez/libro-iva-local/ejecutar.sh
set -euo pipefail
cd "$(dirname "$0")"
I=../../../../scripts/conta/diez/libros-iva-importar.sql
nueva() { psql -d postgres -qc "drop database if exists $1" -c "create database $1" >/dev/null; psql -d "$1" -q -v ON_ERROR_STOP=1 -f esquema.sql >/dev/null; }
corre() { psql -d "$1" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=terse -v empresa=e0000000-0000-4000-8000-000000000001 -v modo="$2" -v desde=2026-01-01 -v hasta=2026-06-30 -f "$I" 2>&1; }
falla() { echo "MAL: $1"; exit 1; }

nueva libro_a
o=$(corre libro_a ensayo) || falla "el ensayo sale en rojo"
grep -q '@@ verde 1' <<<"$o" && grep -q '@@ ensayo_nada_escrito 1' <<<"$o" && ! grep -q '@@ testigo.no_casa' <<<"$o" \
  && grep -q '@@ recibidas.autoliquidadas 1' <<<"$o" && grep -q '@@ recibidas.autoliquidadas_sin_pais 0' <<<"$o" \
  && grep -q '@@ autoliq.1t.con_prefijo.pais.alemania 1' <<<"$o" && grep -q '@@ autoliq.1t.con_prefijo.tipo_op.vacio 1' <<<"$o" \
  && grep -q '@@ autoliquidadas_fuera_de_la_lista 0' <<<"$o" && grep -q '@@ autoliquidadas.intracomunitaria 1' <<<"$o" \
  && grep -q '@@ autoliquidadas.prefijo_contradice_la_lista 0' <<<"$o" || falla "ensayo: $o"
o=$(corre libro_a real) || falla "el real sale en rojo"
grep -q '@@ filas_traidas_despues 8' <<<"$o" && grep -q '@@ tramos_sin_linea_propia 1' <<<"$o" || falla "real: $o"
# Una fila del libro por línea del diario; y el doc 4 (una 472 por tipo): cada tramo, la línea de su importe.
[ "$(psql -d libro_a -Atc "select count(*) - count(distinct line_id) from public.vat_book_entry where line_id is not null")" = 0 ] || falla "dos tramos con la misma línea"
[ "$(psql -d libro_a -Atc "select string_agg(round(v.tax_amount * 100)::text || '=' || round((l.debit - l.credit) * 100)::text, ',' order by v.tax_amount) from public.vat_book_entry v join public.journal_line l on l.id = v.line_id where v.entry_id = '10000000-0000-4000-8000-000000000006'")" = '1000=1000,2100=2100' ] || falla "doc 4: los tramos no van con la línea de su importe"
o=$(corre libro_a real) || falla "el segundo real sale en rojo"
grep -q '@@ filas_escritas 0' <<<"$o" && grep -q '@@ facturas_que_ya_estaban 6' <<<"$o" || falla "segundo real: $o"

t=$(mktemp -d); cp libro.jsonl autoliquidadas.csv "$t/"; sed 's/,29,.*/,29,0000000000000000/' testigo-303.csv > "$t/testigo-303.csv"
nueva libro_b
o=$(cd "$t" && psql -d libro_b -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=terse -v empresa=e0000000-0000-4000-8000-000000000001 -v modo=real -v desde=2026-01-01 -v hasta=2026-06-30 -f "$OLDPWD/$I" 2>&1) && falla "testigo que no casa: salió en verde"
grep -q '@@ real_en_rojo_deshecho 1' <<<"$o" && grep -q '@@ filas_traidas_despues 0' <<<"$o" || falla "testigo que no casa: $o"
# Y dice cuál no casa (fechas y casilla, ningún importe).
grep -q '@@ testigo.no_casa.20260101_0630.c29 1' <<<"$o" && [ "$(grep -c '@@ testigo.no_casa' <<<"$o")" = 1 ] || falla "testigo que no casa: no dice cuál: $o"
sed 's/"cuota": 10500/"cuota": 10400/' libro.jsonl > "$t/libro.jsonl"; cp testigo-303.csv "$t/"
o=$(cd "$t" && psql -d libro_b -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=terse -v empresa=e0000000-0000-4000-8000-000000000001 -v modo=real -v desde=2026-01-01 -v hasta=2026-06-30 -f "$OLDPWD/$I" 2>&1) && falla "cuota cambiada: salió en verde"
grep -q '@@ facturas_con_cuota_distinta_de_su_asiento 1' <<<"$o" && grep -q '@@ filas_traidas_despues 0' <<<"$o" || falla "cuota cambiada: $o"
# Una autoliquidada que no está en la lista: PARA, nada escrito (no se adivina su casilla).
cp libro.jsonl testigo-303.csv "$t/"; : > "$t/autoliquidadas.csv"
o=$(cd "$t" && psql -d libro_b -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=terse -v empresa=e0000000-0000-4000-8000-000000000001 -v modo=real -v desde=2026-01-01 -v hasta=2026-06-30 -f "$OLDPWD/$I" 2>&1) && falla "autoliquidada fuera de la lista: salió en verde"
grep -q '@@ autoliquidadas_fuera_de_la_lista 1' <<<"$o" && grep -q '@@ filas_escritas 0' <<<"$o" && grep -q '@@ filas_traidas_despues 0' <<<"$o" || falla "autoliquidada fuera de la lista: $o"
# La lista dice «otra_isp» de una con prefijo de la UE: lo dice, y la [37] ya no casa.
printf '2026,2,2,otra_isp\n' > "$t/autoliquidadas.csv"
o=$(cd "$t" && psql -d libro_b -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=terse -v empresa=e0000000-0000-4000-8000-000000000001 -v modo=ensayo -v desde=2026-01-01 -v hasta=2026-06-30 -f "$OLDPWD/$I" 2>&1) && falla "lista contradicha: salió en verde"
grep -q '@@ autoliquidadas.prefijo_contradice_la_lista 1' <<<"$o" && grep -q '@@ testigo.no_casa.20260101_0331.c37 1' <<<"$o" || falla "lista contradicha: $o"
rm -rf "$t"
echo "BIEN: los cinco caminos (ensayo, real, real otra vez, testigo que no casa, cuota cambiada), una fila del libro por línea del diario, y la lista de autoliquidadas (fuera de ella para; el prefijo que la contradice se dice)."
