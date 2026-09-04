create or replace function public.food_cost_dashboard(
  p_account uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_location uuid default null,
  p_brand uuid default null
) returns jsonb
language sql
stable
as $function$
  with l as (
    select s.brand_id, b.name as brand, mi.name as dish,
           coalesce(sl.line_type, 'product')            as lt,
           coalesce(sl.parent_sale_line_id, sl.id)      as unidad,
           sl.quantity, sl.unit_price,
           ri.computed_cost, coalesce(ri.packaging_cost,0) as packaging,
           (ri.computed_cost is not null)               as costed
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
  ),
  -- LA UNIDAD DE VENTA, no la linea: una linea de producto MAS sus hijos
  -- (combo_item y modifier). Es lo que el cliente compro y pago junto.
  u as (
    select unidad,
           max(brand) as brand,
           sum(quantity * unit_price)                          as eur,
           sum(quantity * computed_cost) filter (where costed)  as coste,
           bool_or(costed)                                     as costeada
    from l
    group by unidad
  )
  select jsonb_build_object(
    'salud', jsonb_build_object(
      'unidades',           (select count(*) from u),
      'unidades_costeadas', (select count(*) filter (where costeada) from u),
      'cobertura_pct',      (select round(100.0*count(*) filter (where costeada)
                                          /nullif(count(*),0),1) from u),
      'cobertura_dinero_pct', (select round(100.0*sum(eur) filter (where costeada)
                                            /nullif(sum(eur),0),1) from u)
    ),
    'total', (select jsonb_build_object(
        'ingreso',       round(sum(eur) filter (where costeada)),
        'food_cost',     round(sum(coste)),
        'food_cost_pct', round(100.0*sum(coste)/nullif(sum(eur) filter (where costeada),0),1)
      ) from u),
    'by_brand', (
      select coalesce(jsonb_agg(x order by x.ingreso desc),'[]'::jsonb) from (
        select brand,
          round(sum(eur) filter (where costeada))   as ingreso,
          round(sum(coste))                         as food_cost,
          round(100.0*sum(coste)/nullif(sum(eur) filter (where costeada),0),1) as food_cost_pct,
          round(100.0*count(*) filter (where costeada)/nullif(count(*),0),1)   as cobertura_pct,
          (round(100.0*sum(coste)/nullif(sum(eur) filter (where costeada),0),1) > 60
           or round(100.0*sum(coste)/nullif(sum(eur) filter (where costeada),0),1) < 8) as sospechoso
        from u where brand is not null group by brand
      ) x
    ),
    -- by_dish SI filtra a 'product': un hijo de combo no es un plato vendido a
    -- SU precio (va a 0 y el padre se lleva el dinero). Meterlo aqui pinta
    -- platos al 0 % y platos al 700 %.
    'by_dish', (
      select coalesce(jsonb_agg(d order by d.ingreso desc),'[]'::jsonb) from (
        select dish, brand,
          round(sum(quantity)) as uds,
          round(avg(unit_price),2) as precio,
          round(avg(computed_cost),2) as food,
          round(100.0*sum(quantity*computed_cost)/nullif(sum(quantity*unit_price),0),1) as food_cost_pct,
          round(sum(quantity*unit_price)) as ingreso
        from l where costed and dish is not null and lt = 'product'
        group by dish, brand
        order by sum(quantity*unit_price) desc limit 30
      ) d
    )
  );
$function$;

comment on function public.food_cost_dashboard(uuid, timestamptz, timestamptz, uuid, uuid) is
  'Food cost por UNIDAD DE VENTA (linea de producto + sus combo_item y modifier), no por linea suelta. Antes contaba el coste de los hijos del combo y descartaba el ingreso del padre por no tener receta: inflaba el food cost. Ver 20260902T2200_food_cost_denominador_por_unidad.sql.';