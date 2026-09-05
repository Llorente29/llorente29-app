-- create_dish_from_unmapped: recast ACOTADO al producto, no a toda la cuenta.
--
-- PROBLEMA: al pulsar "Crear plato nuevo" la función llamaba a
-- recast_lastapp_sales(p_account_id), que hace un bucle sobre TODAS las ventas
-- lastapp de la cuenta (4.901 en Foodint) reprocesándolas una a una (recost +
-- re-consumo + triggers). Crear UN plato disparaba el reprocesamiento de toda la
-- historia → superaba el statement_timeout y provocaba contención de locks. La
-- acción hermana map_sales_product_to_dish NO recasa el pasado (arregla de hoy en
-- adelante); create_dish era la única incoherente.
--
-- ARREGLO: reprocesar SOLO las ventas que contienen este producto (146 vs 4.901,
-- 34x menos). Casa las líneas del producto igual de bien (mismo out_lineas_casadas),
-- sin tocar las demás ventas ni pelearse con el cron auto_map_exact_sales. Añadida
-- guardia statement_timeout '30s'. El resto de la lógica (crear recipe_item +
-- menu_item sellado por matrícula) NO cambia.
create or replace function public.create_dish_from_unmapped(p_account_id uuid, p_product_name text)
 returns table(out_recipe_item_id uuid, out_marcas_creadas integer, out_lineas_casadas integer)
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
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
  v_sale_id    uuid;
BEGIN
  -- Guard de tenancy.
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'create_dish_from_unmapped: sin acceso a la cuenta %', p_account_id;
  END IF;

  v_norm := regexp_replace(
              regexp_replace(btrim(lower(public.unaccent(coalesce(p_product_name, '')))), '\.$', ''),
              '\s+', ' ', 'g'
            );

  -- 1) matrícula + marca desde una línea representativa (canónico, sin product_map).
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

  IF v_matricula IS NULL THEN
    RAISE EXCEPTION 'No se pudo resolver el producto "%" (sus ventas no traen id de producto del TPV; no es casable por matrícula).', p_product_name;
  END IF;

  -- 2) nombre / precio / es_combo desde el catálogo agnóstico (opcional salvo combo).
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

  IF coalesce(v_is_combo, false) THEN
    RAISE EXCEPTION 'El producto "%" es un combo en el catálogo; su coste es la suma de sus componentes, no una receta plana. (Frente propio: combos.)', p_product_name;
  END IF;

  -- Marca: si la venta no la traía, intentar deducirla del catálogo (propias);
  -- si tampoco, EXCEPTION (anti-invención: no se crea plato sin marca).
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
    RAISE EXCEPTION 'No se pudo resolver la marca de "%". Vincula la marca externa (external_brand_map) o revisa el alias de catálogo.', p_product_name;
  END IF;

  -- 3) ¿ya existe el menu_item por matrícula? (idempotencia: seed u otra acción).
  SELECT mi.id, mi.recipe_item_id INTO v_menu_id, v_recipe_id
  FROM menu_item mi
  WHERE mi.account_id = p_account_id
    AND mi.external_source = 'lastapp'
    AND mi.external_id = v_matricula
    AND mi.brand_id = v_brand_id
    AND mi.archived_at IS NULL
  LIMIT 1;

  IF v_recipe_id IS NULL THEN
    -- Unidad base "Unidad" de la cuenta (o global). Si no hay, EXCEPTION clara.
    SELECT id INTO v_unit FROM kitchen_unit
    WHERE lower(coalesce(abbreviation, '')) = 'ud' OR lower(coalesce(name, '')) = 'unidad'
    ORDER BY (lower(coalesce(abbreviation, '')) = 'ud') DESC
    LIMIT 1;
    IF v_unit IS NULL THEN
      RAISE EXCEPTION 'No existe la unidad base "Unidad" en kitchen_unit; no se puede crear el plato.';
    END IF;

    -- Plato (dish): nace en revisión (falta escandallarlo). source='import' (entró del TPV).
    INSERT INTO recipe_item (account_id, type, name, base_unit_id, source, needs_review, is_sellable)
    VALUES (p_account_id, 'dish',
            coalesce(nullif(btrim(v_cat_name), ''), p_product_name),
            v_unit, 'import', true, true)
    RETURNING id INTO v_recipe_id;

    -- menu_item SELLADO con la matrícula → el recast lo casará.
    IF v_menu_id IS NULL THEN
      INSERT INTO menu_item (account_id, brand_id, channel_id, recipe_item_id, name, price,
                             product_type, external_source, external_id, source, needs_review)
      VALUES (p_account_id, v_brand_id, NULL, v_recipe_id,
              coalesce(nullif(btrim(v_cat_name), ''), p_product_name),
              coalesce(v_cat_price, 0)::numeric / 100.0,
              'item', 'lastapp', v_matricula, 'import', true)
      RETURNING id INTO v_menu_id;
      v_marcas := v_marcas + 1;
    ELSE
      UPDATE menu_item SET recipe_item_id = v_recipe_id WHERE id = v_menu_id;
    END IF;
  END IF;

  -- 4) Recasar SOLO las ventas de ESTE producto (no toda la cuenta). Antes se
  --    llamaba a recast_lastapp_sales(p_account_id), que reprocesaba las ~4.900
  --    ventas de la cuenta y agotaba el timeout. Las únicas ventas que pueden
  --    casar nuevas por crear este plato son las que contienen este producto.
  FOR v_sale_id IN
    SELECT DISTINCT s.id
      FROM sale s
      JOIN sale_line sl ON sl.sale_id = s.id
     WHERE s.account_id = p_account_id
       AND s.source = 'lastapp'
       AND s.raw_products IS NOT NULL
       AND coalesce(sl.line_type, 'product') = 'product'
       AND regexp_replace(
             regexp_replace(btrim(lower(public.unaccent(coalesce(sl.product_name, '')))), '\.$', ''),
             '\s+', ' ', 'g'
           ) = v_norm
  LOOP
    PERFORM public.reprocess_sale(v_sale_id);
  END LOOP;

  -- 5) Contar líneas casadas del producto.
  SELECT count(*) INTO v_casadas
  FROM sale_line sl
  JOIN sale s ON s.id = sl.sale_id
  WHERE sl.account_id = p_account_id AND s.source = 'lastapp'
    AND sl.menu_item_id IS NOT NULL
    AND regexp_replace(
          regexp_replace(btrim(lower(public.unaccent(coalesce(sl.product_name, '')))), '\.$', ''),
          '\s+', ' ', 'g'
        ) = v_norm;

  out_recipe_item_id := v_recipe_id;
  out_marcas_creadas := v_marcas;
  out_lineas_casadas := v_casadas;
  RETURN NEXT;
END;
$function$;