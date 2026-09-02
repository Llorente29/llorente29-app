-- 20260902T2200_food_cost_denominador_por_unidad.sql
-- APLICADA y verificada el 02/09. Una sola firma (no hay sobrecarga: la firma
-- no cambia, solo el cuerpo — regla 2 no aplica aquí).
--
-- ── EL DIAGNÓSTICO QUE TRAÍA EL FRENTE 14 ERA EQUIVOCADO ───────────────────
-- El frente decía: «mete líneas de modificador y de combo_item en el
-- denominador; se arregla con `and coalesce(sl.line_type,'product')='product'`
-- y la cobertura sube de 71,4 % a 88 %». Se midió antes de aplicarlo y el
-- resultado fue el contrario del esperado:
--
--     food cost 27,4 %  ->  22,8 %     (BAJA 4,6 puntos)
--
-- Porque las líneas que iba a quitar NO son gratis: 1.411 de las 2.862 tienen
-- receta costeada y aportan 2.880 € de coste real contra solo 400 € de
-- ingreso. Ese `where` habría borrado 2.880 € de comida de verdad del
-- numerador. Un cambio que hace bajar el food cost es un cambio que dice que
-- el negocio va mejor de lo que va — es el error que aprueba, no el que falla.
--
-- ── EL FALLO DE VERDAD ─────────────────────────────────────────────────────
-- Un combo se parte en varias `sale_line`: una PADRE de tipo `product` y varias
-- HIJAS de tipo `combo_item`. Y el dinero y el coste no viven en la misma:
--
--   · El PRECIO va en la padre. Medido: 581 de los 605 combos vendidos en 30
--     días (13.229 €) ponen ahí el importe; solo 22 (421 €) lo ponen en las
--     hijas. Y la padre no tiene `recipe_item` — un combo no lleva escandallo
--     propio.
--   · El COSTE va en las hijas, que sí tienen receta.
--
-- La función agrupaba por LÍNEA y filtraba ambos sumatorios por `costed`. O
-- sea: metía el coste de las hijas en el numerador (tienen receta) y tiraba el
-- ingreso de la padre del denominador (no la tiene). El food cost de todos los
-- combos se dividía entre un denominador que no incluía lo que los combos
-- facturan.
--
-- ── LA CORRECCIÓN: LA UNIDAD DE VENTA ──────────────────────────────────────
-- `unidad = coalesce(parent_sale_line_id, id)`. Un producto con sus extras y
-- sus componentes es UNA cosa: la que el cliente compró y pagó junta. El
-- numerador no se toca (16.439 €, el mismo euro por euro); el denominador
-- recupera los 13.229 € que se estaban tirando.
--
-- ANTES → DESPUÉS, Foodint, 30 días:
--
--   cobertura        71,4 %   ->  95,2 %   (y 96,6 % pesada por dinero)
--   food cost        27,4 %   ->  22,3 %
--   ingreso base    59.894 €  ->  73.591 €
--   food cost €     16.432 €  ->  16.439 €   (el mismo; solo cambia el reparto)
--
-- Y por marca, que es donde más dolía — estas cifras decidían qué marca se
-- mira y cuál se cierra:
--
--   Ay Mamita Bowls           46,3 %  ->  18,9 %
--   Deep Pizza                78,6 %  ->  32,9 %   (estaba marcada «sospechosa»)
--   Chivuos                   60,4 %  ->  22,6 %   (estaba marcada «sospechosa»)
--   Koreans do it better      39,4 %  ->  23,5 %
--   Big Mike's Burger Joint   37,2 %  ->  24,1 %
--   Dos Coyotes               32,7 %  ->  26,8 %
--   Milanesa Haus             24,6 %  ->  23,8 %   (casi no vende combos)
--
-- Las marcas que salían fatal eran las que venden combos. Después del cambio
-- NO queda ninguna marcada como sospechosa: las dos banderas rojas eran
-- artefactos de este mismo fallo.
--
-- ── DÓNDE SÍ VALE EL FILTRO DE `line_type` ─────────────────────────────────
-- En `by_dish`, y solo ahí. Un componente de combo no es un plato vendido a SU
-- precio: va a 0 € con su coste puesto, y en la lista de platos aparece como
-- un plato al 0 % o al 700 %. Ahí el filtro es la corrección, no el error.
--
-- ── LO QUE SIGUE SIENDO OPTIMISTA, Y HAY QUE DECIRLO ───────────────────────
-- Las 1.187 líneas de `modifier` llevan 726 € de venta y CERO coste: ninguna
-- opción tiene receta costeada. Su ingreso entra en el denominador y su coste
-- no entra en el numerador, así que el 22,3 % se queda algo por debajo del
-- real. Son el 0,95 % de la venta; si costasen como el resto, el número subiría
-- unas tres décimas. Se dice aquí porque el día que alguien coste los
-- modificadores, el food cost subirá un poco y no será una regresión.
--
-- ── CAMBIO DE NOMBRES EN `salud` ───────────────────────────────────────────
-- `lineas`/`lineas_costeadas` pasan a `unidades`/`unidades_costeadas`, y se
-- añade `cobertura_dinero_pct`. Los nombres cambian porque el significado
-- cambia: dejar «líneas» contando otra cosa es cómo se hereda una mentira. El
-- compilador señaló los tres consumidores y los tres están actualizados.

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
