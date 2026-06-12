-- 20260612T1000_casado_por_marca_ignore_motivo.sql
-- Aplicada: PENDIENTE (propuesta por Claude Code, ejecuta y verifica Julio)
--
-- TRABAJO B — pantalla de casado de ventas POR MARCA × LOCAL.
-- Dos cosas:
--   1) MOTIVO + FECHA de lo IGNORADO. Hoy "Ignorar" pone unmapped_reason='ignored'
--      pero no guarda el porqué (gol de Folvy sobre tspoon = mostrar el motivo).
--      Se añaden sale_line.ignore_reason (texto del motivo) e ignored_at (cuándo).
--   2) IGNORAR ACOTADO A LA MARCA + DESHACER:
--      - resolve_unmapped_sales gana p_reason (motivo) y p_brand_id (acotar el
--        ignore/delist a una marca; NULL = comportamiento anterior, todas).
--        Compatible hacia atrás: los dos nuevos params son DEFAULT NULL, pero como
--        cambian la aridad se DROPea la firma vieja (3 args) y se recrea con 5.
--      - unignore_unmapped_sales: deshace el ignore (limpia el estado y recasa,
--        que recomputa la razón real de no-casado).
--
-- SECURITY DEFINER + guard de tenancy (igual que la versión previa). NO probar
-- dentro de esta transacción (auth.uid() NULL en SQL Editor revienta el guard);
-- verificar funcionalmente DESDE LA APP con sesión.

BEGIN;

-- ── 1) Columnas de motivo/fecha del ignorado ──────────────────────────────
ALTER TABLE public.sale_line ADD COLUMN IF NOT EXISTS ignore_reason text;
ALTER TABLE public.sale_line ADD COLUMN IF NOT EXISTS ignored_at   timestamptz;

COMMENT ON COLUMN public.sale_line.ignore_reason IS
  'Motivo corto (texto libre) por el que la línea se marcó como ignorada. NULL si no se ignoró.';
COMMENT ON COLUMN public.sale_line.ignored_at IS
  'Momento en que la línea se marcó como ignorada/descatalogada. NULL si no se ignoró.';

-- ── 2) resolve_unmapped_sales con motivo + scope de marca ─────────────────
-- Se elimina la firma anterior (3 args) para evitar overloads ambiguos.
DROP FUNCTION IF EXISTS public.resolve_unmapped_sales(uuid, text, text);

