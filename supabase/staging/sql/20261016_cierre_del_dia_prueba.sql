-- supabase/staging/sql/20261016_cierre_del_dia_prueba.sql
--
-- SOLO STAGING. Prueba de «El día se cierra a las 6:00» (migraciones
-- 20261016T0100 a 0140): conta_cerrar_dias, conta_por_cerrar,
-- conta_ultimo_dia_cerrado, conta_cerrado_hasta, conta_no_confirmados,
-- tg_sale_consumption_on_complete, generate_sale_consumption,
-- conta_dias_por_asentar y conta_pedidos_del_dia.
-- Todo en una transacción con ROLLBACK: no cambia staging.
--
--   1. Siembra en la empresa A, local «Norte Centro», la MISMA forma que los
--      20 pedidos abiertos de producción (T1, medidos el 09/10): los mismos
--      días de agosto, septiembre y octubre, el mismo estado de la plataforma,
--      el mismo importe y el mismo número de líneas; los 12 que en producción
--      tienen consumo, aquí también lo tienen. Más 3 ventas cerradas por día
--      del 1 al 9 de octubre, uno abierto de HOY (no se cierra), uno abierto
--      de una marca cedida (no es nuestro) y uno abierto de AYER a las 23:00.
--   2. Antes del cierre: lo que cerraría (conta_por_cerrar), los días por
--      asentar como usuario de A, y lo que ha escrito la transacción en cada
--      tabla (pg_stat_xact_user_tables).
--   3. El cierre. Después:
--      · solo ha escrito en sale y en sales_day_close_log: ni print_job, ni
--        avisos, ni cola de llamadas (net), ni stock_movement, ni nada más;
--      · ha cerrado EXACTAMENTE lo que decía conta_por_cerrar; HOY y la
--        cedida siguen abiertos;
--      · el stock de los pedidos cerrados no se ha movido (huella de sus
--        movimientos y de recipe_item_location_stock);
--      · otra pasada, y la de la segunda empresa de la cuenta, cierran 0;
--      · los días por asentar son los mismos antes y después, y ninguno es
--        de un día sin cerrar.
--   4. La frontera de las 6:00: el pedido de ayer a las 23:00 está «por
--      cerrar» a las 6:00 de hoy y no a las 5:59.
--   5. Lo que ve cada uno: A ve sus no confirmados en conta_no_confirmados y
--      «unconfirmed» en conta_pedidos_del_dia; B no ve ninguno.
--   6. Regenerar el consumo de un no confirmado no lo borra.
--   7. Regla 10, después del cierre y como usuario de A: cerrar una venta,
--      recibir un albarán, apuntar una merma y aprobar un recuento. Los
--      cuatro escriben su movimiento, y el stock de los no confirmados sigue
--      igual.
--   8. ROMPERLA A PROPÓSITO: con el disparador y el motor de ANTES (los de la
--      copia de la 0110), cerrar un pedido cocinado le borra el consumo. La
--      prueba EXIGE que eso pase: si con los viejos tampoco se moviera, la
--      prueba no distinguiría nada.
--   9. El cambio de hora de octubre y de marzo, con las mismas horas que
--      tests/unit/modules/conta/cierreDelDia.test.ts.
--  10. El libro diario de un mes: conta_dias_por_asentar < 1 s.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA cierre del día: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- Las dos empresas de la cuenta A: la prueba cierra con la primera.
select set_config('prueba.empresa',  (select id::text from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at limit 1), true);
select set_config('prueba.empresa2', (select id::text from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at desc limit 1), true);

