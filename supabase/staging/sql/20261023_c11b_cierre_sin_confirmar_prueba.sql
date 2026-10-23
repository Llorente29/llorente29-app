-- supabase/staging/sql/20261023_c11b_cierre_sin_confirmar_prueba.sql
--
-- SOLO STAGING. Prueba de 20261023T2300_c11b_cierre_cierra_sin_confirmar
-- (public.conta_cerrar_dias, public.sales_day_close_log y
-- public.conta_sin_confirmar_no_cobrados) y de 20261023T2310 (sin Foodint no
-- hace nada), con \i dentro de la transacción y ROLLBACK: staging no cambia.
-- En la empresa de la cuenta A de pruebas, con pedidos inventados del 24/10.
--
--   1. Un pedido de plataforma abierto (esperando recogida) a las 2:07: se
--      cierra como vendido (closed, con su closed_at), queda
--      «cerrado_sin_confirmar» y, como no tenía ningún movimiento de stock, se
--      genera su consumo una vez.
--   2. Uno que la plataforma canceló: se anula (cancelled, unconfirmed_at) y
--      queda «anulado».
--   3. Uno del TPV: no se toca y queda «revisar».
--   4. Uno que el freno había apuntado «para revisar»: pasa a
--      «cerrado_sin_confirmar».
--   5. Una segunda pasada no cambia nada.
--   6. Como usuario de A: no puede lanzar el cierre, y el aviso de la
--      liquidación (conta_sin_confirmar_no_cobrados) se lee sin error.
--   7. La 2310 sin Foodint no toca ninguna venta, y las dos vueltas atrás
--      dejan conta_cerrar_dias como el freno (md5 12743c98…).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA C11b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

\i supabase/migrations/20261023T2300_c11b_cierre_cierra_sin_confirmar.sql

do $$
declare
  v_acc   constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc   constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_marca constant uuid := '7e000000-0000-4000-8000-000000000b01';
  v_canal constant uuid := 'e0200000-0000-4000-8000-00000000a0c1';
  v_plat  constant uuid := 'cd000000-0000-4000-8000-000000001201';
  v_canc  constant uuid := 'cd000000-0000-4000-8000-000000001202';
  v_tpv   constant uuid := 'cd000000-0000-4000-8000-000000001203';
  v_rev   constant uuid := 'cd000000-0000-4000-8000-000000001204';
  v_e uuid; r jsonb; r2 jsonb; v_d date := date '2026-10-24'; s record;
