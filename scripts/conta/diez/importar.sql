-- scripts/conta/diez/importar.sql
--
-- C04b · T3 · La tanda del histórico de Diez, paso 2 de 2: ESCRIBIR, MEDIR y
-- decidir. Todo en UNA transacción (Julio, 12/10):
--   1. ejercicios traídos, subcuentas que faltan y asientos, con las
--      funciones de 20261019T0150/0160 (las reglas las pone la base);
--   2. mide, ejercicio a ejercicio, lo ESCRITO contra el testigo (los Excel de
--      sumas y saldos de Julio), por huella: debe y haber de cada subcuenta al
--      céntimo, rehechos como estaban en Diez con «movido», sin
--      regularización (4) ni cierre (5). Es canonicoTestigo (diezTestigo.ts),
--      la misma cadena, calculada aquí;
--   3. si todo cuadra y nada se rechazó: cierra 2023–2025 (respuesta 3) y
--      marca traído el histórico de cada ejercicio (0160: desde ahí Folvy
--      valida y numera detrás de lo traído);
--   4. el informe: recuentos, rechazos con su motivo (sin importes),
--      documentos esperados por origen, marca de negativos y el testigo;
--   5. ENSAYO o simulado: rollback, y comprueba que no queda nada escrito.
--      REAL: commit solo si está en verde; si no, rollback y en rojo.
--
-- Variables de psql: empresa (uuid) y modo (ensayo | real). Se ejecuta DESDE
-- la carpeta de la carga del paso 1 (\copy no sustituye variables en el
-- nombre del fichero): lee asientos.csv, subcuentas.csv y testigo.csv y deja
-- detalle.csv, las sumas por subcuenta, que el workflow CIFRA antes de
-- enseñarlas (llevan importes).

\set ON_ERROR_STOP on
\pset footer off

-- Lo de antes, para el «no queda nada escrito» (la misma vara antes y después).
select count(*) as antes_asientos from public.journal_entry where company_id = :'empresa'::uuid and external_program = 'diez' \gset
select count(*) as antes_lecturas from public.import_run where company_id = :'empresa'::uuid \gset

begin;
set local statement_timeout = 0;
set local lock_timeout = '5s';
select set_config('diez.empresa', :'empresa', true), set_config('diez.modo', :'modo', true) \g /dev/null

create temp table carga_asiento (orden int, ejercicio text, documento text, doc jsonb) on commit drop;
create temp table carga_subcuenta (doc jsonb) on commit drop;
create temp table carga_testigo (ejercicio text, hasta date, cuentas int, huella text) on commit drop;
create temp table carga_rechazo (ejercicio text, clave text, motivo text) on commit drop;
create temp table carga_sin_importe (ejercicio text, clave text) on commit drop;
create temp table informe (n serial, linea text) on commit drop;
create temp table detalle (ejercicio text, cuenta text, debe bigint, haber bigint) on commit drop;

\copy carga_asiento from 'asientos.csv' with (format csv)
\copy carga_subcuenta from 'subcuentas.csv' with (format csv)
\copy carga_testigo from 'testigo.csv' with (format csv)
\copy carga_rechazo from 'rechazos.csv' with (format csv)
\copy carga_sin_importe from 'sin-importe.csv' with (format csv)

do $$
declare
  c constant uuid := current_setting('diez.empresa')::uuid;
  v_cuenta uuid; v_run uuid; r jsonb; v_sub jsonb; ej record; t record; x record;
  n_traidos int := 0; n_estaban int := 0; rech jsonb := '[]'; dist jsonb := '[]';
  v_h text; v_n int; v_cuadra boolean; v_todos boolean := true; v_verde boolean;
  inf text[] := '{}';
