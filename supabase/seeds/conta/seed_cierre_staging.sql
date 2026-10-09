-- supabase/seeds/conta/seed_cierre_staging.sql
--
-- SOLO STAGING. «El día se cierra a las 6:00»: dos pedidos más cerrados como
-- no confirmados el 04/10 en Norte Centro (cuenta A), el día que tiene su
-- asiento de ventas validado. Con el que cerró el cron de verdad (7B001,
-- 17,00 €, en preparación) son tres: 66,80 €. Para el e2e y las capturas
-- (tests/e2e/conta/cierre/cierre.spec.ts). Todo inventado; ids fijos, se
-- puede aplicar otra vez sin duplicar.
--
-- Entran ya cerrados (status 'cancelled' con unconfirmed_at): el disparador de
-- consumo no hace nada al insertar una venta cancelada, ni se imprime nada.

do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla del cierre del día: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;

insert into public.sale (id, account_id, location_id, brand_id, channel_id, sold_at, status, order_status, delivery_state, total, source,
                         platform_order_code, is_active, cancelled_at, unconfirmed_at, cancel_reason)
values
  ('cd5ee000-0000-4000-8000-000000000001', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b1', 'e0200000-0000-4000-8000-00000000a0c1', '2026-10-04 19:08:00+00', 'cancelled',
   'delivery_failed', 'failed', 22.40, 'hubrise', 'G153', true, '2026-10-05 04:07:00+00', '2026-10-05 04:07:00+00',
   'No confirmado por la plataforma al cierre del día (6:00)'),
  ('cd5ee000-0000-4000-8000-000000000002', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b2', 'e0200000-0000-4000-8000-00000000a0c2', '2026-10-04 21:07:00+00', 'cancelled',
   'awaiting_collection', null, 27.40, 'hubrise', 'D6B55', true, '2026-10-05 04:07:00+00', '2026-10-05 04:07:00+00',
   'No confirmado por la plataforma al cierre del día (6:00)')
on conflict (id) do nothing;

insert into public.sales_day_close_log (account_id, company_id, sale_id, location_id, sales_day, closed_through, close_time, order_code, total, order_status, delivery_state, closed_at)
select s.account_id, '3b34403a-a7d6-4a48-a8d7-737e8cababdc', s.id, s.location_id, date '2026-10-04', date '2026-10-04', time '06:00',
       s.platform_order_code, s.total, s.order_status, s.delivery_state, s.unconfirmed_at
  from public.sale s where s.id in ('cd5ee000-0000-4000-8000-000000000001', 'cd5ee000-0000-4000-8000-000000000002')
on conflict (sale_id) do nothing;

do $$
declare v_n int; v_t numeric;
begin
  select count(*), sum(total) into v_n, v_t from public.sale
   where account_id = 'c01a0000-0000-4000-8000-00000000000a' and location_id = 'c01a0000-0000-4000-8000-0000000000a2'
     and unconfirmed_at is not null and (sold_at at time zone 'Europe/Madrid')::date = date '2026-10-04';
  raise notice 'Semilla del cierre del día: Norte Centro, 04/10 · % no confirmados, % €.', v_n, v_t;
end $$;
