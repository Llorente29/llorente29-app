-- supabase/staging/sql/20261122_x27c_domicilio_prueba.sql
--
-- SOLO STAGING. Prueba del X27c (20261122T1920_x27c_web_y_domicilio y 20261122T1921_x27c_alta_parte_el_domicilio), que
-- el ensayo de staging pone delante en la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia. Nombra
-- lo que cambia: public.supplier (el disparador x27c_alta_parte_el_domicilio); y lo nuevo: public.customer_fiscal
-- (website), public._x27c_provincia_de_cp(text), public._x27c_partir_domicilio(text) y
-- public.tg_x27c_alta_parte_el_domicilio(). Domicilios y proveedores inventados (T11). Por sus CAMINOS:
--   1. Partir domicilios: con código postal (y la provincia entre paréntesis), sin él con la población tras una coma,
--      y uno que no se sabe partir (entero en la calle).
--   2. Dar de alta un proveedor como su usuario: con la población dentro del domicilio (el caso de la respuesta X27 · 1),
--      con el código postal y sin provincia, y con todo ya puesto (no se toca).
--   3. Lo ya guardado no cambia: un proveedor que ya existía con la población dentro del domicilio, igual después.
--   4. La web del cliente se guarda como su usuario.
--   5. La vuelta atrás: quita el disparador, las funciones y la columna.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X27c: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public.tg_x27c_alta_parte_el_domicilio()') is null then raise exception 'PRUEBA X27c · 0: faltan la 1920 y la 1921 delante.'; end if;
end $$;
set local statement_timeout = '60s';

-- 1 · Partir domicilios --------------------------------------------------------------------------------------------
do $$
declare v jsonb;
begin
  v := public._x27c_partir_domicilio('C/ Inventada, 5, 28013 Madrid');
  if v <> '{"calle": "C/ Inventada, 5", "cp": "28013", "ciudad": "Madrid", "provincia": "MADRID"}'::jsonb then raise exception 'PRUEBA X27c · 1a: %', v; end if;
  v := public._x27c_partir_domicilio('C/ Inventada 61, 08940 Cornellà de Llobregat (Barcelona)');
  if v->>'ciudad' <> 'Cornellà de Llobregat' or v->>'provincia' <> 'BARCELONA' or v->>'cp' <> '08940' then raise exception 'PRUEBA X27c · 1b: %', v; end if;
  v := public._x27c_partir_domicilio('Avda. Inventada 12, Madrid');
  if v <> '{"calle": "Avda. Inventada 12", "cp": null, "ciudad": "Madrid", "provincia": "MADRID"}'::jsonb then raise exception 'PRUEBA X27c · 1c: %', v; end if;
  v := public._x27c_partir_domicilio('Avda. Inventada 12, Getafe');
  if v->>'ciudad' <> 'Getafe' or v->>'provincia' is not null then raise exception 'PRUEBA X27c · 1d (una población que no se llama como su provincia): %', v; end if;
  v := public._x27c_partir_domicilio('Calle Inventada 3');
  if v <> '{"calle": "Calle Inventada 3", "cp": null, "ciudad": null, "provincia": null}'::jsonb then raise exception 'PRUEBA X27c · 1e: %', v; end if;
  if public._x27c_provincia_de_cp('08940') <> 'BARCELONA' or public._x27c_provincia_de_cp('99999') is not null then raise exception 'PRUEBA X27c · 1f'; end if;
  raise notice 'PRUEBA X27c · 1: los domicilios se parten (con y sin código postal, y el que no se sabe partir, entero).';
end $$;

-- 3 (antes) · Un proveedor que ya existía con la población dentro del domicilio: se mira antes y después.
create temp table _x27c (clave text primary key, valor text) on commit drop;
grant all on _x27c to authenticated;
insert into _x27c select 'antes', coalesce(fiscal_street, '') || '|' || coalesce(fiscal_city, '') || '|' || coalesce(fiscal_province, '')
  from public.supplier where id = 'c0e40000-0000-4000-8000-0000000000a1';

-- 2 · Dar de alta, como su usuario ---------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
insert into public.supplier (id, account_id, name, fiscal_street, created_by_name) values
  ('c0e40000-0000-4000-8000-00000000c27a', 'c0e20000-0000-4000-8000-0000000000e0', 'Proveedor Inventado X27c Uno', 'C/ Inventada 9, Madrid', 'prueba'),
  ('c0e40000-0000-4000-8000-00000000c27b', 'c0e20000-0000-4000-8000-0000000000e0', 'Proveedor Inventado X27c Dos', 'C/ Inventada 10', 'prueba');
