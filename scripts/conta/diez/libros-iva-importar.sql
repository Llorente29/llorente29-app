-- scripts/conta/diez/libros-iva-importar.sql
--
-- I01b · Los libros de IVA de Diez · paso 2: ESCRIBIR, MEDIR y decidir. Todo
-- en UNA transacción, con el molde de importar.sql (el histórico, C04b):
--   1. carga libro.jsonl (las filas que dejó libros-iva-preparar.ts, una por
--      tramo de IVA). El TESTIGO no es un fichero (I01c · pieza 2, 19/10): son
--      las casillas de los 303 PRESENTADOS que Julio subió con su justificante
--      (tax_return_box con origen «justificante»), leídas aquí mismo, dentro de
--      la transacción. Cada trimestre del periodo tiene que tener el suyo;
--      si falta uno, no se escribe nada y se dice cuál;
--   2. cada factura, con su asiento traído de Diez de la empresa (ejercicio,
--      serie, documento). Rechazo si no lo tiene, o si la cuota de la factura
--      no es la 477 (expedidas) o la 472 (recibidas) de su asiento al céntimo;
--   3. idempotente: el asiento que ya tiene su libro no se toca (ya estaban);
--   4. escribe vat_book_entry (una fila por tramo), enganchada al asiento y a
--      su apunte de IVA; lo autoliquidado (una recibida cuyo asiento lleva 477
--      y 472) va como inversión del sujeto pasivo (S2), y con su país;
--   5. mide: cobertura (ningún asiento traído con IVA del periodo sin su
--      libro), las expedidas de cada trimestre contra la 477 del diario, las
--      recibidas de todo el periodo contra la 472, y las casillas de los 303
--      presentados contra el libro, al céntimo. Las CUOTAS deciden; las bases se
--      miden y se dicen, pero no paran (ver «El testigo», abajo);
--   6. ENSAYO: rollback, y comprueba que no queda nada escrito. REAL: commit
--      solo si está en verde; si no, rollback y en rojo.
--
-- Variables de psql: empresa (uuid), modo (ensayo | real), desde y hasta
-- (AAAA-MM-DD). Se ejecuta DESDE la carpeta de la carga (\copy no sustituye
-- variables en el nombre del fichero). La salida es «@@ clave valor» para
-- salida-segura.mjs: recuentos y sí/no, ningún importe ni ningún dato de nadie.

\set ON_ERROR_STOP on
\pset footer off
\pset tuples_only on
\pset format unaligned

select count(*) as antes from public.vat_book_entry where company_id = :'empresa'::uuid and source_type = 'migrated' \gset

begin;
set local statement_timeout = 0;
set local lock_timeout = '5s';
select set_config('libro.empresa', :'empresa', true), set_config('libro.desde', :'desde', true), set_config('libro.hasta', :'hasta', true) \g /dev/null

create temp table carga_linea (j jsonb) on commit drop;
-- Las autoliquidadas, clasificadas por lo que declaró la gestoría (autoliquidadas-foodint.csv).
create temp table carga_autoliq (ejercicio text, serie text, documento text, tipo text check (tipo in ('intracomunitaria', 'otra_isp'))) on commit drop;
create temp table salida (n serial, clave text, valor text) on commit drop;
-- JSON Lines: un objeto por línea; con un delimitador y una comilla que no
-- salen nunca, COPY no toca ni comillas ni barras.
\copy carga_linea from 'libro.jsonl' with (format csv, delimiter e'\x02', quote e'\x01')
\copy carga_autoliq from 'autoliquidadas.csv' with (format csv)

do $$
declare
  c constant uuid := current_setting('libro.empresa')::uuid;
  v_desde constant date := current_setting('libro.desde')::date;
  v_hasta constant date := current_setting('libro.hasta')::date;
  v_cuenta uuid; v_n int; v_rech int; v_falta int; v_mal int; v_test int; v_test_mal int; v_verde boolean; q record;