CREATE OR REPLACE FUNCTION public.resolve_unmapped_sales(
  p_account_id   uuid,
  p_product_name text,
  p_action       text,            -- 'link' | 'ignore' | 'delist'
  p_reason       text DEFAULT NULL,  -- motivo (solo se usa en ignore/delist)
  p_brand_id     uuid DEFAULT NULL   -- acota a una marca; NULL = todas (compat)
)
RETURNS TABLE(
  resultado          text,    -- 'linked' | 'ignored' | 'delisted'
  menu_item_id       uuid,    -- el menu_item creado/encontrado (solo 'link')
  recipe_item_id     uuid,
  brand_id           uuid,
  lineas_afectadas   integer  -- líneas de sale_line tocadas
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_norm        text;
  v_brand_id    uuid;
  v_recipe_id   uuid;
  v_cat_prod    uuid;
  v_org_prod    uuid;
  v_is_combo    boolean := false;
  v_price       numeric;
  v_name        text;
  v_menu_item   uuid;
  v_afect       integer := 0;
BEGIN
  -- Guard de tenancy.
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'resolve_unmapped_sales: sin acceso a la cuenta %', p_account_id;
  END IF;

  IF p_action NOT IN ('link','ignore','delist') THEN
    RAISE EXCEPTION 'resolve_unmapped_sales: acción inválida %', p_action;
  END IF;

  -- Nombre normalizado IGUAL que el recast (unaccent + lower + trim + sin punto final
  -- + espacios colapsados), para casar las líneas del producto.
  v_norm := regexp_replace(
              regexp_replace(btrim(lower(public.unaccent(coalesce(p_product_name,'')))), '\.$', ''),
              '\s+', ' ', 'g'
            );

  -- ── ignore / delist: marcar estado deliberado en las líneas del producto ──
  -- Si p_brand_id no es NULL, se acota a las ventas de ESA marca (imposible
  -- ignorar en otra marca por error desde la pantalla por marca×local).
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

  -- ── link: resolver marca + receta desde el JSON de las ventas del producto ──
  -- Tomamos un elemento representativo del producto en cualquier venta de la cuenta.
  SELECT
    b.id,
    lpm.recipe_item_id,
    (rp.elem->>'catalogProductId')::uuid,
    nullif(rp.elem->>'organizationProductId','')::uuid
  INTO v_brand_id, v_recipe_id, v_cat_prod, v_org_prod
  FROM sale s,
       lateral jsonb_array_elements(s.raw_products::jsonb) AS rp(elem)
  LEFT JOIN lastapp_catalog_product lcp
    ON lcp.account_id = p_account_id
   AND lcp.catalog_product_id = (rp.elem->>'catalogProductId')::uuid
  LEFT JOIN brand b
    ON b.account_id = p_account_id
   AND b.is_active is not false
   AND upper(coalesce(b.name,'')) <> 'FOODINT'
   AND lower(public.unaccent(b.name)) = lower(public.unaccent(lcp.lastapp_brand_name))
  LEFT JOIN lastapp_product_map lpm
    ON lpm.account_id = p_account_id
   AND lpm.organization_product_id = coalesce(
         nullif(rp.elem->>'organizationProductId','')::uuid,
         lcp.organization_product_id)
  WHERE s.account_id = p_account_id
    AND s.source = 'lastapp'
    AND s.raw_products IS NOT NULL
    AND (p_brand_id IS NULL OR s.brand_id = p_brand_id)
    AND regexp_replace(
          regexp_replace(btrim(lower(public.unaccent(coalesce(rp.elem->>'name','')))), '\.$', ''),
          '\s+', ' ', 'g'
        ) = v_norm
  LIMIT 1;

  IF v_brand_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo resolver la marca del producto "%". Revisa el alias de marca.', p_product_name;
  END IF;
  IF v_recipe_id IS NULL THEN
    RAISE EXCEPTION 'El producto "%" no tiene escandallo (no_recipe). Crea su escandallo antes de vincularlo.', p_product_name;
  END IF;

  -- ¿Es un combo en el catálogo? Si lo es, no se vincula a una receta plana.
  SELECT (lcp.product_type = 'combo')
  INTO v_is_combo
  FROM lastapp_catalog_product lcp
  WHERE lcp.account_id = p_account_id
    AND lcp.catalog_product_id = v_cat_prod
  LIMIT 1;

  IF coalesce(v_is_combo, false) THEN
    RAISE EXCEPTION 'El producto "%" es un combo; su coste es la suma de sus componentes, no una receta. (Frente propio: coste de combo.)', p_product_name;
  END IF;

  -- Precio y nombre del catálogo (para el menu_item nuevo).
  SELECT lcp.price_cents::numeric / 100.0, lcp.product_name
  INTO v_price, v_name
  FROM lastapp_catalog_product lcp
  WHERE lcp.account_id = p_account_id
    AND lcp.catalog_product_id = v_cat_prod
  LIMIT 1;

  -- ¿Ya existe un menu_item (brand, recipe_item) no archivado? (idempotente)
  SELECT mi.id INTO v_menu_item
  FROM menu_item mi
  WHERE mi.account_id = p_account_id
    AND mi.brand_id = v_brand_id
    AND mi.recipe_item_id = v_recipe_id
    AND mi.archived_at IS NULL
  LIMIT 1;

  IF v_menu_item IS NULL THEN
    INSERT INTO menu_item (account_id, brand_id, recipe_item_id, name, price, product_type, source, needs_review)
    VALUES (p_account_id, v_brand_id, v_recipe_id,
            coalesce(nullif(btrim(v_name),''), p_product_name),
            coalesce(v_price, 0), 'item', 'manual', false)
    RETURNING id INTO v_menu_item;
  END IF;

  -- Recasar la cuenta: ahora que existe el menu_item, las líneas del producto casan.
  PERFORM public.recast_lastapp_sales(p_account_id);

  -- Contar las líneas de este producto que han quedado casadas.
  SELECT count(*)
  INTO v_afect
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

-- ── 3) unignore_unmapped_sales: DESHACER el ignore ────────────────────────
-- Limpia el estado ignorado (vuelve a "pendiente") de las líneas del producto
-- (acotado a la marca si se pasa) y RECASA: el recast recomputa la razón real
-- de no-casado (no_recipe/no_menu_item/no_brand) para las líneas que ya no están
-- ignoradas/delisted/manual. Devuelve cuántas líneas se reabrieron.
CREATE OR REPLACE FUNCTION public.unignore_unmapped_sales(
  p_account_id   uuid,
  p_product_name text,
  p_brand_id     uuid DEFAULT NULL
)
RETURNS TABLE(
  resultado        text,    -- 'unignored'
  lineas_afectadas integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_norm  text;
  v_afect integer := 0;
BEGIN
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'unignore_unmapped_sales: sin acceso a la cuenta %', p_account_id;
  END IF;

  v_norm := regexp_replace(
              regexp_replace(btrim(lower(public.unaccent(coalesce(p_product_name,'')))), '\.$', ''),
              '\s+', ' ', 'g'
            );

  UPDATE sale_line sl
  SET unmapped_reason = NULL,
      ignore_reason = NULL,
      ignored_at = NULL,
      map_needs_review = true,
      updated_at = now()
  FROM sale s
  WHERE sl.sale_id = s.id
    AND sl.account_id = p_account_id
    AND s.source = 'lastapp'
    AND sl.menu_item_id IS NULL
    AND coalesce(sl.line_type,'product') = 'product'
    AND sl.map_source <> 'manual'
    AND coalesce(sl.unmapped_reason,'') = 'ignored'
    AND (p_brand_id IS NULL OR s.brand_id = p_brand_id)
    AND regexp_replace(
          regexp_replace(btrim(lower(public.unaccent(coalesce(sl.product_name,'')))), '\.$', ''),
          '\s+', ' ', 'g'
        ) = v_norm;
  GET DIAGNOSTICS v_afect = ROW_COUNT;

  -- Recomputar la razón real de las líneas reabiertas.
  PERFORM public.recast_lastapp_sales(p_account_id);

  RETURN QUERY SELECT 'unignored'::text, v_afect;
END;
$function$;

COMMIT;
