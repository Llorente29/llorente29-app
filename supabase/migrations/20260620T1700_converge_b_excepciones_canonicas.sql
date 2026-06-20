-- supabase/migrations/20260620T1700_converge_b_excepciones_canonicas.sql
-- ============================================================================
-- CONVERGENCIA DE INGESTA — Bloque B: las 3 funciones de EXCEPCIONES, canónicas.
-- ============================================================================
-- Reescribe classify_unmapped_product, create_dish_from_unmapped y
-- resolve_unmapped_sales para que NO dependan del modelo viejo
-- (lastapp_product_map + lastapp_catalog_product). Conserva firma y tipos de
-- retorno EXACTOS (los consume el front: salesReliabilityService +
-- SalesExceptionsPage).
--
-- RECON (verificado 20/06):
--   · El casado vivo (adapt_lastapp_order, fichero suelto v3) casa por
--     menu_item.external_source='lastapp' + external_id = matrícula
--     (organizationProductId). NO usa product_map. La marca de la venta la fija
--     resolve_sale_brand_from_map (external_brand_map) → sale.brand_id, y adapt
--     escribe la matrícula en sale_line.external_product_id.
--   · BUG latente que esto corrige: las versiones viejas de estas 3 funciones
--     creaban menu_item SIN external_source/external_id → el recast canónico NO
--     los encontraría (casa por external_id). La versión canónica SELLA
--     external_source='lastapp' + external_id = matrícula en cada menu_item que
--     crea, de modo que el recast los case.
--   · seed_catalog_canonical ya crea 1 menu_item BASE por (marca×matrícula). El
--     modelo viejo de "1 receta compartida → N menu_items por marca" queda
--     descartado → se ELIMINA el bucle de propagación multi-marca de estas
--     funciones (cada matrícula = una marca = un menu_item, como el seed).
--
-- RESOLUCIÓN CANÓNICA COMÚN (sin product_map, sin catálogo para la marca):
--   1) matrícula y marca: de una línea representativa del producto en sale_line
--      (external_product_id) + su venta (sale.brand_id). Ya son canónicas.
--   2) nombre / precio / es_combo: de external_catalog_product por
--      organization_product_id = matrícula (precio = external_channel='default'
--      o moda de respaldo; igual ancla que el seed). El catálogo es OPCIONAL
--      para nombre/precio; la marca NO depende de él (eso arreglaba las cedidas).
--   3) receta existente: menu_item(external_source='lastapp', external_id=matrícula)
--      → recipe_item_id. Si no existe, se crea (recipe + menu_item sellado).
--
-- Anti-invención: EXCEPTION si no hay matrícula, si no resuelve marca, o si el
-- producto es un combo en el catálogo (su coste es Σ componentes, frente propio).
--
-- SECURITY DEFINER + guard de tenancy. Postgres 17.6. Idempotente (CREATE OR
-- REPLACE: las 3 conservan su tipo de retorno). Sin BEGIN/COMMIT. Sin SELECT de
-- prueba dentro. NO probar en SQL Editor (auth.uid() null revienta el guard):
-- verificar DESDE LA APP con sesión.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 1) create_dish_from_unmapped — crear PLATO nuevo del TPV (canónico)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_dish_from_unmapped(
  p_account_id   uuid,
  p_product_name text
)
RETURNS TABLE(
  out_recipe_item_id  uuid,
  out_marcas_creadas  integer,
  out_lineas_casadas  integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
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

  -- 4) Recasar por el canónico → las líneas del producto casan.
  PERFORM public.recast_lastapp_sales(p_account_id);

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

COMMENT ON FUNCTION public.create_dish_from_unmapped(uuid, text) IS
  'Crea un plato nuevo del TPV (no_recipe/no_menu_item) en el modelo canónico: resuelve matrícula+marca de sale_line/sale, crea recipe(dish)+menu_item SELLADO con external_source=lastapp+external_id=matrícula, y recasa. Sin product_map. Anti-invención: EXCEPTION si no hay matrícula, marca o si es combo.';


