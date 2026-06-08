-- 20260608T2300_adapt_lastapp_order.sql
-- Aplicada: 2026-06-08
--
-- ADAPTADOR Last.app → modelo canónico (capa 2 del frente multi-TPV).
-- Descompone raw_products (JSON crudo, formato Last.app) en líneas canónicas de
-- sale_line con jerarquía:
--   producto/combo (line_type='product', parent=NULL; combo se distingue por tener hijas combo_item)
--     └─ modificador  (line_type='modifier',  parent=producto, modifier_option_id)
--     └─ componente   (line_type='combo_item', parent=combo, combo via menu_item)
--          └─ modificador del componente (line_type='modifier', parent=componente)
--
-- Es el ÚNICO sitio que conoce el formato Last.app (modifiers[], comboProducts[],
-- organizationProductId, organizationModifierId). El core leerá sale_line canónico.
-- Idempotente por venta: borra y reconstruye las líneas de esa venta (respeta lo
-- humano: no borra líneas con map_source='manual' ni estados ignored/delisted).
--
-- Identidad:
--   producto/componente → organizationProductId → lastapp_product_map → recipe_item
--                          → menu_item (marca × receta)
--   modificador → por NOMBRE normalizado → modifier_option (21/24 casan; los que no,
--                 modifier_option_id NULL + needs_review para mapeo asistido)
--
-- Opción 1 de importes: cada línea lleva su propio importe (producto su price base,
-- modificador su priceImpact, componente su parte). La suma de la jerarquía = total.
-- Para combo: el padre lleva el price del combo; los componentes van con unit_price 0
-- (su precio ya está en el combo) para no duplicar el importe. El COSTE sí sale de los
-- componentes (el motor de coste suma componentes); el PRECIO es el del combo.

BEGIN;

CREATE OR REPLACE FUNCTION public.adapt_lastapp_order(p_sale_id uuid)
RETURNS integer  -- nº de líneas canónicas creadas
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
BEGIN
  SELECT * INTO v_sale FROM sale WHERE id = p_sale_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_acc := v_sale.account_id;

  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(v_acc)) THEN
    RAISE EXCEPTION 'adapt_lastapp_order: sin acceso a la cuenta %', v_acc;
  END IF;

  IF v_sale.source <> 'lastapp' OR v_sale.raw_products IS NULL THEN RETURN 0; END IF;

  -- Idempotencia: borrar líneas canónicas previas de esta venta, RESPETANDO lo humano.
  DELETE FROM sale_line
  WHERE sale_id = p_sale_id
    AND coalesce(map_source,'') <> 'manual'
    AND coalesce(unmapped_reason,'') NOT IN ('ignored','delisted');

  -- Recorrer cada elemento (producto o combo) del JSON.
  FOR v_elem IN SELECT * FROM jsonb_array_elements(v_sale.raw_products::jsonb)
  LOOP
    v_is_combo := (jsonb_typeof(v_elem->'comboProducts') = 'array'
                   AND jsonb_array_length(v_elem->'comboProducts') > 0);
    v_qty := COALESCE((v_elem->>'quantity')::numeric, 1);

    -- Resolver receta+menu del producto (no aplica a combo, que no tiene recipe propio)
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
      -- combo: intentar menu_item del combo por su catalogProductId si está mapeado
      SELECT mi.id INTO v_menu FROM menu_item mi
      WHERE mi.account_id = v_acc AND mi.brand_id = v_sale.brand_id
        AND mi.archived_at IS NULL
        AND lower(public.unaccent(mi.name)) = lower(public.unaccent(coalesce(v_elem->>'name','')))
      LIMIT 1;
    END IF;

    -- LÍNEA PADRE (producto o combo)
    INSERT INTO sale_line (account_id, sale_id, product_name, raw_text, line_type,
                           quantity, unit_price, line_total, menu_item_id,
                           map_source, map_needs_review, parent_sale_line_id)
    VALUES (v_acc, p_sale_id, v_elem->>'name', v_elem->>'name',
            'product',
            v_qty,
            COALESCE((v_elem->>'price')::numeric,0)/100.0,
            COALESCE((v_elem->>'price')::numeric,0)/100.0 * v_qty,
            v_menu,
            CASE WHEN v_menu IS NOT NULL THEN 'pos' ELSE 'unmapped' END,
            (v_menu IS NULL),
            NULL)
    RETURNING id INTO v_parent_id;
    v_count := v_count + 1;

    -- MODIFICADORES del producto (líneas hijas)
    IF jsonb_typeof(v_elem->'modifiers') = 'array' THEN
      FOR v_mod IN SELECT * FROM jsonb_array_elements(v_elem->'modifiers')
      LOOP
        -- Resolver POR ID en el contexto del articulo padre (v_menu): el external_id del
        -- modificador entre las opciones de los grupos asociados a ese menu_item.
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

    -- COMPONENTES del combo (líneas hijas) + sus modificadores (nietas)
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

        INSERT INTO sale_line (account_id, sale_id, product_name, raw_text, line_type,
                               quantity, unit_price, line_total, menu_item_id,
                               map_source, map_needs_review, parent_sale_line_id)
        VALUES (v_acc, p_sale_id, v_comp->>'name', coalesce(v_comp->>'name','combo_item'), 'combo_item',
                COALESCE((v_comp->>'quantity')::numeric,1),
                0, 0,   -- precio 0: el importe del combo está en el padre (no duplicar)
                v_menu,
                CASE WHEN v_menu IS NOT NULL THEN 'pos' ELSE 'unmapped' END,
                (v_menu IS NULL),
                v_parent_id)
        RETURNING id INTO v_comp_id;
        v_count := v_count + 1;

        -- modificadores del componente (nietas)
        IF jsonb_typeof(v_comp->'modifiers') = 'array' THEN
          FOR v_mod IN SELECT * FROM jsonb_array_elements(v_comp->'modifiers')
          LOOP
            -- Resolver POR ID en el contexto del articulo del COMPONENTE (v_menu).
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
