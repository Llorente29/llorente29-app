-- 20260608T1700_classify_unmapped_product.sql
-- Aplicada: 2026-06-08
--
-- Capa 1 del frente "modelo de producto": clasificar un producto ciego (no_recipe)
-- desde la pantalla de excepciones. Tres acciones, una RPC, sin duplicar lógica:
--
--   action='resale'  → ARTÍCULO DE REVENTA (bebida, postre comprado): convierte el
--                       recipe_item a type='raw', is_sellable=true, is_purchasable=true.
--                       Coste: si llega p_unit_cost → cost_strategy='fixed' + fixed_cost;
--                       si no, se deja el recompute (proveedor) y queda en revisión si NULL.
--                       Crea menu_item en TODAS las marcas donde el producto se vende
--                       (artículo único, presencia multi-marca, como Apicbase), con el
--                       precio de venta de cada marca del catálogo. Recasa. Recomputa.
--   action='dish'    → ES UN PLATO: no toca el tipo (sigue 'dish'); solo devuelve el
--                       recipe_item_id para que el front lleve al editor de escandallo.
--                       NO crea menu_item (sin coste aún no procede).
--   action='combo'   → ES UN COMBO: marca needs_review + nota; queda para el frente de
--                       combos (coste = Σ componentes). No hace nada incorrecto.
--
-- La identidad del producto se resuelve por su organizationProductId (único por
-- producto), a partir del nombre normalizado de las líneas ciegas → recipe_item.
-- Anti-invención: si no se puede resolver el recipe_item o la marca, EXCEPTION clara.
--
-- SECURITY DEFINER + guard de tenancy. NO probar en la misma tx (auth.uid() null en
-- SQL Editor); verificar desde la app.

BEGIN;

CREATE OR REPLACE FUNCTION public.classify_unmapped_product(
  p_account_id   uuid,
  p_product_name text,
  p_action       text,             -- 'resale' | 'dish' | 'combo'
  p_unit_cost    numeric DEFAULT NULL  -- coste de compra por unidad base (solo 'resale', opcional)
)
RETURNS TABLE(
  resultado        text,    -- 'resale_linked' | 'is_dish' | 'is_combo'
  recipe_item_id   uuid,
  marcas_creadas   integer, -- menu_item creados (solo resale)
  lineas_casadas   integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_norm       text;
  v_recipe_id  uuid;
  v_cur_type   text;
  v_marcas     integer := 0;
  v_casadas    integer := 0;
  r record;
BEGIN
  -- Guard de tenancy.
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

  -- Resolver el recipe_item del producto vía la cadena (organizationProductId).
  -- Tomamos un elemento representativo del JSON de cualquier venta del producto.
  SELECT lpm.recipe_item_id
  INTO v_recipe_id
  FROM sale s,
       lateral jsonb_array_elements(s.raw_products::jsonb) AS rp(elem)
  LEFT JOIN lastapp_catalog_product lcp
    ON lcp.account_id = p_account_id
   AND lcp.catalog_product_id = (rp.elem->>'catalogProductId')::uuid
  LEFT JOIN lastapp_product_map lpm
    ON lpm.account_id = p_account_id
   AND lpm.organization_product_id = coalesce(
         nullif(rp.elem->>'organizationProductId','')::uuid,
         lcp.organization_product_id)
  WHERE s.account_id = p_account_id
    AND s.source = 'lastapp'
    AND s.raw_products IS NOT NULL
    AND regexp_replace(
          regexp_replace(btrim(lower(public.unaccent(coalesce(rp.elem->>'name','')))), '\.$', ''),
          '\s+', ' ', 'g'
        ) = v_norm
    AND lpm.recipe_item_id IS NOT NULL
  LIMIT 1;

  IF v_recipe_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo resolver el artículo de "%" (sin recipe_item en el mapeo). Revisa el mapeo del producto.', p_product_name;
  END IF;

  SELECT ri.type INTO v_cur_type FROM recipe_item ri WHERE ri.id = v_recipe_id;

  -- ── ES UN PLATO: no se toca el tipo; el front irá al editor de escandallo. ──
  IF p_action = 'dish' THEN
    RETURN QUERY SELECT 'is_dish'::text, v_recipe_id, 0, 0;
    RETURN;
  END IF;

  -- ── ES UN COMBO: declarar y dejar para el frente de combos. ──
  IF p_action = 'combo' THEN
    UPDATE recipe_item
    SET needs_review = true,
        review_notes = coalesce(review_notes,'{}'::jsonb) || jsonb_build_object('classify','combo: coste por componentes, frente propio'),
        updated_at = now()
    WHERE id = v_recipe_id;
    RETURN QUERY SELECT 'is_combo'::text, v_recipe_id, 0, 0;
    RETURN;
  END IF;

  -- ── ES REVENTA: convertir a raw vendible/comprable + coste + propagar marcas. ──
  UPDATE recipe_item ri
  SET type = 'raw',
      is_sellable = true,
      is_purchasable = true,
      cost_strategy = CASE WHEN p_unit_cost IS NOT NULL THEN 'fixed' ELSE ri.cost_strategy END,
      fixed_cost = CASE WHEN p_unit_cost IS NOT NULL THEN p_unit_cost ELSE ri.fixed_cost END,
      needs_review = CASE WHEN p_unit_cost IS NULL AND ri.computed_cost IS NULL THEN true ELSE false END,
      updated_at = now()
  WHERE ri.id = v_recipe_id;

  -- Recalcular el coste del raw (si tiene proveedor; si es fixed, ya está sellado).
  PERFORM public.kitchen_recompute_raw_cost(v_recipe_id);

  -- Propagar: crear menu_item en TODAS las marcas donde el producto se vende y aún
  -- no tiene menu_item. Precio de venta de cada marca, del catálogo (price_cents).
  FOR r IN
    SELECT DISTINCT b.id AS brand_id,
           max(lcp.product_name)  AS prod_name,
           max(lcp.price_cents)   AS price_cents
    FROM lastapp_catalog_product lcp
    JOIN lastapp_product_map lpm
      ON lpm.account_id = lcp.account_id
     AND lpm.organization_product_id = lcp.organization_product_id
     AND lpm.recipe_item_id = v_recipe_id
    JOIN brand b
      ON b.account_id = lcp.account_id
     AND b.is_active IS NOT FALSE
     AND upper(coalesce(b.name,'')) <> 'FOODINT'
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
              coalesce(nullif(btrim(r.prod_name),''), p_product_name),
              coalesce(r.price_cents,0)::numeric / 100.0, 'item', 'manual', false);
      v_marcas := v_marcas + 1;
    END IF;
  END LOOP;

  -- Recasar: ahora que existen los menu_item, las líneas del producto casan.
  PERFORM public.recast_lastapp_sales(p_account_id);

  -- Contar líneas ya casadas de este producto.
  SELECT count(*)
  INTO v_casadas
  FROM sale_line sl
  JOIN sale s ON s.id = sl.sale_id
  WHERE sl.account_id = p_account_id
    AND s.source = 'lastapp'
    AND sl.menu_item_id IS NOT NULL
    AND regexp_replace(
          regexp_replace(btrim(lower(public.unaccent(coalesce(sl.product_name,'')))), '\.$', ''),
          '\s+', ' ', 'g'
        ) = v_norm;

  RETURN QUERY SELECT 'resale_linked'::text, v_recipe_id, v_marcas, v_casadas;
END;
$function$;

COMMIT;
