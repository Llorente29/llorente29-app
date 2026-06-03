-- supabase/migrations/20260603T1700_kitchen_cost_last_purchase.sql
--
-- Tramo 1 del frente "cimiento de coste real": cablear el coste de los raws
-- desde proveedor + formato de compra (coste REAL), no desde fixed_cost (andamiaje).
--
-- Único cambio vs la versión anterior: la rama de raws/tools añade el caso
-- cost_strategy = 'last_purchase' (valor YA permitido por el CHECK
-- recipe_item_cost_strategy_valid). Toda la lógica de recetas/dishes y el guard
-- de tenancy quedan IDÉNTICOS.
--
-- last_purchase: coste/unidad base = article_supplier.last_price / formato.qty_in_base
--   - usa el proveedor PREFERENTE activo con precio y formato usables;
--   - si no hay dato usable -> cae a fixed_cost y marca needs_review (honesto, nunca 0 inventado).
-- Los 162 raws actuales siguen en 'fixed' -> no se altera ningún coste hoy.
-- Invariante SUM(líneas)=computed_cost intacto (el breakdown lee computed_cost).
--
-- SECURITY DEFINER: NO testear dentro de esta transacción (auth.uid() null en
-- SQL Editor). Verificar desde la app o con un raw de prueba recalculado tras crear.

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
  v_total           numeric := 0;
  v_incomplete      boolean := false;
  v_price           numeric;
  v_fmt_base        numeric;
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
    IF v_item.cost_strategy = 'last_purchase' THEN
      -- Coste real desde el proveedor preferente activo con precio y formato usables.
      -- Preferimos is_preferred; desempate por updated_at más reciente.
      SELECT a.last_price, f.qty_in_base
        INTO v_price, v_fmt_base
        FROM article_supplier a
        JOIN recipe_item_purchase_format f
          ON f.id = a.purchase_format_id
         AND f.is_active
         AND f.qty_in_base > 0
        WHERE a.recipe_item_id = p_item_id
          AND a.is_active
          AND a.last_price IS NOT NULL
        ORDER BY a.is_preferred DESC, a.updated_at DESC
        LIMIT 1;
      IF v_price IS NOT NULL AND v_fmt_base IS NOT NULL AND v_fmt_base > 0 THEN
        v_total := v_price / v_fmt_base;            -- €/unidad base de uso
      ELSE
        v_total := COALESCE(v_item.fixed_cost, 0);  -- fallback honesto
        v_incomplete := true;                       -- sin dato de compra usable
      END IF;
    ELSIF v_item.cost_strategy = 'fixed' THEN
      v_total := COALESCE(v_item.fixed_cost, 0);
    ELSE
      v_total := COALESCE(v_item.computed_cost, v_item.fixed_cost, 0);
    END IF;
    UPDATE recipe_item
      SET computed_cost = v_total,
          cost_updated_at = now(),
          needs_review = CASE WHEN v_incomplete THEN true ELSE needs_review END
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
$function$;
