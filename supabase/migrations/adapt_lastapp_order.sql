-- Reescritura de adapt_lastapp_order: casado por MATRÍCULA → menu_item, con
-- desambiguación por marca solo cuando el producto está en varias marcas.
-- La marca se DEDUCE del producto (no se exige del catálogo de la frontera).
--
-- Cambio vs versión anterior:
--   ANTES: resolvía brand_id del ticket (del catálogo, fallaba en cedidas) →
--          buscaba recipe en lastapp_product_map (incompleto) → menu_item por marca.
--   AHORA: organizationProductId → menu_item por external_id directamente.
--          1 match → casa. Varios (producto compartido) → desambigua por
--          v_sale.brand_id si lo hay; si no, deja la marca del único/primero.
--          recipe_item_id sale del propio menu_item.
--
-- El resto (combos, modificadores, consumo, idempotencia) intacto.

CREATE OR REPLACE FUNCTION public.adapt_lastapp_order(p_sale_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_sale        sale%ROWTYPE;
  v_acc         uuid;
  v_brand_ext   text;
  v_elem        jsonb;
  v_mod         jsonb;
  v_comp        jsonb;
  v_parent_id   uuid;
  v_comp_id     uuid;
  v_is_combo    boolean;
  v_norm        text;
  v_menu        uuid;
  v_menu_brand  uuid;
  v_n_match     integer;
  v_matricula   text;
  v_mod_opt     uuid;
  v_count       integer := 0;
  v_qty         numeric;
  v_reason      text;
BEGIN
  SELECT * INTO v_sale FROM sale WHERE id = p_sale_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_acc := v_sale.account_id;
  v_brand_ext := nullif(v_sale.external_brand_text, '');

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
    v_matricula := nullif(v_elem->>'organizationProductId','');

    v_menu := NULL; v_menu_brand := NULL;

    IF NOT v_is_combo THEN
      -- CASADO POR MATRÍCULA: busca menu_item(s) con esta external_id.
      IF v_matricula IS NOT NULL THEN
        SELECT count(*) INTO v_n_match
        FROM menu_item mi
        WHERE mi.account_id = v_acc
          AND mi.external_source = 'lastapp'
          AND mi.external_id = v_matricula
          AND mi.archived_at IS NULL;

        IF v_n_match = 1 THEN
          -- Único menu_item con esa matrícula: casa directo (marca deducida).
          SELECT mi.id, mi.brand_id INTO v_menu, v_menu_brand
          FROM menu_item mi
          WHERE mi.account_id = v_acc AND mi.external_source = 'lastapp'
            AND mi.external_id = v_matricula AND mi.archived_at IS NULL
          LIMIT 1;
        ELSIF v_n_match > 1 THEN
          -- Producto compartido entre marcas: desambigua por la marca del ticket.
          IF v_sale.brand_id IS NOT NULL THEN
            SELECT mi.id, mi.brand_id INTO v_menu, v_menu_brand
            FROM menu_item mi
            WHERE mi.account_id = v_acc AND mi.external_source = 'lastapp'
              AND mi.external_id = v_matricula AND mi.archived_at IS NULL
              AND mi.brand_id = v_sale.brand_id
            LIMIT 1;
          END IF;
          -- Si no hay marca de ticket o no casó por marca: queda sin casar
          -- (ambiguo), no se adivina.
        END IF;
      END IF;
    ELSE
      -- Combo: casa por nombre dentro de la marca del ticket (igual que antes).
      SELECT mi.id, mi.brand_id INTO v_menu, v_menu_brand FROM menu_item mi
      WHERE mi.account_id = v_acc AND mi.brand_id = v_sale.brand_id
        AND mi.archived_at IS NULL
        AND lower(public.unaccent(mi.name)) = lower(public.unaccent(coalesce(v_elem->>'name','')))
      LIMIT 1;
    END IF;

    IF v_menu IS NOT NULL THEN
      v_reason := NULL;
    ELSIF v_matricula IS NULL AND NOT v_is_combo THEN
      v_reason := 'no_recipe';
    ELSIF v_is_combo AND v_sale.brand_id IS NULL THEN
      v_reason := 'no_brand';
    ELSE
      v_reason := 'no_menu_item';
    END IF;

    INSERT INTO sale_line (account_id, sale_id, product_name, raw_text, line_type,
                           quantity, unit_price, line_total, menu_item_id,
                           map_source, map_needs_review, unmapped_reason, parent_sale_line_id,
                           external_source, external_product_id, external_brand_id)
    VALUES (v_acc, p_sale_id, v_elem->>'name', v_elem->>'name',
            'product', v_qty,
            COALESCE((v_elem->>'price')::numeric,0)/100.0,
            COALESCE((v_elem->>'price')::numeric,0)/100.0 * v_qty,
            v_menu,
            CASE WHEN v_menu IS NOT NULL THEN 'pos' ELSE 'unmapped' END,
            (v_menu IS NULL), v_reason, NULL,
            'lastapp', v_matricula, v_brand_ext)
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
                               external_source, external_product_id, external_brand_id)
        VALUES (v_acc, p_sale_id, v_mod->>'name', coalesce(v_mod->>'name','modifier'), 'modifier',
                COALESCE((v_mod->>'quantity')::numeric,1),
                COALESCE((v_mod->>'priceImpact')::numeric,0)/100.0,
                COALESCE((v_mod->>'priceImpact')::numeric,0)/100.0,
                v_mod_opt,
                CASE WHEN v_mod_opt IS NOT NULL THEN 'pos' ELSE 'unmapped' END,
                (v_mod_opt IS NULL), v_parent_id,
                'lastapp', nullif(v_mod->>'organizationModifierId',''), v_brand_ext);
        v_count := v_count + 1;
      END LOOP;
    END IF;

    IF v_is_combo THEN
      FOR v_comp IN SELECT * FROM jsonb_array_elements(v_elem->'comboProducts')
      LOOP
        v_menu := NULL; v_menu_brand := NULL;
        v_matricula := nullif(v_comp->>'organizationProductId','');

        IF v_matricula IS NOT NULL THEN
          SELECT count(*) INTO v_n_match
          FROM menu_item mi
          WHERE mi.account_id = v_acc AND mi.external_source = 'lastapp'
            AND mi.external_id = v_matricula AND mi.archived_at IS NULL;

          IF v_n_match = 1 THEN
            SELECT mi.id, mi.brand_id INTO v_menu, v_menu_brand
            FROM menu_item mi
            WHERE mi.account_id = v_acc AND mi.external_source = 'lastapp'
              AND mi.external_id = v_matricula AND mi.archived_at IS NULL
            LIMIT 1;
          ELSIF v_n_match > 1 AND v_sale.brand_id IS NOT NULL THEN
            SELECT mi.id, mi.brand_id INTO v_menu, v_menu_brand
            FROM menu_item mi
            WHERE mi.account_id = v_acc AND mi.external_source = 'lastapp'
              AND mi.external_id = v_matricula AND mi.archived_at IS NULL
              AND mi.brand_id = v_sale.brand_id
            LIMIT 1;
          END IF;
        END IF;

        IF v_menu IS NOT NULL THEN
          v_reason := NULL;
        ELSIF v_matricula IS NULL THEN
          v_reason := 'no_recipe';
        ELSE
          v_reason := 'no_menu_item';
        END IF;

        INSERT INTO sale_line (account_id, sale_id, product_name, raw_text, line_type,
                               quantity, unit_price, line_total, menu_item_id,
                               map_source, map_needs_review, unmapped_reason, parent_sale_line_id,
                               external_source, external_product_id, external_brand_id)
        VALUES (v_acc, p_sale_id, v_comp->>'name', coalesce(v_comp->>'name','combo_item'), 'combo_item',
                COALESCE((v_comp->>'quantity')::numeric,1),
                0, 0, v_menu,
                CASE WHEN v_menu IS NOT NULL THEN 'pos' ELSE 'unmapped' END,
                (v_menu IS NULL), v_reason, v_parent_id,
                'lastapp', v_matricula, v_brand_ext)
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
                                   external_source, external_product_id, external_brand_id)
            VALUES (v_acc, p_sale_id, v_mod->>'name', coalesce(v_mod->>'name','modifier'), 'modifier',
                    COALESCE((v_mod->>'quantity')::numeric,1),
                    COALESCE((v_mod->>'priceImpact')::numeric,0)/100.0,
                    COALESCE((v_mod->>'priceImpact')::numeric,0)/100.0,
                    v_mod_opt,
                    CASE WHEN v_mod_opt IS NOT NULL THEN 'pos' ELSE 'unmapped' END,
                    (v_mod_opt IS NULL), v_comp_id,
                    'lastapp', nullif(v_mod->>'organizationModifierId',''), v_brand_ext);
            v_count := v_count + 1;
          END LOOP;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;
