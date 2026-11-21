-- supabase/staging/sql/20261113_s01p_uber_sin_tienda_prueba.sql
--
-- SOLO STAGING. Prueba de la 1136 (S01p·18 · 6: las liquidaciones de Uber a las que les
-- falta la tienda), con \i dentro de la transacción y ROLLBACK: staging no cambia. En la cuenta A.
--
--   1. Una liquidación de Uber con su tienda pero sin local ni marca (como las 8 de Foodint):
--      sale en conta_liquidaciones_sin_tienda con lo que le da su tienda; una de otro mes, no;
--      una que ya los tiene, no.
--   2. Asignarla: toma el local y la marca de su tienda en su fecha, lo dice, y deja de salir.
--      Otra vez: «ya tenía».
--   3. Una tienda sin local en esas fechas: sale con su porqué y no se asigna.
--   4. Quien no es de la cuenta, no.
--   5. La vuelta atrás: ni una función ni la otra.
--
-- Nombra lo que toca, para el analizador: conta_liquidaciones_sin_tienda,
-- conta_liquidacion_asignar_tienda, channel_settlement, platform_store, conta_tienda_en.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p·18 · 6: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';
set local lock_timeout = '30s';

select to_regprocedure('public.conta_liquidacion_asignar_tienda(uuid,text)') is not null as ya_esta \gset
\if :ya_esta
\else
\i supabase/migrations/20261113T1136_s01p_uber_sin_tienda.sql
\endif

create temp table _p (clave text primary key, v text) on commit drop;
grant select on _p to authenticated, anon, service_role;
insert into _p values ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('admin', 'c01a0000-0000-4000-8000-0000000000a1'),
  ('tienda', 'c18a0000-0000-4000-8000-000000001861'), ('tienda2', 'c18a0000-0000-4000-8000-000000001862'),
  ('sin', 'c18a0000-0000-4000-8000-000000001871'), ('otro_mes', 'c18a0000-0000-4000-8000-000000001872'),
  ('con', 'c18a0000-0000-4000-8000-000000001873'), ('sin2', 'c18a0000-0000-4000-8000-000000001874');
insert into _p select 'empresa', (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1)::text;
insert into _p select 'marca', (select id from public.brand where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by name, id limit 1)::text;
insert into _p select 'local', (select id from public.locations where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by name, id limit 1)::text;
insert into _p select 'canal', (select id from public.sales_channel where name ilike 'uber%' order by id limit 1)::text;

-- La siembra: una tienda de Uber con su local y su marca, y otra sin local; cuatro liquidaciones.
do $$
declare a uuid := 'c01a0000-0000-4000-8000-00000000000a'; e uuid := (select v::uuid from _p where clave = 'empresa');
  m uuid := (select v::uuid from _p where clave = 'marca'); l uuid := (select v::uuid from _p where clave = 'local'); c uuid := (select v::uuid from _p where clave = 'canal');
