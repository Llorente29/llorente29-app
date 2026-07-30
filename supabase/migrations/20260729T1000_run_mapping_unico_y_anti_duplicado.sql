-- ============================================================================
-- Folvy · run_mapping único + anti-duplicado en create_dish_from_unmapped
-- VERSIÓN FUSIONADA / CORREGIDA — reemplaza el borrador original de este archivo.
--
-- ⚠️ POR QUÉ SE CORRIGIÓ EL BORRADOR (28/07):
--   El borrador escribía create_dish_from_unmapped contra un modelo de datos que
--   YA NO EXISTE en la BBDD: lastapp_catalog_product, lastapp_product_map y
--   sale.raw_products (JSON con organizationProductId/catalogProductId).
--   Verificado en vivo: to_regclass('lastapp_catalog_product') = NULL,
--   to_regclass('lastapp_product_map') = NULL. El modelo VIVO es
--   external_catalog_product (2.877 filas para Foodint) + sale_line.external_product_id.
--   Aplicar el borrador habría roto la función en runtime ("relation does not exist").
--   Además reintroducía recast_lastapp_sales(cuenta) → reproceso de ~4.900 ventas
--   → statement_timeout (el bug que ya se había arreglado el 28/07).
--
-- ESTA VERSIÓN CONSERVA:
--   · de Code: DROP de run_mapping(5 args) + anti-duplicado por similarity trigram
--     (>= 0.6) + p_confirm_create + las columnas de salida nuevas
--     (out_creado / out_candidato_id / out_candidato_nombre / out_similitud).
--   · del cuerpo VIVO: resolución por external_catalog_product / external_product_id
--     / menu_item.external_id.
--   · del arreglo de rendimiento 28/07: recast SOLO de las ventas del producto
--     (no de toda la cuenta) + guardia statement_timeout '30s'.
--
-- Aplicar a mano en el SQL Editor. Sin begin/commit. Idempotente.
-- (Ya aplicada en el proyecto remoto vía MCP el 28/07 como
--  'run_mapping_unico_y_anti_duplicado_MERGED'; este archivo es para que el repo
--  refleje lo que hay vivo.)
-- ============================================================================

-- A) run_mapping — retirar la versión vieja (drift, sin llamador válido). El
--    cliente ahora pasa p_target_types=['dish'] → usa el overload de 6 args.
drop function if exists public.run_mapping(uuid, text, text, integer, numeric);

-- B) create_dish_from_unmapped — anti-duplicado + firma nueva. Cambia el tipo de
--    retorno y el nº de args → DROP antes de CREATE.
drop function if exists public.create_dish_from_unmapped(uuid, text);
drop function if exists public.create_dish_from_unmapped(uuid, text, boolean);

create or replace function public.create_dish_from_unmapped(
  p_account_id     uuid,
  p_product_name   text,
  p_confirm_create boolean default false
)
returns table(
  out_recipe_item_id    uuid,
  out_marcas_creadas    integer,
  out_lineas_casadas    integer,
  out_creado            boolean,
  out_candidato_id      uuid,
  out_candidato_nombre  text,
  out_similitud         numeric
)
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
  v_candidato_id     uuid;
  v_candidato_nombre text;
  v_similitud        numeric;
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

  -- ANTI-DUPLICADO: antes de crear, ¿ya existe un plato MUY parecido? Dos
  -- matrículas del mismo plato físico (una casada, otra no) generaban un plato
  -- duplicado cada vez (caso "Korean crispy Chicken Burger KDB" vs "...Burger",
  -- 28/07; similarity 0.90). Solo se salta con p_confirm_create=true.
  IF NOT p_confirm_create THEN
    SELECT ri.id, ri.name,
           round(similarity(public.normalize_ingredient_name(ri.name), v_norm)::numeric, 2)
      INTO v_candidato_id, v_candidato_nombre, v_similitud
      FROM recipe_item ri
     WHERE ri.account_id = p_account_id
       AND ri.type = 'dish'
       AND ri.is_active = true
       AND ri.archived_at IS NULL
       AND public.normalize_ingredient_name(ri.name) % v_norm
       AND similarity(public.normalize_ingredient_name(ri.name), v_norm) >= 0.6
     ORDER BY similarity(public.normalize_ingredient_name(ri.name), v_norm) DESC
     LIMIT 1;

    IF v_candidato_id IS NOT NULL THEN
      out_recipe_item_id   := NULL;
      out_marcas_creadas   := 0;
      out_lineas_casadas   := 0;
      out_creado           := false;
      out_candidato_id     := v_candidato_id;
      out_candidato_nombre := v_candidato_nombre;
      out_similitud        := v_similitud;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- 1) matrícula + marca desde una línea representativa (modelo VIVO: external_*).
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

  -- 2) nombre / precio / es_combo desde el catálogo agnóstico.
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

  -- Marca: si la venta no la traía, deducirla del catálogo; si no, EXCEPTION.
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

  -- 3) ¿ya existe el menu_item por matrícula? (idempotencia).
  SELECT mi.id, mi.recipe_item_id INTO v_menu_id, v_recipe_id
  FROM menu_item mi
  WHERE mi.account_id = p_account_id
    AND mi.external_source = 'lastapp'
    AND mi.external_id = v_matricula
    AND mi.brand_id = v_brand_id
    AND mi.archived_at IS NULL
  LIMIT 1;

  IF v_recipe_id IS NULL THEN
    SELECT id INTO v_unit FROM kitchen_unit
    WHERE lower(coalesce(abbreviation, '')) = 'ud' OR lower(coalesce(name, '')) = 'unidad'
    ORDER BY (lower(coalesce(abbreviation, '')) = 'ud') DESC
    LIMIT 1;
    IF v_unit IS NULL THEN
      RAISE EXCEPTION 'No existe la unidad base "Unidad" en kitchen_unit; no se puede crear el plato.';
    END IF;

    INSERT INTO recipe_item (account_id, type, name, base_unit_id, source, needs_review, is_sellable)
    VALUES (p_account_id, 'dish',
            coalesce(nullif(btrim(v_cat_name), ''), p_product_name),
            v_unit, 'import', true, true)
    RETURNING id INTO v_recipe_id;

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

  -- 4) Recasar SOLO las ventas de ESTE producto (arreglo 28/07: antes recasteaba
  --    las ~4.900 de la cuenta → timeout). Las únicas que pueden casar nuevas por
  --    crear este plato son las que contienen este producto.
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

  out_recipe_item_id   := v_recipe_id;
  out_marcas_creadas   := v_marcas;
  out_lineas_casadas   := v_casadas;
  out_creado           := true;
  out_candidato_id     := NULL;
  out_candidato_nombre := NULL;
  out_similitud        := NULL;
  RETURN NEXT;
END;
$function$;

comment on function public.create_dish_from_unmapped(uuid, text, boolean) is
  'Crea un plato del TPV que no existe en Folvy (modelo external_catalog_product). Antes de crear comprueba si ya hay un plato MUY parecido (similarity >= 0.6): si lo hay y p_confirm_create=false, devuelve el candidato sin duplicar (out_creado=false). p_confirm_create=true salta el check. Recast acotado al producto (no a toda la cuenta).';

grant execute on function public.create_dish_from_unmapped(uuid, text, boolean) to authenticated;

notify pgrst, 'reload schema';
