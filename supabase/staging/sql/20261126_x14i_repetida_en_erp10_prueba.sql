-- supabase/staging/sql/20261126_x14i_repetida_en_erp10_prueba.sql
--
-- SOLO STAGING. Prueba del X14i (20261126T0710_x14i_repetida_en_erp10), que el ensayo de staging pone delante en la misma
-- sesión. Todo en una transacción con ROLLBACK: staging no cambia. Lo que cambia: public.conta_traer_dar_por_bueno, y lo nuevo:
-- customer_invoice.import_repeated, su guarda (customer_invoice_repetida_solo_traida y tg_customer_invoice_repetida) y el índice
-- customer_invoice_numero_unico en lugar de la restricción de un solo número.
--
-- En una empresa NUEVA de la cuenta A, como el administrador a1, con lo leído INVENTADO de 2024 (12 asientos de 121,00) y su
-- libro de expedidas con la P-7 dos veces, igual, y la P-8. Los caminos:
--   1. Darlo por bueno, sin día de inicio fijado (todo lo traído es historia de ERP10): entran las tres; las dos P-7, marcadas «repetida en ERP10»; la P-8, sin marcar.
--   2. Una factura de Sumied no puede llevar el número de una repetida (la P-8 pasada a 7, para).
--   3. Con el día de inicio fijado (01/01/2026), una repetida de ese día o después no entra (una P-7 de 2026, para).
--   4. La marca, solo en lo traído (una P-7 pasada a «a mano», para).
--   5. Dos de Sumied sin marcar siguen sin poder repetir número (la P-8 copiada, para).
--   6. La vuelta atrás, con marcadas, para y no deja nada a medias.
--   7. La vuelta atrás, sin marcadas: lo deja como antes.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X14i: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regclass('public.customer_invoice_numero_unico') is null then raise exception 'PRUEBA X14i · 0: falta la 20261126T0710 delante.'; end if;
end $$;
set local statement_timeout = '120s';
create temp table _x14i (k text primary key, v text) on commit drop;
grant all on _x14i to authenticated;
create function pg_temp.p(k text) returns text language sql as $$ select v from _x14i where _x14i.k = $1 $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

-- La empresa nueva, con solo 2026, y la carga inventada de 2024.
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; d jsonb; d7 text; s int := 0; x int;
begin
  -- Un CIF inventado al azar con su dígito de control (como cifInventado de las e2e): el de la cuenta tiene que ser único.
  d7 := lpad(floor(random() * 1e7)::bigint::text, 7, '0');
  for i in 1..7 loop
    x := substr(d7, i, 1)::int;
    if i % 2 = 1 then x := x * 2; s := s + x / 10 + x % 10; else s := s + x; end if;
  end loop;
  insert into public.company (account_id, legal_name, tax_id, tax_id_type, entity_kind, setup_step, setup_completed_at)
  values (v_acc, 'Prueba X14i inventada', 'B' || d7 || ((10 - s % 10) % 10)::text, 'nif_es', 'company', 'hecho', now()) returning id into c;
  insert into public.company_tax_profile (account_id, company_id, tax_territory, chart_kind, account_digits, tax_forms)
  values (v_acc, c, 'peninsula_baleares', 'pymes', 8, array['303']);
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31');
  d := jsonb_build_object('version', 1, 'programa', 'erp10', 'ficheros', '[]'::jsonb, 'largos', '[8]'::jsonb,
    'cuentas', jsonb_build_array(jsonb_build_object('codigo', '43000901', 'nombre', 'CLIENTE INVENTADO X14I'), jsonb_build_object('codigo', '70500000', 'nombre', 'Prestaciones de servicios')),
    'terceros', '[]'::jsonb,
    'asientos', (select jsonb_agg(jsonb_build_object('clave', 'X14I-' || y || '-' || m, 'serie', '1', 'documento', (y * 100 + m)::text, 'fecha', make_date(y, m, 15)::text,
        'concepto', 'Inventado X14i ' || y || '/' || m, 'apuntesLeidos', 2,
        'apuntes', jsonb_build_array(jsonb_build_object('cuenta', '43000901', 'nombre', '', 'concepto', 'Inventado', 'debe', 12100, 'haber', 0),
                                     jsonb_build_object('cuenta', '70500000', 'nombre', '', 'concepto', 'Inventado', 'debe', 0, 'haber', 12100))) order by y, m)
      from generate_series(2024, 2024) y, generate_series(1, 12) m),
    'facturas', (select jsonb_agg(jsonb_build_object('libro', 'expedidas', 'numero', 'P-' || n, 'serie', 'P', 'numeroSolo', n::text, 'fecha', '2024-03-15',
        'operacion', null, 'periodo', null, 'ejercicio', '2024', 'nif', null, 'nombre', 'CLIENTE INVENTADO X14I',
        'tramos', jsonb_build_array(jsonb_build_object('base', 10000, 'tipo', 21, 'cuota', 2100)), 'base', 10000, 'cuota', 2100, 'total', 12100,
        'retencion', null, 'asiento', null, 'pendiente', null) order by o)
      from unnest(array[7, 7, 8]) with ordinality u(n, o)), 'aprendido', '[]'::jsonb, 'pendientesNoExactos', '[]'::jsonb, 'raros', '[]'::jsonb, 'sumas', jsonb_build_array(jsonb_build_object('cuenta', '43000901', 'nombre', 'Calculado', 'debe', 145200, 'haber', 0), jsonb_build_object('cuenta', '70500000', 'nombre', 'Calculado', 'debe', 0, 'haber', 145200)), 'inmovilizado', null, 'frases', '[]'::jsonb);
  insert into _x14i values ('empresa', c), ('datos', d::text);
