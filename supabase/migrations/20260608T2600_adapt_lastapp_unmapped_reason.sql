-- 20260608T2600_adapt_lastapp_unmapped_reason.sql
-- Aplicada: 2026-06-08
--
-- Camino A del frente de fiabilidad: el ADAPTADOR escribe unmapped_reason.
--
-- El adaptador es el único punto que conoce el formato Last.app y resuelve la
-- identidad (recipe + menu_item). Por tanto es el único sitio que sabe POR QUÉ una
-- línea no casó. Hasta ahora marcaba 'unmapped' sin la razón → unmapped_reason NULL.
-- Ahora la CALCULA y la ESCRIBE, usando lo que ya tiene a mano (v_recipe, v_menu,
-- brand_id), con la MISMA lógica que el recast viejo pero SIN re-leer el JSON aparte:
--   brand_id IS NULL              -> 'no_brand'
--   recipe NULL                   -> 'no_recipe'   (vendido, sin escandallo mapeado)
--   recipe OK pero menu_item NULL -> 'no_menu_item'(tiene receta, falta en esa carta)
--
-- Así la razón vive en el canónico y la fiabilidad (capa 4: señal de % ciego) solo
-- la LEE — agnóstica del TPV. Otter calculará su razón en su propio adaptador y la
-- fiabilidad no se toca.
--
-- Anti-invención: combo padre no lleva recipe propio (su coste sale de componentes);
-- si el combo no resuelve menu_item, razón 'no_menu_item' (existe como combo en POS
-- pero no en carta). Modificadores no llevan unmapped_reason de casado de carta (no
-- son productos de carta); su no-casado se gestiona en el frente G3, no aquí.
--
-- Resto de la función IDÉNTICO a 20260608T2300.

BEGIN;

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
  v_reason      text;   -- razón del no-casado (Camino A): se escribe en la línea
BEGIN
  SELECT * INTO v_sale FROM sale WHERE id = p_sale_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_acc := v_sale.account_id;

  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(v_acc)) THEN
    RAISE EXCEPTION 'adapt_lastapp_order: sin acceso a la cuenta %', v_acc;
  END IF;

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

    -- Razón del no-casado (solo si no hay menu_item). Misma lógica que el recast.
    IF v_menu IS NOT NULL THEN
      v_reason := NULL;
    ELSIF v_sale.brand_id IS NULL THEN
      v_reason := 'no_brand';
    ELSIF NOT v_is_combo AND v_recipe IS NULL THEN
      v_reason := 'no_recipe';
    ELSE
      v_reason := 'no_menu_item';  -- tiene receta (o es combo) pero falta en la carta
    END IF;

    INSERT INTO sale_line (account_id, sale_id, product_name, raw_text, line_type,
                           quantity, unit_price, line_total, menu_item_id,
                           map_source, map_needs_review, unmapped_reason, parent_sale_line_id)
    VALUES (v_acc, p_sale_id, v_elem->>'name', v_elem->>'name',
            'product',
            v_qty,
            COALESCE((v_elem->>'price')::numeric,0)/100.0,
            COALESCE((v_elem->>'price')::numeric,0)/100.0 * v_qty,
            v_menu,
            CASE WHEN v_menu IS NOT NULL THEN 'pos' ELSE 'unmapped' END,
            (v_menu IS NULL),
            v_reason,
            NULL)
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
                (v_mod_opt IS NULL),
                v_parent_id);
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

        -- Razón del componente (mismo criterio).
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
                0, 0,
                v_menu,
                CASE WHEN v_menu IS NOT NULL THEN 'pos' ELSE 'unmapped' END,
                (v_menu IS NULL),
                v_reason,
                v_parent_id)
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
                    (v_mod_opt IS NULL),
                    v_comp_id);
            v_count := v_count + 1;
          END LOOP;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;

COMMIT;
