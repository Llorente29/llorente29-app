CREATE OR REPLACE FUNCTION public.preview_bogo_mirror_price(
  p_account_id uuid, p_channel_id uuid, p_brand_id uuid,
  p_margin_floor_pct numeric DEFAULT 45, p_menu_item_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(menu_item_id uuid, item_name text, brand_name text, pvp_cliente numeric,
   food_cost numeric, precio_paridad numeric, precio_min_suelo numeric, precio_sugerido numeric,
   margen_2x1 numeric, margen_pct_2x1 numeric, ahorro_cliente_pct numeric, units_30d numeric, status text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with rate as (
    select cr.commission_pct, cr.commission_base
    from channel_rate cr
    where cr.account_id = p_account_id
      and cr.sales_channel_id = p_channel_id
      and cr.is_active
    order by cr.commission_pct asc
    limit 1
  ),
  items as (
    select m.id, m.name, b.name as brand_name,
           coalesce(o.price, m.price) as pvp_gross,
           coalesce(m.vat_rate, 10) as vat,
           ri.computed_cost as food_cost
    from menu_item m
    join brand b on b.id = m.brand_id
    left join menu_item_override o
      on o.menu_item_id = m.id and o.channel_id = p_channel_id and o.price is not null
    left join recipe_item ri on ri.id = m.recipe_item_id
    where m.account_id = p_account_id
      and m.archived_at is null
      and m.brand_id = p_brand_id
      and (p_menu_item_ids is null or m.id = any(p_menu_item_ids))
  ),
  sold as (
    select sl.menu_item_id, sum(sl.quantity) as units
    from sale_line sl
    join sale s on s.id = sl.sale_id
    where s.account_id = p_account_id
      and s.brand_id = p_brand_id
      and s.created_at >= now() - interval '30 days'
    group by sl.menu_item_id
  ),
  calc as (
    select i.*,
      i.pvp_gross as pvp_cli,
      case when r.commission_base = 'pvp_sin_iva'
        then r.commission_pct/100.0
        else r.commission_pct/100.0 * (1 + i.vat/100) end as k
    from items i cross join rate r
  ),
  calc2 as (
    select c.*,
      c.pvp_gross / (1 + c.vat/100) as n1,
      case when (1 - c.k) > 0
        then (c.pvp_gross / (1 + c.vat/100)) + c.food_cost / (1 - c.k)
        else null end as n_paridad,
      case when (1 - c.k - p_margin_floor_pct/100.0) > 0
        then (2 * c.food_cost) / (1 - c.k - p_margin_floor_pct/100.0)
        else null end as n_suelo
    from calc c
  ),
  calc3 as (
    select c.*,
      round(c.n_paridad * (1 + c.vat/100), 2) as p_paridad,
      round(c.n_suelo   * (1 + c.vat/100), 2) as p_suelo,
      ceil(greatest(c.n_suelo, c.n1) * (1 + c.vat/100) * 10) / 10.0 as p_sug
    from calc2 c
  ),
  calc4 as (
    select c.*,
      c.p_sug / (1 + c.vat/100) as n_sug,
      round((c.p_sug / (1 + c.vat/100)) * (1 - c.k) - 2 * c.food_cost, 2) as margen_2x1_eur
    from calc3 c
  )
  select
    c.id, c.name, c.brand_name,
    c.pvp_cli,
    round(c.food_cost, 2),
    c.p_paridad, c.p_suelo, c.p_sug,
    c.margen_2x1_eur,
    round(100 * c.margen_2x1_eur / nullif(c.n_sug, 0), 1) as margen_pct_2x1,
    round(100 * (1 - c.p_sug / nullif(2 * c.pvp_cli, 0)), 1) as ahorro_cliente_pct,
    coalesce(so.units, 0),
    case
      when c.food_cost is null then 'sin_escandallo'
      when c.p_sug is null or c.p_sug >= 2 * c.pvp_cli then 'inviable'
      else 'ok'
    end as status
  from calc4 c
  left join sold so on so.menu_item_id = c.id
  order by coalesce(so.units, 0) desc;
$function$;