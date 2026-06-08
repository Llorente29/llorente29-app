-- 20260608T2200_sale_line_cost_combos.sql
-- Aplicada: 2026-06-08
--
-- Paso 2 del motor de coste de venta: COMBOS. "El combo es la suma de sus componentes
-- realmente elegidos, cada uno con sus modificadores" (Opción 1: coste real del JSON de
-- cada venta, no plantilla). Si el elemento del JSON trae comboProducts no vacío, el
-- coste de la línea = Σ coste de cada componente (resuelto por organizationProductId →
-- lastapp_product_map → recipe_item) + los modificadores anidados de ese componente.
-- Se ignora el escandallo del cascarón del combo (un combo no tiene escandallo propio).
--
-- Reutiliza _impact_cost (conversión idéntica al escandallo) para los modificadores.
-- Honesto: si un componente no tiene coste resoluble, ese componente aporta 0 y la línea
-- se marca incompleta (computed_cost NULL) para que la señal lo refleje, en vez de dar un
-- coste de combo falsamente bajo.

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
  v_norm        text;
  v_elem        jsonb;
  v_mod         jsonb;
  v_comp        jsonb;
  v_impact      record;
  v_total       numeric;
  v_is_combo    boolean := false;
  v_combo_total numeric := 0;
  v_comp_cost   numeric;
  v_comp_recipe uuid;
  v_comp_base   numeric;
  v_comp_mod    numeric;
  v_incomplete  boolean := false;
