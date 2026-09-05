-- Refresco de la agregación. Idempotente por rango: borra y reinserta el tramo pedido.
-- Replica EXACTAMENTE la agregación de las funciones de demanda (mismo join, misma zona horaria,
-- mismo coalesce(is_active,true)) para que los números no cambien ni un decimal.
create or replace function public.refresh_sales_hourly_agg(
  p_account uuid, p_from date, p_to date
) returns integer
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_rows int;
begin
  delete from public.sales_hourly_agg
  where account_id = p_account and day >= p_from and day <= p_to;

  insert into public.sales_hourly_agg (account_id, location_id, day, hour, demand_kind, units, tickets)
  select s.account_id,
         s.location_id,
         (s.sold_at at time zone 'Europe/Madrid')::date as day,
         extract(hour from (s.sold_at at time zone 'Europe/Madrid'))::smallint as hour,
         coalesce(mc.demand_kind, 'otro') as demand_kind,
         coalesce(sum(sl.quantity), 0) as units,
         count(distinct s.id) as tickets
  from public.sale s
  join public.sale_line sl on sl.sale_id = s.id
  join public.menu_item mi on mi.id = sl.menu_item_id
  join public.menu_category mc on mc.id = mi.menu_category_id
  where s.account_id = p_account
    and coalesce(s.is_active, true)
    and (s.sold_at at time zone 'Europe/Madrid')::date >= p_from
    and (s.sold_at at time zone 'Europe/Madrid')::date <= p_to
  group by 1,2,3,4,5;

  get diagnostics v_rows = row_count;
  return v_rows;
end $function$;

revoke execute on function public.refresh_sales_hourly_agg(uuid,date,date) from public, anon;
grant execute on function public.refresh_sales_hourly_agg(uuid,date,date) to authenticated, service_role;