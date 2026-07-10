-- 20260709T2120_team_demand_profile.sql
-- Perfil de demanda para el cuadrante: unidades por (día de la semana × hora),
-- solo de las categorías que cuentan como carga (team_demand_config). Alimenta la
-- barra por día del cuadrante y la mini-curva por horas del tooltip.
-- dow: 0=Lunes .. 6=Domingo (igual que DayOfWeek del front).
-- SECURITY INVOKER.

begin;

create or replace function public.team_demand_profile(
  p_account uuid, p_from timestamptz, p_to timestamptz
) returns table (
  location_id uuid, dow int, hour_of_day int, units numeric
) language sql stable as $$
  with kinds as (
    select coalesce(
      (select counted_kinds from public.team_demand_config where account_id = p_account),
      array['cocina']
    ) as k
  )
  select s.location_id,
         (extract(isodow from (s.sold_at at time zone 'Europe/Madrid'))::int - 1) as dow,
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
  group by s.location_id, 2, 3;
$$;

grant execute on function public.team_demand_profile(uuid, timestamptz, timestamptz) to authenticated;

commit;
