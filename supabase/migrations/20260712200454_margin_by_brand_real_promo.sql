create or replace function public.margin_by_brand(
  p_account uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_location uuid default null
) returns jsonb
language sql stable security invoker as $$
  with base as (
    select s.brand_id, b.name as brand, s.channel_id, s.location_id,
      sum(sl.quantity*sl.unit_price) filter (where ri.computed_cost is not null) as venta,
      sum(sl.quantity*ri.computed_cost) filter (where ri.computed_cost is not null) as food,
      count(*) as lineas,
      count(*) filter (where ri.computed_cost is not null) as lineas_costeadas
    from public.sale_line sl
    join public.sale s on s.id = sl.sale_id
    left join public.menu_item mi on mi.id = sl.menu_item_id
    left join public.recipe_item ri on ri.id = mi.recipe_item_id
    left join public.brand b on b.id = s.brand_id
    where sl.account_id = p_account
      and s.channel_id is not null
      and coalesce(s.status,'') <> 'cancelled'
      and (p_from is null or s.sold_at >= p_from)
      and (p_to  is null or s.sold_at <  p_to)
      and (p_location is null or s.location_id = p_location)
    group by s.brand_id, b.name, s.channel_id, s.location_id
  ),
  withrate as (
    select *, public.resolve_channel_commission(p_account, channel_id, brand_id, location_id, 'platform_delivery') as rate
    from base
  ),
  -- promo REAL por marca desde Capa C (channel_settlement_order): promo / venta bruta
  promo_cte as (
    select brand_id,
      sum(coalesce(promo_product,0)+coalesce(promo_flash,0)) as promo,
      sum(coalesce(net_payout,0)+coalesce(commission,0)+coalesce(promo_product,0)+coalesce(promo_flash,0)) as gross
    from public.channel_settlement_order
    where account_id = p_account
      and (p_from is null or order_date >= p_from::date)
      and (p_to  is null or order_date <  p_to::date)
      and (p_location is null or location_id = p_location)
    group by brand_id
  ),
  bybrand as (
    select w.brand, w.brand_id,
      round(sum(coalesce(w.venta,0))) as venta,
      round(sum(coalesce(w.food,0))) as food,
      round(sum(coalesce(w.venta,0) * coalesce(w.rate,0)/100.0)) as comision,
      round(100.0*sum(coalesce(w.venta,0) * coalesce(w.rate,0)/100.0)/nullif(sum(w.venta),0),1) as comision_pct,
      round(100.0*sum(w.food)/nullif(sum(w.venta),0),1) as food_pct,
      round(100.0*sum(w.lineas_costeadas)/nullif(sum(w.lineas),0),1) as cobertura_pct,
      coalesce(max(case when p.gross > 0 then round(100.0*p.promo/p.gross,1) end),0) as promo_pct
    from withrate w
    left join promo_cte p on p.brand_id = w.brand_id
    where w.brand is not null group by w.brand, w.brand_id
    having sum(coalesce(w.venta,0)) > 0
  )
  select jsonb_build_object(
    'total', jsonb_build_object(
      'venta', round(sum(venta)), 'comision', round(sum(comision)), 'food', round(sum(food)),
      'promo', round(sum(venta*promo_pct/100.0))
    ),
    'by_brand', coalesce(jsonb_agg(jsonb_build_object(
      'brand', brand, 'venta', venta, 'comision', comision, 'comision_pct', comision_pct,
      'food', food, 'food_pct', food_pct, 'promo_pct', promo_pct, 'cobertura_pct', cobertura_pct
    ) order by venta desc), '[]'::jsonb)
  )
  from bybrand;
$$;