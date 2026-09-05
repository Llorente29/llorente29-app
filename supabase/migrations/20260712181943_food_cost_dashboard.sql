create or replace function public.food_cost_dashboard(
  p_account uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_location uuid default null,
  p_brand uuid default null
) returns jsonb
language sql stable security invoker as $$
  with l as (
    select s.brand_id, b.name as brand, mi.name as dish,
           sl.quantity, sl.unit_price,
           ri.computed_cost, coalesce(ri.packaging_cost,0) as packaging,
           (ri.computed_cost is not null) as costed
    from public.sale_line sl
    join public.sale s on s.id = sl.sale_id
    left join public.menu_item mi on mi.id = sl.menu_item_id
    left join public.recipe_item ri on ri.id = mi.recipe_item_id
    left join public.brand b on b.id = s.brand_id
    where sl.account_id = p_account
      and coalesce(s.status,'') <> 'cancelled'
      and (p_from is null or s.sold_at >= p_from)
      and (p_to  is null or s.sold_at <  p_to)
      and (p_location is null or s.location_id = p_location)
      and (p_brand is null or s.brand_id = p_brand)
  )
  select jsonb_build_object(
    'salud', jsonb_build_object(
      'lineas', count(*),
      'lineas_costeadas', count(*) filter (where costed),
      'cobertura_pct', round(100.0*count(*) filter (where costed)/nullif(count(*),0),1)
    ),
    'total', jsonb_build_object(
      'ingreso', round(sum(quantity*unit_price) filter (where costed)),
      'food_cost', round(sum(quantity*computed_cost) filter (where costed)),
      'food_cost_pct', round(100.0*sum(quantity*computed_cost) filter (where costed)
                            / nullif(sum(quantity*unit_price) filter (where costed),0),1)
    ),
    'by_brand', (
      select coalesce(jsonb_agg(x order by x.ingreso desc),'[]'::jsonb) from (
        select brand,
          round(sum(quantity*unit_price) filter (where costed)) as ingreso,
          round(sum(quantity*computed_cost) filter (where costed)) as food_cost,
          round(100.0*sum(quantity*computed_cost) filter (where costed)
                / nullif(sum(quantity*unit_price) filter (where costed),0),1) as food_cost_pct,
          round(100.0*count(*) filter (where costed)/nullif(count(*),0),1) as cobertura_pct,
          (round(100.0*sum(quantity*computed_cost) filter (where costed)
                / nullif(sum(quantity*unit_price) filter (where costed),0),1) > 60
           or round(100.0*sum(quantity*computed_cost) filter (where costed)
                / nullif(sum(quantity*unit_price) filter (where costed),0),1) < 8) as sospechoso
        from l where brand is not null group by brand
      ) x
    ),
    'by_dish', (
      select coalesce(jsonb_agg(d order by d.ingreso desc),'[]'::jsonb) from (
        select dish, brand,
          round(sum(quantity)) as uds,
          round(avg(unit_price),2) as precio,
          round(avg(computed_cost),2) as food,
          round(100.0*sum(quantity*computed_cost)/nullif(sum(quantity*unit_price),0),1) as food_cost_pct,
          round(sum(quantity*unit_price)) as ingreso
        from l where costed and dish is not null group by dish, brand
        order by sum(quantity*unit_price) desc limit 30
      ) d
    )
  )
  from l;
$$;

comment on function public.food_cost_dashboard is
  'Food cost real por marca y por plato (via sale_line->menu_item->recipe_item.computed_cost), con cobertura y flag de recetas sospechosas. SECURITY INVOKER (RLS).';