begin
  if e is null or m is null or l is null then raise exception 'PRUEBA S01p·18 · 6 · siembra: la cuenta A no tiene empresa, marca o local.'; end if;
  insert into public.platform_store (id, account_id, company_id, provider, external_text, channel_id, brand_id, location_id)
  values ((select v::uuid from _p where clave = 'tienda'), a, e, 'uber', 'Tienda Prueba S01p18 (Calle Inventada 1)', c, m, l),
         ((select v::uuid from _p where clave = 'tienda2'), a, e, 'uber', 'Tienda Prueba S01p18 sin local', c, m, null);
  insert into public.channel_settlement (id, account_id, channel_id, store_id, brand_id, location_id, period_from, period_to, net_payout, import_key, source)
  values ((select v::uuid from _p where clave = 'sin'), a, c, (select v::uuid from _p where clave = 'tienda'), null, null, '2026-10-12', '2026-10-18', 782.16, 'prueba-s01p18-6-a', 'prueba'),
         ((select v::uuid from _p where clave = 'otro_mes'), a, c, (select v::uuid from _p where clave = 'tienda'), null, null, '2026-08-03', '2026-08-09', 10, 'prueba-s01p18-6-b', 'prueba'),
         ((select v::uuid from _p where clave = 'con'), a, c, (select v::uuid from _p where clave = 'tienda'), m, l, '2026-10-19', '2026-10-25', 20, 'prueba-s01p18-6-c', 'prueba'),
         ((select v::uuid from _p where clave = 'sin2'), a, c, (select v::uuid from _p where clave = 'tienda2'), null, null, '2026-10-12', '2026-10-18', 30, 'prueba-s01p18-6-d', 'prueba');
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from _p where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); r jsonb; x jsonb; v_ids text[];
begin
  -- 1. Las de octubre sin local o marca: «sin» y «sin2»; ni la de agosto ni la que ya los tiene.
  r := public.conta_liquidaciones_sin_tienda(e, '2026-10-01', '2026-10-31');
  select array_agg(z->>'id') into v_ids from jsonb_array_elements(r) z where z->>'tienda' like 'Tienda Prueba S01p18%';
  if v_ids is null or array_length(v_ids, 1) <> 2 or not ((select v from _p where clave = 'sin') = any(v_ids)) or not ((select v from _p where clave = 'sin2') = any(v_ids)) then
    raise exception 'PRUEBA S01p·18 · 6 · 1: salen %.', r;
  end if;
  select z into x from jsonb_array_elements(r) z where z->>'id' = (select v from _p where clave = 'sin');
  if x->>'local_id' <> (select v from _p where clave = 'local') or x->>'marca_id' <> (select v from _p where clave = 'marca') or x->>'porque' is not null then
    raise exception 'PRUEBA S01p·18 · 6 · 1: lo que le da su tienda es %.', x;
  end if;
  raise notice '1 · sin tienda en octubre: 2 (la de agosto y la que ya la tiene, no); la primera, de % · %', x->>'marca', x->>'local';
  -- 2. Asignarla, y otra vez.
  r := public.conta_liquidacion_asignar_tienda((select v::uuid from _p where clave = 'sin'), null);
  if coalesce(r->>'texto', '') !~ '^Asignada: la liquidación de .* del 12/10 al 18/10 \(782,16 €\) es de .* · .*, como su tienda en esas fechas\.$' then
    raise exception 'PRUEBA S01p·18 · 6 · 2: dice %.', r;
  end if;
  raise notice '2 · %', r->>'texto';
  r := public.conta_liquidacion_asignar_tienda((select v::uuid from _p where clave = 'sin'), null);
  if (r->>'ya_estaba')::boolean is not true then raise exception 'PRUEBA S01p·18 · 6 · 2: la segunda vez dice %.', r; end if;
  r := public.conta_liquidaciones_sin_tienda(e, '2026-10-01', '2026-10-31');
  if exists (select 1 from jsonb_array_elements(r) z where z->>'id' = (select v from _p where clave = 'sin')) then raise exception 'PRUEBA S01p·18 · 6 · 2: sigue saliendo.'; end if;
  -- 3. La tienda sin local: sale con su porqué y no se asigna.
  select z into x from jsonb_array_elements(r) z where z->>'id' = (select v from _p where clave = 'sin2');
  if coalesce(x->>'porque', '') !~ 'Sus tiendas' then raise exception 'PRUEBA S01p·18 · 6 · 3: sale %.', x; end if;
  begin perform public.conta_liquidacion_asignar_tienda((select v::uuid from _p where clave = 'sin2'), null); raise exception 'PRUEBA S01p·18 · 6 · 3: la asigna sin local.';
  exception when sqlstate '22023' then raise notice '3 · %', sqlerrm; end;
end $$;
reset role;
do $$
declare v_l uuid; v_m uuid;
begin
  select location_id, brand_id into v_l, v_m from public.channel_settlement where id = (select v::uuid from _p where clave = 'sin');
  if v_l::text <> (select v from _p where clave = 'local') or v_m::text <> (select v from _p where clave = 'marca') then raise exception 'PRUEBA S01p·18 · 6 · 2: quedó con % · %.', v_m, v_l; end if;
  raise notice '2 · en la base: con su local y su marca';
end $$;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
do $$
declare v_err text;
begin
  begin perform public.conta_liquidacion_asignar_tienda((select v::uuid from _p where clave = 'sin2'), null); exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'PRUEBA S01p·18 · 6 · 4: alguien sin cuenta asigna.'; end if;
  raise notice '4 · sin cuenta, no («%»)', v_err;
end $$;
reset role;

-- 5. La vuelta atrás.
\i supabase/vuelta-atras/20261113T1136_s01p_uber_sin_tienda.down.sql
do $$ begin
  if to_regprocedure('public.conta_liquidacion_asignar_tienda(uuid,text)') is not null or to_regprocedure('public.conta_liquidaciones_sin_tienda(uuid,date,date)') is not null then
    raise exception 'PRUEBA S01p·18 · 6 · 5: la vuelta atrás deja sus funciones.';
  end if;
  raise notice '5 · la vuelta atrás: fuera las dos';
end $$;
\i supabase/migrations/20261113T1136_s01p_uber_sin_tienda.sql

rollback;