begin
  select account_id into v_cuenta from public.company where id = c;
  if v_cuenta is null then raise exception 'La empresa % no existe.', c; end if;
  if v_cuenta = '00000000-0000-0000-0000-000000000001' then raise exception 'Folvy Interno no se toca.'; end if;
  if (select count(*) from carga_asiento) = 0 then raise exception 'La carga no trae ningún asiento.'; end if;

  insert into public.import_run (account_id, company_id, program, kind, period_from, period_to, created_by_name)
  values (v_cuenta, c, 'diez', 'historico',
          (select min((doc ->> 'fecha')::date) from carga_asiento), (select max((doc ->> 'fecha')::date) from carga_asiento),
          'Tanda del histórico de Diez')
  returning id into v_run;

  -- 1 · Ejercicios, subcuentas y asientos (por tandas de 200, en el orden de la cadena).
  for ej in select distinct ejercicio from carga_asiento order by 1 loop
    perform public.conta_diez_ejercicio(c, ej.ejercicio, (ej.ejercicio || '-01-01')::date, (ej.ejercicio || '-12-31')::date);
  end loop;
  v_sub := public.conta_diez_subcuentas(c, v_run, coalesce((select jsonb_agg(doc) from carga_subcuenta), '[]'::jsonb));
  for t in select (orden - 1) / 200 as g, jsonb_agg(doc order by orden) as docs from carga_asiento group by 1 order by 1 loop
    r := public.conta_diez_importar(c, v_run, t.docs);
    n_traidos := n_traidos + (r ->> 'traidos')::int;
    n_estaban := n_estaban + (r ->> 'yaEstaban')::int;
    rech := rech || coalesce(r -> 'rechazados', '[]'::jsonb);
    dist := dist || coalesce(r -> 'distintos', '[]'::jsonb);
  end loop;

  inf := inf || format('## Diez · tanda del histórico · %s', upper(current_setting('diez.modo')))
             || ''::text
             || format('- Asientos en la carga: %s · traídos: %s · ya estaban: %s · rechazados por la base: %s · cambiados en Diez después de traerlos: %s',
                       (select count(*) from carga_asiento), n_traidos, n_estaban, jsonb_array_length(rech), jsonb_array_length(dist))
             || format('- Subcuentas: %s nuevas traídas de Diez · %s ya estaban · %s rechazadas%s',
                       v_sub ->> 'nuevas', v_sub ->> 'estaban', jsonb_array_length(v_sub -> 'rechazadas'),
                       coalesce(' (' || (select string_agg(e ->> 'code' || ': ' || (e ->> 'motivo'), '; ') from jsonb_array_elements(v_sub -> 'rechazadas') e) || ')', ''));
  inf := inf || format('- Rechazados al convertir (mueven saldo y no entran): %s', (select count(*) from carga_rechazo));
  for x in select clave, motivo from carga_rechazo order by 1 loop
    inf := inf || format('  - rechazado al convertir %s: %s', x.clave, x.motivo);
  end loop;
  inf := inf || format('- Fuera, sin importe en Diez (todas las líneas a cero; no es un rechazo y no impide cerrar): %s%s',
                       (select count(*) from carga_sin_importe),
                       coalesce(' — ' || (select string_agg(clave, ', ' order by clave) from carga_sin_importe), ''));
  for x in select e ->> 'clave' as clave, regexp_replace(e ->> 'motivo', '-?\d[\d.]*[.,]\d{2}\M', '[importe]', 'g') as motivo
             from jsonb_array_elements(rech) e order by 1 loop
    inf := inf || format('  - rechazado %s: %s', x.clave, x.motivo);
  end loop;
  for x in select e ->> 'clave' as clave from jsonb_array_elements(dist) e order by 1 loop
    inf := inf || format('  - distinto en Diez: %s (no se pisa)', x.clave);
  end loop;

  -- 2 · Por ejercicio: lo traído, la marca de negativos, los documentos y el testigo.
  inf := inf || ''::text || '| Ejercicio | Traídos (serie 1 · 2 · 3 · 4 · 9) | Líneas «En Diez iba en negativo» | Facturas que esperan documento | Testigo |'::text
             || '|---|---|---:|---|---|'::text;
  for ej in select * from carga_testigo order by ejercicio loop
    insert into detalle
    select ej.ejercicio, ca.code,
           sum(round(jl.debit * 100)::bigint - coalesce((s.el ->> 'movido')::bigint, 0)),
           sum(round(jl.credit * 100)::bigint - coalesce((s.el ->> 'movido')::bigint, 0))
      from public.journal_entry e
      join public.fiscal_year f on f.id = e.fiscal_year_id and f.code = ej.ejercicio
      join public.journal_line jl on jl.entry_id = e.id
      join public.company_account ca on ca.id = jl.company_account_id
      left join public.external_entry_snapshot sn on sn.company_id = e.company_id and sn.program = 'diez'
        and sn.ext_year = e.external_year and sn.ext_series = e.external_series and sn.ext_number = e.external_number::int
      left join lateral (select el from jsonb_array_elements(sn.lines) el where (el ->> 'posicion')::int = jl.position limit 1) s on true
     where e.company_id = c and e.external_program = 'diez' and e.status = 'validado' and e.entry_date <= ej.hasta
       and coalesce((select (z ->> 'tipo_diez')::int from jsonb_array_elements(e.reasons) z where z ->> 'decision' = 'traido-de-diez' limit 1), -1) not in (4, 5)
     group by ca.code;
    select encode(extensions.digest(coalesce(string_agg(cuenta || ':' || debe || ':' || haber, E'\n' order by cuenta collate "C"), ''), 'sha256'), 'hex'), count(*)
      into v_h, v_n
      from detalle where ejercicio = ej.ejercicio and (debe <> 0 or haber <> 0);
    v_cuadra := v_h = ej.huella;
    v_todos := v_todos and v_cuadra;
    inf := inf || format('| %s | %s | %s | %s | %s |', ej.ejercicio,
      (select coalesce(string_agg(coalesce(n::text, '0'), ' · ' order by s), '—') from (select s, (select count(*) from public.journal_entry e join public.fiscal_year f on f.id = e.fiscal_year_id
              where e.company_id = c and f.code = ej.ejercicio and e.external_program = 'diez' and e.series = s) n from unnest(array[1, 2, 3, 4, 9]) s) q),
      (select count(*) from public.journal_line jl join public.journal_entry e on e.id = jl.entry_id join public.fiscal_year f on f.id = e.fiscal_year_id
        where e.company_id = c and f.code = ej.ejercicio and e.external_program = 'diez' and jl.external_negative_side is not null),
      coalesce((select string_agg(n || ' por ' || case documento when 'portal_uber_eats' then 'el portal de Uber Eats' when 'portal_glovo' then 'el portal de Glovo'
                 when 'portal_just_eat' then 'el portal de Just Eat' when 'portal_riders' then 'el portal de riders' else 'Drive (subida a mano)' end, ' · ' order by documento)
                 from (select documento, count(*) n from carga_asiento where ejercicio = ej.ejercicio and documento <> '' group by 1) d), 'ninguna'),
      case when v_cuadra then format('**cuadra** al céntimo (%s subcuentas)', v_n)
           else format('**NO cuadra**: Folvy %s subcuentas, testigo %s', v_n, ej.cuentas) end);
  end loop;

  -- 3 · Verde: todo cuadra y nada pendiente de explicar. Entonces se cierra y se marca.
  v_verde := v_todos and jsonb_array_length(rech) = 0 and jsonb_array_length(dist) = 0
             and not exists (select 1 from carga_rechazo)
             and jsonb_array_length(v_sub -> 'rechazadas') = 0;
  inf := inf || ''::text;
  if v_verde then
    for ej in select t2.ejercicio, f.origin from carga_testigo t2 join public.fiscal_year f on f.company_id = c and f.code = t2.ejercicio order by 1 loop
      if ej.origin = 'migrated' then
        r := public.conta_diez_cerrar_ejercicio(c, ej.ejercicio);
        inf := inf || case when (r ->> 'yaCerrado')::boolean then format('- %s: ya estaba cerrado.', ej.ejercicio)
                           else format('- %s: ejercicio cerrado (%s asientos traídos).', ej.ejercicio, r ->> 'asientos') end;
      end if;
      r := public.conta_diez_historico_traido(c, ej.ejercicio);
      inf := inf || format('- %s: histórico marcado como traído; Folvy numera detrás de %s.', ej.ejercicio, r -> 'ultimoPorSerie');
    end loop;
  end if;

  update public.import_run set status = case when v_verde then 'hecho' else 'fallido' end, finished_at = now(),
         counts = jsonb_build_object('traidos', n_traidos, 'yaEstaban', n_estaban, 'rechazados', jsonb_array_length(rech),
                                     'distintos', jsonb_array_length(dist), 'subcuentas', v_sub - 'rechazadas'),
         error = case when v_verde then null else 'no cuadra con el testigo o hay rechazos' end
   where id = v_run;

  inf := inf || ''::text || case when v_verde then '**En verde.**' else '**En ROJO**: no cuadra con el testigo o hay algo rechazado.' end;
  insert into informe (linea) select unnest(inf);
  perform set_config('diez.verde', case when v_verde then 'si' else 'no' end, true);
