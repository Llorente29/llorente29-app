-- 20260608T2800_motor_puro_frontera_unica.sql
-- Aplicada: 2026-06-08
--
-- PRINCIPIO ARQUITECTÓNICO: FRONTERA ÚNICA (autorización en la entrada, motor puro).
-- ===========================================================================
-- Toda escritura externa entra por una FRONTERA (Edge Function) que autoriza:
--   - webhook de cada TPV (Last.app, futuro Glovo/Uber/Otter) valida SU token
--   - la app valida la sesión del usuario (JWT)
--   - los procesos batch/scripts se autentican como admin
-- El MOTOR (adaptadores + cálculo) NO lleva guard de usuario: asume que quien llama
-- ya pasó por una frontera. Es trabajo puro, reutilizable por cualquier entrada.
--
-- POR QUÉ (solidez a años vista): añadir un TPV/integrador nuevo = 1 frontera (su
-- webhook con su token) + 1 adaptador (su formato → canónico). El motor NUNCA se
-- toca y NUNCA hay que volver a decidir "dónde va el guard": siempre en la frontera.
-- Es el patrón que ya usa el repo (create-account valida y delega a create_account_tx).
--
-- Este migration quita el guard de usuario de las dos funciones de motor:
--   - adapt_lastapp_order  (su frontera natural es el webhook; la app NUNCA la llama)
--   - compute_sale_line_cost (la llama el webhook y la app autenticada; cálculo de
--     coste derivado, no expone datos)
-- Las RPC que la APP invoca directo y SÍ exponen/deciden (reliability, preview) MANTIENEN
-- su guard por ahora; el norte es que migren a Edge cuando se toquen (deuda declarada,
-- no urgente). Documentado en CONTEXTO §"Principio de frontera única".
--
-- Las funciones quedan IDÉNTICAS a sus versiones canónicas vigentes (2600 / 2700),
-- solo se elimina el bloque IF NOT (current_user_is_admin...) THEN RAISE.

BEGIN;

