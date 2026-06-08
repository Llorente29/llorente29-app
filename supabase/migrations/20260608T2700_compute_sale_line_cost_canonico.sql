-- 20260608T2700_compute_sale_line_cost_canonico.sql
-- Aplicada: 2026-06-08
--
-- Reescribe compute_sale_line_cost para leer el MODELO CANÓNICO (jerarquía sale_line),
-- NO raw_products. Cierra la otra mitad de la deuda del modelo canónico: el casado y
-- el coste ahora leen la MISMA verdad (canónico), agnóstica del TPV.
--
-- ANTES (acoplado a Last.app): buscaba el elemento en raw_products POR NOMBRE (frágil),
-- re-parseaba comboProducts/modifiers del JSON, re-resolvía vía lastapp_product_map y
-- external_id. Duplicaba la identidad que el adaptador ya había resuelto.
--
-- AHORA (canónico, agnóstico): el adaptador ya pobló las hijas (line_type modifier /
-- combo_item con parent_sale_line_id, modifier_option_id, menu_item_id resueltos). El
-- coste solo RECORRE esa jerarquía:
--   producto (line_type='product') = escandallo base
--        + Σ impactos CONFIRMADOS de sus hijas line_type='modifier' (vía modifier_option_id)
--   combo (line_type='product' con hijas combo_item) = Σ coste de cada hija combo_item
--        (su menu_item→recipe + sus propios modificadores nietas)
--
-- El coste se calcula y se escribe en la línea PADRE (product). Las hijas no llevan
-- coste propio (se agregaría doble). Si le pasan una hija, no calcula (su coste vive
-- en el padre) → devuelve su computed_cost actual sin tocar.
--
-- Mantiene: _impact_cost (conversión idéntica a kitchen_recompute), filtro
-- status='confirmed' (propuesta IA no toca coste), anti-invención (NULL si falta
-- cualquier coste, no inventa). Cero raw_products, cero lastapp_*.
--
-- SECURITY DEFINER + guard. No probar en SQL Editor; verificar desde script autenticado.

BEGIN;

