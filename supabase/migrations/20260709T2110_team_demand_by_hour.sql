-- 20260709T2110_team_demand_by_hour.sql
-- Motor de la barra de demanda del cuadrante: cuenta UNIDADES vendidas por hora
-- (hora local Madrid) y local, SOLO de las categorías cuyo demand_kind está en la
-- config de la cuenta (team_demand_config.counted_kinds). Multi-cliente.
-- SECURITY INVOKER: la RLS del que llama manda. NO probar SECURITY DEFINER en SQL Editor.

begin;

create or replace function public.team_demand_by_hour(
  p_account uuid, p_from timestamptz, p_to timestamptz
) returns table (
  location_id uuid, hour_of_day int, units numeric
) language sql stable as $$
  with kinds as (
    select coalesce(
      (select counted_kinds from public.team_demand_config where account_id = p_account),
      array['cocina']
    ) as k
  )
  select s.location_id,
         extract(hour from (s.sold_at at time zone 'Europe/Madrid'))::int as h,
         coalesce(sum(sl.quantity), 0) as units
  from public.sale s
  join public.sale_line sl on sl.sale_id = s.id
  join public.menu_item mi on mi.id = sl.menu_item_id
  join public.menu_category mc on mc.id = mi.menu_category_id
  cross join kinds
  where s.account_id = p_account
    and coalesce(s.is_active, true)
    and s.sold_at >= p_from and s.sold_at < p_to
    and mc.demand_kind = any (kinds.k)
  group by s.location_id, 2;
$$;

grant execute on function public.team_demand_by_hour(uuid, timestamptz, timestamptz) to authenticated;

commit;