insert into public.supplier (id, account_id, name, fiscal_street, fiscal_postal_code, fiscal_city, fiscal_province, created_by_name) values
  ('c0e40000-0000-4000-8000-00000000c27c', 'c0e20000-0000-4000-8000-0000000000e0', 'Proveedor Inventado X27c Tres', 'C/ Inventada 11', '08940', 'Cornellà', null, 'prueba'),
  ('c0e40000-0000-4000-8000-00000000c27d', 'c0e20000-0000-4000-8000-0000000000e0', 'Proveedor Inventado X27c Cuatro', 'C/ Inventada 12, Madrid', '28001', 'Alcorcón', 'PROVINCIA PUESTA', 'prueba');
reset role;
do $$
declare v record;
begin
  select fiscal_street, fiscal_city, fiscal_province into v from public.supplier where id = 'c0e40000-0000-4000-8000-00000000c27a';
  if v.fiscal_street <> 'C/ Inventada 9' or v.fiscal_city <> 'Madrid' or v.fiscal_province <> 'MADRID' then raise exception 'PRUEBA X27c · 2a: %', row_to_json(v); end if;
  select fiscal_street, fiscal_city, fiscal_province into v from public.supplier where id = 'c0e40000-0000-4000-8000-00000000c27b';
  if v.fiscal_street <> 'C/ Inventada 10' or v.fiscal_city is not null then raise exception 'PRUEBA X27c · 2b: %', row_to_json(v); end if;
  select fiscal_street, fiscal_city, fiscal_province into v from public.supplier where id = 'c0e40000-0000-4000-8000-00000000c27c';
  if v.fiscal_province <> 'BARCELONA' or v.fiscal_city <> 'Cornellà' then raise exception 'PRUEBA X27c · 2c: %', row_to_json(v); end if;
  select fiscal_street, fiscal_city, fiscal_province into v from public.supplier where id = 'c0e40000-0000-4000-8000-00000000c27d';
  if v.fiscal_street <> 'C/ Inventada 12, Madrid' or v.fiscal_city <> 'Alcorcón' or v.fiscal_province <> 'PROVINCIA PUESTA' then raise exception 'PRUEBA X27c · 2d (lo puesto no se toca): %', row_to_json(v); end if;
  raise notice 'PRUEBA X27c · 2: el alta parte el domicilio y pone la provincia; lo que ya trae, no se toca.';
end $$;

-- 3 · Lo ya guardado no cambia ---------------------------------------------------------------------------------------
update public.supplier set notes = notes where id = 'c0e40000-0000-4000-8000-0000000000a1';
do $$ begin
  if (select valor from _x27c where clave = 'antes') is distinct from (select coalesce(fiscal_street, '') || '|' || coalesce(fiscal_city, '') || '|' || coalesce(fiscal_province, '')
       from public.supplier where id = 'c0e40000-0000-4000-8000-0000000000a1') then
    raise exception 'PRUEBA X27c · 3: un proveedor que ya existía ha cambiado su domicilio.';
  end if;
  raise notice 'PRUEBA X27c · 3 (regla 31): lo ya guardado no cambia (el disparador es solo del alta).';
end $$;

-- 4 · La web del cliente -------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
update public.customer_fiscal set website = 'https://cliente.prueba.folvy.test' where party_id = 'c0e50000-0000-4000-8000-0000000000c1';
reset role;
do $$ begin
  if (select website from public.customer_fiscal where party_id = 'c0e50000-0000-4000-8000-0000000000c1') is distinct from 'https://cliente.prueba.folvy.test' then
    raise exception 'PRUEBA X27c · 4: la web del cliente no se guarda como su usuario.';
  end if;
  raise notice 'PRUEBA X27c · 4: la web del cliente se guarda.';
end $$;

-- 5 · La vuelta atrás -----------------------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261122T1921_x27c_alta_parte_el_domicilio.down.sql
\i supabase/vuelta-atras/20261122T1920_x27c_web_y_domicilio.down.sql
do $$ begin
  if to_regprocedure('public.tg_x27c_alta_parte_el_domicilio()') is not null or to_regprocedure('public._x27c_partir_domicilio(text)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_fiscal' and column_name = 'website') then
    raise exception 'PRUEBA X27c · 5: la vuelta atrás no quita lo nuevo.';
  end if;
  raise notice 'PRUEBA X27c · 5: la vuelta atrás quita el disparador, las funciones y la web del cliente.';
end $$;

rollback;