-- ── 1) adapt_lastapp_order: motor puro (sin guard) ──
-- Idéntica a 20260608T2600 salvo el guard eliminado.
CREATE OR REPLACE FUNCTION public.adapt_lastapp_order(p_sale_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sale        sale%ROWTYPE;
  v_acc         uuid;
  v_elem        jsonb;
  v_mod         jsonb;
  v_comp        jsonb;
  v_parent_id   uuid;
  v_comp_id     uuid;
  v_is_combo    boolean;
  v_norm        text;
  v_recipe      uuid;
  v_menu        uuid;
  v_mod_opt     uuid;
  v_count       integer := 0;
  v_qty         numeric;
  v_reason      text;
BEGIN
  SELECT * INTO v_sale FROM sale WHERE id = p_sale_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_acc := v_sale.account_id;

  -- (sin guard de usuario: la autorización vive en la frontera que invoca esta función)

  IF v_sale.source <> 'lastapp' OR v_sale.raw_products IS NULL THEN RETURN 0; END IF;

  DELETE FROM sale_line
  WHERE sale_id = p_sale_id
    AND coalesce(map_source,'') <> 'manual'
    AND coalesce(unmapped_reason,'') NOT IN ('ignored','delisted');

  FOR v_elem IN SELECT * FROM jsonb_array_elements(v_sale.raw_products::jsonb)
  LOOP
    v_is_combo := (jsonb_typeof(v_elem->'comboProducts') = 'array'
                   AND jsonb_array_length(v_elem->'comboProducts') > 0);
    v_qty := COALESCE((v_elem->>'quantity')::numeric, 1);

    v_recipe := NULL; v_menu := NULL;
    IF NOT v_is_combo THEN
      SELECT lpm.recipe_item_id INTO v_recipe
      FROM lastapp_product_map lpm
      WHERE lpm.account_id = v_acc
        AND lpm.organization_product_id = nullif(v_elem->>'organizationProductId','')::uuid
      LIMIT 1;
      IF v_recipe IS NOT NULL THEN
        SELECT mi.id INTO v_menu FROM menu_item mi
        WHERE mi.account_id = v_acc AND mi.recipe_item_id = v_recipe
          AND mi.brand_id = v_sale.brand_id AND mi.archived_at IS NULL
        LIMIT 1;
      END IF;
    ELSE
      SELECT mi.id INTO v_menu FROM menu_item mi
      WHERE mi.account_id = v_acc AND mi.brand_id = v_sale.brand_id
        AND mi.archived_at IS NULL
        AND lower(public.unaccent(mi.name)) = lower(public.unaccent(coalesce(v_elem->>'name','')))
      LIMIT 1;
    END IF;

    IF v_menu IS NOT NULL THEN
      v_reason := NULL;
    ELSIF v_sale.brand_id IS NULL THEN
      v_reason := 'no_brand';
    ELSIF NOT v_is_combo AND v_recipe IS NULL THEN
      v_reason := 'no_recipe';
    ELSE
      v_reason := 'no_menu_item';
    END IF;

    INSERT INTO sale_line (account_id, sale_id, product_name, raw_text, line_type,
                           quantity, unit_price, line_total, menu_item_id,
                           map_source, map_needs_review, unmapped_reason, parent_sale_line_id)
    VALUES (v_acc, p_sale_id, v_elem->>'name', v_elem->>'name',
            'product', v_qty,
            COALESCE((v_elem->>'price')::numeric,0)/100.0,
            COALESCE((v_elem->>'price')::numeric,0)/100.0 * v_qty,
            v_menu,
            CASE WHEN v_menu IS NOT NULL THEN 'pos' ELSE 'unmapped' END,
            (v_menu IS NULL), v_reason, NULL)
    RETURNING id INTO v_parent_id;
    v_count := v_count + 1;

    IF jsonb_typeof(v_elem->'modifiers') = 'array' THEN
      FOR v_mod IN SELECT * FROM jsonb_array_elements(v_elem->'modifiers')
      LOOP
        v_mod_opt := NULL;
        IF v_menu IS NOT NULL THEN
          SELECT mo.id INTO v_mod_opt
          FROM modifier_group_assignment mga
          JOIN modifier_option mo ON mo.modifier_group_id = mga.modifier_group_id
          WHERE mga.menu_item_id = v_menu
            AND mo.external_id = (v_mod->>'organizationModifierId')
          LIMIT 1;
        END IF;
        IF v_mod_opt IS NULL THEN
          v_norm := regexp_replace(regexp_replace(btrim(lower(public.unaccent(coalesce(v_mod->>'name','')))),'\.$',''),'\s+',' ','g');
          SELECT mo.id INTO v_mod_opt FROM modifier_option mo
          WHERE mo.account_id = v_acc
            AND regexp_replace(regexp_replace(btrim(lower(public.unaccent(mo.name))),'\.$',''),'\s+',' ','g') = v_norm
          LIMIT 1;
        END IF;

        INSERT INTO sale_line (account_id, sale_id, product_name, raw_text, line_type,
                               quantity, unit_price, line_total, modifier_option_id,
                               map_source, map_needs_review, parent_sale_line_id)
        VALUES (v_acc, p_sale_id, v_mod->>'name', coalesce(v_mod->>'name','modifier'), 'modifier',
                COALESCE((v_mod->>'quantity')::numeric,1),
                COALESCE((v_mod->>'priceImpact')::numeric,0)/100.0,
                COALESCE((v_mod->>'priceImpact')::numeric,0)/100.0,
                v_mod_opt,
                CASE WHEN v_mod_opt IS NOT NULL THEN 'pos' ELSE 'unmapped' END,
                (v_mod_opt IS NULL), v_parent_id);
        v_count := v_count + 1;
      END LOOP;
    END IF;

    IF v_is_combo THEN
      FOR v_comp IN SELECT * FROM jsonb_array_elements(v_elem->'comboProducts')
      LOOP
        v_recipe := NULL; v_menu := NULL;
        SELECT lpm.recipe_item_id INTO v_recipe FROM lastapp_product_map lpm
        WHERE lpm.account_id = v_acc
          AND lpm.organization_product_id = nullif(v_comp->>'organizationProductId','')::uuid
        LIMIT 1;
        IF v_recipe IS NOT NULL THEN
          SELECT mi.id INTO v_menu FROM menu_item mi
          WHERE mi.account_id = v_acc AND mi.recipe_item_id = v_recipe
            AND mi.brand_id = v_sale.brand_id AND mi.archived_at IS NULL
          LIMIT 1;
        END IF;

        IF v_menu IS NOT NULL THEN
          v_reason := NULL;
        ELSIF v_sale.brand_id IS NULL THEN
          v_reason := 'no_brand';
        ELSIF v_recipe IS NULL THEN
          v_reason := 'no_recipe';
        ELSE
          v_reason := 'no_menu_item';
        END IF;

        INSERT INTO sale_line (account_id, sale_id, product_name, raw_text, line_type,
                               quantity, unit_price, line_total, menu_item_id,
                               map_source, map_needs_review, unmapped_reason, parent_sale_line_id)
        VALUES (v_acc, p_sale_id, v_comp->>'name', coalesce(v_comp->>'name','combo_item'), 'combo_item',
                COALESCE((v_comp->>'quantity')::numeric,1),
                0, 0, v_menu,
                CASE WHEN v_menu IS NOT NULL THEN 'pos' ELSE 'unmapped' END,
                (v_menu IS NULL), v_reason, v_parent_id)
        RETURNING id INTO v_comp_id;
        v_count := v_count + 1;

        IF jsonb_typeof(v_comp->'modifiers') = 'array' THEN
          FOR v_mod IN SELECT * FROM jsonb_array_elements(v_comp->'modifiers')
          LOOP
            v_mod_opt := NULL;
            IF v_menu IS NOT NULL THEN
              SELECT mo.id INTO v_mod_opt
              FROM modifier_group_assignment mga
              JOIN modifier_option mo ON mo.modifier_group_id = mga.modifier_group_id
              WHERE mga.menu_item_id = v_menu
                AND mo.external_id = (v_mod->>'organizationModifierId')
              LIMIT 1;
            END IF;
            IF v_mod_opt IS NULL THEN
              v_norm := regexp_replace(regexp_replace(btrim(lower(public.unaccent(coalesce(v_mod->>'name','')))),'\.$',''),'\s+',' ','g');
              SELECT mo.id INTO v_mod_opt FROM modifier_option mo
              WHERE mo.account_id = v_acc
                AND regexp_replace(regexp_replace(btrim(lower(public.unaccent(mo.name))),'\.$',''),'\s+',' ','g') = v_norm
              LIMIT 1;
            END IF;

            INSERT INTO sale_line (account_id, sale_id, product_name, raw_text, line_type,
                                   quantity, unit_price, line_total, modifier_option_id,
                                   map_source, map_needs_review, parent_sale_line_id)
            VALUES (v_acc, p_sale_id, v_mod->>'name', coalesce(v_mod->>'name','modifier'), 'modifier',
                    COALESCE((v_mod->>'quantity')::numeric,1),
                    COALESCE((v_mod->>'priceImpact')::numeric,0)/100.0,
                    COALESCE((v_mod->>'priceImpact')::numeric,0)/100.0,
                    v_mod_opt,
                    CASE WHEN v_mod_opt IS NOT NULL THEN 'pos' ELSE 'unmapped' END,
                    (v_mod_opt IS NULL), v_comp_id);
            v_count := v_count + 1;
          END LOOP;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- ── 2) compute_sale_line_cost: motor puro (sin guard) ──
