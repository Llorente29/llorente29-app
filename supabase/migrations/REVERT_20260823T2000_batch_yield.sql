-- ============================================================================
-- REVERSO de 20260823T2000_batch_yield.sql
--
-- Transcrito de pg_get_functiondef() de PRODUCCIÓN el 23/08/2026, ANTES de
-- aplicar la migración. El botón de deshacer, en disco y no en un chat.
--
-- Devuelve explode_recipe_to_raws y kitchen_recompute_item a su cuerpo previo
-- (sin rendimiento de batch) y retira la función auxiliar nueva.
--
-- Las COLUMNAS (batch_yield / batch_yield_unit_id) NO se borran aquí a
-- propósito: quitarlas destruiría lo que el usuario haya tecleado. Con las
-- funciones revertidas quedan inertes — nadie las lee. Si se quisiera borrarlas
-- de verdad, va aparte y a conciencia:
--     ALTER TABLE recipe_item DROP COLUMN batch_yield,
--                             DROP COLUMN batch_yield_unit_id;
-- ============================================================================

CREATE OR REPLACE FUNCTION public.explode_recipe_to_raws(p_item_id uuid, p_multiplier numeric)
 RETURNS TABLE(raw_item_id uuid, qty_base numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item recipe_item%ROWTYPE;
  v_line recipe_line%ROWTYPE;
  v_qb   numeric;
BEGIN
  IF p_item_id IS NULL OR p_multiplier IS NULL THEN RETURN; END IF;
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Condicion de parada: hoja del arbol de consumo.
  IF v_item.type IN ('raw', 'tool')
     OR (v_item.type = 'recipe' AND COALESCE(v_item.is_stockable, false)) THEN
    raw_item_id := p_item_id;
    qty_base    := p_multiplier;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Nodo compuesto (recipe no-stockable o dish): recurrir por cada linea.
  FOR v_line IN
    SELECT * FROM recipe_line WHERE parent_item_id = p_item_id
    ORDER BY position ASC, created_at ASC
  LOOP
    v_qb := public._qty_in_base(
              v_line.child_item_id,
              COALESCE(v_line.quantity_gross, v_line.quantity_net),
              v_line.unit_id);
    IF v_qb IS NULL THEN
      CONTINUE;  -- no convertible -> 0, exactamente como el coste
    END IF;
    RETURN QUERY
      SELECT * FROM public.explode_recipe_to_raws(v_line.child_item_id, p_multiplier * v_qb);
  END LOOP;
  RETURN;
END;
$function$;

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
  IF NOT public.belongs_to_account(v_item.account_id) THEN
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

DROP FUNCTION IF EXISTS public._batch_yield_in_base(uuid);

-- Tras revertir, recostear lo que el rendimiento hubiera tocado:
--   SELECT public.kitchen_recompute_item('4868d63c-6933-440e-a9e2-0aeb3aec5d66'); -- Arroz Criollo
--   SELECT public.kitchen_recompute_item('d9c6fc3b-d37c-4d48-845e-6646c9521669'); -- Birria Beef Bowl