end $$;
set local role authenticated;

-- 1 · Darlo por bueno: las dos P-7 entran, marcadas ------------------------------------------------------------------------------
do $$
declare r jsonb; v_r public.import_run; n_rep int; n_sin int;
begin
  r := public.conta_traer_cargar(pg_temp.p('empresa')::uuid, '2024', pg_temp.p('datos')::jsonb, 'Prueba X14i');
  while coalesce((r->>'acabado')::boolean, true) is false loop r := public.conta_traer_seguir((r->>'carga')::uuid); end loop;
  select * into v_r from public.import_run where id = (r->>'carga')::uuid;
  if v_r.status <> 'en_prueba' then raise exception 'PRUEBA X14i · 1: no ha entrado en prueba: %', r; end if;
  if (select count(*) from jsonb_array_elements(v_r.detail->'emitidas')) <> 3 then raise exception 'PRUEBA X14i · 1: la carga no guarda las 3 emitidas: %', v_r.detail->'emitidas'; end if;
  insert into _x14i values ('carga', v_r.id);
  perform public.conta_traer_poner_sumas(v_r.id, '[{"cuenta": "43000901", "nombre": "Inventado", "debe": 145200, "haber": 0},
                                                 {"cuenta": "70500000", "nombre": "Inventado", "debe": 0, "haber": 145200}]', 'Prueba X14i');
  perform public.conta_traer_dar_por_bueno(v_r.id, 'Prueba X14i');
  if (select status from public.import_run where id = v_r.id) <> 'dada_por_buena' then raise exception 'PRUEBA X14i · 1: no se ha dado por buena.'; end if;
  select count(*) filter (where import_repeated and number = 7), count(*) filter (where not import_repeated and number = 8)
    into n_rep, n_sin from public.customer_invoice where import_run_id = v_r.id;
  if n_rep <> 2 or n_sin <> 1 then raise exception 'PRUEBA X14i · 1: entran % P-7 marcadas y % P-8 sin marcar (se esperaban 2 y 1).', n_rep, n_sin; end if;
  insert into _x14i select 'p8', id from public.customer_invoice where import_run_id = v_r.id and number = 8;
  insert into _x14i select 'p7', id from public.customer_invoice where import_run_id = v_r.id and number = 7 limit 1;
  raise notice 'PRUEBA X14i · 1: dada por buena; las dos P-7, «repetida en ERP10»; la P-8, sin marcar.';
end $$;
reset role;