-- ── 1 · La siembra ──────────────────────────────────────────────────────────
create temp table _forma (n int, sold_at timestamptz, origen text, estado text, entrega text, total numeric, lineas int, cocinado boolean) on commit drop;
-- Los 20 de producción (T1): sold_at, origen, order_status, delivery_state, importe, líneas, ¿tiene consumo?
insert into _forma values
  ( 1, '2026-08-23 20:45:38+00', 'hubrise', 'rejected',            null,        16.30, 2, false),
  ( 2, '2026-08-25 11:28:49+00', 'lastapp', 'cancelled',           'failed',    66.70, 6, false),
  ( 3, '2026-08-25 11:35:32+00', 'lastapp', 'cancelled',           'delivered', 17.03, 1, false),
  ( 4, '2026-08-25 20:42:01+00', 'lastapp', 'cancelled',           null,        15.90, 1, false),
  ( 5, '2026-08-27 16:21:53+00', 'hubrise', 'delivery_failed',     'failed',    28.93, 4, true),
  ( 6, '2026-09-01 18:30:09+00', 'hubrise', 'cancelled',           'delivered', 20.30, 1, false),
  ( 7, '2026-09-10 11:30:46+00', 'hubrise', 'cancelled',           null,        24.30, 2, false),
  ( 8, '2026-09-10 18:32:45+00', 'hubrise', 'delivery_failed',     'failed',    25.80, 4, true),
  ( 9, '2026-09-13 13:08:31+00', 'hubrise', 'delivery_failed',     'failed',    21.40, 2, true),
  (10, '2026-09-14 12:34:07+00', 'hubrise', 'cancelled',           null,        20.70, 3, false),
  (11, '2026-09-14 20:11:13+00', 'hubrise', 'delivery_failed',     'failed',    54.60, 6, true),
  (12, '2026-10-02 16:50:17+00', 'hubrise', 'delivery_failed',     'failed',    21.90, 2, true),
  (13, '2026-10-02 19:08:01+00', 'hubrise', 'delivery_failed',     'failed',    22.40, 2, true),
  (14, '2026-10-02 21:07:13+00', 'hubrise', 'delivery_failed',     'failed',    27.40, 4, true),
  (15, '2026-10-06 20:33:57+00', 'hubrise', 'awaiting_collection', null,        20.40, 1, true),
  (16, '2026-10-07 12:33:25+00', 'hubrise', 'cancelled',           'canceled',  16.33, 2, false),
  (17, '2026-10-07 18:29:11+00', 'hubrise', 'awaiting_collection', null,        24.30, 2, true),
  (18, '2026-10-07 19:15:55+00', 'hubrise', 'awaiting_collection', null,        20.40, 1, true),
  (19, '2026-10-08 20:00:22+00', 'hubrise', 'awaiting_collection', null,        11.90, 2, true),
  (20, '2026-10-08 20:05:00+00', 'hubrise', 'awaiting_collection', null,        23.80, 3, true);

do $$
declare
  f record; v_id uuid; i int; d date;
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_marca constant uuid := '7e000000-0000-4000-8000-000000000b01';    -- Casa Lola, propia, con carta
  v_cedida constant uuid := 'e0200000-0000-4000-8000-00000000a0b5';   -- Brasa Prestada, cedida
  v_canal constant uuid := 'e0200000-0000-4000-8000-00000000a0c1';
  v_platos constant uuid[] := array['7e000000-0000-4000-8000-000000000e01', '7e000000-0000-4000-8000-000000000e02', '7e000000-0000-4000-8000-000000000e03']::uuid[];
  v_hoy date := (now() at time zone 'Europe/Madrid')::date;
begin
  for f in select * from _forma order by n loop
    v_id := ('cd000000-0000-4000-8000-0000000000' || lpad(f.n::text, 2, '0'))::uuid;
    -- Entra «new» (como de la plataforma), sin líneas aún.
    insert into public.sale (id, account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, source, platform_order_code, is_active)
    values (v_id, v_acc, v_loc, v_marca, v_canal, f.sold_at, 'open', case when f.cocinado then 'new' else f.estado end, f.total, f.origen, 'P' || (900 + f.n), true);
    for i in 1 .. f.lineas loop
      insert into public.sale_line (account_id, sale_id, raw_text, product_name, menu_item_id, quantity, line_type)
      values (v_acc, v_id, 'prueba', 'prueba', v_platos[1 + (i % 3)], 1, 'product');
    end loop;
    if f.cocinado then
      -- Aceptado: el disparador descuenta. Y luego, como en producción, se queda en reparto fallido o esperando recogida.
      update public.sale set order_status = 'accepted' where id = v_id;
      update public.sale set order_status = f.estado, delivery_state = f.entrega where id = v_id;
    else
      update public.sale set delivery_state = f.entrega where id = v_id;
    end if;
  end loop;

  -- 3 ventas cerradas por día, del 1 al 9 de octubre.
  for d in select generate_series(date '2026-10-01', date '2026-10-09', interval '1 day')::date loop
    for i in 1 .. 3 loop
      insert into public.sale (account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, source, is_active)
      values (v_acc, v_loc, v_marca, v_canal, (d::timestamp + make_interval(hours => 12 + 3 * i)) at time zone 'Europe/Madrid', 'closed', 'completed', 20 + i, 'hubrise', true);
    end loop;
  end loop;

  -- Abierto de HOY (el día en curso): no se cierra.
  insert into public.sale (id, account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, source, platform_order_code, is_active)
  values ('cd000000-0000-4000-8000-000000000101', v_acc, v_loc, v_marca, v_canal, (v_hoy::timestamp + time '00:30') at time zone 'Europe/Madrid', 'open', 'new', 12.5, 'hubrise', 'P1101', true);
  -- Abierto de una marca CEDIDA, de agosto: no es nuestro, no se cierra.
  insert into public.sale (id, account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, source, platform_order_code, is_active)
  values ('cd000000-0000-4000-8000-000000000102', v_acc, v_loc, v_cedida, v_canal, '2026-08-24 20:00:00+00', 'open', 'awaiting_collection', 18, 'hubrise', 'P1102', true);
  -- Abierto de AYER a las 23:00 de Madrid: la frontera de las 6:00.
  insert into public.sale (id, account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, source, platform_order_code, is_active)
  values ('cd000000-0000-4000-8000-000000000103', v_acc, v_loc, v_marca, v_canal, ((v_hoy - 1)::timestamp + time '23:00') at time zone 'Europe/Madrid', 'open', 'awaiting_collection', 9.9, 'hubrise', 'P1103', true);
