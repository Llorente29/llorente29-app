-- supabase/staging/sql/20261124_x14_traer_por_trozos_prueba.sql
--
-- SOLO STAGING. Prueba del X14 · 1 (20261124T1552_x14_traer_por_trozos), que el ensayo de staging pone delante en la misma
-- sesión. Todo en una transacción con ROLLBACK: staging no cambia. Lo que cambia: public.import_run (el estado «cargando»),
-- public.conta_traer_cargar (la cola), public.conta_traer_deshacer (también a medias) y public._journal_entry_proponer
-- (un asiento traído entra con su carga en prueba o a medias).
--
-- En la primera empresa de la cuenta A sin nada traído, como el administrador a1, con una carga INVENTADA de 2024 (30
-- asientos, 10 emitidas atadas a su asiento y una recibida con retención del 19 % cuyo asiento va a un 621). Los caminos:
--   1. Una carga pequeña entra en UNA llamada, como antes: en prueba, con sus cifras; la recibida, con la retención de
--      alquiler (mirada al encolar). Deshacerla deja la cuenta como estaba.
--   2. Con el margen a 0 (cada llamada mete uno): la carga queda a medias («cargando», 1 de 30), otra no entra, y seguir la
--      acaba con las MISMAS cifras y el MISMO texto que la 1.
--   3. Una carga a medias se deshace entera, con su cola: la cuenta, como estaba.
--   4. Traer otra vez, entera: las mismas cifras, nada duplicado.
--   5. La vuelta atrás: las funciones de antes, sin la cola ni «cargando».

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X14: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public.conta_traer_seguir(uuid)') is null then raise exception 'PRUEBA X14 · 0: falta la 1552 delante.'; end if;
end $$;
set local statement_timeout = '120s';
create temp table _x14 (k text primary key, v text) on commit drop;
grant all on _x14 to authenticated;
create function pg_temp.p(k text) returns text language sql as $$ select v from _x14 where _x14.k = $1 $$;

