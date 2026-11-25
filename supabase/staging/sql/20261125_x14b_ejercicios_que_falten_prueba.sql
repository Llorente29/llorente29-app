-- supabase/staging/sql/20261125_x14b_ejercicios_que_falten_prueba.sql
--
-- SOLO STAGING. Prueba del X14 · 1b (20261125T0816_x14b_ejercicios_que_falten), que el ensayo de staging pone delante en la
-- misma sesión. Todo en una transacción con ROLLBACK: staging no cambia. Lo que cambia: public.conta_traer_cargar (crea los
-- ejercicios que falten) y public.conta_traer_deshacer (los quita).
--
-- En una empresa NUEVA de la cuenta A (pymes, 8 dígitos, solo con su ejercicio 2026), como el administrador a1, con una carga
-- INVENTADA de 2024 (12 asientos). Los caminos:
--   1. Traer el 2024: entra en prueba, y la empresa tiene 2024 y 2025, años naturales, encadenados a 2026.
--   2. Deshacer: los dos ejercicios se van, 2026 vuelve a no tener anterior, y la cuenta, como estaba.
--   3. Si el primer ejercicio no es un año natural, no se adivina: para como antes.
--   4. La vuelta atrás: las dos funciones de antes.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X14b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if strpos(pg_get_functiondef('public.conta_traer_cargar(uuid,text,jsonb,text)'::regprocedure), 'X14 · 1b') = 0 then
    raise exception 'PRUEBA X14b · 0: falta la 0816 delante.';
  end if;
end $$;
set local statement_timeout = '120s';
create temp table _x14b (k text primary key, v text) on commit drop;
grant all on _x14b to authenticated;
create function pg_temp.p(k text) returns text language sql as $$ select v from _x14b where _x14b.k = $1 $$;
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
  values (v_acc, 'Prueba X14b inventada', 'B' || d7 || ((10 - s % 10) % 10)::text, 'nif_es', 'company', 'hecho', now()) returning id into c;
  insert into public.company_tax_profile (account_id, company_id, tax_territory, chart_kind, account_digits, tax_forms)
  values (v_acc, c, 'peninsula_baleares', 'pymes', 8, array['303']);
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31');
  d := jsonb_build_object('version', 1, 'programa', 'erp10', 'ficheros', '[]'::jsonb, 'largos', '[8]'::jsonb,
    'cuentas', jsonb_build_array(jsonb_build_object('codigo', '43000901', 'nombre', 'CLIENTE INVENTADO X14B'), jsonb_build_object('codigo', '70500000', 'nombre', 'Prestaciones de servicios')),
    'terceros', '[]'::jsonb,
    'asientos', (select jsonb_agg(jsonb_build_object('clave', 'X14B-' || i, 'serie', '1', 'documento', i::text, 'fecha', make_date(2024, i, 15)::text, 'concepto', 'Inventado X14b ' || i,
        'apuntesLeidos', 2, 'apuntes', jsonb_build_array(jsonb_build_object('cuenta', '43000901', 'nombre', '', 'concepto', 'Inventado', 'debe', 12100, 'haber', 0),
                                                         jsonb_build_object('cuenta', '70500000', 'nombre', '', 'concepto', 'Inventado', 'debe', 0, 'haber', 12100))) order by i)
      from generate_series(1, 12) i),
    'facturas', '[]'::jsonb, 'aprendido', '[]'::jsonb, 'pendientesNoExactos', '[]'::jsonb, 'raros', '[]'::jsonb, 'sumas', '[]'::jsonb, 'inmovilizado', null, 'frases', '[]'::jsonb);
  insert into _x14b values ('empresa', c), ('datos', d::text);
end $$;
create function pg_temp.ejercicios() returns text language sql as $$
  select string_agg(y.code || coalesce('←' || p.code, ''), ' ' order by y.starts_on)
    from public.fiscal_year y left join public.fiscal_year p on p.id = y.previous_year_id where y.company_id = pg_temp.p('empresa')::uuid