-- 2 a 5 · La guarda --------------------------------------------------------------------------------------------------------------
do $$
declare ok2 boolean := false; ok3 boolean := false; ok4 boolean := false; ok5 boolean := false;
begin
  begin update public.customer_invoice set number = 7 where id = pg_temp.p('p8')::uuid;
  exception when unique_violation then ok2 := sqlerrm like 'Ya hay en Sumied una factura emitida P-7 del 2024 (repetida en ERP10).'; end;
  -- Con el día de inicio fijado (01/01/2026, a mano, como lo hará Julio), una repetida de ese día o después no entra.
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  perform public.conta_fijar_corte(pg_temp.p('empresa')::uuid, '2025-12-31', 'erp10');
  if public.conta_dia_de_inicio(pg_temp.p('empresa')::uuid) <> '2026-01-01' then raise exception 'PRUEBA X14i · 3: el día de inicio no ha quedado el 01/01/2026.'; end if;
  begin
    insert into public.customer_invoice (account_id, company_id, status, doc_type, origin, series_code, fiscal_year, number, number_text, issue_date,
                                         customer, base, tax, withholding_amount, total, import_run_id, import_repeated)
    select account_id, company_id, 'emitida', 'factura', 'traida', series_code, 2026, 7, 'P-7', '2026-03-15', customer, base, tax, withholding_amount, total,
           import_run_id, true
      from public.customer_invoice where id = pg_temp.p('p7')::uuid;
  exception when check_violation then ok3 := sqlerrm like '%después del día de inicio (01/01/2026)%'; end;
  begin update public.customer_invoice set origin = 'a_mano' where id = pg_temp.p('p7')::uuid;
  exception when check_violation then ok4 := sqlerrm like '%customer_invoice_repetida_solo_traida%'; end;
  begin
    insert into public.customer_invoice (account_id, company_id, status, doc_type, origin, series_code, fiscal_year, number, number_text, issue_date,
                                         customer, base, tax, withholding_amount, total)
    select account_id, company_id, 'emitida', 'factura', 'a_mano', series_code, fiscal_year, number, number_text, issue_date, customer, base, tax, withholding_amount, total
      from public.customer_invoice where id = pg_temp.p('p8')::uuid;
  exception when unique_violation then ok5 := true; end;
  if not (ok2 and ok3 and ok4 and ok5) then raise exception 'PRUEBA X14i · 2 a 5: la guarda deja pasar algo (% % % %).', ok2, ok3, ok4, ok5; end if;
  raise notice 'PRUEBA X14i · 2: una de Sumied no lleva el número de una repetida.';
  raise notice 'PRUEBA X14i · 3: con el día de inicio el 01/01/2026, una repetida de ese día o después no entra.';
  raise notice 'PRUEBA X14i · 4: la marca, solo en lo traído.';
  raise notice 'PRUEBA X14i · 5: dos sin marcar siguen sin poder repetir número.';
end $$;

-- 6 · La vuelta atrás, con marcadas -----------------------------------------------------------------------------------------------
do $$
declare ok boolean := false;
begin
  begin
    if exists (select 1 from public.customer_invoice where import_repeated) then
      raise exception 'X14i: hay emitidas marcadas «repetida en ERP10»: con ellas no cabe la regla de un solo número de antes. No se deshace.';
    end if;
  exception when others then ok := sqlerrm like 'X14i: hay emitidas marcadas%'; end;
  if not ok or to_regclass('public.customer_invoice_numero_unico') is null then raise exception 'PRUEBA X14i · 6: la vuelta atrás no para con marcadas.'; end if;
  raise notice 'PRUEBA X14i · 6: con marcadas, la vuelta atrás para (su primer paso) y no deja nada a medias.';
end $$;

-- 7 · La vuelta atrás, sin marcadas: quita lo nuevo y devuelve la regla y la función de antes --------------------------------
-- Las emitidas de la prueba fuera (una emitida no se borra desde Sumied: se quitan aquí, dentro del ROLLBACK).
set local session_replication_role = replica;
do $$ begin
  delete from public.customer_invoice where company_id = pg_temp.p('empresa')::uuid;
  if exists (select 1 from public.customer_invoice where import_repeated) then
    raise notice 'PRUEBA X14i · 7: esta base tiene otras marcadas: la vuelta atrás no se puede pasar entera aquí.';
  end if;
end $$;
set local session_replication_role = origin;
\i supabase/vuelta-atras/20261126T0710_x14i_repetida_en_erp10.down.sql
do $$ begin
  if to_regclass('public.customer_invoice_numero_unico') is not null
     or not exists (select 1 from pg_constraint where conname = 'customer_invoice_company_id_series_code_fiscal_year_number_key')
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_invoice' and column_name = 'import_repeated')
     or to_regprocedure('public._customer_invoice_repetida_guarda()') is not null
     or strpos(pg_get_functiondef('public.conta_traer_dar_por_bueno(uuid,text)'::regprocedure), 'X14i') > 0 then
    raise exception 'PRUEBA X14i · 7: la vuelta atrás no lo deja como antes.';
  end if;
  raise notice 'PRUEBA X14i · 7: la vuelta atrás quita la marca, su guarda y el índice, y devuelve la regla de un solo número y la función de antes.';
  raise notice 'PRUEBA X14i: 7 de 7 bien.';
end $$;

rollback;
