-- supabase/staging/sql/20261027_l00_ancestros_por_cuenta_prueba.sql
--
-- SOLO STAGING. Prueba de la 1647 (L00 · Respuesta 6: un trabajador que recibe
-- un albarán recalcula el coste de los platos), con \i dentro de la transacción
-- y ROLLBACK: staging no cambia.
--
-- Por el camino de verdad (regla 10): lo que hace Recepciones del portal tras
-- recibir, la cascada de coste del front (cascadeFromItem): kitchen_ancestors_of
-- del ingrediente y kitchen_recompute_item de cada ancestro, en ese orden.
-- Con un ingrediente, una elaboración que lo usa y un plato que usa la
-- elaboración (inventados, en la cuenta A), y un ingrediente de la cuenta B.
--
--   0 · lo de antes: kitchen_ancestors_of con el md5 de producción, y el
--       trabajador recibe «sin acceso» (lo que pasaba en producción).
--   1 · aplicada: el trabajador de la cuenta A hace la cascada entera (los dos
--       ancestros, el plato primero, y los recalcula).
--   2 · el encargado de la cuenta A, igual que antes.
--   3 · lo que no cambia: el trabajador de A no ve los ancestros de un artículo
--       de la cuenta B, y una sesión sin cuenta tampoco.
--   4 · una sola firma.
--   5 · la vuelta atrás: el md5 de producción y el trabajador otra vez sin acceso.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA L00 ANCESTROS: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

create temp table _s (clave text primary key, v text) on commit drop;
grant select on _s to authenticated;
insert into _s values
  ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('cuenta_b', 'c01b0000-0000-4000-8000-00000000000b'),
  ('encargado', 'c01a0000-0000-4000-8000-0000000000a6'), ('trabajador', 'c01a0000-0000-4000-8000-0000000000a7'),
  ('sin_cuenta', 'c01a0000-0000-4000-8000-0000000000ff'), ('md5_antes', 'eef6dc15fb26b156aac096a251b7b31c');

-- Los usuarios de prueba existen, con su papel.
do $$
declare v_falta text;
begin
  select string_agg(x.c || ' (' || x.rol || ')', ', ') into v_falta
    from (values ('encargado', 'manager'), ('trabajador', 'worker')) x(c, rol)
   where not exists (select 1 from public.user_profiles up where up.user_id = (select v::uuid from _s where clave = x.c)
                      and up.account_id = (select v::uuid from _s where clave = 'cuenta') and up.role = x.rol and up.active);
  if v_falta is not null then raise exception 'PRUEBA L00 ANCESTROS · faltan los usuarios de prueba de la cuenta A: %.', v_falta; end if;
  if exists (select 1 from public.user_profiles where user_id = (select v::uuid from _s where clave = 'sin_cuenta')) then
    raise exception 'PRUEBA L00 ANCESTROS · el usuario «sin cuenta» tiene perfil: elige otro id.';
  end if;
end $$;

-- Los artículos, inventados: ingrediente → elaboración → plato en A; un ingrediente en B.
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); b uuid := (select v::uuid from _s where clave = 'cuenta_b');
        ua uuid; ub uuid; ing uuid; ela uuid; pla uuid; ing_b uuid;
begin
  select id into ua from public.kitchen_unit where (account_id is null or account_id = a) and is_active order by is_base desc, id limit 1;
  if ua is null then raise exception 'PRUEBA L00 ANCESTROS · no hay unidad de cocina en la cuenta A.'; end if;
  -- La cuenta B de staging no tiene unidades de cocina (27/10): se copia la de A,
  -- dentro de la transacción.
  insert into public.kitchen_unit (account_id, name, abbreviation, dimension, factor_to_base, is_base, is_active)
  select b, k.name, k.abbreviation, k.dimension, k.factor_to_base, k.is_base, true from public.kitchen_unit k where k.id = ua
  returning id into ub;
  insert into public.recipe_item (account_id, type, name, base_unit_id) values (a, 'raw', 'Ingrediente de la prueba L00', ua) returning id into ing;
  insert into public.recipe_item (account_id, type, name, base_unit_id) values (a, 'recipe', 'Elaboración de la prueba L00', ua) returning id into ela;
  insert into public.recipe_item (account_id, type, name, base_unit_id) values (a, 'dish', 'Plato de la prueba L00', ua) returning id into pla;
  insert into public.recipe_item (account_id, type, name, base_unit_id) values (b, 'raw', 'Ingrediente de la cuenta B, prueba L00', ub) returning id into ing_b;
  insert into public.recipe_line (account_id, parent_item_id, child_item_id, quantity_net, unit_id) values (a, ela, ing, 1, ua), (a, pla, ela, 1, ua);
  insert into _s values ('ing', ing), ('ela', ela), ('pla', pla), ('ing_b', ing_b);
