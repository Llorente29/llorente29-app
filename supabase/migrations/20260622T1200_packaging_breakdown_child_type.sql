-- ============================================================================
-- Folvy — Hueco 1 (packaging), TRAMO 2: child_type en el desglose de líneas
-- kitchen_recipe_breakdown añade la columna child_type (el tipo del hijo de cada
-- línea: raw / recipe / tool / dish / packaging). Habilita en el front:
--   (1) agrupar el escandallo en secciones (Ingredientes / Sub-recetas / Packaging)
--   (2) desglosar el coste (packaging = Σ líneas packaging; food = total − packaging)
-- desde una sola fuente viva (las líneas), siempre consistente con el total.
--
-- Cambia la firma (columna nueva) -> DROP antes de CREATE.
-- SECURITY DEFINER: NO incluir SELECT que la invoque dentro de la migración.
-- ============================================================================

DROP FUNCTION IF EXISTS public.kitchen_recipe_breakdown(uuid);
CREATE OR REPLACE FUNCTION public.kitchen_recipe_breakdown(p_item_id uuid)
 RETURNS TABLE(line_id uuid, child_item_id uuid, child_name text, child_type text, quantity numeric, quantity_net numeric, unit_abbr text, line_cost numeric, needs_review boolean, child_needs_review boolean)
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
  v_line_total      numeric;
  v_line_incomplete boolean;
BEGIN
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kitchen_recipe_breakdown: item % no existe', p_item_id;
  END IF;
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(v_item.account_id)) THEN
    RAISE EXCEPTION 'kitchen_recipe_breakdown: sin acceso al item %', p_item_id;
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
    v_child_cost := COALESCE(v_child.computed_cost, v_child.fixed_cost, 0);
    v_qty := COALESCE(v_line.quantity_gross, v_line.quantity_net);
    v_line_incomplete := false;
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
    line_id            := v_line.id;
    child_item_id      := v_line.child_item_id;
    child_name         := v_child.name;
    child_type         := v_child.type;          -- NUEVO: tipo del hijo
    quantity           := v_qty;
    quantity_net       := v_line.quantity_net;
    unit_abbr          := v_line_unit.abbreviation;
    line_cost          := v_line_total;
    needs_review       := v_line_incomplete;
    child_needs_review := COALESCE(v_child.needs_review, false);
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$function$;