-- La empresa (como la prueba del N06a), con su ejercicio 2024 y sin día de inicio; y la carga inventada.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; d jsonb;
begin
  select co.id into c from public.company co
   where co.account_id = v_acc and not exists (select 1 from public.journal_entry e where e.company_id = co.id and e.source_type = 'migrated')
   order by co.created_at, co.id limit 1;
  if c is null then raise exception 'PRUEBA X14: la cuenta A no tiene ninguna empresa sin asientos traídos.'; end if;
  if (select account_digits from public.company_tax_profile where company_id = c) is distinct from 8 then
    raise exception 'PRUEBA X14: la empresa de la cuenta A no tiene cuentas de 8 dígitos.';
  end if;
  if not exists (select 1 from public.fiscal_year where company_id = c and starts_on = '2024-01-01') then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2024', '2024-01-01', '2024-12-31');
  end if;
  update public.bank_settings set cutover_date = null where company_id = c;
  perform public.conta_fijar_corte(c, null, 'erp10');
  d := jsonb_build_object('version', 1, 'programa', 'erp10', 'ficheros', '[]'::jsonb, 'largos', '[8]'::jsonb,
    'cuentas', jsonb_build_array(jsonb_build_object('codigo', '43000901', 'nombre', 'CLIENTE INVENTADO X14'), jsonb_build_object('codigo', '41000901', 'nombre', 'ACREEDOR INVENTADO X14'),
                                 jsonb_build_object('codigo', '70500000', 'nombre', 'Prestaciones de servicios'), jsonb_build_object('codigo', '57200000', 'nombre', 'Bancos'),
                                 jsonb_build_object('codigo', '62100000', 'nombre', 'Arrendamientos'), jsonb_build_object('codigo', '47510000', 'nombre', 'HP retenciones')),
    'terceros', jsonb_build_array(jsonb_build_object('clase', 'cliente', 'codigo', '43000901', 'nombre', 'CLIENTE INVENTADO X14', 'nombreComercial', '', 'nif', null),
                                  jsonb_build_object('clase', 'proveedor', 'codigo', '41000901', 'nombre', 'ACREEDOR INVENTADO X14', 'nombreComercial', '', 'nif', 'B00000000')),
    'asientos', (select jsonb_agg(case when i = 30 then
        jsonb_build_object('clave', 'X14-30', 'serie', '1', 'documento', '30', 'fecha', '2024-06-30', 'concepto', 'Alquiler inventado X14', 'apuntesLeidos', 3,
          'apuntes', jsonb_build_array(jsonb_build_object('cuenta', '62100000', 'nombre', '', 'concepto', 'Alquiler', 'debe', 10000, 'haber', 0),
                                       jsonb_build_object('cuenta', '47510000', 'nombre', '', 'concepto', 'Alquiler', 'debe', 0, 'haber', 1900, 'retencion', jsonb_build_object('tipo', 19, 'base', 10000)),
                                       jsonb_build_object('cuenta', '41000901', 'nombre', '', 'concepto', 'Alquiler', 'debe', 0, 'haber', 8100)))
      else jsonb_build_object('clave', 'X14-' || i, 'serie', '1', 'documento', i::text, 'fecha', ('2024-01-01'::date + i * 7)::text, 'concepto', 'Cobro inventado X14 ' || i, 'apuntesLeidos', 2,
          'apuntes', jsonb_build_array(jsonb_build_object('cuenta', '43000901', 'nombre', '', 'concepto', 'Inventado', 'debe', 12100, 'haber', 0),
                                       jsonb_build_object('cuenta', '70500000', 'nombre', '', 'concepto', 'Inventado', 'debe', 0, 'haber', 12100))) end order by i)
      from generate_series(1, 30) i),
    'facturas', (select jsonb_agg(f order by o) from (
        select i o, jsonb_build_object('libro', 'expedidas', 'numero', 'X14-' || i, 'serie', 'X14', 'numeroSolo', i::text, 'fecha', ('2024-01-01'::date + i * 7)::text,
          'operacion', null, 'periodo', null, 'ejercicio', '2024', 'nif', null, 'nombre', 'CLIENTE INVENTADO X14',
          'tramos', jsonb_build_array(jsonb_build_object('base', 12100, 'tipo', null, 'cuota', 0)), 'base', 12100, 'cuota', 0, 'total', 12100, 'retencion', null,
          'asiento', 'X14-' || i || '|' || ('2024-01-01'::date + i * 7)::text, 'pendiente', null) f from generate_series(1, 10) i
        union all
        select 99, jsonb_build_object('libro', 'recibidas', 'numero', 'ALQ-X14', 'serie', null, 'numeroSolo', null, 'fecha', '2024-06-30',
          'operacion', null, 'periodo', null, 'ejercicio', '2024', 'nif', 'B00000000', 'nombre', 'ACREEDOR INVENTADO X14',
          'tramos', jsonb_build_array(jsonb_build_object('base', 10000, 'tipo', 0, 'cuota', 0)), 'base', 10000, 'cuota', 0, 'total', 8100,
          'retencion', jsonb_build_object('tipo', 19, 'importe', 1900), 'asiento', 'X14-30|2024-06-30', 'pendiente', 0)) z),
    'aprendido', '[]'::jsonb, 'pendientesNoExactos', '[]'::jsonb, 'raros', '[]'::jsonb, 'sumas', '[]'::jsonb, 'inmovilizado', null, 'frases', '[]'::jsonb);
  insert into _x14 values ('empresa', c), ('datos', d::text), ('cuenta', v_acc);
end $$;

-- La huella de la cuenta A: lo que traer toca, contado y en md5 (sin fechas de cambio).
create function pg_temp.huella() returns text language sql as $$
  select concat_ws(' · ',
    (select count(*) || '/' || md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.journal_entry where account_id = pg_temp.p('cuenta')::uuid),
    (select count(*) || '/' || md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.company_account where account_id = pg_temp.p('cuenta')::uuid),
    (select count(*) || '/' || md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.supplier where account_id = pg_temp.p('cuenta')::uuid),
    (select count(*) || '/' || md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.party where account_id = pg_temp.p('cuenta')::uuid),
    (select count(*) || '/' || md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.supplier_invoice where account_id = pg_temp.p('cuenta')::uuid),
    (select count(*) || '/' || md5(coalesce(string_agg(id::text, ',' order by id), '')) from public.company_account_link where account_id = pg_temp.p('cuenta')::uuid))