CREATE OR REPLACE FUNCTION public.compute_sale_line_cost(p_sale_line_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_line        sale_line%ROWTYPE;
  v_account_id  uuid;
  v_mi          menu_item%ROWTYPE;
  v_base_cost   numeric;
  v_mod_total   numeric := 0;
  v_total       numeric;
  v_is_combo    boolean := false;
  v_combo_total numeric := 0;
  v_incomplete  boolean := false;
  v_child       record;
  v_impact      record;
  v_comp_base   numeric;
  v_comp_mod    numeric;
  v_comp_recipe uuid;
BEGIN
  SELECT * INTO v_line FROM sale_line WHERE id = p_sale_line_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_account_id := v_line.account_id;

  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(v_account_id)) THEN
    RAISE EXCEPTION 'compute_sale_line_cost: sin acceso a la cuenta %', v_account_id;
  END IF;

  -- El coste se calcula en la línea PADRE (product). Las hijas (modifier/combo_item)
  -- no llevan coste propio: su impacto se agrega en el padre. Si le pasan una hija,
  -- no se toca (evita doble conteo).
  IF COALESCE(v_line.line_type, 'product') <> 'product' THEN
    RETURN v_line.computed_cost;
  END IF;

  -- ¿Es combo? En el canónico, un combo es un 'product' con hijas 'combo_item'.
  SELECT EXISTS (
    SELECT 1 FROM sale_line c
    WHERE c.parent_sale_line_id = p_sale_line_id
      AND c.line_type = 'combo_item'
  ) INTO v_is_combo;

  -- ── COMBO: coste = Σ de sus componentes (cada uno con su receta + sus modificadores) ──
  IF v_is_combo THEN
    FOR v_child IN
      SELECT c.id, c.menu_item_id, c.quantity
      FROM sale_line c
      WHERE c.parent_sale_line_id = p_sale_line_id
        AND c.line_type = 'combo_item'
    LOOP
      -- receta del componente (vía su menu_item)
      v_comp_recipe := NULL;
      IF v_child.menu_item_id IS NOT NULL THEN
        SELECT mi.recipe_item_id INTO v_comp_recipe FROM menu_item mi WHERE mi.id = v_child.menu_item_id;
      END IF;
      IF v_comp_recipe IS NULL THEN v_incomplete := true; CONTINUE; END IF;

      SELECT COALESCE(ri.computed_cost, ri.fixed_cost) INTO v_comp_base
      FROM recipe_item ri WHERE ri.id = v_comp_recipe;
      IF v_comp_base IS NULL THEN v_incomplete := true; CONTINUE; END IF;

      -- modificadores del componente (nietas: hijas modifier del combo_item)
      v_comp_mod := 0;
      FOR v_impact IN
        SELECT mri.impact_type, mri.target_recipe_item_id, mri.quantity, mri.unit_id,
               COALESCE(gm.quantity, 1) AS mod_qty
        FROM sale_line gm
        JOIN modifier_recipe_impact mri ON mri.modifier_option_id = gm.modifier_option_id
        WHERE gm.parent_sale_line_id = v_child.id
          AND gm.line_type = 'modifier'
          AND mri.status = 'confirmed'
      LOOP
        IF v_impact.impact_type IN ('add_item','bundle','replace_item') THEN
          v_comp_mod := v_comp_mod + public._impact_cost(v_impact.target_recipe_item_id, v_impact.quantity * v_impact.mod_qty, v_impact.unit_id);
        ELSIF v_impact.impact_type = 'remove_item' THEN
          v_comp_mod := v_comp_mod - public._impact_cost(v_impact.target_recipe_item_id, v_impact.quantity * v_impact.mod_qty, v_impact.unit_id);
        ELSIF v_impact.impact_type = 'multiply' THEN
          v_comp_mod := v_comp_mod + v_comp_base * (COALESCE(v_impact.quantity,1) - 1);
        END IF;
      END LOOP;

      v_combo_total := v_combo_total + (v_comp_base + v_comp_mod) * COALESCE(v_child.quantity, 1);
    END LOOP;

    IF v_incomplete THEN
      UPDATE sale_line SET computed_cost = NULL, cost_computed_at = now() WHERE id = p_sale_line_id;
      RETURN NULL;
    END IF;
    v_total := ROUND(v_combo_total * COALESCE(v_line.quantity, 1), 6);
    UPDATE sale_line SET computed_cost = v_total, cost_computed_at = now() WHERE id = p_sale_line_id;
    RETURN v_total;
  END IF;

  -- ── PRODUCTO SIMPLE: escandallo base + Σ impactos de sus hijas modifier ──
  IF v_line.menu_item_id IS NULL THEN
    UPDATE sale_line SET computed_cost = NULL, cost_computed_at = now() WHERE id = p_sale_line_id;
    RETURN NULL;
  END IF;
  SELECT * INTO v_mi FROM menu_item WHERE id = v_line.menu_item_id;
  IF v_mi.recipe_item_id IS NULL THEN
    UPDATE sale_line SET computed_cost = NULL, cost_computed_at = now() WHERE id = p_sale_line_id;
    RETURN NULL;
  END IF;

  SELECT COALESCE(ri.computed_cost, ri.fixed_cost) INTO v_base_cost
  FROM recipe_item ri WHERE ri.id = v_mi.recipe_item_id;
  IF v_base_cost IS NULL THEN
    UPDATE sale_line SET computed_cost = NULL, cost_computed_at = now() WHERE id = p_sale_line_id;
    RETURN NULL;
  END IF;

  FOR v_impact IN
    SELECT mri.impact_type, mri.target_recipe_item_id, mri.quantity, mri.unit_id,
           COALESCE(m.quantity, 1) AS mod_qty
    FROM sale_line m
    JOIN modifier_recipe_impact mri ON mri.modifier_option_id = m.modifier_option_id
    WHERE m.parent_sale_line_id = p_sale_line_id
      AND m.line_type = 'modifier'
      AND mri.status = 'confirmed'
  LOOP
    IF v_impact.impact_type IN ('add_item','bundle','replace_item') THEN
      v_mod_total := v_mod_total + public._impact_cost(v_impact.target_recipe_item_id, v_impact.quantity * v_impact.mod_qty, v_impact.unit_id);
    ELSIF v_impact.impact_type = 'remove_item' THEN
      v_mod_total := v_mod_total - public._impact_cost(v_impact.target_recipe_item_id, v_impact.quantity * v_impact.mod_qty, v_impact.unit_id);
    ELSIF v_impact.impact_type = 'multiply' THEN
      v_mod_total := v_mod_total + v_base_cost * (COALESCE(v_impact.quantity,1) - 1);
    END IF;
  END LOOP;

  v_total := ROUND((v_base_cost + v_mod_total) * COALESCE(v_line.quantity, 1), 6);
  UPDATE sale_line SET computed_cost = v_total, cost_computed_at = now() WHERE id = p_sale_line_id;
  RETURN v_total;
END;
$function$;

COMMIT;