BEGIN
  SELECT * INTO v_line FROM sale_line WHERE id = p_sale_line_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_account_id := v_line.account_id;

  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(v_account_id)) THEN
    RAISE EXCEPTION 'compute_sale_line_cost: sin acceso a la cuenta %', v_account_id;
  END IF;

  IF v_line.menu_item_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_mi FROM menu_item WHERE id = v_line.menu_item_id;

  -- Localizar el elemento del JSON de la venta (por nombre normalizado, igual que el casado).
  v_norm := regexp_replace(
              regexp_replace(btrim(lower(public.unaccent(coalesce(v_line.product_name,'')))), '\.$', ''),
              '\s+', ' ', 'g');
  SELECT rp.elem INTO v_elem
  FROM sale s, lateral jsonb_array_elements(s.raw_products::jsonb) rp(elem)
  WHERE s.id = v_line.sale_id
    AND regexp_replace(
          regexp_replace(btrim(lower(public.unaccent(coalesce(rp.elem->>'name','')))), '\.$', ''),
          '\s+', ' ', 'g') = v_norm
  LIMIT 1;

  v_is_combo := (v_elem IS NOT NULL
                 AND jsonb_typeof(v_elem->'comboProducts') = 'array'
                 AND jsonb_array_length(v_elem->'comboProducts') > 0);

  -- ─────────────────────────── COMBO ───────────────────────────
  IF v_is_combo THEN
    FOR v_comp IN SELECT * FROM jsonb_array_elements(v_elem->'comboProducts')
    LOOP
      -- componente → recipe_item por organizationProductId
      SELECT lpm.recipe_item_id INTO v_comp_recipe
      FROM lastapp_product_map lpm
      WHERE lpm.account_id = v_account_id
        AND lpm.organization_product_id = nullif(v_comp->>'organizationProductId','')::uuid
      LIMIT 1;

      IF v_comp_recipe IS NULL THEN
        v_incomplete := true;  -- componente sin mapeo → no se puede costear el combo entero
        CONTINUE;
      END IF;

      SELECT COALESCE(ri.computed_cost, ri.fixed_cost) INTO v_comp_base
      FROM recipe_item ri WHERE ri.id = v_comp_recipe;

      IF v_comp_base IS NULL THEN
        v_incomplete := true;  -- componente sin coste → combo incompleto
        CONTINUE;
      END IF;

      -- modificadores anidados del componente
      v_comp_mod := 0;
      IF jsonb_typeof(v_comp->'modifiers') = 'array' THEN
        FOR v_mod IN SELECT * FROM jsonb_array_elements(v_comp->'modifiers')
        LOOP
          FOR v_impact IN
            SELECT mri.impact_type, mri.target_recipe_item_id, mri.quantity, mri.unit_id,
                   COALESCE((v_mod->>'quantity')::numeric, 1) AS mod_qty
            FROM modifier_option mo
            JOIN modifier_recipe_impact mri ON mri.modifier_option_id = mo.id
            WHERE mo.account_id = v_account_id
              AND mo.external_id = (v_mod->>'organizationModifierId')
          LOOP
            IF v_impact.impact_type IN ('add_item','bundle','replace_item') THEN
              v_comp_mod := v_comp_mod + public._impact_cost(v_impact.target_recipe_item_id, v_impact.quantity * v_impact.mod_qty, v_impact.unit_id);
            ELSIF v_impact.impact_type = 'remove_item' THEN
              v_comp_mod := v_comp_mod - public._impact_cost(v_impact.target_recipe_item_id, v_impact.quantity * v_impact.mod_qty, v_impact.unit_id);
            ELSIF v_impact.impact_type = 'multiply' THEN
              v_comp_mod := v_comp_mod + v_comp_base * (COALESCE(v_impact.quantity,1) - 1);
            END IF;
          END LOOP;
        END LOOP;
      END IF;

      v_comp_cost := (v_comp_base + v_comp_mod) * COALESCE((v_comp->>'quantity')::numeric, 1);
      v_combo_total := v_combo_total + v_comp_cost;
    END LOOP;

    IF v_incomplete THEN
      UPDATE sale_line SET computed_cost = NULL, cost_computed_at = now() WHERE id = p_sale_line_id;
      RETURN NULL;  -- combo con algún componente sin coste → honesto, no coste falso
    END IF;

    v_total := ROUND(v_combo_total * COALESCE(v_line.quantity, 1), 6);
    UPDATE sale_line SET computed_cost = v_total, cost_computed_at = now() WHERE id = p_sale_line_id;
    RETURN v_total;
  END IF;

  -- ─────────────────────────── PRODUCTO ───────────────────────────
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

  IF v_elem IS NOT NULL AND jsonb_typeof(v_elem->'modifiers') = 'array' THEN
    FOR v_mod IN SELECT * FROM jsonb_array_elements(v_elem->'modifiers')
    LOOP
      FOR v_impact IN
        SELECT mri.impact_type, mri.target_recipe_item_id, mri.quantity, mri.unit_id,
               COALESCE((v_mod->>'quantity')::numeric, 1) AS mod_qty
        FROM modifier_option mo
        JOIN modifier_recipe_impact mri ON mri.modifier_option_id = mo.id
        WHERE mo.account_id = v_account_id
          AND mo.external_id = (v_mod->>'organizationModifierId')
      LOOP
        IF v_impact.impact_type IN ('add_item','bundle','replace_item') THEN
          v_mod_total := v_mod_total + public._impact_cost(v_impact.target_recipe_item_id, v_impact.quantity * v_impact.mod_qty, v_impact.unit_id);
        ELSIF v_impact.impact_type = 'remove_item' THEN
          v_mod_total := v_mod_total - public._impact_cost(v_impact.target_recipe_item_id, v_impact.quantity * v_impact.mod_qty, v_impact.unit_id);
        ELSIF v_impact.impact_type = 'multiply' THEN
          v_mod_total := v_mod_total + v_base_cost * (COALESCE(v_impact.quantity,1) - 1);
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  v_total := ROUND((v_base_cost + v_mod_total) * COALESCE(v_line.quantity, 1), 6);
  UPDATE sale_line SET computed_cost = v_total, cost_computed_at = now() WHERE id = p_sale_line_id;
  RETURN v_total;
END;
$function$;

COMMIT;
