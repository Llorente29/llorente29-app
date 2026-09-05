create or replace function public.margin_by_brand(
  p_account uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_location uuid default null
) returns jsonb
language sql stable security invoker as $$
  with base as (
    select s.brand_id, b.name as brand, s.channel_id, s.location_id,
      -- base consistente: SOLO lineas con food cost conocido
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
    select *,
      public.resolve_channel_commission(p_account, channel_id, brand_id, location_id, 'platform_delivery') as rate
    from base
  ),
  bybrand as (
    select brand,
      round(sum(coalesce(venta,0))) as venta,
      round(sum(coalesce(food,0))) as food,
      round(sum(coalesce(venta,0) * coalesce(rate,0)/100.0)) as comision,
      round(100.0*sum(coalesce(venta,0) * coalesce(rate,0)/100.0)/nullif(sum(venta),0),1) as comision_pct,
      round(100.0*sum(food)/nullif(sum(venta),0),1) as food_pct,
      round(100.0*sum(lineas_costeadas)/nullif(sum(lineas),0),1) as cobertura_pct
    from withrate where brand is not null group by brand
    having sum(coalesce(venta,0)) > 0
  )
  select jsonb_build_object(
    'total', jsonb_build_object(
      'venta', round(sum(venta)), 'comision', round(sum(comision)), 'food', round(sum(food))
    ),
    'by_brand', coalesce(jsonb_agg(jsonb_build_object(
      'brand', brand, 'venta', venta, 'comision', comision, 'comision_pct', comision_pct,
      'food', food, 'food_pct', food_pct, 'cobertura_pct', cobertura_pct
    ) order by venta desc), '[]'::jsonb)
  )
  from bybrand;
$$;