begin
  select id into v_e from public.company where account_id = v_acc order by created_at limit 1;
  if v_e is null then raise exception 'PRUEBA C11b: la cuenta A no tiene empresa.'; end if;
  update public.company_tax_profile set sales_day_close_time = time '02:00' where company_id = v_e;

  insert into public.sale (id, account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, source, platform_order_code, is_active, ready_at)
  values (v_plat, v_acc, v_loc, v_marca, v_canal, (v_d::timestamp + time '21:00') at time zone 'Europe/Madrid', 'open', 'awaiting_collection', 12.5, 'hubrise', 'P1201', true,
          (v_d::timestamp + time '21:20') at time zone 'Europe/Madrid'),
         (v_canc, v_acc, v_loc, v_marca, v_canal, (v_d::timestamp + time '21:30') at time zone 'Europe/Madrid', 'open', 'cancelled', 8.0, 'hubrise', 'P1202', true, null),
         (v_tpv,  v_acc, v_loc, v_marca, v_canal, (v_d::timestamp + time '22:00') at time zone 'Europe/Madrid', 'open', 'accepted', 5.0, 'tpv', 'T1203', true, null),
         (v_rev,  v_acc, v_loc, v_marca, v_canal, (v_d::timestamp + time '22:30') at time zone 'Europe/Madrid', 'open', 'in_delivery', 9.9, 'lastapp', 'L1204', true, null);
  insert into public.sales_day_close_log (account_id, company_id, sale_id, location_id, sales_day, closed_through, close_time, order_code, total, order_status, accion)
  values (v_acc, v_e, v_rev, v_loc, v_d, v_d, time '02:00', 'L1204', 9.9, 'in_delivery', 'revisar');

  r := public.conta_cerrar_dias(v_e, '2026-10-25 00:07:00+00');   -- 2:07 del 25/10

  -- 1 · Cerrado como vendido, con su hora, y su consumo una vez.
  select * into s from public.sale where id = v_plat;
  if s.status <> 'closed' or s.closed_at is distinct from ((v_d::timestamp + time '21:20') at time zone 'Europe/Madrid')
     or s.order_status <> 'awaiting_collection' or s.unconfirmed_at is not null or s.cancelled_at is not null then
    raise exception 'PRUEBA C11b · 1: el pedido de plataforma no se ha cerrado como vendido (% · % · %).', s.status, s.closed_at, r;
  end if;
  if (select accion from public.sales_day_close_log where sale_id = v_plat) is distinct from 'cerrado_sin_confirmar' then
    raise exception 'PRUEBA C11b · 1: el pedido cerrado no ha quedado «cerrado_sin_confirmar».';
  end if;
  if (r ->> 'consumos_generados')::int < 1 then
    raise exception 'PRUEBA C11b · 1: sin movimientos de stock, el cierre no ha generado su consumo (%).', r;
  end if;

  -- 2 · Cancelado en la plataforma: fuera.
  select * into s from public.sale where id = v_canc;
  if s.status <> 'cancelled' or s.unconfirmed_at is null
     or (select accion from public.sales_day_close_log where sale_id = v_canc) is distinct from 'anulado' then
    raise exception 'PRUEBA C11b · 2: el cancelado en la plataforma no se ha quedado fuera (% · %).', s.status, s.cancel_reason;
  end if;

  -- 3 · Del TPV: no se toca.
  if (select status from public.sale where id = v_tpv) <> 'open'
     or (select accion from public.sales_day_close_log where sale_id = v_tpv) is distinct from 'revisar' then
    raise exception 'PRUEBA C11b · 3: el pedido del TPV se ha tocado o no ha quedado «revisar».';
  end if;

  -- 4 · El que el freno dejó «para revisar».
  if (select status from public.sale where id = v_rev) <> 'closed'
     or (select accion from public.sales_day_close_log where sale_id = v_rev) is distinct from 'cerrado_sin_confirmar' then
    raise exception 'PRUEBA C11b · 4: el que estaba «para revisar» no ha pasado a cerrado sin confirmar.';
  end if;

  -- 5 · La segunda pasada no cambia nada.
  r2 := public.conta_cerrar_dias(v_e, '2026-10-25 01:07:00+00');
  if (r2 ->> 'cerrados')::int <> 0 or (r2 ->> 'anulados')::int <> 0 or (r2 ->> 'consumos_generados')::int <> 0 then
    raise exception 'PRUEBA C11b · 5: la segunda pasada ha vuelto a cerrar o anular: %.', r2;
  end if;

  raise notice 'C11b · 1-5: cierra lo de plataforma como vendido (con su consumo una vez), deja fuera lo cancelado, no toca el TPV, recoge lo «para revisar» y no repite';
end $$;

-- 6 · Como usuario de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_e uuid; v_n int;
begin
  select id into v_e from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at limit 1;
  begin
    perform public.conta_cerrar_dias(v_e, now());
    raise exception 'PRUEBA C11b · 6: un usuario ha podido lanzar el cierre del día.';
  exception when insufficient_privilege then null;
  end;
  select count(*) into v_n from public.conta_sin_confirmar_no_cobrados(v_e);
  raise notice 'C11b · 6: un usuario no lanza el cierre; el aviso de la liquidación se lee (% sin cobrar)', v_n;
end $$;
reset role;

-- 7 · La 2310 sin Foodint, y las vueltas atrás.
create temp table _c11b_ventas on commit drop as select id, status, closed_at from public.sale;
\i supabase/migrations/20261023T2310_c11b_cerrar_las_entregadas.sql
do $$ begin
  if exists (select 1 from public.sale s join _c11b_ventas a on a.id = s.id
              where s.status is distinct from a.status or s.closed_at is distinct from a.closed_at) then
    raise exception 'PRUEBA C11b · 7: sin Foodint, la 2310 ha tocado alguna venta.';
  end if;
end $$;
\i supabase/vuelta-atras/20261023T2310_c11b_cerrar_las_entregadas.down.sql
\i supabase/vuelta-atras/20261023T2300_c11b_cierre_cierra_sin_confirmar.down.sql
do $$ begin
  if md5((select prosrc from pg_proc where oid = 'public.conta_cerrar_dias(uuid, timestamptz)'::regprocedure)) <> '12743c982825a9ee11d970b6d095c275' then
    raise exception 'PRUEBA C11b · 7: la vuelta atrás no deja conta_cerrar_dias como el freno.';
  end if;
  if to_regprocedure('public.conta_sin_confirmar_no_cobrados(uuid)') is not null then
    raise exception 'PRUEBA C11b · 7: la vuelta atrás no ha quitado conta_sin_confirmar_no_cobrados.';
  end if;
  raise notice 'PRUEBA C11b en verde: la regla nueva del cierre por sus cuatro casos; sin Foodint la 2310 no toca nada; las vueltas atrás, como estaba.';
end $$;

rollback;