-- ════════════════════════════════════════════════════════════════════════════
-- 2) classify_unmapped_product — clasificar reventa / plato / combo (canónico)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.classify_unmapped_product(
  p_account_id   uuid,
  p_product_name text,
  p_action       text,             -- 'resale' | 'dish' | 'combo'
  p_unit_cost    numeric DEFAULT NULL
)
RETURNS TABLE(
  resultado        text,    -- 'resale_linked' | 'is_dish' | 'is_combo'
  recipe_item_id   uuid,
  marcas_creadas   integer,
  lineas_casadas   integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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

  -- Resolución canónica (matrícula + marca) desde sale_line/sale.
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

  -- ¿menu_item ya existente por matrícula? (productos ya casados — CostlessRow — o seed).
  IF v_matricula IS NOT NULL THEN
    SELECT mi.id, mi.recipe_item_id INTO v_menu_id, v_recipe_id
    FROM menu_item mi
    WHERE mi.account_id = p_account_id
      AND mi.external_source = 'lastapp'
      AND mi.external_id = v_matricula
      AND (v_brand_id IS NULL OR mi.brand_id = v_brand_id)
      AND mi.archived_at IS NULL
    ORDER BY (mi.brand_id = v_brand_id) DESC NULLS LAST
    LIMIT 1;
  END IF;

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

  -- ── COMBO: declarar; marcar la receta (si existe) para el frente de combos. ──
  IF p_action = 'combo' THEN
    IF v_recipe_id IS NOT NULL THEN
      UPDATE recipe_item
      SET needs_review = true,
          review_notes = coalesce(review_notes,'{}'::jsonb) || jsonb_build_object('classify','combo: coste por componentes, frente propio'),
          updated_at = now()
      WHERE id = v_recipe_id;
    END IF;
    RETURN QUERY SELECT 'is_combo'::text, v_recipe_id, 0, 0;
    RETURN;
  END IF;

  IF coalesce(v_is_combo, false) THEN
    RAISE EXCEPTION 'El producto "%" es un combo en el catálogo; clasifícalo como combo (su coste es Σ componentes).', p_product_name;
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

  -- ── ES REVENTA: convertir la receta a raw vendible/comprable + coste. ──
  UPDATE recipe_item ri
  SET type = 'raw',
      is_sellable = true,
      is_purchasable = true,
      cost_strategy = CASE WHEN p_unit_cost IS NOT NULL THEN 'fixed' ELSE ri.cost_strategy END,
      fixed_cost = CASE WHEN p_unit_cost IS NOT NULL THEN p_unit_cost ELSE ri.fixed_cost END,
      needs_review = CASE WHEN p_unit_cost IS NULL AND ri.computed_cost IS NULL THEN true ELSE false END,
      updated_at = now()
  WHERE ri.id = v_recipe_id;

  PERFORM public.kitchen_recompute_raw_cost(v_recipe_id);
  PERFORM public.recast_lastapp_sales(p_account_id);

  SELECT count(*) INTO v_casadas
  FROM sale_line sl
  JOIN sale s ON s.id = sl.sale_id
  WHERE sl.account_id = p_account_id AND s.source = 'lastapp'
    AND sl.menu_item_id IS NOT NULL
    AND regexp_replace(
          regexp_replace(btrim(lower(public.unaccent(coalesce(sl.product_name,'')))), '\.$', ''),
          '\s+', ' ', 'g'
        ) = v_norm;

  RETURN QUERY SELECT 'resale_linked'::text, v_recipe_id, v_marcas, v_casadas;
END;
$function$;

COMMENT ON FUNCTION public.classify_unmapped_product(uuid, text, text, numeric) IS
  'Clasifica un producto ciego (resale|dish|combo) en el modelo canónico: resuelve/crea recipe+menu_item SELLADO por matrícula (sin product_map), aplica el tipo y recasa. resale → raw vendible+coste; dish → devuelve recipe_item_id; combo → declara. Anti-invención: EXCEPTION sin matrícula/marca o si es combo (en resale/dish).';


-- ════════════════════════════════════════════════════════════════════════════
-- 3) resolve_unmapped_sales — link / ignore / delist (canónico)
-- ════════════════════════════════════════════════════════════════════════════
-- ignore/delist NO cambian respecto a la versión viva (no tocan catálogo ni
-- product_map). 'link' (legacy, hoy no cableado en el front) se canoniza:
-- resuelve/crea menu_item SELLADO por matrícula y recasa.
CREATE OR REPLACE FUNCTION public.resolve_unmapped_sales(
  p_account_id   uuid,
  p_product_name text,
  p_action       text,            -- 'link' | 'ignore' | 'delist'
  p_reason       text DEFAULT NULL,
  p_brand_id     uuid DEFAULT NULL
)
RETURNS TABLE(
  resultado          text,    -- 'linked' | 'ignored' | 'delisted'
  menu_item_id       uuid,
  recipe_item_id     uuid,
  brand_id           uuid,
  lineas_afectadas   integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_norm       text;
  v_matricula  text;
  v_brand_id   uuid;
  v_is_combo   boolean := false;
  v_cat_name   text;
  v_cat_price  numeric;
  v_unit       uuid;
  v_recipe_id  uuid;
  v_menu_item  uuid;
  v_afect      integer := 0;
BEGIN
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'resolve_unmapped_sales: sin acceso a la cuenta %', p_account_id;
  END IF;
  IF p_action NOT IN ('link','ignore','delist') THEN
    RAISE EXCEPTION 'resolve_unmapped_sales: acción inválida %', p_action;
  END IF;

  v_norm := regexp_replace(
              regexp_replace(btrim(lower(public.unaccent(coalesce(p_product_name,'')))), '\.$', ''),
              '\s+', ' ', 'g'
            );

  -- ── ignore / delist: marcar estado deliberado (sin cambios respecto a v.viva) ──
  IF p_action IN ('ignore','delist') THEN
    UPDATE sale_line sl
    SET unmapped_reason = CASE WHEN p_action = 'ignore' THEN 'ignored' ELSE 'delisted' END,
        ignore_reason = nullif(btrim(coalesce(p_reason,'')), ''),
        ignored_at = now(),
        map_needs_review = false,
        updated_at = now()
    FROM sale s
    WHERE sl.sale_id = s.id
      AND sl.account_id = p_account_id
      AND s.source = 'lastapp'
      AND sl.menu_item_id IS NULL
      AND coalesce(sl.line_type,'product') = 'product'
      AND sl.map_source <> 'manual'
      AND (p_brand_id IS NULL OR s.brand_id = p_brand_id)
      AND regexp_replace(
            regexp_replace(btrim(lower(public.unaccent(coalesce(sl.product_name,'')))), '\.$', ''),
            '\s+', ' ', 'g'
          ) = v_norm;
    GET DIAGNOSTICS v_afect = ROW_COUNT;
    RETURN QUERY SELECT
      CASE WHEN p_action='ignore' THEN 'ignored' ELSE 'delisted' END,
      NULL::uuid, NULL::uuid, p_brand_id, v_afect;
    RETURN;
  END IF;

  -- ── link (canónico): resolver/crear menu_item SELLADO por matrícula y recasar ──
  SELECT sl.external_product_id, s.brand_id
  INTO v_matricula, v_brand_id
  FROM sale_line sl
  JOIN sale s ON s.id = sl.sale_id
  WHERE sl.account_id = p_account_id
    AND s.source = 'lastapp'
    AND coalesce(sl.line_type, 'product') = 'product'
    AND (p_brand_id IS NULL OR s.brand_id = p_brand_id)
    AND regexp_replace(
          regexp_replace(btrim(lower(public.unaccent(coalesce(sl.product_name, '')))), '\.$', ''),
          '\s+', ' ', 'g'
        ) = v_norm
  ORDER BY (sl.external_product_id IS NOT NULL) DESC, (s.brand_id IS NOT NULL) DESC
  LIMIT 1;

  v_brand_id := coalesce(p_brand_id, v_brand_id);

  IF v_matricula IS NULL THEN
    RAISE EXCEPTION 'No se pudo resolver "%" por matrícula (sus ventas no traen id de producto del TPV).', p_product_name;
  END IF;

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
    RAISE EXCEPTION 'El producto "%" es un combo; su coste es Σ componentes, no una receta. (Frente propio: combos.)', p_product_name;
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
    RAISE EXCEPTION 'No se pudo resolver la marca de "%".', p_product_name;
  END IF;

  -- ¿ya existe el menu_item por matrícula? si no, crear recipe(dish)+menu_item sellado.
  SELECT mi.id, mi.recipe_item_id INTO v_menu_item, v_recipe_id
  FROM menu_item mi
  WHERE mi.account_id = p_account_id
    AND mi.external_source = 'lastapp'
    AND mi.external_id = v_matricula
    AND mi.brand_id = v_brand_id
    AND mi.archived_at IS NULL
  LIMIT 1;

  IF v_menu_item IS NULL THEN
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
    RETURNING id INTO v_menu_item;
  END IF;

  PERFORM public.recast_lastapp_sales(p_account_id);

  SELECT count(*) INTO v_afect
  FROM sale_line sl
  JOIN sale s ON s.id = sl.sale_id
  WHERE sl.account_id = p_account_id
    AND s.source = 'lastapp'
    AND sl.menu_item_id = v_menu_item
    AND regexp_replace(
          regexp_replace(btrim(lower(public.unaccent(coalesce(sl.product_name,'')))), '\.$', ''),
          '\s+', ' ', 'g'
        ) = v_norm;

  RETURN QUERY SELECT 'linked'::text, v_menu_item, v_recipe_id, v_brand_id, v_afect;
END;
$function$;

COMMENT ON FUNCTION public.resolve_unmapped_sales(uuid, text, text, text, uuid) IS
  'Resuelve un producto ciego (link|ignore|delist) en el modelo canónico. ignore/delist marcan estado (acotable a marca). link resuelve/crea menu_item SELLADO por matrícula (sin product_map) y recasa. Anti-invención: EXCEPTION sin matrícula/marca o si es combo.';
