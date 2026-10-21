#!/usr/bin/env bash
# tests/conta/diez/libro-iva-local/ejecutar.sh
#
# I01b · El importador de los libros de IVA de Diez (libros-iva-importar.sql),
# ENTERO, contra un Postgres local con el esquema mínimo (esquema.sql: los
# nombres de columna medidos en producción) y datos inventados. No toca
# staging ni producción.
#
# I01c · pieza 2 (19/10): el testigo son las casillas de los 303 PRESENTADOS
# (tax_return_box con origen «justificante»), no un fichero de huellas. Los
# caminos: ensayo (verde, nada escrito), real (escribe), real otra vez (no
# duplica), una cuota del impreso que no casa (rojo, deshecho, dice cuál), una
# BASE que no casa (se dice, no para), falta el 303 de un trimestre (rojo, nada
# escrito), una cuota de la factura cambiada (rechazo), una autoliquidada
# fuera de la lista (para y dice CUÁL) y la lista que contradice al prefijo.
#
#   PGHOST=/ruta/al/socket PGPORT=54329 PGUSER=postgres bash tests/conta/diez/libro-iva-local/ejecutar.sh
set -euo pipefail
cd "$(dirname "$0")"
I=../../../../scripts/conta/diez/libros-iva-importar.sql
E=e0000000-0000-4000-8000-000000000001
nueva() { psql -d postgres -qc "drop database if exists $1" -c "create database $1" >/dev/null; psql -d "$1" -q -v ON_ERROR_STOP=1 -f esquema.sql >/dev/null; }
corre() { psql -d "$1" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=terse -v empresa=$E -v modo="$2" -v desde=2026-01-01 -v hasta="${3:-2026-06-30}" -f "$I" 2>&1; }
# Desde una carpeta con otra carga (libro.jsonl y autoliquidadas.csv).
corre_en() { (cd "$1" && psql -d "$2" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=terse -v empresa=$E -v modo="$3" -v desde=2026-01-01 -v hasta=2026-06-30 -f "$OLDPWD/$I" 2>&1); }
sql() { psql -d "$1" -Atqc "$2"; }
falla() { echo "MAL: $1"; exit 1; }

nueva libro_a
o=$(corre libro_a ensayo) || falla "el ensayo sale en rojo: $o"
grep -q '@@ verde 1' <<<"$o" && grep -q '@@ ensayo_nada_escrito 1' <<<"$o" \
  && grep -q '@@ recibidas.autoliquidadas 1' <<<"$o" && grep -q '@@ recibidas.autoliquidadas_sin_pais 0' <<<"$o" \
  && grep -q '@@ autoliq.1t.con_prefijo.pais.alemania 1' <<<"$o" && grep -q '@@ autoliq.1t.con_prefijo.tipo_op.vacio 1' <<<"$o" \
  && grep -q '@@ autoliquidadas_fuera_de_la_lista 0' <<<"$o" && grep -q '@@ autoliquidadas.intracomunitaria 1' <<<"$o" \
  && grep -q '@@ autoliquidadas.prefijo_contradice_la_lista 0' <<<"$o" || falla "ensayo: $o"
# El testigo: las cuotas del impreso, una a una. [06], [11] y [37] por trimestre; la [29], del
# semestre (el impreso la reparte 84/83 y el libro 105/62: por trimestre no casaría, el semestre sí).
# Y el 303 de la otra cuenta (regla 9) no entra: si entrara, la [06] del 1T no casaría.
grep -q '@@ testigo.cuotas 5' <<<"$o" && grep -q '@@ testigo.cuotas_que_no_casan 0' <<<"$o" \
  && grep -q '@@ testigo.1t.c06.casa 1' <<<"$o" && grep -q '@@ testigo.2t.c06.casa 1' <<<"$o" \
  && grep -q '@@ testigo.1t.c11.casa 1' <<<"$o" && grep -q '@@ testigo.1t.c37.casa 1' <<<"$o" \
  && grep -q '@@ testigo.1t_2t.c29.casa 1' <<<"$o" && ! grep -q '@@ testigo.1t.c29' <<<"$o" \
  && grep -q '@@ testigo_base.1t_2t.c28.casa 1' <<<"$o" && grep -q '@@ testigo.bases_que_no_casan 0' <<<"$o" || falla "ensayo · testigo: $o"
