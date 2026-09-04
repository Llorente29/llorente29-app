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
                                            /nullif(sum(eur),0),1) from u),
      'ingreso_total',      (select round(sum(eur)) from u)
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
          -- ── LA BANDERA «sospechosa». UMBRAL ALTO PROVISIONAL: 40 %. ────────
          -- Estaba en 60 y NO PODIA ENCENDERSE. Se midieron 68 observaciones
          -- (17 marcas x 4 ventanas) con la metrica por unidad de venta: minimo
          -- 5,4 · mediana 21,6 · p95 31,1 · MAXIMO 33,1. Cero por encima de 60,
          -- cero por encima de 40, una por debajo de 8.
          --
          -- El 60 se fijo cuando los combos inflaban el numero al doble (Deep
          -- Pizza marcaba 78,6 % y es 32,9 %). Corregido el denominador, ninguna
          -- marca de esta casa puede acercarse: era una alarma muda.
          --
          -- 40 son SIETE PUNTOS por encima de la peor marca real: no salta por
          -- variacion normal y sigue por debajo de donde un food cost deja de
          -- ser un margen. Es un numero con padre, no uno redondo.
          --
          -- ES INTERINO, Y ESTA ES SU FECHA DE CADUCIDAD: el umbral bueno no es
          -- absoluto, es «X puntos sobre el objetivo de la cuenta». Hoy no se
          -- puede: kitchen_settings.target_food_cost_pct existe como columna
          -- pero Foodint NO TIENE FILA en kitchen_settings (frente A7). El dia
          -- que ese objetivo exista, este 40 se sustituye por el relativo y deja
          -- de envejecer solo. Quien toque esto: mirar A7 antes.
          --
          -- La rama baja se queda en 8: esa SI funciona — salto en julio con una
          -- marca al 5,4 %, que es su trabajo (avisar de que falta coste).
          (round(100.0*sum(coste)/nullif(sum(eur) filter (where costeada),0),1) > 40
           or round(100.0*sum(coste)/nullif(sum(eur) filter (where costeada),0),1) < 8) as sospechoso
        from u where brand is not null group by brand
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
        from l where costed and dish is not null and lt = 'product'
        group by dish, brand
        order by sum(quantity*unit_price) desc limit 30
      ) d
    )
  );
$function$;