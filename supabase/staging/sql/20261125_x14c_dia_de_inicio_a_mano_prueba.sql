-- supabase/staging/sql/20261125_x14c_dia_de_inicio_a_mano_prueba.sql
--
-- SOLO STAGING. Prueba del X14 · 2 (20261125T0903_x14c_dia_de_inicio_a_mano), que el ensayo de staging pone delante en la
-- misma sesión. Todo en una transacción con ROLLBACK: staging no cambia. Lo que cambia: public.conta_traer_cargar y
-- public._conta_traer_seguir (lo traído no fija el día de inicio), public.conta_fijar_corte y
-- public.fiscal_year_corte_cambiable (a mano, también con lo traído antes).
--
-- En una empresa NUEVA de la cuenta A (pymes, 8 dígitos, solo con su ejercicio 2026), como el administrador a1, con lo leído
-- INVENTADO de tres años: 12 asientos de 2024, 12 de 2025 y 3 de 2026 (enero a marzo). Los caminos:
--   1. Traer 2025, darlo por bueno; traer 2024, darlo por bueno; traer 2026: los tres entran enteros (12, 12 y 3), en ese
--      orden, y la empresa sigue SIN día de inicio. Antes, el 2025 lo fijaba en el 01/01/2026 y el 2024 no traía nada.
--   2. A mano, un día de inicio con lo traído después (el 01/02/2026): para y dice cuántos y el primer día que vale.
--   3. A mano, el 01/04/2026: vale; 2024 y 2025, traídos; 2026, mixto hasta el 31/03; el día de inicio, el 01/04/2026.
--   4. A mano, quitarlo con lo traído: para.
--   5. La vuelta atrás: las cuatro funciones de antes.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X14c: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if strpos(pg_get_functiondef('public.conta_traer_cargar(uuid,text,jsonb,text)'::regprocedure), 'X14 · 2') = 0 then
    raise exception 'PRUEBA X14c · 0: falta la 0903 delante.';
  end if;
end $$;
set local statement_timeout = '120s';
create temp table _x14c (k text primary key, v text) on commit drop;
grant all on _x14c to authenticated;
create function pg_temp.p(k text) returns text language sql as $$ select v from _x14c where _x14c.k = $1 $$;
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
  values (v_acc, 'Prueba X14c inventada', 'B' || d7 || ((10 - s % 10) % 10)::text, 'nif_es', 'company', 'hecho', now()) returning id into c;
  insert into public.company_tax_profile (account_id, company_id, tax_territory, chart_kind, account_digits, tax_forms)
  values (v_acc, c, 'peninsula_baleares', 'pymes', 8, array['303']);
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31');
  d := jsonb_build_object('version', 1, 'programa', 'erp10', 'ficheros', '[]'::jsonb, 'largos', '[8]'::jsonb,
    'cuentas', jsonb_build_array(jsonb_build_object('codigo', '43000901', 'nombre', 'CLIENTE INVENTADO X14C'), jsonb_build_object('codigo', '70500000', 'nombre', 'Prestaciones de servicios')),
    'terceros', '[]'::jsonb,
    'asientos', (select jsonb_agg(jsonb_build_object('clave', 'X14C-' || y || '-' || m, 'serie', '1', 'documento', (y * 100 + m)::text, 'fecha', make_date(y, m, 15)::text,
        'concepto', 'Inventado X14c ' || y || '/' || m, 'apuntesLeidos', 2,
        'apuntes', jsonb_build_array(jsonb_build_object('cuenta', '43000901', 'nombre', '', 'concepto', 'Inventado', 'debe', 12100, 'haber', 0),
                                     jsonb_build_object('cuenta', '70500000', 'nombre', '', 'concepto', 'Inventado', 'debe', 0, 'haber', 12100))) order by y, m)
      from generate_series(2024, 2026) y, generate_series(1, 12) m where y < 2026 or m <= 3),
    'facturas', '[]'::jsonb, 'aprendido', '[]'::jsonb, 'pendientesNoExactos', '[]'::jsonb, 'raros', '[]'::jsonb, 'sumas', '[]'::jsonb, 'inmovilizado', null, 'frases', '[]'::jsonb);
  insert into _x14c values ('empresa', c), ('datos', d::text);
end $$;
create function pg_temp.ejercicios() returns text language sql as $$
  select string_agg(y.code || ':' || y.origin || coalesce('<' || y.imported_until::text, ''), ' ' order by y.starts_on)
    from public.fiscal_year y where y.company_id = pg_temp.p('empresa')::uuid
$$;
grant execute on function pg_temp.ejercicios() to authenticated;
create function pg_temp.traer(ej text) returns jsonb language plpgsql as $$
declare r jsonb; v_r public.import_run;
begin
  r := public.conta_traer_cargar(pg_temp.p('empresa')::uuid, ej, pg_temp.p('datos')::jsonb, 'Prueba X14c');
  while coalesce((r->>'acabado')::boolean, true) is false loop r := public.conta_traer_seguir((r->>'carga')::uuid); end loop;
  select * into v_r from public.import_run where id = (r->>'carga')::uuid;
  return jsonb_build_object('carga', v_r.id, 'status', v_r.status, 'asientos', (v_r.counts->>'asientos')::int, 'texto', r->>'texto', 'dia', r->'dia_de_inicio');
