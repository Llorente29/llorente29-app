-- 20260629T1500_classify_resale_por_matricula.sql
-- Aplicada:
--
-- Frente: "Es reventa" bien hecho. La RPC classify_unmapped_product anclaba la
-- reventa a UNA marca (LIMIT 1) y casaba por NOMBRE → en producto compartido (misma
-- matrícula en N marcas) arreglaba 1 y dejaba N-1 roto, y el nombre fragmentaba el
-- mismo refresco en varias denominaciones.
--
-- Cambio (solo el corazón; firma intacta, las dos puertas — ficha y Excepciones —
-- siguen llamando igual): la reventa se ancla a la MATRÍCULA (sale_line.external_product_id
-- / menu_item.external_id) y opera sobre TODAS las marcas de esa matrícula:
--   1) resuelve la matrícula desde el nombre (igual que antes, para casar la llamada),
--   2) elige UN recipe_item canónico entre los menu_item de esa matrícula,
--   3) lo convierte a reventa (raw + sellable + purchasable + coste/needs_review),
--   4) REAPUNTA todos los menu_item de la matrícula al canónico,
--   5) BORRA los recipe_items que queden huérfanos (esquirlas),
--   6) recostea + recasa.
-- Una matrícula por llamada (sin fusión automática de matrículas distintas = no inventa).
-- Los menús/combos que mencionan la bebida tienen matrícula propia → quedan fuera solos.
--
-- DDL: CREATE OR REPLACE, sin BEGIN/COMMIT. SECURITY DEFINER: no probar en SQL Editor
-- (auth.uid() null → guard EXCEPTION); verificar desde la app.

