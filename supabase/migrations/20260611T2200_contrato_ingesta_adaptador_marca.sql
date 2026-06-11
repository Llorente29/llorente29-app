-- ============================================================
-- Migración: 20260611T2200_contrato_ingesta_adaptador_marca
-- Contrato único de ingesta — Eslabón 2 (cierre del paso 3)
-- adapt_lastapp_order copia external_brand_text (id de marca CRUDO de la
-- cabecera, escrito por la frontera) a sale_line.external_brand_id en TODAS
-- las lineas. Una venta = una marca. Aditivo: el casado no cambia.
-- Diseño: docs/folvy_contrato_ingesta_diseno.md
-- Aplicada: 2026-06-11 (Folvy Interno)
-- ============================================================

CREATE OR REPLACE FUNCTION public.adapt_lastapp_order(p_sale_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_sale        sale%ROWTYPE;
  v_acc         uuid;
  v_brand_ext   text;          -- [P3b] id de marca crudo de la cabecera
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
  v_brand_ext := nullif(v_sale.external_brand_text, '');   -- [P3b]

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
                           map_source, map_needs_review, unmapped_reason, parent_sale_line_id,
                           external_source, external_product_id, external_brand_id) -- [P3b]
    VALUES (v_acc, p_sale_id, v_elem->>'name', v_elem->>'name',
            'product', v_qty,
            COALESCE((v_elem->>'price')::numeric,0)/100.0,
            COALESCE((v_elem->>'price')::numeric,0)/100.0 * v_qty,
            v_menu,
            CASE WHEN v_menu IS NOT NULL THEN 'pos' ELSE 'unmapped' END,
            (v_menu IS NULL), v_reason, NULL,
            'lastapp', nullif(v_elem->>'organizationProductId',''), v_brand_ext) -- [P3b]
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
                               map_source, map_needs_review, parent_sale_line_id,
                               external_source, external_product_id, external_brand_id) -- [P3b]
        VALUES (v_acc, p_sale_id, v_mod->>'name', coalesce(v_mod->>'name','modifier'), 'modifier',
                COALESCE((v_mod->>'quantity')::numeric,1),
                COALESCE((v_mod->>'priceImpact')::numeric,0)/100.0,
                COALESCE((v_mod->>'priceImpact')::numeric,0)/100.0,
                v_mod_opt,
                CASE WHEN v_mod_opt IS NOT NULL THEN 'pos' ELSE 'unmapped' END,
                (v_mod_opt IS NULL), v_parent_id,
                'lastapp', nullif(v_mod->>'organizationModifierId',''), v_brand_ext); -- [P3b]
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
                               map_source, map_needs_review, unmapped_reason, parent_sale_line_id,
                               external_source, external_product_id, external_brand_id) -- [P3b]
        VALUES (v_acc, p_sale_id, v_comp->>'name', coalesce(v_comp->>'name','combo_item'), 'combo_item',
                COALESCE((v_comp->>'quantity')::numeric,1),
                0, 0, v_menu,
                CASE WHEN v_menu IS NOT NULL THEN 'pos' ELSE 'unmapped' END,
                (v_menu IS NULL), v_reason, v_parent_id,
                'lastapp', nullif(v_comp->>'organizationProductId',''), v_brand_ext) -- [P3b]
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
                                   map_source, map_needs_review, parent_sale_line_id,
                                   external_source, external_product_id, external_brand_id) -- [P3b]
            VALUES (v_acc, p_sale_id, v_mod->>'name', coalesce(v_mod->>'name','modifier'), 'modifier',
                    COALESCE((v_mod->>'quantity')::numeric,1),
                    COALESCE((v_mod->>'priceImpact')::numeric,0)/100.0,
                    COALESCE((v_mod->>'priceImpact')::numeric,0)/100.0,
                    v_mod_opt,
                    CASE WHEN v_mod_opt IS NOT NULL THEN 'pos' ELSE 'unmapped' END,
                    (v_mod_opt IS NULL), v_comp_id,
                    'lastapp', nullif(v_mod->>'organizationModifierId',''), v_brand_ext); -- [P3b]
            v_count := v_count + 1;
          END LOOP;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;