end $$;

-- Los 12 cocinados tienen que tener consumo, o la prueba no mide nada.
do $$
declare v_n int; v_m int;
begin
  select count(distinct m.source_id), count(*) into v_n, v_m from public.stock_movement m
   where m.source_type = 'sale' and m.movement_type = 'consumo'
     and m.source_id in (select ('cd000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid from _forma where cocinado);
  if v_n <> 12 then
    raise exception 'PRUEBA cierre · 1: la siembra no tiene consumo en los 12 cocinados (tiene %).', v_n;
  end if;
  raise notice 'PRUEBA cierre · 1: sembrados los 20 de producción (12 con consumo: % movimientos), 27 cerradas de octubre, hoy, cedida y ayer 23:00.', v_m;
end $$;

-- ── 2 · Antes ──────────────────────────────────────────────────────────────
create temp table _por_cerrar on commit drop as
  select * from public.conta_por_cerrar(current_setting('prueba.empresa')::uuid, now());

create temp table _huella (que text, antes text, despues text) on commit drop;
insert into _huella (que, antes) values
  ('movimientos de los cerrados',
   (select md5(coalesce(string_agg(m.id::text || ':' || m.qty_base || ':' || coalesce(m.unit_cost::text, '-'), ',' order by m.id), ''))
      from public.stock_movement m where m.source_type = 'sale' and m.source_id in (select sale_id from _por_cerrar))),
  ('stock por artículo y local de A',
   (select md5(coalesce(string_agg(to_jsonb(r)::text, ',' order by r.recipe_item_id, r.location_id), ''))
      from public.recipe_item_location_stock r where r.account_id = 'c01a0000-0000-4000-8000-00000000000a')),
  ('notas de consumo de A',
   (select count(*)::text from public.sale_consumption_skip where account_id = 'c01a0000-0000-4000-8000-00000000000a'));

-- Días por asentar, como usuario de A (agosto → hoy).
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table _dias_antes on commit drop as
  select * from public.conta_dias_por_asentar(current_setting('prueba.empresa')::uuid, date '2026-08-01', (now() at time zone 'Europe/Madrid')::date);
reset role;

create temp table _escrito_antes on commit drop as
  select schemaname || '.' || relname t, n_tup_ins i, n_tup_upd u, n_tup_del d from pg_stat_xact_user_tables;

-- ── 3 · El cierre ─────────────────────────────────────────────────────────
select set_config('prueba.cierre', public.conta_cerrar_dias(current_setting('prueba.empresa')::uuid, now())::text, true);

create temp table _escrito_despues on commit drop as
  select schemaname || '.' || relname t, n_tup_ins i, n_tup_upd u, n_tup_del d from pg_stat_xact_user_tables;

do $$
declare
  v_res jsonb := current_setting('prueba.cierre')::jsonb;
  v_tocadas text;
  v_n int; v_mal int;
begin
  -- Solo sale y sales_day_close_log.
  select string_agg(d.t || ' (+' || (d.i - coalesce(a.i, 0)) || ' ~' || (d.u - coalesce(a.u, 0)) || ' -' || (d.d - coalesce(a.d, 0)) || ')', ', ' order by d.t)
    into v_tocadas
    from _escrito_despues d left join _escrito_antes a on a.t = d.t
   where (d.i, d.u, d.d) is distinct from (coalesce(a.i, 0), coalesce(a.u, 0), coalesce(a.d, 0))
     and d.t not like 'pg_temp%';
  if v_tocadas is distinct from (select string_agg(x, ', ' order by x) from unnest(array[
        'public.sale (+0 ~' || (v_res->>'cerrados') || ' -0)',
        'public.sales_day_close_log (+' || (v_res->>'cerrados') || ' ~0 -0)']) x) then
    raise exception 'PRUEBA cierre · 3: el cierre ha escrito fuera de sale y su rastro: %', v_tocadas;
  end if;

  -- Exactamente lo que decía conta_por_cerrar.
  select count(*) into v_n from _por_cerrar;
  if (v_res->>'cerrados')::int <> v_n then
    raise exception 'PRUEBA cierre · 3: conta_por_cerrar decía % y se han cerrado %.', v_n, v_res->>'cerrados';
  end if;
  select count(*) into v_mal from _por_cerrar p join public.sale s on s.id = p.sale_id
   where not (s.status = 'cancelled' and s.unconfirmed_at is not null and s.cancel_reason = 'No confirmado por la plataforma al cierre del día (6:00)');
  if v_mal > 0 then
    raise exception 'PRUEBA cierre · 3: % de los que había que cerrar no han quedado como no confirmados.', v_mal;
  end if;
  if (select count(*) from _por_cerrar where sale_id::text like 'cd000000-0000-4000-8000-0000000000__') <> 20 then
    raise exception 'PRUEBA cierre · 3: de los 20 sembrados no se han cerrado los 20.';
  end if;
  if exists (select 1 from public.sale where id in ('cd000000-0000-4000-8000-000000000101', 'cd000000-0000-4000-8000-000000000102') and status <> 'open') then
    raise exception 'PRUEBA cierre · 3: se ha cerrado el de hoy o el de la marca cedida.';
  end if;
  if (select count(*) from public.sales_day_close_log l join _por_cerrar p on p.sale_id = l.sale_id
       where l.close_time = time '06:00' and l.sales_day = p.sales_day and l.total is not distinct from p.total) <> v_n then
    raise exception 'PRUEBA cierre · 3: el rastro no tiene una fila por pedido con su día, su importe y la regla.';
  end if;
  raise notice 'PRUEBA cierre · 3: cerrados % (% €), los mismos que decía conta_por_cerrar; solo escribe en: %.', v_res->>'cerrados', v_res->>'importe', v_tocadas;
end $$;

update _huella set despues = case que
  when 'movimientos de los cerrados' then
   (select md5(coalesce(string_agg(m.id::text || ':' || m.qty_base || ':' || coalesce(m.unit_cost::text, '-'), ',' order by m.id), ''))
      from public.stock_movement m where m.source_type = 'sale' and m.source_id in (select sale_id from _por_cerrar))
  when 'stock por artículo y local de A' then
   (select md5(coalesce(string_agg(to_jsonb(r)::text, ',' order by r.recipe_item_id, r.location_id), ''))
      from public.recipe_item_location_stock r where r.account_id = 'c01a0000-0000-4000-8000-00000000000a')
  else (select count(*)::text from public.sale_consumption_skip where account_id = 'c01a0000-0000-4000-8000-00000000000a') end;

do $$
declare r record; v_otra jsonb; v_otra2 jsonb;
begin
  for r in select * from _huella loop
    if r.antes is distinct from r.despues then
      raise exception 'PRUEBA cierre · 3: se ha movido «%» (antes %, después %).', r.que, r.antes, r.despues;
    end if;
  end loop;
  -- Idempotente: otra pasada, y la segunda empresa de la misma cuenta, no cierran nada.
  v_otra  := public.conta_cerrar_dias(current_setting('prueba.empresa')::uuid, now());
  v_otra2 := public.conta_cerrar_dias(current_setting('prueba.empresa2')::uuid, now());
  if (v_otra->>'cerrados')::int <> 0 or (v_otra2->>'cerrados')::int <> 0 then
    raise exception 'PRUEBA cierre · 3: la segunda pasada ha cerrado % y la otra empresa %.', v_otra->>'cerrados', v_otra2->>'cerrados';
  end if;
  raise notice 'PRUEBA cierre · 3: el stock no se ha movido (huellas iguales: %); otra pasada 0, la otra empresa 0.',
    (select string_agg(que, ', ') from _huella);
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table _dias_despues on commit drop as
  select * from public.conta_dias_por_asentar(current_setting('prueba.empresa')::uuid, date '2026-08-01', (now() at time zone 'Europe/Madrid')::date);
reset role;

do $$
declare v_a text; v_d text; v_ultimo date := public.conta_ultimo_dia_cerrado(current_setting('prueba.empresa')::uuid);
begin
  select string_agg(location_id || ' ' || dia || ' ' || pedidos, ', ' order by dia, location_id) into v_a from _dias_antes;
  select string_agg(location_id || ' ' || dia || ' ' || pedidos, ', ' order by dia, location_id) into v_d from _dias_despues;
  if v_a is distinct from v_d then
    raise exception 'PRUEBA cierre · 3: los días por asentar cambian con el cierre: antes «%», después «%».', v_a, v_d;
  end if;
  if exists (select 1 from _dias_despues where dia > v_ultimo) then
    raise exception 'PRUEBA cierre · 3: conta_dias_por_asentar devuelve un día sin cerrar (último cerrado %).', v_ultimo;
  end if;
  if not exists (select 1 from _dias_despues where dia between date '2026-10-01' and least(v_ultimo, date '2026-10-09')) then
    raise exception 'PRUEBA cierre · 3: los días cerrados de octubre no salen por asentar.';
  end if;
  raise notice 'PRUEBA cierre · 3: días por asentar iguales antes y después (% días), el último %, último cerrado %.',
    (select count(*) from _dias_despues), (select max(dia) from _dias_despues), v_ultimo;
end $$;

-- ── 4 · La frontera de las 6:00 ────────────────────────────────────────────
do $$
declare
  v_hoy date := (now() at time zone 'Europe/Madrid')::date;
  v_empresa uuid := current_setting('prueba.empresa')::uuid;
  v_559 boolean; v_600 boolean;
begin
  v_559 := exists (select 1 from public.conta_por_cerrar(v_empresa, (v_hoy::timestamp + time '05:59') at time zone 'Europe/Madrid') where sale_id = 'cd000000-0000-4000-8000-000000000103');
  v_600 := exists (select 1 from public.conta_por_cerrar(v_empresa, (v_hoy::timestamp + time '06:00') at time zone 'Europe/Madrid') where sale_id = 'cd000000-0000-4000-8000-000000000103');
  -- Si la prueba corre antes de las 6:00, el de ayer no se ha cerrado y está «por cerrar» a las 6:00.
  -- Si corre después, ya se cerró en el paso 3 y no está en ninguna de las dos.
  if (now() at time zone 'Europe/Madrid')::time < time '06:00' then
    if v_559 or not v_600 then
      raise exception 'PRUEBA cierre · 4: el de ayer a las 23:00: a las 5:59 % y a las 6:00 % (tiene que ser no y sí).', v_559, v_600;
    end if;
  else
    if (select status from public.sale where id = 'cd000000-0000-4000-8000-000000000103') <> 'cancelled' then
      raise exception 'PRUEBA cierre · 4: pasadas las 6:00, el de ayer a las 23:00 tenía que estar cerrado.';
    end if;
    -- Y la frontera, con una hora de cierre que aún no ha llegado hoy: 23:59.
    update public.company_tax_profile set sales_day_close_time = time '23:59' where company_id = v_empresa;
    if public.conta_ultimo_dia_cerrado(v_empresa) <> v_hoy - 2 then
      raise exception 'PRUEBA cierre · 4: con cierre a las 23:59, el último cerrado tenía que ser anteayer.';
    end if;
    update public.company_tax_profile set sales_day_close_time = time '06:00' where company_id = v_empresa;
  end if;
  raise notice 'PRUEBA cierre · 4: la frontera de las 6:00 en verde (hora de Madrid de la prueba: %).', to_char(now() at time zone 'Europe/Madrid', 'HH24:MI');
end $$;

-- ── 5 · Lo que ve cada uno ─────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('prueba.ve_a', (select count(*)::text from public.conta_no_confirmados(current_setting('prueba.empresa')::uuid, date '2026-08-01', date '2026-10-31')), true);
select set_config('prueba.ve_a_dia', (select count(*)::text from public.conta_pedidos_del_dia(current_setting('prueba.empresa')::uuid, 'c01a0000-0000-4000-8000-0000000000a2', date '2026-10-02') where estado = 'unconfirmed'), true);
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('prueba.ve_b', (select count(*)::text from public.conta_no_confirmados(current_setting('prueba.empresa')::uuid, date '2026-08-01', date '2026-10-31')), true);
select set_config('prueba.ve_b_log', (select count(*)::text from public.sales_day_close_log), true);
reset role;
do $$
declare v_a int := current_setting('prueba.ve_a')::int; v_hay int;
begin
  select count(*) into v_hay from public.sale s where s.account_id = 'c01a0000-0000-4000-8000-00000000000a' and s.unconfirmed_at is not null and s.sold_at < '2026-11-01';
  if v_a <> v_hay or v_a < 20 then
    raise exception 'PRUEBA cierre · 5: A ve % no confirmados y hay %.', v_a, v_hay;
  end if;
  if current_setting('prueba.ve_a_dia')::int <> 3 then
    raise exception 'PRUEBA cierre · 5: conta_pedidos_del_dia del 02/10 da % «unconfirmed» (tienen que ser 3).', current_setting('prueba.ve_a_dia');
  end if;
  if current_setting('prueba.ve_b')::int <> 0 or current_setting('prueba.ve_b_log')::int <> 0 then
    raise exception 'PRUEBA cierre · 5: B ve % no confirmados y % filas del rastro de A.', current_setting('prueba.ve_b'), current_setting('prueba.ve_b_log');
  end if;
  raise notice 'PRUEBA cierre · 5: A ve sus % no confirmados (3 «unconfirmed» el 02/10); B, 0 y 0 del rastro.', v_a;
end $$;

-- ── 6 · Regenerar no borra ─────────────────────────────────────────────────
-- Los 12 sembrados que se cocinaron (los de staging de antes no tienen por qué
-- tener su consumo al día, y regenerarlos mediría otra cosa).
create temp table _cocinados on commit drop as
  select ('cd000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid sale_id from _forma where cocinado;
do $$
declare v_antes text; v_despues text; s uuid;
begin
  select md5(string_agg(m.id::text || ':' || m.qty_base, ',' order by m.id)) into v_antes
    from public.stock_movement m where m.source_type = 'sale' and m.movement_type = 'consumo'
     and m.source_id in (select sale_id from _cocinados);
  for s in select sale_id from _cocinados loop
    perform public.generate_sale_consumption(s);
  end loop;
  select md5(string_agg(m.id::text || ':' || m.qty_base, ',' order by m.id)) into v_despues
    from public.stock_movement m where m.source_type = 'sale' and m.movement_type = 'consumo'
     and m.source_id in (select sale_id from _cocinados);
  if v_antes is null or v_antes is distinct from v_despues then
    raise exception 'PRUEBA cierre · 6: regenerar el consumo de los no confirmados lo ha cambiado (% → %).', v_antes, v_despues;
  end if;
  raise notice 'PRUEBA cierre · 6: regenerar los 12 no confirmados cocinados deja su consumo igual.';
end $$;

-- ── 7 · Regla 10: los cuatro caminos, después del cierre, como usuario de A ──
-- Con la sesión de A (auth.uid() = el admin de A): las cuatro funciones son
-- security definer y comprueban la cuenta con belongs_to_account. Lo que se
-- siembra para ellas (la venta, el albarán, el recuento) entra como lo haría
-- el servidor.
create temp table _caminos (camino text, resultado text) on commit drop;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_crudo constant uuid := '7e000000-0000-4000-8000-000000000a01';   -- Cerveza de barril (caña)
  v_venta uuid := 'cd000000-0000-4000-8000-000000000201';
  v_alb uuid := 'cd000000-0000-4000-8000-000000000301';
  v_rec uuid := 'cd000000-0000-4000-8000-000000000401';
  v_n int; v_r record;
begin
  -- a) Cerrar una venta: entra, se acepta, se cierra.
  insert into public.sale (id, account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, source, is_active)
  values (v_venta, v_acc, v_loc, '7e000000-0000-4000-8000-000000000b01', 'e0200000-0000-4000-8000-00000000a0c1', now(), 'open', 'new', 2.5, 'hubrise', true);
  insert into public.sale_line (account_id, sale_id, raw_text, product_name, menu_item_id, quantity, line_type)
  values (v_acc, v_venta, 'prueba', 'Caña', '7e000000-0000-4000-8000-000000000e01', 2, 'product');
  update public.sale set order_status = 'accepted' where id = v_venta;
  perform public.close_sale(v_venta);
  select count(*) into v_n from public.stock_movement where source_type = 'sale' and source_id = v_venta and movement_type = 'consumo';
  if v_n = 0 or (select status from public.sale where id = v_venta) <> 'closed' then
    raise exception 'PRUEBA cierre · 7a: cerrar una venta no ha escrito su consumo (% movimientos).', v_n;
  end if;
  insert into _caminos values ('cerrar una venta', v_n || ' movimiento(s) de consumo');

  -- b) Recibir un albarán.
  insert into public.goods_receipt (id, account_id, location_id, status) values (v_alb, v_acc, v_loc, 'borrador');
  insert into public.goods_receipt_line (account_id, goods_receipt_id, product_name, qty_received, recipe_item_id, qty_in_base, unit_cost)
  values (v_acc, v_alb, 'Barril', 30, v_crudo, 30, 0.6);
  select * into v_r from public.confirm_goods_receipt(v_alb);
  select count(*) into v_n from public.stock_movement where recipe_item_id = v_crudo and location_id = v_loc and movement_type <> 'consumo'
     and occurred_at >= now() - interval '1 minute';
  if v_r.posted_lines < 1 or v_n = 0 then
    raise exception 'PRUEBA cierre · 7b: recibir el albarán no ha entrado en el almacén (líneas %, movimientos %).', v_r.posted_lines, v_n;
  end if;
  insert into _caminos values ('recibir un albarán', v_r.posted_lines || ' línea(s), ' || v_n || ' movimiento(s)');

  -- c) Apuntar una merma.
  select * into v_r from public.register_waste(v_acc, v_loc, v_crudo, 'caducado', 2, null, null, null, null, null, null, 'prueba', 'c01a0000-0000-4000-8000-0000000000a1', 'Prueba');
  if v_r.waste_id is null then
    raise exception 'PRUEBA cierre · 7c: la merma no se ha apuntado.';
  end if;
  insert into _caminos values ('apuntar una merma', 'merma ' || v_r.waste_id || ', ' || coalesce(round(v_r.cost_eur, 2)::text, '—') || ' €');

  -- d) Aprobar un recuento, por la puerta de la pantalla: se abre, se cuenta
  --    con save_count_line (lo mismo que dice el sistema), se cierra con
  --    close_inventory_count y se aprueba con apply_inventory_count.
  insert into public.inventory_count (id, account_id, location_id, status, kind)
  values (v_rec, v_acc, v_loc, 'contando', 'full');
  insert into public.inventory_count_line (id, account_id, inventory_count_id, recipe_item_id, system_qty)
  values ('cd000000-0000-4000-8000-000000000402', v_acc, v_rec, v_crudo,
          (select x.qty_on_hand from public.recipe_item_location_stock x where x.recipe_item_id = v_crudo and x.location_id = v_loc));
  perform public.save_count_line('cd000000-0000-4000-8000-000000000402',
          jsonb_build_array(jsonb_build_object('method', 'peso', 'qty',
            (select greatest(x.qty_on_hand, 0) from public.recipe_item_location_stock x where x.recipe_item_id = v_crudo and x.location_id = v_loc))),
          null, 'c01a0000-0000-4000-8000-0000000000a1', null);
  perform public.close_inventory_count(v_rec);
  select * into v_r from public.apply_inventory_count(v_rec, 'c01a0000-0000-4000-8000-0000000000a1', 'Prueba', false);
  if (select status from public.inventory_count where id = v_rec) <> 'aprobado' then
    raise exception 'PRUEBA cierre · 7d: el recuento no ha quedado aprobado (está %).', (select status from public.inventory_count where id = v_rec);
  end if;
  insert into _caminos values ('aprobar un recuento', v_r.adjustments || ' ajuste(s), ' || v_r.items_recomputed || ' artículo(s) recalculados');
