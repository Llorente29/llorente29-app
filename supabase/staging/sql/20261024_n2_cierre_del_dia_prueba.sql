-- supabase/staging/sql/20261024_n2_cierre_del_dia_prueba.sql
--
-- SOLO STAGING. N2 · Ventas › Lo que deja el cierre del día. No hay migración:
-- la pantalla lee lo que dejó el C11b. Esta prueba mira, con \i nada y en una
-- transacción que acaba en ROLLBACK (staging no cambia), que lo que lee y
-- escribe la pantalla funciona COMO PERSONA, con su RLS (regla 40: los nombres
-- de las tablas y columnas van entre comillas en el front):
--
--   1. Como usuario de A: lee el apunte del cierre (sales_day_close_log), el
--      pedido (sale), lo cobrado (channel_settlement_order), lo descartado
--      (journal_dismissal) y el libro (journal_entry), con las columnas que usa
--      loQueDejaElCierreService. El pedido de plataforma que su liquidación no
--      cobra sale en conta_sin_confirmar_no_cobrados.
--   2. «Se cobró por otro lado»: el usuario de A guarda el descarte
--      (journal_dismissal, sales_adjustment) y el aviso deja de traerlo.
--   3. B no ve nada de A: ni el apunte del cierre ni el descarte.
-- En la empresa de la cuenta A de pruebas, con pedidos inventados del 24/10.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA N2: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public.conta_sin_confirmar_no_cobrados(uuid)') is null then
    raise exception 'PRUEBA N2: staging no tiene conta_sin_confirmar_no_cobrados (la 2300 del C11b).';
  end if;
end $$;
set local statement_timeout = '60s';

create temp table _n2 (clave text primary key, v uuid) on commit drop;
grant select on _n2 to authenticated;

do $$
declare
  v_acc   constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_loc   constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_marca constant uuid := '7e000000-0000-4000-8000-000000000b01';
  v_canal constant uuid := 'e0200000-0000-4000-8000-00000000a0c1';
  v_plat  constant uuid := 'cd000000-0000-4000-8000-000000002401';
  v_tpv   constant uuid := 'cd000000-0000-4000-8000-000000002402';
  v_e uuid; v_d date := date '2026-10-24';
begin
  select id into v_e from public.company where account_id = v_acc order by created_at limit 1;
  if v_e is null then raise exception 'PRUEBA N2: la cuenta A no tiene empresa.'; end if;
  insert into _n2 values ('empresa', v_e), ('plat', v_plat), ('tpv', v_tpv);
  insert into public.sale (id, account_id, location_id, brand_id, channel_id, sold_at, status, order_status, total, source, platform_order_code, is_active)
  values (v_plat, v_acc, v_loc, v_marca, v_canal, (v_d::timestamp + time '21:00') at time zone 'Europe/Madrid', 'open', 'awaiting_collection', 12.5, 'hubrise', 'N2401', true),
         (v_tpv,  v_acc, v_loc, v_marca, v_canal, (v_d::timestamp + time '22:00') at time zone 'Europe/Madrid', 'open', 'accepted', 5.0, 'folvy_pos', 'T2402', true);
  -- Como lo deja el cierre del día (C11b): solo status y closed_at.
  update public.sale set status = 'closed', closed_at = (v_d::timestamp + time '21:20') at time zone 'Europe/Madrid', updated_at = now() where id = v_plat;
  insert into public.sales_day_close_log (account_id, company_id, sale_id, location_id, sales_day, closed_through, close_time, order_code, total, order_status, accion)
  values (v_acc, v_e, v_plat, v_loc, v_d, v_d, time '02:00', 'N2401', 12.5, 'awaiting_collection', 'cerrado_sin_confirmar'),
         (v_acc, v_e, v_tpv,  v_loc, v_d, v_d, time '02:00', 'T2402', 5.0, 'accepted', 'revisar');
  -- La liquidación de su canal cubre el 24/10 y no trae el pedido.
  insert into public.channel_settlement (account_id, channel_id, location_id, settlement_ref, settlement_date, period_from, period_to, import_key, source)
  values (v_acc, v_canal, v_loc, 'N2-LIQ', date '2026-10-27', date '2026-10-20', date '2026-10-26', 'n2-prueba-' || gen_random_uuid(), 'manual');