end $$;

\pset tuples_only on
\pset format unaligned
select linea from informe order by n;
\copy (select ejercicio, cuenta, debe, haber from detalle order by 1, 2) to 'detalle.csv' with (format csv)

select current_setting('diez.verde') = 'si' as verde, :'modo' = 'real' as real \gset
\if :real
  \if :verde
    commit;
    \echo ''
    \echo '**REAL: escrito.**'
  \else
    rollback;
    \echo ''
    \echo '**REAL en rojo: deshecho, no se ha escrito nada.**'
  \endif
\else
  rollback;
\endif

-- Lo de después, con la misma vara.
select count(*) as despues_asientos from public.journal_entry where company_id = :'empresa'::uuid and external_program = 'diez' \gset
select count(*) as despues_lecturas from public.import_run where company_id = :'empresa'::uuid \gset
\echo ''
\echo '- Asientos de Diez en la base: antes' :antes_asientos '· después' :despues_asientos
\echo '- Lecturas de Diez: antes' :antes_lecturas '· después' :despues_lecturas

\if :real
\else
  select (:despues_asientos = :antes_asientos and :despues_lecturas = :antes_lecturas) as nada_escrito \gset
  \if :nada_escrito
    \echo '**Ensayo: deshecho, no queda nada escrito.**'
  \else
    do $$ begin raise exception 'El ensayo ha dejado algo escrito: mirar ya.'; end $$;
  \endif
\endif

\if :verde
\else
  do $$ begin raise exception 'En rojo: no cuadra con el testigo o hay algo rechazado (ver el informe).'; end $$;
\endif