$$;
grant execute on function pg_temp.huella() to authenticated;
insert into _x14 select 'antes', pg_temp.huella();
set local role authenticated;

-- 1 · Una carga pequeña, en una llamada --------------------------------------------------------------------------------
do $$
declare r jsonb; v_r public.import_run; v_ret text;
begin
  r := public.conta_traer_cargar(pg_temp.p('empresa')::uuid, '2024', pg_temp.p('datos')::jsonb, 'Prueba X14');
  select * into v_r from public.import_run where id = (r->>'carga')::uuid;
  if not (r->>'acabado')::boolean or v_r.status <> 'en_prueba' or (v_r.counts->>'asientos')::int <> 30 or (v_r.counts->>'casadas')::int <> 11
     or (v_r.counts->>'facturas_emitidas')::int <> 10 or (v_r.counts->>'facturas_recibidas')::int <> 1 or r->>'texto' not like 'Traído en prueba: 30 asientos%' then
    raise exception 'PRUEBA X14 · 1: no ha entrado entera en una llamada: % · %', r, to_jsonb(v_r) - 'detail';
  end if;
  select w.code into v_ret from public.supplier_invoice i join public.withholding_rate w on w.id = i.withholding_rate_id
   where i.import_run_id = v_r.id and i.invoice_number = 'ALQ-X14';
  if v_ret is distinct from 'alquiler' then raise exception 'PRUEBA X14 · 1: la retención de la recibida con 621 no es de alquiler: %.', v_ret; end if;
  insert into _x14 values ('cuentas1', v_r.counts::text), ('texto1', r->>'texto');
  perform public.conta_traer_deshacer(v_r.id, 'Prueba X14');
  if pg_temp.huella() <> pg_temp.p('antes') then raise exception 'PRUEBA X14 · 1: deshacer no deja la cuenta como estaba.'; end if;
  raise notice 'PRUEBA X14 · 1: en una llamada, en prueba («%»); la retención, de alquiler; deshecha, la cuenta como estaba.', left(r->>'texto', 60);
end $$;

-- 2 · A medias, y seguir hasta el final --------------------------------------------------------------------------------
do $$
declare r jsonb; v_r public.import_run; n int := 1; ok boolean := false;
begin
  perform set_config('conta.traer_segundos', '0', true);
  r := public.conta_traer_cargar(pg_temp.p('empresa')::uuid, '2024', pg_temp.p('datos')::jsonb, 'Prueba X14');
  select * into v_r from public.import_run where id = (r->>'carga')::uuid;
  if (r->>'acabado')::boolean or v_r.status <> 'cargando' or (r->'asientos'->>'hechos')::int <> 1 or (r->'asientos'->>'de')::int <> 30 then
    raise exception 'PRUEBA X14 · 2: con el margen a 0 no queda a medias con 1 de 30: %', r;
  end if;
  begin perform public.conta_traer_cargar(pg_temp.p('empresa')::uuid, '2024', pg_temp.p('datos')::jsonb, 'Prueba X14');
  exception when others then ok := sqlerrm like 'Hay una carga de esta empresa a medias%'; end;
  if not ok then raise exception 'PRUEBA X14 · 2: con una carga a medias ha entrado otra'; end if;
  while not (r->>'acabado')::boolean loop
    r := public.conta_traer_seguir(v_r.id); n := n + 1;
    if n > 100 then raise exception 'PRUEBA X14 · 2: seguir no acaba'; end if;
  end loop;
  select * into v_r from public.import_run where id = v_r.id;
  if v_r.status <> 'en_prueba' or v_r.counts::text <> pg_temp.p('cuentas1') or r->>'texto' <> pg_temp.p('texto1') then
    raise exception 'PRUEBA X14 · 2: a trozos no da lo mismo que de una vez: % · %', v_r.counts, r->>'texto';
  end if;
  if (select count(*) from public.journal_entry where import_run_id = v_r.id) <> 30
     or (select count(*) from public.supplier_invoice where import_run_id = v_r.id and journal_entry_id is not null) <> 1 then
    raise exception 'PRUEBA X14 · 2: los asientos o la recibida atada a su asiento no están.';
  end if;
  insert into _x14 values ('carga2', v_r.id);
  raise notice 'PRUEBA X14 · 2: a medias (1 de 30), otra no entra, y en % llamadas, las mismas cifras y el mismo texto que de una vez.', n;
  perform public.conta_traer_deshacer(v_r.id, 'Prueba X14');