$$;
grant execute on function pg_temp.ejercicios() to authenticated;
insert into _x14b select 'antes', pg_temp.ejercicios();
set local role authenticated;

-- 1 · Traer el 2024 -------------------------------------------------------------------------------------------------------
do $$
declare r jsonb; v_r public.import_run; v_mal int;
begin
  r := public.conta_traer_cargar(pg_temp.p('empresa')::uuid, '2024', pg_temp.p('datos')::jsonb, 'Prueba X14b');
  select * into v_r from public.import_run where id = (r->>'carga')::uuid;
  if v_r.status <> 'en_prueba' or (v_r.counts->>'asientos')::int <> 12 then raise exception 'PRUEBA X14b · 1: no ha entrado en prueba: % · %', r, v_r.counts; end if;
  if pg_temp.ejercicios() <> '2024 2025←2024 2026←2025' then raise exception 'PRUEBA X14b · 1: los ejercicios no quedan encadenados: %.', pg_temp.ejercicios(); end if;
  select count(*) into v_mal from public.fiscal_year where company_id = pg_temp.p('empresa')::uuid and code in ('2024', '2025')
     and not (starts_on = make_date(code::int, 1, 1) and ends_on = make_date(code::int, 12, 31));
  if v_mal > 0 then raise exception 'PRUEBA X14b · 1: un ejercicio creado no es un año natural.'; end if;
  insert into _x14b values ('carga', v_r.id);
  raise notice 'PRUEBA X14b · 1: el 2024 entra en prueba (12 asientos), y la empresa tiene %.', pg_temp.ejercicios();
end $$;

-- 2 · Deshacer ----------------------------------------------------------------------------------------------------------
do $$ begin
  perform public.conta_traer_deshacer(pg_temp.p('carga')::uuid, 'Prueba X14b');
  if pg_temp.ejercicios() <> pg_temp.p('antes') then raise exception 'PRUEBA X14b · 2: deshacer no deja los ejercicios como estaban: %.', pg_temp.ejercicios(); end if;
  if exists (select 1 from public.journal_entry where company_id = pg_temp.p('empresa')::uuid) then raise exception 'PRUEBA X14b · 2: quedan asientos.'; end if;
  raise notice 'PRUEBA X14b · 2: deshecha, la empresa vuelve a tener solo «%».', pg_temp.ejercicios();
end $$;
reset role;

-- 3 · El primero no es un año natural: no se adivina ---------------------------------------------------------------------
update public.fiscal_year set starts_on = '2026-02-01', ends_on = '2027-01-31' where company_id = pg_temp.p('empresa')::uuid and code = '2026';
set local role authenticated;
do $$
declare ok boolean := false;
begin
  begin perform public.conta_traer_cargar(pg_temp.p('empresa')::uuid, '2024', pg_temp.p('datos')::jsonb, 'Prueba X14b');
  exception when others then ok := sqlerrm like 'La empresa no tiene el ejercicio 2024%'; end;
  if not ok then raise exception 'PRUEBA X14b · 3: con un primer ejercicio que no es año natural no ha parado como antes.'; end if;
  raise notice 'PRUEBA X14b · 3: con el primer ejercicio partido (01/02 a 31/01), para como antes: «La empresa no tiene el ejercicio 2024».';
end $$;
reset role;

-- 4 · La vuelta atrás -----------------------------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261125T0816_x14b_ejercicios_que_falten.down.sql
do $$ begin
  if strpos(pg_get_functiondef('public.conta_traer_cargar(uuid,text,jsonb,text)'::regprocedure), 'X14 · 1b') > 0
     or strpos(pg_get_functiondef('public.conta_traer_deshacer(uuid,text)'::regprocedure), 'X14 · 1b') > 0 then
    raise exception 'PRUEBA X14b · 4: la vuelta atrás no lo deja como antes.';
  end if;
  raise notice 'PRUEBA X14b · 4: la vuelta atrás deja las dos funciones de antes.';
  raise notice 'PRUEBA X14b: 4 de 4 bien.';
end $$;

rollback;