CREATE OR REPLACE FUNCTION public.classify_unmapped_product(p_account_id uuid, p_product_name text, p_action text, p_unit_cost numeric DEFAULT NULL::numeric)
 RETURNS TABLE(resultado text, recipe_item_id uuid, marcas_creadas integer, lineas_casadas integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_norm       text;
  v_matricula  text;
  v_brand_id   uuid;
  v_is_combo   boolean := false;
  v_cat_name   text;
  v_cat_price  numeric;
  v_unit       uuid;
  v_recipe_id  uuid;
  v_menu_id    uuid;
  v_marcas     integer := 0;
  v_casadas    integer := 0;
  v_reapuntados integer := 0;
  v_borrados   integer := 0;
BEGIN
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'classify_unmapped_product: sin acceso a la cuenta %', p_account_id;
  END IF;
  IF p_action NOT IN ('resale','dish','combo') THEN
    RAISE EXCEPTION 'classify_unmapped_product: acción inválida %', p_action;
  END IF;

  v_norm := regexp_replace(
              regexp_replace(btrim(lower(public.unaccent(coalesce(p_product_name,'')))), '\.$', ''),
              '\s+', ' ', 'g'
            );

  -- Resolución de la MATRÍCULA + una marca de referencia desde sale_line/sale (por nombre,
  -- solo para anclar la llamada; a partir de aquí se opera por matrícula, no por nombre).
  SELECT sl.external_product_id, s.brand_id
  INTO v_matricula, v_brand_id
  FROM sale_line sl
  JOIN sale s ON s.id = sl.sale_id
  WHERE sl.account_id = p_account_id
    AND s.source = 'lastapp'
    AND coalesce(sl.line_type, 'product') = 'product'
    AND regexp_replace(
          regexp_replace(btrim(lower(public.unaccent(coalesce(sl.product_name, '')))), '\.$', ''),
          '\s+', ' ', 'g'
        ) = v_norm
  ORDER BY (sl.external_product_id IS NOT NULL) DESC, (s.brand_id IS NOT NULL) DESC
  LIMIT 1;

  -- Datos de catálogo (nombre/precio/combo) por matrícula.
  IF v_matricula IS NOT NULL THEN
    SELECT
      max(ecp.product_name) FILTER (WHERE ecp.external_channel = 'default'),
      bool_or(ecp.product_type = 'combo'),
      coalesce(
        max(ecp.price_cents) FILTER (WHERE ecp.external_channel = 'default'),
        (SELECT mode() WITHIN GROUP (ORDER BY ecp2.price_cents)
           FROM external_catalog_product ecp2
          WHERE ecp2.account_id = p_account_id
            AND ecp2.organization_product_id::text = v_matricula
            AND ecp2.price_cents IS NOT NULL)
      )
    INTO v_cat_name, v_is_combo, v_cat_price
    FROM external_catalog_product ecp
    WHERE ecp.account_id = p_account_id
      AND ecp.organization_product_id::text = v_matricula;
  END IF;

  -- ── COMBO: declarar; marcar la(s) receta(s) de la matrícula para el frente de combos. ──
  IF p_action = 'combo' THEN
    UPDATE recipe_item ri
    SET needs_review = true,
        review_notes = coalesce(review_notes,'{}'::jsonb) || jsonb_build_object('classify','combo: coste por componentes, frente propio'),
        updated_at = now()
    WHERE ri.id IN (
      SELECT DISTINCT mi.recipe_item_id FROM menu_item mi
      WHERE mi.account_id = p_account_id AND mi.external_source = 'lastapp'
        AND mi.external_id = v_matricula AND mi.recipe_item_id IS NOT NULL
    );
    SELECT mi.recipe_item_id INTO v_recipe_id FROM menu_item mi
    WHERE mi.account_id = p_account_id AND mi.external_source = 'lastapp'
      AND mi.external_id = v_matricula AND mi.recipe_item_id IS NOT NULL
    LIMIT 1;
    RETURN QUERY SELECT 'is_combo'::text, v_recipe_id, 0, 0;
    RETURN;
  END IF;

  IF coalesce(v_is_combo, false) THEN
    RAISE EXCEPTION 'El producto "%" es un combo en el catálogo; clasifícalo como combo (su coste es Σ componentes).', p_product_name;
  END IF;

  -- ── Elegir el recipe_item CANÓNICO entre los menu_item de esta matrícula. ──
  -- Preferencia: ya raw > sellable > más usado. Si no hay ninguno, queda NULL y se crea.
  IF v_matricula IS NOT NULL THEN
    SELECT mi.recipe_item_id INTO v_recipe_id
    FROM menu_item mi
    JOIN recipe_item ri ON ri.id = mi.recipe_item_id
    WHERE mi.account_id = p_account_id
      AND mi.external_source = 'lastapp'
      AND mi.external_id = v_matricula
      AND mi.archived_at IS NULL
    ORDER BY (ri.type = 'raw') DESC,
             ri.is_sellable DESC,
             (SELECT count(*) FROM menu_item m2 WHERE m2.recipe_item_id = ri.id) DESC
    LIMIT 1;
  END IF;

  -- Para 'resale' y 'dish' necesitamos receta+menu_item: resolver o CREAR (sellado).
  IF v_recipe_id IS NULL THEN
    IF v_matricula IS NULL THEN
      RAISE EXCEPTION 'No se pudo resolver el artículo de "%" (sus ventas no traen id de producto del TPV).', p_product_name;
    END IF;
    IF v_brand_id IS NULL THEN
      SELECT b.id INTO v_brand_id
      FROM external_catalog_product ecp
      JOIN brand b
        ON b.account_id = p_account_id
       AND b.is_active IS NOT FALSE
       AND upper(coalesce(b.name, '')) <> 'FOODINT'
       AND lower(public.unaccent(b.name)) = lower(public.unaccent(
             CASE WHEN ecp.external_brand_name = 'Dirty Burgers' THEN 'Dirty Burger'
                  ELSE ecp.external_brand_name END))
      WHERE ecp.account_id = p_account_id
        AND ecp.organization_product_id::text = v_matricula
        AND ecp.external_brand_name IS NOT NULL
      LIMIT 1;
    END IF;
    IF v_brand_id IS NULL THEN
      RAISE EXCEPTION 'No se pudo resolver la marca de "%". Vincula la marca externa o revisa el alias de catálogo.', p_product_name;
    END IF;

    SELECT id INTO v_unit FROM kitchen_unit
    WHERE lower(coalesce(abbreviation, '')) = 'ud' OR lower(coalesce(name, '')) = 'unidad'
    ORDER BY (lower(coalesce(abbreviation, '')) = 'ud') DESC
    LIMIT 1;
    IF v_unit IS NULL THEN
      RAISE EXCEPTION 'No existe la unidad base "Unidad" en kitchen_unit.';
    END IF;

    INSERT INTO recipe_item (account_id, type, name, base_unit_id, source, needs_review, is_sellable)
    VALUES (p_account_id, 'dish',
            coalesce(nullif(btrim(v_cat_name), ''), p_product_name),
            v_unit, 'import', true, true)
    RETURNING id INTO v_recipe_id;

    INSERT INTO menu_item (account_id, brand_id, channel_id, recipe_item_id, name, price,
                           product_type, external_source, external_id, source, needs_review)
    VALUES (p_account_id, v_brand_id, NULL, v_recipe_id,
            coalesce(nullif(btrim(v_cat_name), ''), p_product_name),
            coalesce(v_cat_price, 0)::numeric / 100.0,
            'item', 'lastapp', v_matricula, 'import', true)
    RETURNING id INTO v_menu_id;
    v_marcas := v_marcas + 1;
  END IF;

  -- ── ES UN PLATO: no se toca el tipo; el front va al editor de escandallo. ──
  IF p_action = 'dish' THEN
    PERFORM public.recast_lastapp_sales(p_account_id);
    RETURN QUERY SELECT 'is_dish'::text, v_recipe_id, v_marcas, 0;
    RETURN;
  END IF;

  -- ── ES REVENTA ──────────────────────────────────────────────────────────────
  -- 1) Convertir el canónico a raw vendible/comprable + coste.
  UPDATE recipe_item ri
  SET type = 'raw',
      is_sellable = true,
      is_purchasable = true,
      cost_strategy = CASE WHEN p_unit_cost IS NOT NULL THEN 'fixed' ELSE ri.cost_strategy END,
      fixed_cost = CASE WHEN p_unit_cost IS NOT NULL THEN p_unit_cost ELSE ri.fixed_cost END,
      needs_review = CASE WHEN p_unit_cost IS NULL AND ri.computed_cost IS NULL THEN true ELSE false END,
      updated_at = now()
  WHERE ri.id = v_recipe_id;

  -- 2) Reapuntar TODOS los menu_item de esta matrícula (todas las marcas) al canónico.
  WITH upd AS (
    UPDATE menu_item mi
    SET recipe_item_id = v_recipe_id, updated_at = now()
    WHERE mi.account_id = p_account_id
      AND mi.external_source = 'lastapp'
      AND mi.external_id = v_matricula
      AND mi.archived_at IS NULL
      AND mi.recipe_item_id IS DISTINCT FROM v_recipe_id
    RETURNING 1
  )
  SELECT count(*) INTO v_reapuntados FROM upd;

  -- 3) Borrar los recipe_items que hayan quedado huérfanos (esquirlas de esta matrícula):
  --    los que estaban enlazados antes, ya no tienen ningún menu_item, no se usan como
  --    ingrediente de otra receta y no llevan escandallo. Nunca el canónico.
  WITH del AS (
    DELETE FROM recipe_item ri
    WHERE ri.account_id = p_account_id
      AND ri.id <> v_recipe_id
      AND ri.source = 'import'
      AND NOT EXISTS (SELECT 1 FROM menu_item mi WHERE mi.recipe_item_id = ri.id)
      AND NOT EXISTS (SELECT 1 FROM recipe_line rl WHERE rl.parent_item_id = ri.id OR rl.child_item_id = ri.id)
      AND ri.id IN (
        -- candidatos: recipe_items que ANTES colgaban de algún menu_item de esta matrícula
        SELECT DISTINCT ri2.id FROM recipe_item ri2
        WHERE ri2.account_id = p_account_id
          AND ri2.id <> v_recipe_id
          AND ri2.type = 'dish'
          AND NOT EXISTS (SELECT 1 FROM menu_item mi3 WHERE mi3.recipe_item_id = ri2.id)
          AND NOT EXISTS (SELECT 1 FROM recipe_line rl3 WHERE rl3.parent_item_id = ri2.id)
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_borrados FROM del;

  -- 4) Recostear el canónico y recasar las ventas de la cuenta.
  PERFORM public.kitchen_recompute_raw_cost(v_recipe_id);
  PERFORM public.recast_lastapp_sales(p_account_id);

  -- 5) Contar líneas de venta casadas de esta matrícula (no por nombre).
  SELECT count(*) INTO v_casadas
  FROM sale_line sl
  JOIN sale s ON s.id = sl.sale_id
  WHERE sl.account_id = p_account_id AND s.source = 'lastapp'
    AND sl.external_product_id = v_matricula
    AND sl.menu_item_id IS NOT NULL;

  RETURN QUERY SELECT 'resale_linked'::text, v_recipe_id, (v_marcas + v_reapuntados), v_casadas;
END;
$function$;