end $$;

-- 3 · Deshacer una carga a medias ---------------------------------------------------------------------------------------
do $$
declare r jsonb; v_r public.import_run;
begin
  perform set_config('conta.traer_segundos', '0', true);
  r := public.conta_traer_cargar(pg_temp.p('empresa')::uuid, '2024', pg_temp.p('datos')::jsonb, 'Prueba X14');
  for i in 1..12 loop r := public.conta_traer_seguir((r->>'carga')::uuid); end loop;   -- 13 de 41: asientos a medias
  select * into v_r from public.import_run where id = (r->>'carga')::uuid;
  if v_r.status <> 'cargando' then raise exception 'PRUEBA X14 · 3: no está a medias: %', r; end if;
  r := public.conta_traer_deshacer(v_r.id, 'Prueba X14');
  select * into v_r from public.import_run where id = v_r.id;
  if v_r.status <> 'deshecha' or pg_temp.huella() <> pg_temp.p('antes') then
    raise exception 'PRUEBA X14 · 3: deshacer una carga a medias no deja la cuenta como estaba (%).', v_r.status;
  end if;
  raise notice 'PRUEBA X14 · 3: una carga a medias (13 de 41) se deshace entera: la cuenta, como estaba.';
end $$;

-- 4 · Traer otra vez, entera ------------------------------------------------------------------------------------------
do $$
declare r jsonb; v_r public.import_run;
begin
  perform set_config('conta.traer_segundos', '4', true);
  r := public.conta_traer_cargar(pg_temp.p('empresa')::uuid, '2024', pg_temp.p('datos')::jsonb, 'Prueba X14');
  select * into v_r from public.import_run where id = (r->>'carga')::uuid;
  if v_r.status <> 'en_prueba' or v_r.counts::text <> pg_temp.p('cuentas1')
     or (select count(*) from public.journal_entry where account_id = pg_temp.p('cuenta')::uuid and source_type = 'migrated' and status = 'borrador') <> 30 then
    raise exception 'PRUEBA X14 · 4: traer otra vez no da lo mismo, o duplica: %', v_r.counts;
  end if;
  raise notice 'PRUEBA X14 · 4: traída otra vez, las mismas cifras y 30 asientos traídos, ni uno más.';
end $$;
reset role;

-- 5 · La vuelta atrás -------------------------------------------------------------------------------------------------
do $$ begin
  update public.import_run set status = 'deshecha' where status = 'cargando' and account_id = pg_temp.p('cuenta')::uuid;   -- no queda ninguna: por si acaso
end $$;
\i supabase/vuelta-atras/20261124T1552_x14_traer_por_trozos.down.sql
do $$ begin
  if to_regprocedure('public.conta_traer_seguir(uuid)') is not null or to_regclass('public.conta_traer_trozo') is not null
     or strpos(pg_get_functiondef('public.conta_traer_cargar(uuid,text,jsonb,text)'::regprocedure), 'X14') > 0
     or strpos(pg_get_functiondef('public.conta_traer_deshacer(uuid,text)'::regprocedure), 'X14') > 0
     or strpos(pg_get_functiondef('public._journal_entry_proponer(uuid,jsonb,jsonb,jsonb,text,uuid)'::regprocedure), 'X14') > 0
     or strpos(pg_get_constraintdef((select oid from pg_constraint where conname = 'import_run_status_check')), 'cargando') > 0 then
    raise exception 'PRUEBA X14 · 5: la vuelta atrás no lo deja como antes.';
  end if;
  raise notice 'PRUEBA X14 · 5: la vuelta atrás deja las tres funciones de antes, sin la cola ni «cargando».';
  raise notice 'PRUEBA X14: 5 de 5 bien.';
end $$;

rollback;
