-- team_demand_forecast: previsión ajustada de platos/día por local y semana.
-- previsión = (base_reciente_local / factor_estacional_base) × idx_dow × idx_mes × tendencia
-- Reutiliza team_demand_coefficients (dow+mes, mezcla propio+prior) y la definición
-- de demanda del cuadrante (team_demand_config.counted_kinds). Clima/eventos: fuera a propósito.
create or replace function public.team_demand_forecast(
  p_account uuid,
  p_location uuid,
  p_week_start date
)
returns table(
  fecha date, dow int, mes int,
  base_reciente numeric,   -- media platos/día del local (cruda, trazabilidad)
  base_anual numeric,      -- base desestacionalizada (la que se multiplica)
  idx_dow numeric, idx_mes numeric,
  factor_base numeric,     -- factor estacional del periodo base
  tendencia numeric,
  prevision numeric,
  dias_datos int
)
language sql
stable
as $function$
  with cfg as (
    select coalesce(
      (select counted_kinds from public.team_demand_config where account_id = p_account),
      array['cocina']
    ) as kinds
  ),
  loc_days as (
    select (s.sold_at at time zone 'Europe/Madrid')::date as d,
           sum(sl.quantity)::numeric as platos
    from public.sale s
    join public.sale_line sl on sl.sale_id = s.id
    join public.menu_item mi on mi.id = sl.menu_item_id
    join public.menu_category mc on mc.id = mi.menu_category_id
    cross join cfg
    where s.account_id = p_account
      and s.location_id = p_location
      and coalesce(s.is_active, true)
      and mc.demand_kind = any (cfg.kinds)
    group by 1
  ),
  anchor as (select max(d) as ad from loc_days),
  base_win as (
    select d, platos, extract(month from d)::int as mon
    from loc_days, anchor
    where anchor.ad is not null and d > anchor.ad - 56 and d <= anchor.ad
  ),
  base_stats as (select avg(platos) as base_reciente, count(*)::int as dias from base_win),
  coef as (select dim, key, idx_final from public.team_demand_coefficients(p_account)),
  season_base as (
    select coalesce(avg(c.idx_final), 1) as f
    from base_win b left join coef c on c.dim='month' and c.key = b.mon
  ),
  tc as (
    select (select sum(platos) from loc_days, anchor where d > anchor.ad - 14 and d <= anchor.ad) as t_recent,
           (select sum(platos) from loc_days, anchor where d > anchor.ad - 28 and d <= anchor.ad - 14) as t_prev
  ),
  trend as (
    select case
      when (select dias from base_stats) < 21 then 1.0
      when coalesce(t_prev,0) <= 0 or coalesce(t_recent,0) <= 0 then 1.0
      else least(1.15, greatest(0.85, t_recent / t_prev))
    end as tv
    from tc
  ),
  days as (
    select (p_week_start + g)::date as fecha,
           (extract(isodow from (p_week_start + g))::int - 1) as dow,
           extract(month from (p_week_start + g))::int as mes
    from generate_series(0,6) g
  )
  select
    d.fecha, d.dow, d.mes,
    round(bs.base_reciente, 1) as base_reciente,
    round(bs.base_reciente / nullif(sb.f,0), 1) as base_anual,
    cd.idx_final as idx_dow,
    cm.idx_final as idx_mes,
    round(sb.f, 3) as factor_base,
    round(tr.tv, 3) as tendencia,
    round((bs.base_reciente / nullif(sb.f,0)) * coalesce(cd.idx_final,1) * coalesce(cm.idx_final,1) * tr.tv, 0) as prevision,
    bs.dias as dias_datos
  from days d
  cross join base_stats bs
  cross join season_base sb
  cross join trend tr
  left join coef cd on cd.dim='dow'   and cd.key = d.dow
  left join coef cm on cm.dim='month' and cm.key = d.mes
  order by d.fecha;
$function$;

grant execute on function public.team_demand_forecast(uuid, uuid, date) to anon, authenticated;
