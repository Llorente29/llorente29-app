-- 20260629T1000_bloqueo_unidad_no_convertible_motor.sql
-- Aplicada:
--
-- Frente: BLOQUEO POR UNIDAD NO CONVERTIBLE — CAPA 1 (motor).
-- Objetivo: que el coste, el stock y el AvT dejen de mentir cuando una línea de
-- escandallo usa una unidad NO convertible a la base del ingrediente y sin fila
-- en recipe_item_unit_conversion. Hoy explode_recipe_to_raws hace
-- `IF v_qb IS NULL THEN CONTINUE` → tira la línea (y su subárbol) en silencio:
-- ni costea ni descuenta stock, y la venta se da por buena → fuga silenciosa /
-- el AvT miente por omisión.
--
-- Decisión de diseño (aprobada): BLOQUEAR, no avisar; opción "completa".
--   (A) predicado recursivo = única verdad del "no convertible" para esta pregunta
--       (reusa _qty_in_base; NO converge la matemática de coste de las 5 funciones
--        — esa convergencia queda como DEUDA DECLARADA, fuera de este frente).
--   (B) kitchen_recompute_item: escribe el estado "incompleto" en recipe_item.completeness
--       (merge namespaced, no pisa otras claves). NO se nula computed_cost
--       (lo hereda compute_sale_line_cost; nularlo rompería la cascada de venta).
--   (C) avt_period: los crudos×local que cuelgan (a cualquier profundidad) de una
--       línea no medible de un plato VENDIDO en el periodo/local se marcan
--       status='consumo_incompleto' y su merma NO entra (merma_qty/merma_eur = NULL).
--       "solo medibles suman = honestidad".
--
-- Esquema: NO se toca (cero columnas/constraints nuevos; todo se calcula al leer).
-- Las 5 funciones de conversión NO se unifican aquí (deuda con disparador).
--
-- NOTA DDL: solo CREATE OR REPLACE (idempotente). Sin BEGIN/COMMIT en el SQL Editor.
-- SECURITY DEFINER: NO probar en el SQL Editor (auth.uid() null); verificar desde la app.