end $$;

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
do $$ begin
  if (select md5(prosrc) from pg_proc where oid = 'public.kitchen_ancestors_of(uuid)'::regprocedure) is distinct from (select v from _s where clave = 'md5_antes') then
    raise exception 'PRUEBA L00 ANCESTROS · 0: kitchen_ancestors_of no es la de producción.';
  end if;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'trabajador'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.kitchen_ancestors_of((select v::uuid from _s where clave = 'ing'));
    raise exception 'PRUEBA L00 ANCESTROS · 0: el trabajador ya veía los ancestros antes de la 1647.';
  exception when others then
    if sqlerrm not like 'kitchen_ancestors_of: sin acceso%' then raise; end if;
  end;
  raise notice '0 · lo de antes: el md5 de producción, y el trabajador recibe «sin acceso» (lo de producción)';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

\i supabase/migrations/20261027T1647_l00_ancestros_por_cuenta.sql

-- ── 1 · El trabajador de la cuenta A: la cascada entera ─────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'trabajador'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_ids uuid[]; r record;
begin
  select array_agg(x.ancestor_id order by x.depth desc) into v_ids from public.kitchen_ancestors_of((select v::uuid from _s where clave = 'ing')) x;
  if v_ids is distinct from array[(select v::uuid from _s where clave = 'pla'), (select v::uuid from _s where clave = 'ela')] then
    raise exception 'PRUEBA L00 ANCESTROS · 1: el trabajador no recibe el plato y la elaboración, en ese orden (recibe %).', v_ids;
  end if;
  -- El paso siguiente de la cascada, como lo hace el front: de lo más profundo a la hoja.
  for r in select x.ancestor_id from public.kitchen_ancestors_of((select v::uuid from _s where clave = 'ing')) x order by x.depth desc loop
    perform public.kitchen_recompute_item(r.ancestor_id);
  end loop;
  raise notice '1 · trabajador de A: recibe el plato y la elaboración (el plato primero) y los recalcula';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 2 · El encargado de la cuenta A, como antes ─────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'encargado'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.kitchen_ancestors_of((select v::uuid from _s where clave = 'ing'))) <> 2 then
    raise exception 'PRUEBA L00 ANCESTROS · 2: el encargado no recibe los dos ancestros.';
  end if;
  raise notice '2 · encargado de A: igual que antes';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 3 · Lo que no cambia: otra cuenta y una sesión sin cuenta ───────────────
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'trabajador'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.kitchen_ancestors_of((select v::uuid from _s where clave = 'ing_b'));
    raise exception 'PRUEBA L00 ANCESTROS · 3: el trabajador de A ve los ancestros de un artículo de la cuenta B.';
  exception when others then
    if sqlerrm not like 'kitchen_ancestors_of: sin acceso%' then raise; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'sin_cuenta'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.kitchen_ancestors_of((select v::uuid from _s where clave = 'ing'));
    raise exception 'PRUEBA L00 ANCESTROS · 3: una sesión sin cuenta ve los ancestros.';
  exception when others then
    if sqlerrm not like 'kitchen_ancestors_of: sin acceso%' then raise; end if;
  end;
  raise notice '3 · lo que no cambia: la cuenta B y una sesión sin cuenta, sin acceso';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 4 · Una sola firma ──────────────────────────────────────────────────────
do $$ begin
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'kitchen_ancestors_of') <> 1 then
    raise exception 'PRUEBA L00 ANCESTROS · 4: kitchen_ancestors_of tiene más de una firma.';
  end if;
  raise notice '4 · una sola firma';
end $$;

-- ── 5 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261027T1647_l00_ancestros_por_cuenta.down.sql
do $$ begin
  if (select md5(prosrc) from pg_proc where oid = 'public.kitchen_ancestors_of(uuid)'::regprocedure) is distinct from (select v from _s where clave = 'md5_antes') then
    raise exception 'PRUEBA L00 ANCESTROS · 5: la vuelta atrás no deja kitchen_ancestors_of como estaba.';
  end if;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'trabajador'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.kitchen_ancestors_of((select v::uuid from _s where clave = 'ing'));
    raise exception 'PRUEBA L00 ANCESTROS · 5: tras la vuelta atrás, el trabajador sigue viendo los ancestros.';
  exception when others then
    if sqlerrm not like 'kitchen_ancestors_of: sin acceso%' then raise; end if;
  end;
  raise notice '5 · la vuelta atrás: el md5 de producción y el trabajador otra vez sin acceso';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

rollback;