begin
  select account_id into v_cuenta from public.company where id = c;
  if v_cuenta is null then raise exception 'Esa empresa no existe.'; end if;
  if v_cuenta = '00000000-0000-0000-0000-000000000001' then raise exception 'La plantilla de Folvy no se toca.'; end if;

  -- Las filas, con su asiento traído de Diez (regla 9: de la cuenta de la empresa).
  create temp table fila on commit drop as
  select (j->>'e') e, (j->>'s') s, (j->>'n')::int n, (j->>'tramo')::int tramo, j->>'libro' libro, j->>'tipo_factura' tipo_factura,
         j->>'numero' numero, (j->>'fecha_factura')::date fecha_factura, (j->>'fecha_operacion')::date fecha_operacion,
         (j->>'fecha_recibida')::date fecha_recibida, j->>'nif' nif, j->>'pais' pais, j->>'nombre' nombre,
         (j->>'base')::bigint base, (j->>'tipo')::numeric tipo, (j->>'cuota')::bigint cuota,
         (j->>'retencion_tipo')::numeric retencion_tipo, (j->>'retencion')::bigint retencion,
         j->>'pais_diez' pais_diez, j->>'tipo_operacion' tipo_operacion,
         je.id entry_id
    from carga_linea
    left join public.journal_entry je
      on je.account_id = v_cuenta and je.company_id = c and je.source_type = 'migrated' and je.external_program = 'diez'
     and je.external_year = j->>'e' and je.external_series = j->>'s' and je.external_number = j->>'n';

  -- El IVA de cada asiento, en céntimos, y su apunte de IVA.
  create temp table asiento_iva on commit drop as
  select je.id entry_id, je.entry_date, je.external_series s,
         coalesce(round(sum(jl.credit - jl.debit) filter (where ca.template_code like '477%') * 100), 0)::bigint c477,
         coalesce(round(sum(jl.debit - jl.credit) filter (where ca.template_code like '472%') * 100), 0)::bigint c472,
         (array_agg(jl.id order by jl.position) filter (where ca.template_code like '477%'))[1] linea477,
         (array_agg(jl.id order by jl.position) filter (where ca.template_code like '472%'))[1] linea472
    from public.journal_entry je
    join public.journal_line jl on jl.entry_id = je.id
    join public.company_account ca on ca.id = jl.company_account_id
   where je.account_id = v_cuenta and je.company_id = c and je.source_type = 'migrated' and je.external_program = 'diez'
     and je.entry_date between v_desde and v_hasta
   group by je.id, je.entry_date, je.external_series;

  -- La línea de IVA de cada tramo (una fila del libro por línea del diario: el
  -- índice único uq_vat_book_entry_linea). Diez trae una línea de 472 por tipo
  -- en unas recibidas y una sola en otras (medido el 18/10: 240 de 2.852
  -- asientos de la serie 2 con más de una 472; ninguno con más de una 477). Se
  -- casa cada tramo con la línea de su lado (477 las expedidas, 472 las
  -- recibidas) y de su mismo importe; si no casa ninguna y el asiento tiene una
  -- sola línea de ese lado, se la queda el primer tramo; los demás, sin línea.
  -- (Ensayo del 18/10: el primer ensayo de verdad paró con 23505 porque todos
  -- los tramos cogían la primera línea del asiento.)
  create temp table linea_iva on commit drop as
  select je.id entry_id, jl.id line_id, jl.position,
         case when ca.template_code like '477%' then 'issued' else 'received' end lado,
         round(case when ca.template_code like '477%' then jl.credit - jl.debit else jl.debit - jl.credit end * 100)::bigint cent
    from public.journal_entry je
    join public.journal_line jl on jl.entry_id = je.id
    join public.company_account ca on ca.id = jl.company_account_id
   where je.account_id = v_cuenta and je.company_id = c and je.source_type = 'migrated' and je.external_program = 'diez'
     and je.entry_date between v_desde and v_hasta and (ca.template_code like '477%' or ca.template_code like '472%');
  create temp table tramo_linea on commit drop as
  with t as (select f.entry_id, f.tramo, f.libro, f.cuota, row_number() over (partition by f.entry_id, f.libro, f.cuota order by f.tramo) k
               from fila f where f.entry_id is not null and f.libro in ('issued', 'received')),
       l as (select x.*, row_number() over (partition by x.entry_id, x.lado, x.cent order by x.position) k from linea_iva x)
  select t.entry_id, t.tramo, l.line_id from t join l on l.entry_id = t.entry_id and l.lado = t.libro and l.cent = t.cuota and l.k = t.k;
  insert into tramo_linea (entry_id, tramo, line_id)
  select distinct on (f.entry_id) f.entry_id, f.tramo, l.line_id
    from fila f join linea_iva l on l.entry_id = f.entry_id and l.lado = f.libro
   where f.libro in ('issued', 'received')
     and not exists (select 1 from tramo_linea x where x.entry_id = f.entry_id and x.tramo = f.tramo)
     and not exists (select 1 from tramo_linea x where x.line_id = l.line_id)
     and (select count(*) from linea_iva y where y.entry_id = f.entry_id and y.lado = f.libro) = 1
   order by f.entry_id, f.tramo;
  select count(*) into v_n from fila f where f.entry_id is not null and f.libro in ('issued', 'received')
     and not exists (select 1 from tramo_linea x where x.entry_id = f.entry_id and x.tramo = f.tramo);
  insert into salida (clave, valor) values ('tramos_sin_linea_propia', v_n);

  -- Rechazos: sin asiento, o la cuota de la factura no es la de su asiento.
  select count(distinct (e, s, n)) into v_rech from fila where entry_id is null;
  insert into salida (clave, valor) values ('facturas_sin_asiento', v_rech);
  select count(*) into v_mal from (
    select f.entry_id, sum(f.cuota) cuota, max(f.s) s from fila f where f.entry_id is not null group by f.entry_id) x
    join asiento_iva a on a.entry_id = x.entry_id
   where x.cuota <> case when x.s = '1' then a.c477 else a.c472 end;
  insert into salida (clave, valor) values ('facturas_con_cuota_distinta_de_su_asiento', v_mal);
  v_rech := v_rech + v_mal;

  -- Las autoliquidadas (asiento con 477 y 472), cada una con su tipo de la
  -- lista. Una que no esté en la lista PARA (no se adivina: Julio, 18/10). El
  -- prefijo del NIF solo comprueba: si contradice la lista, se dice.
  create temp table autoliq on commit drop as
  select a.entry_id, l.tipo
    from asiento_iva a join public.journal_entry je on je.id = a.entry_id
    left join carga_autoliq l on l.ejercicio = je.external_year and l.serie = je.external_series and l.documento = je.external_number
   where a.s = '2' and a.c477 <> 0 and a.c472 <> 0;
  select count(*) into v_n from autoliq where tipo is null;
  insert into salida (clave, valor) values ('autoliquidadas_fuera_de_la_lista', v_n);
  v_rech := v_rech + v_n;
  -- Y CUÁLES (Julio, 19/10: «para y dime cuáles»): el número de su asiento de
  -- Diez, que es lo que lleva la lista. Ni NIF ni importe.
  insert into salida (clave, valor)
  select 'autoliquidada_fuera_de_la_lista.' || je.external_year || '_s' || je.external_series, je.external_number
    from autoliq x join public.journal_entry je on je.id = x.entry_id
   where x.tipo is null
   order by je.external_year, je.external_series, length(je.external_number), je.external_number;
  insert into salida (clave, valor)
  select 'autoliquidadas.' || tipo, count(*) from autoliq where tipo is not null group by tipo order by tipo;
  select count(distinct f.entry_id) into v_n from fila f join autoliq x on x.entry_id = f.entry_id
   where f.pais is not null and (x.tipo = 'intracomunitaria') <> (f.pais = any (array['AT','BE','BG','CY','CZ','DE','DK','EE','EL','GR','FI','FR','HR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK']));
  insert into salida (clave, valor) values ('autoliquidadas.prefijo_contradice_la_lista', v_n);

  -- Ya estaban (idempotente): el asiento que tiene libro no se toca.
  select count(distinct f.entry_id) into v_n from fila f where exists (select 1 from public.vat_book_entry v where v.entry_id = f.entry_id);
  insert into salida (clave, valor) values ('facturas_que_ya_estaban', v_n);

  -- El testigo existe: cada trimestre del periodo, con su 303 PRESENTADO y las
  -- casillas de su justificante (pieza 1 del I01c). Si falta uno, no se escribe
  -- nada: sin testigo no hay con qué comprobar lo que se trae.
  create temp table trimestre on commit drop as
  select d::date desde, (d + interval '3 months - 1 day')::date hasta, extract(quarter from d)::int t
    from generate_series(v_desde, v_hasta, interval '3 months') d;
  create temp table presentado on commit drop as
  select tq.t, r.id return_id
    from trimestre tq
    left join lateral (
      select r.id from public.tax_return r
       where r.account_id = v_cuenta and r.company_id = c and r.form_code = '303'
         and r.fiscal_year = extract(year from tq.desde)::int and r.period = tq.t || 'T'
         and r.status in ('filed', 'booked', 'paid', 'offset', 'refunded')
         and exists (select 1 from public.tax_return_box b where b.tax_return_id = r.id and b.origin = 'justificante')
       order by r.sequence desc nulls last limit 1) r on true;
  insert into salida (clave, valor)
  select 'testigo.falta_el_303_presentado_del_' || t || 't', 1 from presentado where return_id is null order by t;
  select count(*) into v_n from presentado where return_id is null;
  if v_n > 0 then v_rech := v_rech + v_n; end if;

  -- Escribir: una fila por tramo, solo si no hay rechazos (nada a medias).
  if v_rech = 0 then
    insert into public.vat_book_entry (account_id, company_id, entry_id, line_id, book, invoice_type, series, number, documents_count,
      issue_date, operation_date, received_date, party_id, counterpart_tax_id, counterpart_id_type, counterpart_country, counterpart_name,
      operation_key, qualification, exempt_cause, tax_base, tax_rate, tax_amount, total, deductible_amount, deductible_later,
      reverse_charge, investment_good, withholding_rate, withholding_amount, source_type, source_id, updated_by_name)
    select v_cuenta, c, f.entry_id,
           (select x.line_id from tramo_linea x where x.entry_id = f.entry_id and x.tramo = f.tramo),
           f.libro, f.tipo_factura, f.s, f.numero, 1,
           coalesce(f.fecha_factura, a.entry_date), f.fecha_operacion, f.fecha_recibida, null, f.nif,
           case when f.pais is not null then '02' end, f.pais, f.nombre,
           case when f.libro = 'received' and (select x.tipo from autoliq x where x.entry_id = f.entry_id) = 'intracomunitaria' then '09' else '01' end,
           case when f.libro = 'not_subject' then null when f.libro = 'received' and a.c477 <> 0 then 'S2' else 'S1' end,
           null, f.base / 100.0, f.tipo, f.cuota / 100.0, (f.base + f.cuota) / 100.0,
           case when f.libro = 'received' then f.cuota / 100.0 end, false,
           f.libro = 'received' and a.c477 <> 0, false,
           f.retencion_tipo, f.retencion / 100.0, 'migrated', f.entry_id, 'Diez (traído)'
      from fila f join asiento_iva a on a.entry_id = f.entry_id
     where not exists (select 1 from public.vat_book_entry v where v.entry_id = f.entry_id);
    get diagnostics v_n = row_count;
  else
    v_n := 0;
  end if;
  insert into salida (clave, valor) values ('filas_escritas', v_n);

  -- Cobertura: ningún asiento traído con IVA de las series 1 y 2 del periodo sin su libro.
  select count(*) into v_falta from asiento_iva a
   where a.s in ('1', '2') and (a.c477 <> 0 or a.c472 <> 0)
     and not exists (select 1 from public.vat_book_entry v where v.entry_id = a.entry_id);
  insert into salida (clave, valor) values ('asientos_con_iva_sin_libro', v_falta);

  -- Expedidas de cada trimestre contra la 477 del diario (serie 1).
  for q in
    select date_trunc('quarter', d)::date t,
           (select coalesce(sum(round(v.tax_amount * 100)), 0) from public.vat_book_entry v
             where v.company_id = c and v.account_id = v_cuenta and v.book = 'issued' and v.voided_at is null
               and date_trunc('quarter', coalesce(v.operation_date, v.issue_date)) = date_trunc('quarter', d)) libro,
           (select coalesce(sum(a.c477), 0) from asiento_iva a where a.s = '1' and date_trunc('quarter', a.entry_date) = date_trunc('quarter', d)) diario
      from generate_series(v_desde, v_hasta, interval '3 months') d
  loop
    insert into salida (clave, valor) values ('expedidas.' || to_char(q.t, 'YYYY') || '_' || extract(quarter from q.t) || 't.cuadra_con_la_477', (q.libro = q.diario)::int);
    if q.libro <> q.diario then v_rech := v_rech + 1; end if;
  end loop;
  -- Recibidas de todo el periodo contra la 472 (serie 2): el trimestre de cada
  -- una lo decide su fecha de deducción, que se mide con el testigo.
  select ((select coalesce(sum(round(v.tax_amount * 100)), 0) from public.vat_book_entry v join asiento_iva a on a.entry_id = v.entry_id
            where v.book in ('received', 'not_subject') and a.s = '2')
          = (select coalesce(sum(a.c472), 0) from asiento_iva a where a.s = '2'))::int into v_n;
  insert into salida (clave, valor) values ('recibidas.cuadran_con_la_472', v_n);
  if v_n = 0 then v_rech := v_rech + 1; end if;

  -- El testigo: las casillas de los 303 PRESENTADOS del periodo (subidos con su
  -- justificante, pieza 1 del I01c), contra el libro, al céntimo. Regla 9: de
  -- la cuenta y la empresa. Una casilla vacía en el impreso es un cero.
  --   [01]/[03] 4 %, [04]/[06] 10 %, [07]/[09] 21 %: expedidas, por tipo.
  --   [10]/[11] y [36]/[37]: adquisiciones intracomunitarias (autoliquidadas
  --     con clave 09), devengado y deducible.
  --   [12]/[13]: otras con inversión del sujeto pasivo (devengado).
  --   [28]/[29]: recibidas interiores corrientes, más lo deducible de las otras
  --     con inversión. ACUMULADAS en todo el periodo: la gestoría dedujo en el
  --     2T parte de las compras del 1T y Diez no guarda cuáles (lectura 6, run
  --     39120406840: el semestre casa al céntimo, cada trimestre no).
  -- Las CUOTAS deciden el verde; las bases se miden y se dicen, y no paran
  -- (una base puede repartir lo exento o lo no sujeto distinto que el libro).
  create temp table regla (casilla text, cuota boolean, acumulada boolean) on commit drop;
  insert into regla values
    ('01', false, false), ('03', true, false), ('04', false, false), ('06', true, false), ('07', false, false), ('09', true, false),
    ('10', false, false), ('11', true, false), ('12', false, false), ('13', true, false),
    ('28', false, true), ('29', true, true), ('36', false, false), ('37', true, false);
  -- Cada comprobación: un trimestre (o el periodo entero, las acumuladas) y una casilla.
  create temp table testigo on commit drop as
  with ambito as (
    select g.casilla, g.cuota, tq.t etiqueta_t, tq.desde, tq.hasta, array[tq.t] ts from regla g cross join trimestre tq where not g.acumulada
    union all
    select g.casilla, g.cuota, null, v_desde, v_hasta, (select array_agg(t order by t) from trimestre) from regla g where g.acumulada)
  select a.casilla, a.cuota, a.desde, a.hasta,
         case when a.etiqueta_t is not null then a.etiqueta_t || 't'
              else (select string_agg(x || 't', '_' order by x) from unnest(a.ts) x) end ambito,
         (select coalesce(sum(round(b.value * 100)), 0)::bigint from presentado p join public.tax_return_box b on b.tax_return_id = p.return_id
           where p.t = any (a.ts) and b.box = a.casilla and b.value is not null) presentado,
         (select coalesce(sum(round(case when a.cuota then v.tax_amount else v.tax_base end * 100)), 0)::bigint
            from public.vat_book_entry v
           where v.company_id = c and v.account_id = v_cuenta and v.voided_at is null
             and case when v.book = 'issued' then coalesce(v.operation_date, v.issue_date) else coalesce(v.received_date, v.issue_date) end
                 between a.desde and a.hasta
             and case a.casilla
                   when '01' then v.book = 'issued' and v.tax_rate = 4 and not v.reverse_charge
                   when '03' then v.book = 'issued' and v.tax_rate = 4 and not v.reverse_charge
                   when '04' then v.book = 'issued' and v.tax_rate = 10 and not v.reverse_charge
                   when '06' then v.book = 'issued' and v.tax_rate = 10 and not v.reverse_charge
                   when '07' then v.book = 'issued' and v.tax_rate = 21 and not v.reverse_charge
                   when '09' then v.book = 'issued' and v.tax_rate = 21 and not v.reverse_charge
                   when '10' then v.book = 'received' and v.reverse_charge and v.operation_key = '09'
                   when '11' then v.book = 'received' and v.reverse_charge and v.operation_key = '09'
                   when '12' then v.book = 'received' and v.reverse_charge and v.operation_key <> '09'
                   when '13' then v.book = 'received' and v.reverse_charge and v.operation_key <> '09'
                   when '28' then v.book = 'received' and not v.investment_good and (not v.reverse_charge or v.operation_key <> '09')
                   when '29' then v.book = 'received' and not v.investment_good and (not v.reverse_charge or v.operation_key <> '09')
                   when '36' then v.book = 'received' and v.reverse_charge and v.operation_key = '09'
                   when '37' then v.book = 'received' and v.reverse_charge and v.operation_key = '09'
                   else false end) libro
    from ambito a;
  -- Solo las que dicen algo: con importe en el impreso o en el libro.
  delete from testigo where presentado = 0 and libro = 0;
  select count(*) filter (where cuota), count(*) filter (where cuota and presentado <> libro) into v_test, v_test_mal from testigo;
  insert into salida (clave, valor) values ('testigo.cuotas', v_test), ('testigo.cuotas_que_no_casan', v_test_mal);
  -- Cuál, por su nombre (trimestre y casilla; ningún importe).
  insert into salida (clave, valor)
  select case when cuota then 'testigo.' else 'testigo_base.' end || ambito || '.c' || casilla || '.casa', (presentado = libro)::int
    from testigo order by not cuota, desde, hasta, casilla;
  insert into salida (clave, valor)
  select 'testigo.bases_que_no_casan', count(*) from testigo where not cuota and presentado <> libro;

  -- Las autoliquidadas (asiento con 477 y 472) y cuántas van sin país: sin
  -- país no entran en la [37] (intracomunitarias) del testigo.
  insert into salida (clave, valor)
  select 'recibidas.autoliquidadas', count(*) from public.vat_book_entry v
   where v.company_id = c and v.account_id = v_cuenta and v.voided_at is null and v.book = 'received' and v.reverse_charge
     and v.source_type = 'migrated'
  union all
  select 'recibidas.autoliquidadas_sin_pais', count(*) from public.vat_book_entry v
   where v.company_id = c and v.account_id = v_cuenta and v.voided_at is null and v.book = 'received' and v.reverse_charge
     and v.source_type = 'migrated' and v.counterpart_country is null;
  -- Qué dicen Pais y TipoOperacion de Diez en las autoliquidadas, por trimestre
  -- y con o sin prefijo de país en el NIF (18/10: la [37] del 1T no casa
  -- porque 6 de 16 van sin prefijo; el 3T mezcla intracomunitarias, [11]/[37],
  -- y otras con inversión del sujeto pasivo, [13]). Valores en corto, ningún
  -- NIF ni importe.
  insert into salida (clave, valor)
  select 'autoliq.' || z.trim_ || '.' || z.pref || '.' || z.kk, count(*)
    from (select distinct f.entry_id, f.tramo,
                 extract(quarter from a.entry_date)::int || 't' trim_,
                 case when f.pais is null then 'sin_prefijo' else 'con_prefijo' end pref,
                 x.kk
            from fila f join asiento_iva a on a.entry_id = f.entry_id
            cross join lateral (values ('pais.' || coalesce(f.pais_diez, 'vacio')), ('tipo_op.' || coalesce(f.tipo_operacion, 'vacio'))) x(kk)
           where f.libro = 'received' and a.c477 <> 0 and f.tramo = 1) z
   group by z.trim_, z.pref, z.kk
   order by z.trim_, z.pref, z.kk;
  if v_test = 0 then insert into salida (clave, valor) values ('testigo.sin_cuotas', 1); end if;

  v_verde := v_rech = 0 and v_falta = 0 and v_test > 0 and v_test_mal = 0;
  insert into salida (clave, valor) values ('verde', v_verde::int);
  perform set_config('libro.verde', case when v_verde then 'si' else 'no' end, true);