-- ─────────────────────────────────────────────────────────────────────────────
-- (1) PREDICADO: ¿el ítem tiene, a cualquier profundidad, una línea no medible?
--     Reusa _qty_in_base (misma verdad que explode). Termina por el trigger
--     recipe_line_prevent_cycle (grafo acíclico).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recipe_item_has_unmeasurable_line(p_item_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item recipe_item%ROWTYPE;
  v_line recipe_line%ROWTYPE;
  v_qb   numeric;
BEGIN
  IF p_item_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- Hoja del árbol de consumo: no tiene líneas que explotar.
  IF v_item.type IN ('raw', 'tool')
     OR (v_item.type = 'recipe' AND COALESCE(v_item.is_stockable, false)) THEN
    RETURN false;
  END IF;

  FOR v_line IN
    SELECT * FROM recipe_line WHERE parent_item_id = p_item_id
  LOOP
    v_qb := public._qty_in_base(
              v_line.child_item_id,
              COALESCE(v_line.quantity_gross, v_line.quantity_net),
              v_line.unit_id);
    IF v_qb IS NULL THEN
      RETURN true;  -- esta línea no convierte -> no medible
    END IF;
    IF public.recipe_item_has_unmeasurable_line(v_line.child_item_id) THEN
      RETURN true;  -- el subárbol del hijo tiene una línea no medible
    END IF;
  END LOOP;

  RETURN false;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (2) CRUDOS BAJO LÍNEAS NO MEDIBLES: el conjunto de raws cuyo consumo queda
--     SIN CONTAR porque su línea (o una línea ancestro) no convierte. Es el
--     espejo de explode_recipe_to_raws sobre las ramas que explode SALTA.
--     Puede devolver duplicados (el llamador hace DISTINCT).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recipe_item_unmeasurable_raws(p_item_id uuid)
 RETURNS TABLE(raw_item_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item recipe_item%ROWTYPE;
  v_line recipe_line%ROWTYPE;
  v_qb   numeric;
BEGIN
  IF p_item_id IS NULL THEN RETURN; END IF;
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Hoja: no tiene líneas.
  IF v_item.type IN ('raw', 'tool')
     OR (v_item.type = 'recipe' AND COALESCE(v_item.is_stockable, false)) THEN
    RETURN;
  END IF;

  FOR v_line IN
    SELECT * FROM recipe_line WHERE parent_item_id = p_item_id
  LOOP
    v_qb := public._qty_in_base(
              v_line.child_item_id,
              COALESCE(v_line.quantity_gross, v_line.quantity_net),
              v_line.unit_id);
    IF v_qb IS NULL THEN
      -- Línea no medible: TODO el subárbol del hijo queda sin contar.
      -- (medibles que cuelgan del hijo + no-medibles más profundos)
      RETURN QUERY SELECT e.raw_item_id
        FROM public.explode_recipe_to_raws(v_line.child_item_id, 1) e;
      RETURN QUERY SELECT u.raw_item_id
        FROM public.recipe_item_unmeasurable_raws(v_line.child_item_id) u;
    ELSE
      -- Línea medible: el subárbol del hijo puede tener SUS propias no-medibles.
      RETURN QUERY SELECT u.raw_item_id
        FROM public.recipe_item_unmeasurable_raws(v_line.child_item_id) u;
    END IF;
  END LOOP;
  RETURN;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (3) kitchen_recompute_item — IDÉNTICA, con UN cambio: escribe el estado
--     "incompleto" en recipe_item.completeness (merge namespaced, no pisa otras
--     claves). computed_cost NO se nula. La detección (v_incomplete) ya existía.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kitchen_recompute_item(p_item_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item            recipe_item%ROWTYPE;
  v_line            recipe_line%ROWTYPE;
  v_child           recipe_item%ROWTYPE;
  v_line_unit       kitchen_unit%ROWTYPE;
  v_child_base_unit kitchen_unit%ROWTYPE;
  v_qty             numeric;
  v_qty_in_base     numeric;
  v_child_cost      numeric;
  v_conv            numeric;
  v_line_cost       numeric;
  v_total           numeric := 0;
  v_packaging       numeric := 0;
  v_incomplete      boolean := false;
BEGIN
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kitchen_recompute_item: item % no existe', p_item_id;
  END IF;
  -- GUARD DE TENANCY: admin de plataforma (CEO) O admin/manager de la cuenta.
  -- SECURITY DEFINER salta RLS, así que validamos acceso explícitamente.
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(v_item.account_id)) THEN
    RAISE EXCEPTION 'kitchen_recompute_item: sin acceso al item %', p_item_id;
  END IF;
  -- Raw/tool/packaging: UNA sola verdad del coste -> función dedicada
  -- (fixed / last_purchase + fallback honesto + needs_review).
  IF v_item.type IN ('raw', 'tool', 'packaging') THEN
    RETURN public.kitchen_recompute_raw_cost(p_item_id);
  END IF;
  FOR v_line IN
    SELECT * FROM recipe_line WHERE parent_item_id = p_item_id
  LOOP
    SELECT * INTO v_child           FROM recipe_item  WHERE id = v_line.child_item_id;
    SELECT * INTO v_line_unit       FROM kitchen_unit WHERE id = v_line.unit_id;
    SELECT * INTO v_child_base_unit FROM kitchen_unit WHERE id = v_child.base_unit_id;
    v_child_cost := COALESCE(v_child.computed_cost, v_child.fixed_cost, 0);
    v_qty := COALESCE(v_line.quantity_gross, v_line.quantity_net);
    IF v_line_unit.dimension = v_child_base_unit.dimension THEN
      v_qty_in_base := v_qty * v_line_unit.factor_to_base / v_child_base_unit.factor_to_base;
    ELSE
      SELECT qty_in_base INTO v_conv
        FROM recipe_item_unit_conversion
        WHERE item_id = v_child.id AND from_unit_id = v_line.unit_id
        LIMIT 1;
      IF v_conv IS NOT NULL THEN
        v_qty_in_base := v_qty * v_conv;
      ELSE
        v_incomplete := true;
        v_qty_in_base := 0;
      END IF;
    END IF;
    v_line_cost := v_child_cost * v_qty_in_base;
    v_total := v_total + v_line_cost;
    -- Desglose: solo líneas DIRECTAS de packaging (no propaga de sub-recetas).
    IF v_child.type = 'packaging' THEN
      v_packaging := v_packaging + v_line_cost;
    END IF;
  END LOOP;
  UPDATE recipe_item
    SET computed_cost   = v_total,
        packaging_cost  = v_packaging,
        cost_updated_at = now(),
        needs_review    = CASE WHEN v_incomplete THEN true ELSE needs_review END,
        -- CAMBIO: estado de completitud del coste (merge, no pisa otras claves).
        -- computed_cost queda como PARCIAL (no se nula); la ficha lo presenta como
        -- "incompleto" en vez de un número limpio mentiroso.
        completeness    = COALESCE(completeness, '{}'::jsonb)
                          || jsonb_build_object(
                               'cost_incomplete', v_incomplete,
                               'cost_incomplete_reason',
                                 CASE WHEN v_incomplete THEN 'unmeasurable_line' ELSE NULL END)
    WHERE id = p_item_id;
  RETURN v_total;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- (4) avt_period — IDÉNTICA, con DOS CTEs nuevas (sold_dishes, incomplete_raws)
--     y el status 'consumo_incompleto' + merma anulada para esos crudos×local.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.avt_period(p_account uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_location uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
with locs as (
  select id, name from locations
  where account_id = p_account and (p_location is null or id = p_location)
),
approved as (
  select ic.id as count_id, ic.location_id, ic.closed_at,
         il.recipe_item_id, il.counted_qty
  from inventory_count ic
  join inventory_count_line il on il.inventory_count_id = ic.id
  where ic.account_id = p_account
    and ic.status = 'aprobado'
    and ic.closed_at is not null
    and il.counted_qty is not null
    and (p_location is null or ic.location_id = p_location)
),
final_count as (
  select distinct on (location_id, recipe_item_id)
         location_id, recipe_item_id, counted_qty as real_final, closed_at as final_at
  from approved
  where closed_at >= p_from and closed_at < p_to
  order by location_id, recipe_item_id, closed_at desc
),
initial_count as (
  select distinct on (location_id, recipe_item_id)
         location_id, recipe_item_id, counted_qty as init_count, closed_at as init_at
  from approved
  where closed_at < p_from
  order by location_id, recipe_item_id, closed_at desc
),
opening_mv as (
  select location_id, recipe_item_id, sum(qty_base) as opening_qty
  from stock_movement
  where account_id = p_account
    and movement_type = 'apertura'
    and (p_location is null or location_id = p_location)
  group by location_id, recipe_item_id
),
buys as (
  select location_id, recipe_item_id, sum(qty_base) as buys_qty
  from stock_movement
  where account_id = p_account
    and movement_type in ('recepcion','traspaso_entrada')
    and occurred_at >= p_from and occurred_at < p_to
    and (p_location is null or location_id = p_location)
  group by location_id, recipe_item_id
),
cons as (
  select location_id, recipe_item_id, -sum(qty_base) as consumo_qty
  from stock_movement
  where account_id = p_account
    and movement_type = 'consumo'
    and occurred_at >= p_from and occurred_at < p_to
    and (p_location is null or location_id = p_location)
  group by location_id, recipe_item_id
),
-- NUEVO: platos DISTINTOS vendidos en el periodo×local (1 evaluación recursiva
-- por plato, no por línea de venta).
sold_dishes as (
  select distinct s.location_id, mi.recipe_item_id as dish_id
  from sale s
  join sale_line sl
    on sl.sale_id = s.id
   and coalesce(sl.line_type,'product') = 'product'
   and sl.menu_item_id is not null
  join menu_item mi on mi.id = sl.menu_item_id and mi.recipe_item_id is not null
  where s.account_id = p_account
    and s.is_active = true
    and s.sold_at >= p_from and s.sold_at < p_to
    and (p_location is null or s.location_id = p_location)
),
-- NUEVO: crudos×local cuyo consumo quedó SIN CONTAR (cuelgan de una línea no
-- medible de un plato vendido) -> consumo infra-contado -> AvT no fiable ahí.
incomplete_raws as (
  select distinct sd.location_id, ur.raw_item_id as recipe_item_id
  from sold_dishes sd
  cross join lateral public.recipe_item_unmeasurable_raws(sd.dish_id) ur
),
universe as (
  select fc.location_id, fc.recipe_item_id, fc.real_final, fc.final_at
  from final_count fc
),
joined as (
  select u.location_id, u.recipe_item_id, u.real_final,
         ic.init_count, om.opening_qty,
         coalesce(b.buys_qty, 0) as buys_qty,
         coalesce(c.consumo_qty, 0) as consumo_qty,
         case
           when ic.init_count is not null then ic.init_count
           when om.opening_qty is not null then om.opening_qty
           else null
         end as init_qty,
         case
           when ic.init_count is not null then 'conteo'
           when om.opening_qty is not null then 'apertura'
           else null
         end as init_source
  from universe u
  left join initial_count ic on ic.location_id = u.location_id and ic.recipe_item_id = u.recipe_item_id
  left join opening_mv om on om.location_id = u.location_id and om.recipe_item_id = u.recipe_item_id
  left join buys b on b.location_id = u.location_id and b.recipe_item_id = u.recipe_item_id
  left join cons c on c.location_id = u.location_id and c.recipe_item_id = u.recipe_item_id
),
enriched as (
  select j.*,
         ri.name as item_name,
         ri.needs_review,
         ri.family_id,
         rf.name as family_name,
         ku.abbreviation as unit_abbr,
         coalesce(rls.avg_unit_cost, ri.computed_cost, 0) as unit_cost,
         l.name as location_name,
         sa.name as area_name,
         (irc.recipe_item_id is not null) as cons_incomplete,
         case when j.init_qty is not null
              then j.init_qty + j.buys_qty - j.consumo_qty else null end as theo_final,
         case when j.init_qty is not null
              then (j.init_qty + j.buys_qty - j.consumo_qty) - j.real_final else null end as merma_qty
  from joined j
  join recipe_item ri on ri.id = j.recipe_item_id
  left join recipe_family rf on rf.id = ri.family_id
  left join kitchen_unit ku on ku.id = ri.base_unit_id
  left join recipe_item_location_stock rls
         on rls.recipe_item_id = j.recipe_item_id and rls.location_id = j.location_id and rls.account_id = p_account
  left join incomplete_raws irc
         on irc.location_id = j.location_id and irc.recipe_item_id = j.recipe_item_id
  join locs l on l.id = j.location_id
  left join lateral (
    select sa.name
    from recipe_item_storage_area risa
    join storage_area sa on sa.id = risa.storage_area_id
    where risa.recipe_item_id = j.recipe_item_id and sa.location_id = j.location_id
    order by risa.position asc nulls last
    limit 1
  ) sa on true
)
select jsonb_build_object(
  'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'recipe_item_id', e.recipe_item_id,
      'item_name', e.item_name,
      'location_id', e.location_id,
      'location_name', e.location_name,
      'area_name', e.area_name,
      'family_id', e.family_id,
      'family_name', e.family_name,
      'unit_abbr', e.unit_abbr,
      'init_qty', e.init_qty,
      'init_source', e.init_source,
      'buys_qty', e.buys_qty,
      'consumo_qty', e.consumo_qty,
      'theo_final', e.theo_final,
      'real_final', e.real_final,
      -- Si el consumo está infra-contado, NO mostramos merma (sería fantasma).
      'merma_qty', case when e.cons_incomplete then null else e.merma_qty end,
      'merma_eur', case when e.cons_incomplete or e.merma_qty is null then null
                        else round(e.merma_qty * e.unit_cost, 2) end,
      'status', case
        when e.init_qty is null then 'sin_apertura'
        when e.theo_final is not null and e.theo_final < 0 then 'dato_incompleto'
        when e.cons_incomplete then 'consumo_incompleto'
        when e.needs_review or e.unit_cost = 0 then 'escandallo_no_fiable'
        else 'medible'
      end,
      'init_estimated', (e.init_source = 'apertura')
    ) order by abs(coalesce(e.merma_qty * e.unit_cost, 0)) desc)
    from enriched e
  ), '[]'::jsonb)
);
$function$;
