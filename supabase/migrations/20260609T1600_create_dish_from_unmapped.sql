-- =====================================================================
-- 20260609T1600_create_dish_from_unmapped.sql
-- Aplicada: __________  (rellenar al aplicar)
--
-- FRENTE COBERTURA: "plato nuevo del TPV" -> plato real de Folvy en UN CLIC.
--
-- Caso: un producto se vende en el TPV pero NO existe en Folvy (no_recipe sin
-- mapeo). Verificado: tiene catalogProductId + organizationProductId + marca
-- resoluble en lastapp_catalog_product, pero 0 filas en lastapp_product_map y
-- ningun recipe_item. classify_unmapped_product NO lo resuelve (exige recipe_item
-- preexistente) -> dejaba al usuario en un callejon ("revisa el mapeo"). Eso es
-- deuda que se pudre: el plato sigue vendiendose ciego.
--
-- Esta RPC convierte la venta huerfana en plato real, atomico:
--   1) Resuelve del JSON: organizationProductId, catalogProductId, marca (via
--      lastapp_catalog_product.lastapp_brand_name -> brand), nombre y precio.
--   2) Crea recipe_item (type='dish', base Unidad, source='import',
--      needs_review=true: nace marcado, falta escandallarlo). Sin coste todavia.
--   3) Crea lastapp_product_map (organization_product_id -> recipe_item nuevo).
--      Es la pieza que faltaba.
--   4) Crea menu_item en TODAS las marcas donde ese organizationProductId se
--      vende y aun no tiene menu_item (un producto, todas sus marcas; precio del
--      catalogo por marca).
--   5) Recasa (recast_lastapp_sales, por canonico) -> las lineas dejan de ser
--      no_recipe y casan.
--   6) Devuelve recipe_item_id -> el front navega a su editor de escandallo.
--
-- Anti-invencion: si la marca no resuelve -> EXCEPTION (no se crea plato sin
-- marca). Si el producto es un combo en el catalogo -> EXCEPTION (su coste es
-- Σ componentes, frente propio; no es un dish plano).
--
-- Idempotente en lo razonable: si el recipe_item ya existe (otro proceso lo
-- creo), reusa por mapeo; si el menu_item ya existe, no lo duplica.
--
-- DEUDA ANOTADA (no urgente): recast_lastapp_sales re-adapta TODA la cuenta.
-- Para onboarding masivo conviene re-adaptar solo las ventas del producto.
-- Disparador: import de carta completa / cientos de productos nuevos.
--
-- SECURITY DEFINER + guard de tenancy. NO probar en la tx que la crea
-- (auth.uid() null en SQL Editor revienta el guard); verificar desde la app.
-- =====================================================================

-- El tipo de retorno cambio (parametros de salida renombrados a out_* para
-- evitar ambiguedad con la columna recipe_item_id de las tablas). PostgreSQL no
-- deja cambiar el tipo de retorno con CREATE OR REPLACE -> DROP primero. Seguro:
-- la funcion es nueva de hoy, nada la llama todavia.
DROP FUNCTION IF EXISTS public.create_dish_from_unmapped(uuid, text);

