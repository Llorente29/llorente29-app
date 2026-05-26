-- =====================================================================
-- FUNCIÓN: kitchen_recompute_item(p_item_id uuid) → numeric
-- Folvy Kitchen — cálculo ATÓMICO de coste de un recipe_item.
-- Calcula y guarda el coste de UN item; lee el cache de los hijos.
-- Convierte unidades (universal vía factor_to_base, o por-ingrediente vía
-- recipe_item_unit_conversion). Aplica merma bruto/neto. Honesta: si no
-- puede convertir, marca needs_review y NO inventa coste.
-- Guard de tenancy: SECURITY DEFINER salta RLS. Acepta admin de plataforma
-- (CEO) o admin/manager de la cuenta. Procesos de sistema (cron/OCR/IA):
-- pendiente de resolver al construir la propagación (sin sesión, auth.uid()
-- null, el guard los bloquearía — es correcto para uso de frontend hoy).
-- Probada en producción (Folvy Interno): cálculo (kg→g, merma, incompleto)
-- y guard (auth.uid() null en SQL Editor → bloquea, esperado).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.kitchen_recompute_item(p_item_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  v_total           numeric := 0;
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

  IF v_item.type IN ('raw', 'tool') THEN
    IF v_item.cost_strategy = 'fixed' THEN
      v_total := COALESCE(v_item.fixed_cost, 0);
    ELSE
      v_total := COALESCE(v_item.computed_cost, v_item.fixed_cost, 0);
    END IF;

    UPDATE recipe_item
      SET computed_cost = v_total, cost_updated_at = now()
      WHERE id = p_item_id;
    RETURN v_total;
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

    v_total := v_total + (v_child_cost * v_qty_in_base);
  END LOOP;

  UPDATE recipe_item
    SET computed_cost   = v_total,
        cost_updated_at = now(),
        needs_review    = CASE WHEN v_incomplete THEN true ELSE needs_review END
    WHERE id = p_item_id;

  RETURN v_total;
END;
$$;