o=$(corre libro_a real) || falla "el real sale en rojo"
grep -q '@@ filas_traidas_despues 8' <<<"$o" && grep -q '@@ tramos_sin_linea_propia 1' <<<"$o" || falla "real: $o"
# Una fila del libro por línea del diario; y el doc 4 (una 472 por tipo): cada tramo, la línea de su importe.
[ "$(sql libro_a "select count(*) - count(distinct line_id) from public.vat_book_entry where line_id is not null")" = 0 ] || falla "dos tramos con la misma línea"
[ "$(sql libro_a "select string_agg(round(v.tax_amount * 100)::text || '=' || round((l.debit - l.credit) * 100)::text, ',' order by v.tax_amount) from public.vat_book_entry v join public.journal_line l on l.id = v.line_id where v.entry_id = '10000000-0000-4000-8000-000000000006'")" = '1000=1000,2100=2100' ] || falla "doc 4: los tramos no van con la línea de su importe"
o=$(corre libro_a real) || falla "el segundo real sale en rojo"
grep -q '@@ filas_escritas 0' <<<"$o" && grep -q '@@ facturas_que_ya_estaban 6' <<<"$o" || falla "segundo real: $o"

t=$(mktemp -d); cp libro.jsonl autoliquidadas.csv "$t/"

# Una CUOTA del impreso que no casa: rojo, deshecho, y dice cuál (ámbito y casilla, ningún importe).
nueva libro_b
sql libro_b "update public.tax_return_box set value = 80 where tax_return_id = '30000000-0000-4000-8000-000000000002' and box = '29'" >/dev/null
o=$(corre libro_b real) && falla "cuota del impreso que no casa: salió en verde"
grep -q '@@ real_en_rojo_deshecho 1' <<<"$o" && grep -q '@@ filas_traidas_despues 0' <<<"$o" \
  && grep -q '@@ testigo.cuotas_que_no_casan 1' <<<"$o" && grep -q '@@ testigo.1t_2t.c29.casa 0' <<<"$o" || falla "cuota que no casa: $o"
# Y la CLASE de la diferencia, sin importes (20/10): mismo signo y libro/303 = 167/164 → 102 %. Las que casan, sin clase.
grep -q '@@ testigo.1t_2t.c29.signo 1' <<<"$o" && grep -q '@@ testigo.1t_2t.c29.razon 102' <<<"$o" \
  && ! grep -q '@@ testigo.1t.c06.signo' <<<"$o" || falla "cuota que no casa · clase: $o"
r=$(grep '^@@' <<<"$o" | node ../../../../scripts/conta/salida-segura.mjs | grep -o 'retenidas por la puerta de salida: [0-9]*')
[ "$r" = 'retenidas por la puerta de salida: 0' ] || falla "la clase de la diferencia no pasa la puerta: $r"

# Una BASE que no casa: se dice, y no para.
nueva libro_b
sql libro_b "update public.tax_return_box set value = 999 where tax_return_id = '30000000-0000-4000-8000-000000000001' and box = '04'" >/dev/null
o=$(corre libro_b ensayo) || falla "base que no casa: salió en rojo: $o"
grep -q '@@ verde 1' <<<"$o" && grep -q '@@ testigo_base.1t.c04.casa 0' <<<"$o" && grep -q '@@ testigo.bases_que_no_casan 1' <<<"$o" || falla "base que no casa: $o"

# Falta el 303 PRESENTADO del 2T (en borrador, o sin casillas del justificante): rojo, nada escrito, y dice cuál.
nueva libro_b
sql libro_b "update public.tax_return set status = 'draft' where id = '30000000-0000-4000-8000-000000000002'" >/dev/null
o=$(corre libro_b real) && falla "sin el 303 del 2T: salió en verde"
grep -q '@@ testigo.falta_el_303_presentado_del_2t 1' <<<"$o" && ! grep -q 'falta_el_303_presentado_del_1t' <<<"$o" \
  && grep -q '@@ filas_escritas 0' <<<"$o" && grep -q '@@ filas_traidas_despues 0' <<<"$o" || falla "sin el 303 del 2T: $o"