CREATE OR REPLACE FUNCTION public.create_dish_from_unmapped(
  p_account_id   uuid,
  p_product_name text
)
RETURNS TABLE(
  out_recipe_item_id  uuid,
  out_marcas_creadas  integer,
  out_lineas_casadas  integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_norm      text;
  v_org_prod  uuid;
  v_cat_prod  uuid;
  v_brand_id  uuid;
  v_is_combo  boolean := false;
  v_name      text;
  v_price     numeric;
  v_unit      uuid;
  v_recipe_id uuid;
  v_marcas    integer := 0;
  v_casadas   integer := 0;
  r record;
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

  -- 1) Resolver identidad desde el JSON de una venta representativa del producto.
  SELECT
    nullif(rp.elem->>'organizationProductId', '')::uuid,
    (rp.elem->>'catalogProductId')::uuid,
    b.id,
    (lcp.product_type = 'combo'),
    lcp.product_name,
    lcp.price_cents::numeric / 100.0
  INTO v_org_prod, v_cat_prod, v_brand_id, v_is_combo, v_name, v_price
  FROM sale s,
       lateral jsonb_array_elements(s.raw_products::jsonb) AS rp(elem)
  LEFT JOIN lastapp_catalog_product lcp
    ON lcp.account_id = p_account_id
   AND lcp.catalog_product_id = (rp.elem->>'catalogProductId')::uuid
  LEFT JOIN brand b
    ON b.account_id = p_account_id
   AND b.is_active IS NOT FALSE
   AND upper(coalesce(b.name, '')) <> 'FOODINT'
   AND lower(public.unaccent(b.name)) = lower(public.unaccent(lcp.lastapp_brand_name))
  WHERE s.account_id = p_account_id
    AND s.source = 'lastapp'
    AND s.raw_products IS NOT NULL
    AND regexp_replace(
          regexp_replace(btrim(lower(public.unaccent(coalesce(rp.elem->>'name', '')))), '\.$', ''),
          '\s+', ' ', 'g'
        ) = v_norm
  LIMIT 1;

  IF v_org_prod IS NULL THEN
    RAISE EXCEPTION 'No se pudo resolver el producto "%" (sin organizationProductId en las ventas).', p_product_name;
  END IF;
  IF v_brand_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo resolver la marca de "%". Revisa el alias de marca del catalogo.', p_product_name;
  END IF;
  IF coalesce(v_is_combo, false) THEN
    RAISE EXCEPTION 'El producto "%" es un combo en el catalogo; su coste es la suma de sus componentes, no una receta plana. (Frente propio: combos.)', p_product_name;
  END IF;

  -- Unidad base de los platos de la cuenta (Unidad). Si no hubiera, EXCEPTION clara.
  SELECT id INTO v_unit FROM kitchen_unit
  WHERE lower(coalesce(abbreviation, '')) = 'ud' OR lower(coalesce(name, '')) = 'unidad'
  ORDER BY (lower(coalesce(abbreviation, '')) = 'ud') DESC
  LIMIT 1;
  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'No existe la unidad base "Unidad" en kitchen_unit; no se puede crear el plato.';
  END IF;

  -- 2) ¿Ya hay recipe_item via mapeo? (idempotencia: otro proceso pudo crearlo.)
  SELECT lpm.recipe_item_id INTO v_recipe_id
  FROM lastapp_product_map lpm
  WHERE lpm.account_id = p_account_id
    AND lpm.organization_product_id = v_org_prod
    AND lpm.recipe_item_id IS NOT NULL
  LIMIT 1;

  IF v_recipe_id IS NULL THEN
    -- Crear el plato (dish). Nace en revision: hay que escandallarlo.
    -- source='import': entro importado del TPV (no manual ni IA). El CHECK
    -- recipe_item_source_check solo admite manual|ai_recipe|ocr_invoice|import|template_global.
    INSERT INTO recipe_item (account_id, type, name, base_unit_id, source, needs_review, is_sellable)
    VALUES (p_account_id, 'dish',
            coalesce(nullif(btrim(v_name), ''), p_product_name),
            v_unit, 'import', true, true)
    RETURNING id INTO v_recipe_id;

    -- 3) Crear/enlazar el mapeo organizationProductId -> recipe_item.
    --    Si existe fila huerfana (recipe_item_id NULL) la enlazamos; si no, la creamos.
    UPDATE lastapp_product_map
      SET recipe_item_id = v_recipe_id, needs_review = false, updated_at = now()
    WHERE account_id = p_account_id AND organization_product_id = v_org_prod
      AND recipe_item_id IS NULL;
    IF NOT FOUND THEN
      INSERT INTO lastapp_product_map (account_id, organization_product_id, recipe_item_id, needs_review)
      VALUES (p_account_id, v_org_prod, v_recipe_id, false)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- 4) Crear menu_item en TODAS las marcas donde el producto se vende y aun no lo tiene.
  FOR r IN
    SELECT DISTINCT b.id AS brand_id,
           max(lcp.product_name) AS prod_name,
           max(lcp.price_cents)  AS price_cents
    FROM lastapp_catalog_product lcp
    JOIN lastapp_product_map lpm
      ON lpm.account_id = lcp.account_id
     AND lpm.organization_product_id = lcp.organization_product_id
     AND lpm.recipe_item_id = v_recipe_id
    JOIN brand b
      ON b.account_id = lcp.account_id
     AND b.is_active IS NOT FALSE
     AND upper(coalesce(b.name, '')) <> 'FOODINT'
     AND lower(public.unaccent(b.name)) = lower(public.unaccent(lcp.lastapp_brand_name))
    WHERE lcp.account_id = p_account_id
    GROUP BY b.id
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM menu_item mi
      WHERE mi.account_id = p_account_id
        AND mi.brand_id = r.brand_id
        AND mi.recipe_item_id = v_recipe_id
        AND mi.archived_at IS NULL
    ) THEN
      INSERT INTO menu_item (account_id, brand_id, recipe_item_id, name, price, product_type, source, needs_review)
      VALUES (p_account_id, r.brand_id, v_recipe_id,
              coalesce(nullif(btrim(r.prod_name), ''), p_product_name),
              coalesce(r.price_cents, 0)::numeric / 100.0, 'item', 'manual', false);
      v_marcas := v_marcas + 1;
    END IF;
  END LOOP;

  -- Si la marca de la venta no estaba en el catalogo-mapeo (defensivo): al menos
  -- crear el menu_item en la marca resuelta en el paso 1.
  IF NOT EXISTS (
    SELECT 1 FROM menu_item mi
    WHERE mi.account_id = p_account_id AND mi.brand_id = v_brand_id
      AND mi.recipe_item_id = v_recipe_id AND mi.archived_at IS NULL
  ) THEN
    INSERT INTO menu_item (account_id, brand_id, recipe_item_id, name, price, product_type, source, needs_review)
    VALUES (p_account_id, v_brand_id, v_recipe_id,
            coalesce(nullif(btrim(v_name), ''), p_product_name),
            coalesce(v_price, 0), 'item', 'manual', false);
    v_marcas := v_marcas + 1;
  END IF;

  -- 5) Recasar por el canonico -> las lineas del producto casan.
  PERFORM public.recast_lastapp_sales(p_account_id);

  -- 6) Contar lineas casadas del producto.
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
$$;