end $$;

do $$
declare v_mov text;
begin
  select md5(coalesce(string_agg(m.id::text || ':' || m.qty_base || ':' || coalesce(m.unit_cost::text, '-'), ',' order by m.id), ''))
    into v_mov from public.stock_movement m where m.source_type = 'sale' and m.source_id in (select sale_id from _por_cerrar);
  if v_mov is distinct from (select antes from _huella where que = 'movimientos de los cerrados') then
    raise exception 'PRUEBA cierre · 7: después de los cuatro caminos, los movimientos de los no confirmados han cambiado.';
  end if;
  raise notice 'PRUEBA cierre · 7: los cuatro caminos en verde: %. Los no confirmados, sin moverse.',
    (select string_agg(camino || ' → ' || resultado, ' · ') from _caminos);
end $$;

-- ── 8 · Romperla a propósito ──────────────────────────────────────────────
do $$
declare
  v_id uuid := 'cd000000-0000-4000-8000-000000000501';
  v_antes int; v_despues int;
  v_trg text; v_gen text;
begin
  select prosrc into v_trg from public._backup_cierre_del_dia_consumo where funcion = 'tg_sale_consumption_on_complete()';
  select prosrc into v_gen from public._backup_cierre_del_dia_consumo where funcion = 'generate_sale_consumption(uuid)';
  if v_trg is null or v_gen is null then
    raise exception 'PRUEBA cierre · 8: no está la copia de los de antes (la 0110 no se ha aplicado).';
  end if;
  begin
    -- Un pedido cocinado de hace dos semanas, abierto.
    insert into public.sale (id, account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, source, is_active)
    values (v_id, 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', '7e000000-0000-4000-8000-000000000b01',
            'e0200000-0000-4000-8000-00000000a0c1', now() - interval '14 days', 'open', 'new', 17.5, 'hubrise', true);
    insert into public.sale_line (account_id, sale_id, raw_text, product_name, menu_item_id, quantity, line_type)
    values ('c01a0000-0000-4000-8000-00000000000a', v_id, 'prueba', 'Secreto', '7e000000-0000-4000-8000-000000000e02', 1, 'product');
    update public.sale set order_status = 'accepted' where id = v_id;
    update public.sale set order_status = 'delivery_failed' where id = v_id;
    select count(*) into v_antes from public.stock_movement where source_type = 'sale' and source_id = v_id and movement_type = 'consumo';
    -- Los de ANTES.
    execute format('create or replace function public.tg_sale_consumption_on_complete() returns trigger language plpgsql security definer set search_path = public as %L', v_trg);
    execute format('create or replace function public.generate_sale_consumption(p_sale_id uuid) returns integer language plpgsql security definer set search_path = public as %L', v_gen);
    perform public.conta_cerrar_dias(current_setting('prueba.empresa')::uuid, now());
    select count(*) into v_despues from public.stock_movement where source_type = 'sale' and source_id = v_id and movement_type = 'consumo';
    raise exception using errcode = 'FC008', message = format('%s|%s', v_antes, v_despues);
  exception when sqlstate 'FC008' then
    v_antes := split_part(sqlerrm, '|', 1)::int;
    v_despues := split_part(sqlerrm, '|', 2)::int;
  end;
  if v_antes = 0 then
    raise exception 'PRUEBA cierre · 8: el pedido de la prueba rota no tenía consumo: no mide nada.';
  end if;
  if v_despues = v_antes then
    raise exception 'PRUEBA cierre · 8: con los de ANTES el cierre tampoco mueve el stock (% movimientos): la prueba no distingue.', v_antes;
  end if;
  -- Y el bloque se ha deshecho: vuelven a estar los de ahora.
  if (select prosrc from pg_proc where oid = 'public.generate_sale_consumption(uuid)'::regprocedure) = v_gen then
    raise exception 'PRUEBA cierre · 8: el motor de antes se ha quedado puesto.';
  end if;
  raise notice 'PRUEBA cierre · 8 en verde: con el disparador y el motor de ANTES, cerrar un pedido cocinado le deja % de % movimientos (devuelve el stock). Con los de ahora, los deja todos.', v_despues, v_antes;
