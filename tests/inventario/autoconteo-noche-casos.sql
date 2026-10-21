-- tests/inventario/autoconteo-noche-casos.sql · Después de la 0400: los conteos de la noche y la tablet.
-- Una persona de Foodint, con sesión, para la tablet.
insert into public.user_profiles (user_id, display_name, account_id, role) values ('bbbb0000-0000-4000-8000-000000000001', 'Natacha', '51ad1792-6629-4ef7-833a-b57b09a86710', 'staff');
insert into public.recipe_item_location_stock select '51ad1792-6629-4ef7-833a-b57b09a86710', 'aaaa0000-0000-4000-8000-0000000000f1', id, 0, 2.0 from public.recipe_item;
-- 10 de partida para los artículos 31 a 36.
insert into public.stock_movement (account_id, location_id, recipe_item_id, movement_type, qty_base, occurred_at)
select '51ad1792-6629-4ef7-833a-b57b09a86710', 'aaaa0000-0000-4000-8000-0000000000f1', ('aaaa0000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'ajuste', 10, now() - interval '5 days'
  from generate_series(31, 36) g;
select public.recompute_location_stock(id, 'aaaa0000-0000-4000-8000-0000000000f1') from public.recipe_item;

create function pg_temp.c(p_code text, p_kind text, p_hace interval) returns uuid language sql as $$
  insert into public.inventory_count (account_id, location_id, code, kind, status, created_at, started_at)
  values ('51ad1792-6629-4ef7-833a-b57b09a86710', 'aaaa0000-0000-4000-8000-0000000000f1', p_code, p_kind, 'contando', now() - p_hace, now() - p_hace) returning id $$;
create function pg_temp.l(p_code text, p_item int, p_qty numeric, p_revisar boolean default false, p_apartada boolean default false) returns void language sql as $$
  insert into public.inventory_count_line (account_id, inventory_count_id, recipe_item_id, system_qty, counted_qty, counted_at, needs_review, excluded_at)
  select '51ad1792-6629-4ef7-833a-b57b09a86710', ic.id, ('aaaa0000-0000-4000-8000-' || lpad(p_item::text, 12, '0'))::uuid, 10, p_qty, now() - interval '1 minute', p_revisar,
         case when p_apartada then now() end
    from public.inventory_count ic where ic.code = p_code $$;

select pg_temp.c('J-HOY', 'cycle', interval '1 hour');
select pg_temp.l('J-HOY', 31, 2);              -- de 10 a 2
select pg_temp.l('J-HOY', 32, 30, true);       -- «revisar»
select pg_temp.l('J-HOY', 33, 1, false, true); -- apartada
select pg_temp.c('J-AYER', 'cycle', interval '30 hours');  select pg_temp.l('J-AYER', 34, 4);
select pg_temp.c('J-VACIO', 'cycle', interval '30 hours'); insert into public.inventory_count_line (account_id, inventory_count_id, recipe_item_id) select account_id, id, 'aaaa0000-0000-4000-8000-000000000037' from public.inventory_count where code = 'J-VACIO';
select pg_temp.c('J-ROTO', 'cycle', interval '30 hours');  select pg_temp.l('J-ROTO', 35, 3);
select pg_temp.c('J-AUDIT', 'audit', interval '30 hours'); select pg_temp.l('J-AUDIT', 36, 40);

-- La tablet: Natacha cuenta la última pieza de J-HOY.
select set_config('request.jwt.claims', '{"sub":"bbbb0000-0000-4000-8000-000000000001","role":"authenticated"}', false);
do $$
declare v record; ic record; lib numeric;
begin
  select * into v from public.autoclose_daily_count((select id from public.inventory_count where code = 'J-HOY'));
  select * into ic from public.inventory_count where code = 'J-HOY';
  if ic.status <> 'aprobado' or ic.auto_applied_via <> 'al_terminar' or ic.approved_by_name <> 'Natacha' or v.pending_anomalies <> 0 then
    raise exception 'JUGUETE tablet: % % % %', ic.status, ic.auto_applied_via, ic.approved_by_name, v.pending_anomalies;
  end if;
  select sum(qty_base) into lib from public.stock_movement where recipe_item_id = 'aaaa0000-0000-4000-8000-000000000031';
  if lib <> 2 then raise exception 'JUGUETE tablet: el desviado está en %', lib; end if;
  select sum(qty_base) into lib from public.stock_movement where recipe_item_id = 'aaaa0000-0000-4000-8000-000000000032';
  if lib <> 30 then raise exception 'JUGUETE tablet: el «revisar» está en %', lib; end if;
  select sum(qty_base) into lib from public.stock_movement where recipe_item_id = 'aaaa0000-0000-4000-8000-000000000033';
  if lib <> 10 then raise exception 'JUGUETE tablet: la apartada se ha aplicado (%)', lib; end if;
  raise notice 'JUGUETE tablet: aplicado al terminar por Natacha, % ajustes, la apartada fuera', v.applied;
end $$;
-- Y el de seguridad sigue pidiendo motivo (aunque sea gestor).
update public.user_profiles set role = 'manager' where user_id = 'bbbb0000-0000-4000-8000-000000000001';
do $$
declare v_err text;
begin
  perform public.close_inventory_count((select id from public.inventory_count where code = 'J-AUDIT'));
  begin
    perform public.apply_inventory_count((select id from public.inventory_count where code = 'J-AUDIT'), null, 'x', false);
  exception when others then v_err := sqlerrm;
  end;
  if v_err is null or v_err not like 'Faltan motivos%' then raise exception 'JUGUETE: el de seguridad se aprueba sin motivo (%)', v_err; end if;
  raise notice 'JUGUETE seguridad: %', v_err;
end $$;
select set_config('request.jwt.claims', '', false);

-- El roto, a propósito.
alter function public.rebase_count_system_qty(uuid) rename to _rebase_juguete;
create function public.rebase_count_system_qty(p uuid) returns void language plpgsql as $$
begin
  if p = (select id from public.inventory_count where code = 'J-ROTO') then raise exception 'roto a propósito'; end if;
  perform public._rebase_juguete(p);
end $$;
