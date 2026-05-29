-- ════════════════════════════════════════════════════════════════════
-- 2026-05-29 — kitchen_recipe_cost_by_location
-- Gemela de kitchen_recipe_breakdown, con coste POR LOCAL.
--
-- Receta GLOBAL (recipe_line no cambia), coste POR LOCAL: el único cambio
-- frente a la función original es de dónde sale el coste de cada ingrediente:
--   1º  recipe_item_location_cost del ingrediente EN ESE LOCAL  (unit_cost)
--   2º  si no hay dato local → computed_cost global  (referencia)
--   3º  si no hay ninguno → fixed_cost → 0
--
-- Todo lo demás (recursión por niveles vía computed_cost de sub-recetas,
-- conversión de unidades, neto/bruto/merma, needs_review) es IDÉNTICO a la
-- función original, para que los números sean coherentes al céntimo.
--
-- NOTA sobre el coste por local del ingrediente: recipe_item_location_cost
-- guarda unit_cost en UNIDAD BASE del ingrediente (€/g, €/ml, €/ud), igual
-- que computed_cost, así que la conversión de unidades de la línea no cambia.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.kitchen_recipe_cost_by_location(
  p_item_id     uuid,
  p_location_id uuid
)
RETURNS TABLE(
  line_id       uuid,
  child_item_id uuid,
  child_name    text,
  quantity      numeric,
  unit_abbr     text,
  line_cost     numeric,
  cost_source   text,      -- 'location' | 'global' | 'fixed' | 'none' (trazabilidad)
  needs_review  boolean
)
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
  v_cost_source     text;
  v_loc_cost        numeric;
  v_conv            numeric;
  v_line_total      numeric;
  v_line_incomplete boolean;
BEGIN
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kitchen_recipe_cost_by_location: item % no existe', p_item_id;
  END IF;
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(v_item.account_id)) THEN
    RAISE EXCEPTION 'kitchen_recipe_cost_by_location: sin acceso al item %', p_item_id;
  END IF;
  IF v_item.type NOT IN ('recipe', 'dish') THEN
    RETURN;
  END IF;

  FOR v_line IN
    SELECT * FROM recipe_line WHERE parent_item_id = p_item_id
    ORDER BY position ASC, created_at ASC
  LOOP
    SELECT * INTO v_child           FROM recipe_item  WHERE id = v_line.child_item_id;
    SELECT * INTO v_line_unit       FROM kitchen_unit WHERE id = v_line.unit_id;
    SELECT * INTO v_child_base_unit FROM kitchen_unit WHERE id = v_child.base_unit_id;

    -- ── ÚNICO CAMBIO: coste del ingrediente POR LOCAL, con fallback ──
    v_loc_cost := NULL;
    SELECT unit_cost INTO v_loc_cost
      FROM recipe_item_location_cost
      WHERE recipe_item_id = v_child.id AND location_id = p_location_id
      LIMIT 1;

    IF v_loc_cost IS NOT NULL THEN
      v_child_cost  := v_loc_cost;
      v_cost_source := 'location';
    ELSIF v_child.computed_cost IS NOT NULL THEN
      v_child_cost  := v_child.computed_cost;
      v_cost_source := 'global';
    ELSIF v_child.fixed_cost IS NOT NULL THEN
      v_child_cost  := v_child.fixed_cost;
      v_cost_source := 'fixed';
    ELSE
      v_child_cost  := 0;
      v_cost_source := 'none';
    END IF;
    -- ────────────────────────────────────────────────────────────────

    v_qty := COALESCE(v_line.quantity_gross, v_line.quantity_net);
    v_line_incomplete := (v_cost_source = 'none');

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
        v_line_incomplete := true;
        v_qty_in_base := 0;
      END IF;
    END IF;

    v_line_total := v_child_cost * v_qty_in_base;

    line_id       := v_line.id;
    child_item_id := v_line.child_item_id;
    child_name    := v_child.name;
    quantity      := v_line.quantity_net;
    unit_abbr     := v_line_unit.abbreviation;
    line_cost     := v_line_total;
    cost_source   := v_cost_source;
    needs_review  := v_line_incomplete;
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$function$;