end $$;

-- 1 y 2 · Como usuario de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e uuid := (select v from _n2 where clave = 'empresa');
  v_plat uuid := (select v from _n2 where clave = 'plat');
  v_tpv uuid := (select v from _n2 where clave = 'tpv');
  v_n int;
begin
  -- Lo que lee la pantalla, con sus columnas.
  select count(*) into v_n from (select sale_id, location_id, sales_day, order_code, total, accion from public.sales_day_close_log
    where account_id = v_acc and company_id = v_e and accion in ('revisar', 'cerrado_sin_confirmar') and sale_id in (v_plat, v_tpv)) x;
  if v_n <> 2 then raise exception 'PRUEBA N2 · 1: el usuario de A no lee los dos apuntes del cierre (%).', v_n; end if;
  select count(*) into v_n from (select id, status, source, channel_id from public.sale where account_id = v_acc and id in (v_plat, v_tpv)) x;
  if v_n <> 2 then raise exception 'PRUEBA N2 · 1: el usuario de A no lee sus dos pedidos (%).', v_n; end if;
  perform sale_id from public.channel_settlement_order where account_id = v_acc and matched and sale_id in (v_plat, v_tpv);
  perform source_key from public.journal_dismissal where account_id = v_acc and company_id = v_e and source_type = 'sales_adjustment' and source_key in (v_plat::text);
  perform source_id from public.journal_entry where account_id = v_acc and company_id = v_e and source_type = 'sales_adjustment'
    and status in ('propuesto', 'borrador', 'validado') and source_id in (v_plat);
  perform id, name from public.sales_channel where account_id = v_acc;
  perform id, name from public.locations where account_id = v_acc;
  if not exists (select 1 from public.conta_sin_confirmar_no_cobrados(v_e) where sale_id = v_plat and settlement_ref = 'N2-LIQ') then
    raise exception 'PRUEBA N2 · 1: el pedido que su liquidación no cobra no sale en el aviso.';
  end if;
  if exists (select 1 from public.conta_sin_confirmar_no_cobrados(v_e) where sale_id = v_tpv) then
    raise exception 'PRUEBA N2 · 1: el del TPV sale en el aviso de la liquidación.';
  end if;
  raise notice 'N2 · 1: el usuario de A lee lo que dejó el cierre, con las columnas de la pantalla; el no cobrado sale en el aviso';

  -- 2 · «Se cobró por otro lado».
  insert into public.journal_dismissal (account_id, company_id, source_type, source_key, reason, created_by_name)
  values (v_acc, v_e, 'sales_adjustment', v_plat::text, 'Cerrado sin confirmar al cierre del día: se cobró por otro lado (no hace falta la devolución).', 'Prueba N2');
  if exists (select 1 from public.conta_sin_confirmar_no_cobrados(v_e) where sale_id = v_plat) then
    raise exception 'PRUEBA N2 · 2: descartado, el aviso lo sigue trayendo.';
  end if;
  raise notice 'N2 · 2: el usuario de A lo descarta y el aviso ya no lo trae';
end $$;
reset role;

-- 3 · B no ve nada de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.sales_day_close_log where sale_id in (select v from _n2 where clave in ('plat', 'tpv')))
     or exists (select 1 from public.journal_dismissal where source_key = (select v from _n2 where clave = 'plat')::text) then
    raise exception 'PRUEBA N2 · 3: B ve lo del cierre de A.';
  end if;
  raise notice 'PRUEBA N2 en verde: lo que lee y escribe la pantalla, como persona; B no ve nada de A.';
end $$;
reset role;

rollback;