end $$;
grant execute on function pg_temp.traer(text) to authenticated;
set local role authenticated;

-- 1 · Tres años, en desorden, y ninguno deja fuera a otro ------------------------------------------------------------------
do $$
declare r jsonb; ej text; esperado int; v_dia date;
begin
  foreach ej in array array['2025', '2024', '2026'] loop
    esperado := case when ej = '2026' then 3 else 12 end;
    r := pg_temp.traer(ej);
    if r->>'status' <> 'en_prueba' or (r->>'asientos')::int <> esperado then
      raise exception 'PRUEBA X14c · 1: el % no entra entero (% de %): %', ej, r->>'asientos', esperado, r;
    end if;
    if r->>'texto' like '%empieza a llevar%' or jsonb_typeof(r->'dia') <> 'null' then raise exception 'PRUEBA X14c · 1: el % anuncia un día de inicio: %', ej, r; end if;
    v_dia := public.conta_empresa_dia_de_inicio(pg_temp.p('empresa')::uuid);
    if v_dia is not null then raise exception 'PRUEBA X14c · 1: traer el % ha fijado el día de inicio en el %.', ej, v_dia; end if;
    if ej <> '2026' then perform public.conta_traer_dar_por_bueno((r->>'carga')::uuid, 'Prueba X14c'); end if;
    raise notice 'PRUEBA X14c · 1: el % entra entero (% asientos) y no hay día de inicio.', ej, r->>'asientos';
  end loop;
  if (select count(*) from public.journal_entry where company_id = pg_temp.p('empresa')::uuid and source_type = 'migrated') <> 27 then
    raise exception 'PRUEBA X14c · 1: no están los 27 traídos.';
  end if;
  if pg_temp.ejercicios() <> '2024:folvy 2025:folvy 2026:folvy' then raise exception 'PRUEBA X14c · 1: un ejercicio ha cambiado: %.', pg_temp.ejercicios(); end if;
end $$;

-- 2 · A mano, con lo traído después: para ----------------------------------------------------------------------------------
do $$
declare ok text;
begin
  begin perform public.conta_fijar_corte(pg_temp.p('empresa')::uuid, '2026-01-31', 'ERP10');
  exception when others then ok := sqlerrm; end;
  if ok is distinct from 'El día de inicio no puede ser el 01/02/2026: hay 2 asientos traídos de ese día en adelante, el último del 15/03/2026. Como pronto, el 16/03/2026.' then
    raise exception 'PRUEBA X14c · 2: no para como debe: %', ok;
  end if;
  if public.conta_empresa_dia_de_inicio(pg_temp.p('empresa')::uuid) is not null then raise exception 'PRUEBA X14c · 2: ha quedado fijado.'; end if;
  raise notice 'PRUEBA X14c · 2: para con «%».', ok;
end $$;

-- 3 · A mano, después de lo traído: vale -----------------------------------------------------------------------------------
do $$
declare v_dia date;
begin
  perform public.conta_fijar_corte(pg_temp.p('empresa')::uuid, '2026-03-31', 'ERP10');
  v_dia := public.conta_empresa_dia_de_inicio(pg_temp.p('empresa')::uuid);
  if v_dia is distinct from '2026-04-01'::date then raise exception 'PRUEBA X14c · 3: el día de inicio es %.', v_dia; end if;
  if pg_temp.ejercicios() <> '2024:migrated 2025:migrated 2026:mixed<2026-03-31' then raise exception 'PRUEBA X14c · 3: los ejercicios quedan %.', pg_temp.ejercicios(); end if;
  raise notice 'PRUEBA X14c · 3: fijado a mano el 01/04/2026, con los 27 traídos antes: %.', pg_temp.ejercicios();
end $$;

-- 4 · A mano, quitarlo con lo traído: para ---------------------------------------------------------------------------------
do $$
declare ok text;
begin
  begin perform public.conta_fijar_corte(pg_temp.p('empresa')::uuid, null, 'ERP10');
  exception when others then ok := sqlerrm; end;
  if ok is null or ok not like 'No se puede quitar el día de inicio: hay 27 asientos traídos, el último del 15/03/2026.%' then
    raise exception 'PRUEBA X14c · 4: no para como debe: %', ok;
  end if;
  raise notice 'PRUEBA X14c · 4: para con «%».', ok;
end $$;
reset role;

-- 5 · La vuelta atrás -----------------------------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261125T0903_x14c_dia_de_inicio_a_mano.down.sql
do $$ begin
  if strpos(pg_get_functiondef('public.conta_traer_cargar(uuid,text,jsonb,text)'::regprocedure), 'X14 · 2') > 0
     or strpos(pg_get_functiondef('public._conta_traer_seguir(uuid,timestamp with time zone)'::regprocedure), 'X14 · 2') > 0
     or strpos(pg_get_functiondef('public.conta_fijar_corte(uuid,date,text)'::regprocedure), 'X14 · 2') > 0
     or strpos(pg_get_functiondef('public.fiscal_year_corte_cambiable()'::regprocedure), 'X14 · 2') > 0 then
    raise exception 'PRUEBA X14c · 5: la vuelta atrás no lo deja como antes.';
  end if;
  raise notice 'PRUEBA X14c · 5: la vuelta atrás deja las cuatro funciones de antes.';
  raise notice 'PRUEBA X14c: 5 de 5 bien.';
end $$;

rollback;
