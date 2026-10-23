-- supabase/staging/sql/20261023_c11_cierre_no_anula_prueba.sql
--
-- SOLO STAGING. Prueba de 20261023T2045_c11_cierre_marca_para_revisar
-- (public.conta_cerrar_dias), con \i dentro de la transacción y ROLLBACK: staging no cambia. En la empresa
-- de la cuenta A de pruebas, con pedidos inventados.
--
--   1. El cierre ya NO anula: un pedido abierto de las 23:00 del día D sigue
--      exactamente igual a las 2:07 de D + 1 (status, unconfirmed_at,
--      cancelled_at, cancel_reason, order_status) y queda apuntado una vez en
--      sales_day_close_log con accion = 'revisar'.
--   2. Una segunda pasada no lo apunta otra vez.
--   3. Un pedido ya cerrado ('closed') no se apunta.
--   4. La vuelta atrás deja conta_cerrar_dias byte a byte como la 0170
--      (md5 7d1dd3c1…).
--   5. Un usuario no puede lanzar el cierre.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA C11: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

\i supabase/migrations/20261023T2045_c11_cierre_marca_para_revisar.sql

do $$
declare
  v_acc   constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc   constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_marca constant uuid := '7e000000-0000-4000-8000-000000000b01';
  v_canal constant uuid := 'e0200000-0000-4000-8000-00000000a0c1';
  v_abierto constant uuid := 'cd000000-0000-4000-8000-000000001101';
  v_cerrado constant uuid := 'cd000000-0000-4000-8000-000000001102';
  v_e uuid; r jsonb; v_d date := date '2026-10-24'; s record;
begin
  select id into v_e from public.company where account_id = v_acc order by created_at limit 1;
  if v_e is null then raise exception 'PRUEBA C11: la cuenta A no tiene empresa.'; end if;
  update public.company_tax_profile set sales_day_close_time = time '02:00' where company_id = v_e;

  insert into public.sale (id, account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, source, platform_order_code, is_active)
  values (v_abierto, v_acc, v_loc, v_marca, v_canal, (v_d::timestamp + time '23:00') at time zone 'Europe/Madrid', 'open', 'awaiting_collection', 9.9, 'hubrise', 'P1101', true),
         (v_cerrado, v_acc, v_loc, v_marca, v_canal, (v_d::timestamp + time '22:00') at time zone 'Europe/Madrid', 'closed', 'completed', 7.5, 'hubrise', 'P1102', true);

  -- 1 · A las 2:07 del 25/10 (la pasada del cron) no se anula: se marca para revisar.
  r := public.conta_cerrar_dias(v_e, '2026-10-25 00:07:00+00');
  select * into s from public.sale where id = v_abierto;
  if s.status <> 'open' or s.order_status <> 'awaiting_collection' or s.unconfirmed_at is not null
     or s.cancelled_at is not null or s.cancel_reason is not null then
    raise exception 'PRUEBA C11 · 1: el cierre ha cambiado el pedido (% · % · %).', s.status, s.order_status, s.cancel_reason;
  end if;
  if (select accion from public.sales_day_close_log where sale_id = v_abierto) is distinct from 'revisar' then
    raise exception 'PRUEBA C11 · 1: el pedido abierto no ha quedado «para revisar» en el registro (%).', r;
  end if;
  if (r ->> 'cerrados')::int <> 0 or (r ->> 'para_revisar')::int < 1 then
    raise exception 'PRUEBA C11 · 1: lo que devuelve el cierre no cuadra: %.', r;
  end if;

  -- 2 · Una segunda pasada no lo apunta otra vez.
  r := public.conta_cerrar_dias(v_e, '2026-10-25 01:07:00+00');
  if (select count(*) from public.sales_day_close_log where sale_id = v_abierto) <> 1 then
    raise exception 'PRUEBA C11 · 2: la segunda pasada lo ha apuntado otra vez.';
  end if;

  -- 3 · Lo cerrado no se apunta.
  if exists (select 1 from public.sales_day_close_log where sale_id = v_cerrado) then
    raise exception 'PRUEBA C11 · 3: un pedido cerrado ha quedado en el registro del cierre.';
  end if;

  raise notice 'C11 · 1-3: el cierre de las 2:07 deja el pedido abierto tal cual, lo apunta una vez «para revisar» y no apunta lo cerrado';
end $$;

-- 6 · Como usuario de A: no puede lanzar el cierre (solo el cron).
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_e uuid;
begin
  select id into v_e from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at limit 1;
  begin
    perform public.conta_cerrar_dias(v_e, now());
    raise exception 'PRUEBA C11 · 6: un usuario ha podido lanzar el cierre del día.';
  exception when insufficient_privilege then
    raise notice 'C11 · 6: un usuario no puede lanzar el cierre del día';
  end;
end $$;
reset role;

-- 5 · La vuelta atrás.
\i supabase/vuelta-atras/20261023T2045_c11_cierre_marca_para_revisar.down.sql
do $$ begin
  if md5((select prosrc from pg_proc where oid = 'public.conta_cerrar_dias(uuid, timestamptz)'::regprocedure)) <> '7d1dd3c15193d716616fe268e3a5bab6' then
    raise exception 'PRUEBA C11 · 5: la vuelta atrás no deja conta_cerrar_dias como la 0170.';
  end if;
  raise notice 'PRUEBA C11 en verde: el cierre no anula y marca para revisar una vez; un usuario no puede lanzarlo; la vuelta atrás, como estaba.';
end $$;

rollback;