end $$;

-- ── 9 · El cambio de hora ──────────────────────────────────────────────────
do $$
declare
  v_e uuid := current_setting('prueba.empresa')::uuid;
  c record; v_mal text := '';
begin
  for c in select * from (values
      ('2026-10-09 15:15:56+00', '2026-10-08'),   -- el asiento b4eb11ca: 17:15 de Madrid
      ('2026-10-09 03:59:00+00', '2026-10-07'),   -- 5:59
      ('2026-10-09 04:00:00+00', '2026-10-08'),   -- 6:00
      ('2026-10-24 03:59:00+00', '2026-10-22'),
      ('2026-10-24 04:00:00+00', '2026-10-23'),
      ('2026-10-25 04:30:00+00', '2026-10-23'),   -- día del cambio: 5:30 de Madrid
      ('2026-10-25 05:00:00+00', '2026-10-24'),
      ('2026-10-26 04:59:00+00', '2026-10-24'),
      ('2026-10-26 05:00:00+00', '2026-10-25'),
      ('2026-03-28 04:59:00+00', '2026-03-26'),
      ('2026-03-28 05:00:00+00', '2026-03-27'),
      ('2026-03-29 03:59:00+00', '2026-03-27'),   -- día del cambio de marzo
      ('2026-03-29 04:00:00+00', '2026-03-28')) as t(ahora, esperado) loop
    if public.conta_ultimo_dia_cerrado(v_e, c.ahora::timestamptz)::text <> c.esperado then
      v_mal := v_mal || format('%s → %s (esperado %s); ', c.ahora, public.conta_ultimo_dia_cerrado(v_e, c.ahora::timestamptz), c.esperado);
    end if;
  end loop;
  if v_mal <> '' then
    raise exception 'PRUEBA cierre · 9: %', v_mal;
  end if;
  raise notice 'PRUEBA cierre · 9: los 13 instantes, iguales que en cierreDelDia.test.ts (octubre y marzo).';
end $$;

-- ── 10 · El libro diario de un mes ─────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('prueba.t0', clock_timestamp()::text, true);
select set_config('prueba.mes', (select count(*)::text from public.conta_dias_por_asentar(current_setting('prueba.empresa')::uuid, date '2026-10-01', date '2026-10-31')), true);
select set_config('prueba.ms', round(extract(epoch from clock_timestamp() - current_setting('prueba.t0')::timestamptz) * 1000, 1)::text, true);
reset role;
do $$ begin
  if current_setting('prueba.ms')::numeric >= 1000 then
    raise exception 'PRUEBA cierre · 10: conta_dias_por_asentar de octubre tarda % ms.', current_setting('prueba.ms');
  end if;
  raise notice 'PRUEBA cierre · 10: conta_dias_por_asentar de octubre, % ms (% días).', current_setting('prueba.ms'), current_setting('prueba.mes');
end $$;

rollback;