-- Idéntica a 20260608T2700 (lee canónico) salvo el guard eliminado.
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

  -- (sin guard de usuario: autorización en la frontera)

  IF COALESCE(v_line.line_type, 'product') <> 'product' THEN
    RETURN v_line.computed_cost;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM sale_line c
    WHERE c.parent_sale_line_id = p_sale_line_id
      AND c.line_type = 'combo_item'
  ) INTO v_is_combo;

  IF v_is_combo THEN
    FOR v_child IN
      SELECT c.id, c.menu_item_id, c.quantity
      FROM sale_line c
      WHERE c.parent_sale_line_id = p_sale_line_id
        AND c.line_type = 'combo_item'
    LOOP
      v_comp_recipe := NULL;
      IF v_child.menu_item_id IS NOT NULL THEN
        SELECT mi.recipe_item_id INTO v_comp_recipe FROM menu_item mi WHERE mi.id = v_child.menu_item_id;
      END IF;
      IF v_comp_recipe IS NULL THEN v_incomplete := true; CONTINUE; END IF;

      SELECT COALESCE(ri.computed_cost, ri.fixed_cost) INTO v_comp_base
      FROM recipe_item ri WHERE ri.id = v_comp_recipe;
      IF v_comp_base IS NULL THEN v_incomplete := true; CONTINUE; END IF;

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
