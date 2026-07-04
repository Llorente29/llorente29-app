-- Motor de ofertas de plataforma · Tramo 2: el cerebro.
-- Preview de impacto de una promo por plato: margen real tras descuento y tras comision.
-- Regla demostrada con factura real de Glovo: comision = % x (base REBAJADA por el descuento).
-- SECURITY INVOKER a proposito: se apoya en RLS y es probable desde el SQL Editor.
-- Aplicada en produccion el 04/07/2026 (SQL Editor). Este fichero la versiona.

create or replace function public.preview_platform_promo_impact(
  p_account_id     uuid,
  p_channel_id     uuid,
  p_brand_ids      uuid[],
  p_discount_type  text,                 -- 'percent' | 'fixed' (EUR sobre precio cliente)
  p_discount_value numeric,
  p_menu_item_ids  uuid[] default null,  -- null = toda la carta de esas marcas
  p_margin_floor_pct numeric default null
)
returns table (
  menu_item_id uuid,
  item_name text,
  brand_name text,
  pvp_cliente numeric,
  pvp_promo_cliente numeric,
  descuento numeric,
  comision_antes numeric,
  comision_despues numeric,
  food_cost numeric,
  margen_antes numeric,
  margen_despues numeric,
  margen_pct_antes numeric,
  margen_pct_despues numeric,
  units_30d numeric,
  status text                   -- ok | bajo_suelo | sin_escandallo
)
language sql stable
as $$
  with rate as (
    select cr.commission_pct, cr.commission_base
    from channel_rate cr
    where cr.account_id = p_account_id
      and cr.sales_channel_id = p_channel_id
      and cr.is_active
    order by cr.updated_at desc
    limit 1
  ),
  items as (
    select m.id, m.name, b.name as brand_name,
           coalesce(o.price, m.price) as price_sin_iva,
           coalesce(m.vat_rate, 10) as vat,
           ri.computed_cost as food_cost
    from menu_item m
    join brand b on b.id = m.brand_id
    left join menu_item_override o
      on o.menu_item_id = m.id and o.channel_id = p_channel_id and o.price is not null
    left join recipe_item ri on ri.id = m.recipe_item_id
    where m.account_id = p_account_id
      and m.archived_at is null
      and m.brand_id = any(p_brand_ids)
      and (p_menu_item_ids is null or m.id = any(p_menu_item_ids))
  ),
  sold as (
    select sl.menu_item_id, sum(sl.quantity) as units
    from sale_line sl
    join sale s on s.id = sl.sale_id
    where s.account_id = p_account_id
      and s.brand_id = any(p_brand_ids)
      and s.created_at >= now() - interval '30 days'
    group by sl.menu_item_id
  ),
  calc as (
    select i.*,
      round(i.price_sin_iva * (1 + i.vat/100), 2) as pvp_cli,
      r.commission_pct, r.commission_base
    from items i cross join rate r
  ),
  calc2 as (
    select c.*,
      least(c.pvp_cli, case when p_discount_type = 'percent'
        then round(c.pvp_cli * p_discount_value / 100, 2)
        else p_discount_value end) as desc_cli
    from calc c
  ),
  calc3 as (
    select c.*,
      (c.pvp_cli - c.desc_cli) as pvp_promo,
      case when c.commission_base = 'pvp_sin_iva'
        then c.pvp_cli / (1 + c.vat/100) else c.pvp_cli end as base_com_antes,
      case when c.commission_base = 'pvp_sin_iva'
        then (c.pvp_cli - c.desc_cli) / (1 + c.vat/100)
        else (c.pvp_cli - c.desc_cli) end as base_com_despues
    from calc2 c
  ),
  calc4 as (
    select c.*,
      round(c.base_com_antes  * c.commission_pct/100, 4) as com_antes,
      round(c.base_com_despues * c.commission_pct/100, 4) as com_despues,
      round(c.pvp_cli   / (1 + c.vat/100), 4) as ingreso_neto_antes,
      round(c.pvp_promo / (1 + c.vat/100), 4) as ingreso_neto_despues
    from calc3 c
  )
  select
    c.id, c.name, c.brand_name,
    c.pvp_cli, c.pvp_promo, c.desc_cli,
    round(c.com_antes, 2), round(c.com_despues, 2),
    round(c.food_cost, 2),
    round(c.ingreso_neto_antes  - c.com_antes  - coalesce(c.food_cost,0), 2) as margen_antes,
    round(c.ingreso_neto_despues - c.com_despues - coalesce(c.food_cost,0), 2) as margen_despues,
    round(100 * (c.ingreso_neto_antes  - c.com_antes  - coalesce(c.food_cost,0))
      / nullif(c.ingreso_neto_antes, 0), 1),
    round(100 * (c.ingreso_neto_despues - c.com_despues - coalesce(c.food_cost,0))
      / nullif(c.ingreso_neto_despues, 0), 1),
    coalesce(so.units, 0),
    case
      when c.food_cost is null then 'sin_escandallo'
      when p_margin_floor_pct is not null
        and 100 * (c.ingreso_neto_despues - c.com_despues - c.food_cost)
            / nullif(c.ingreso_neto_despues, 0) < p_margin_floor_pct then 'bajo_suelo'
      else 'ok'
    end
  from calc4 c
  left join sold so on so.menu_item_id = c.id
  order by coalesce(so.units, 0) desc;
$$;
