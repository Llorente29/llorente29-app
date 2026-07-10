-- 20260709T2210_team_demand_coefficients.sql
-- Coeficientes de demanda de una cuenta = modelo jerárquico (shrinkage):
--   idx_final = w · idx_propio + (1-w) · idx_prior_del_tipo_de_negocio
-- donde w crece con el histórico propio del día/mes. Con poco histórico manda el
-- prior general (arranque en frío resuelto); con mucho, mandan los datos propios.
-- Devuelve, por dimensión (dow|month) y clave, el índice final + su composición
-- (para el desglose visible en el cuadrante). SECURITY INVOKER.

begin;

create or replace function public.team_demand_coefficients(p_account uuid)
returns table (
  dim text, key int, idx_final numeric, idx_own numeric, idx_prior numeric,
  weight_own numeric, own_days int
) language sql stable as $$
  with biz as (
    select coalesce((select business_type from public.accounts where id = p_account), 'dark_kitchen') as bt
  ),
  -- Días con ventas de la cuenta (para calcular medias propias por día/mes).
  days as (
    select (s.sold_at at time zone 'Europe/Madrid')::date as d,
           extract(isodow from (s.sold_at at time zone 'Europe/Madrid'))::int - 1 as dow,
           extract(month  from (s.sold_at at time zone 'Europe/Madrid'))::int as mon,
           count(*)::numeric as tickets
    from public.sale s
    where s.account_id = p_account and coalesce(s.is_active, true)
    group by 1, 2, 3
  ),
  base as (  -- media global de tickets/día de la cuenta (denominador del índice)
    select nullif(avg(tickets), 0) as m from days
  ),
  -- Índice propio por día de la semana + nº de días observados de ese dow.
  own_dow as (
    select 'dow'::text dim, dow key, (avg(tickets) / (select m from base)) idx, count(*)::int n
    from days group by dow
  ),
  own_mon as (
    select 'month'::text dim, mon key, (avg(tickets) / (select m from base)) idx, count(*)::int n
    from days group by mon
  ),
  own as (select * from own_dow union all select * from own_mon),
  prior as (
    select dp.dim, dp.key, dp.idx from public.demand_prior dp, biz where dp.business_type = biz.bt
  ),
  -- Rejilla completa de claves (dow 0..6, month 1..12) para no perder ninguna.
  grid as (
    select 'dow'::text dim, g key from generate_series(0,6) g
    union all
    select 'month'::text, g from generate_series(1,12) g
  )
  select
    grid.dim, grid.key,
    -- w = n / (n + K): con K=6, hacen falta ~6 observaciones para pesar 50 % lo propio.
    round(
      coalesce(o.n,0)::numeric / (coalesce(o.n,0) + 6) * coalesce(o.idx, coalesce(p.idx,1))
      + (1 - coalesce(o.n,0)::numeric / (coalesce(o.n,0) + 6)) * coalesce(p.idx, coalesce(o.idx,1))
    , 3) as idx_final,
    round(coalesce(o.idx, 0), 3) as idx_own,
    round(coalesce(p.idx, 0), 3) as idx_prior,
    round(coalesce(o.n,0)::numeric / (coalesce(o.n,0) + 6), 2) as weight_own,
    coalesce(o.n, 0) as own_days
  from grid
  left join own   o on o.dim = grid.dim and o.key = grid.key
  left join prior p on p.dim = grid.dim and p.key = grid.key
  order by grid.dim, grid.key;
$$;

grant execute on function public.team_demand_coefficients(uuid) to authenticated;

commit;