end $$;

select '@@ ' || clave || ' ' || valor from salida order by n;

select current_setting('libro.verde') = 'si' as verde, :'modo' = 'real' as real \gset
\if :real
  \if :verde
    commit;
    select '@@ real_escrito 1';
  \else
    rollback;
    select '@@ real_en_rojo_deshecho 1';
  \endif
\else
  rollback;
\endif

select count(*) as despues from public.vat_book_entry where company_id = :'empresa'::uuid and source_type = 'migrated' \gset
select '@@ filas_traidas_antes ' || :antes;
select '@@ filas_traidas_despues ' || :despues;
-- Con ON_ERROR_STOP, una excepción deja el código de salida distinto de 0:
-- así el workflow sale en rojo (psql no tiene «\q con código»).
\if :real
  \if :verde
  \else
    select (:antes = :despues) as nada_escrito \gset
    \if :nada_escrito
    \else
      do $$ begin raise exception 'En rojo, pero ha quedado algo escrito: mirar ya.'; end $$;
    \endif
  \endif
\else
  select (:antes = :despues) as nada_escrito \gset
  \if :nada_escrito
    select '@@ ensayo_nada_escrito 1';
  \else
    do $$ begin raise exception 'El ensayo ha dejado algo escrito: mirar ya.'; end $$;
  \endif
\endif
\if :verde
\else
  do $$ begin raise exception 'En rojo: hay facturas rechazadas, asientos con IVA sin libro o el testigo no casa (ver el informe).'; end $$;
\endif