nueva libro_b
sql libro_b "update public.tax_return_box set origin = 'calculated' where tax_return_id = '30000000-0000-4000-8000-000000000002'" >/dev/null
o=$(corre libro_b real) && falla "303 del 2T sin justificante: salió en verde"
grep -q '@@ testigo.falta_el_303_presentado_del_2t 1' <<<"$o" && grep -q '@@ filas_traidas_despues 0' <<<"$o" || falla "303 del 2T sin justificante: $o"
# Y solo el 1T (hasta el 31/03), con el 2T sin presentar: el 2T no hace falta para traer el 1T.
# (La [29] del 1T sola no casa —la gestoría la repartió con el 2T—: eso es lo que diría de verdad.)
o=$(corre libro_b ensayo 2026-03-31) && falla "solo el 1T: la [29] del 1T sola no debería casar"
! grep -q 'falta_el_303' <<<"$o" && grep -q '@@ testigo.1t.c06.casa 1' <<<"$o" && grep -q '@@ testigo.1t.c29.casa 0' <<<"$o" || falla "solo el 1T: $o"

# Una cuota de la FACTURA cambiada: rechazo, nada escrito.
nueva libro_b
sed 's/"cuota": 10500/"cuota": 10400/' libro.jsonl > "$t/libro.jsonl"
o=$(corre_en "$t" libro_b real) && falla "cuota cambiada: salió en verde"
grep -q '@@ facturas_con_cuota_distinta_de_su_asiento 1' <<<"$o" && grep -q '@@ filas_traidas_despues 0' <<<"$o" || falla "cuota cambiada: $o"

# Una autoliquidada que no está en la lista: PARA, nada escrito, y dice CUÁL (su asiento; Julio, 19/10).
cp libro.jsonl "$t/"; : > "$t/autoliquidadas.csv"
o=$(corre_en "$t" libro_b real) && falla "autoliquidada fuera de la lista: salió en verde"
grep -q '@@ autoliquidadas_fuera_de_la_lista 1' <<<"$o" && grep -q '@@ autoliquidada_fuera_de_la_lista.2026_s2 2' <<<"$o" \
  && grep -q '@@ filas_escritas 0' <<<"$o" && grep -q '@@ filas_traidas_despues 0' <<<"$o" || falla "autoliquidada fuera de la lista: $o"
# Sin libro escrito no hay nada que medir: el testigo lo dice y no da «no casa» (el ensayo #6, 20/10: 9 de 9).
grep -q '@@ testigo.no_se_mide_sin_libro 1' <<<"$o" && ! grep -q 'testigo.cuotas_que_no_casan' <<<"$o" \
  && ! grep -q '\.casa 0' <<<"$o" || falla "sin libro, el testigo: $o"

# La lista dice «otra_isp» de una con prefijo de la UE: lo dice, y la [37] del impreso ya no casa.
printf '2026,2,2,otra_isp\n' > "$t/autoliquidadas.csv"
o=$(corre_en "$t" libro_b ensayo) && falla "lista contradicha: salió en verde"
grep -q '@@ autoliquidadas.prefijo_contradice_la_lista 1' <<<"$o" && grep -q '@@ testigo.1t.c37.casa 0' <<<"$o" \
  && grep -q '@@ testigo.1t.c37.signo 0' <<<"$o" && grep -q '@@ testigo.1t.c37.razon 0' <<<"$o" || falla "lista contradicha: $o"
rm -rf "$t"

# Lo que sale es solo lo que deja pasar la puerta de salida: ni una línea «@@» retenida.
nueva libro_c
o=$(corre libro_c ensayo) || falla "ensayo de la puerta: $o"
r=$(grep '^@@' <<<"$o" | node ../../../../scripts/conta/salida-segura.mjs | grep -o 'retenidas por la puerta de salida: [0-9]*')
[ "$r" = 'retenidas por la puerta de salida: 0' ] || falla "la puerta de salida retiene líneas: $r"
echo "BIEN: ensayo, real y real otra vez; el testigo de los 303 presentados (cuotas por trimestre, la [29] del semestre, otra cuenta fuera); una cuota que no casa para y dice cuál; una base que no casa se dice y no para; sin el 303 presentado de un trimestre para y dice cuál; cuota de factura cambiada; autoliquidada fuera de la lista para y dice cuál; la lista contradicha; sin libro el testigo no mide; la clase de cada diferencia (signo y razón, sin importes); y todo pasa la puerta de salida."
