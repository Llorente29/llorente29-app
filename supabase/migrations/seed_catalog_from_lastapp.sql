-- seed_catalog_from_lastapp(account_id)
-- =====================================================================
-- Proceso de SIEMBRA de catálogo (onboarding repetible, genérico por cuenta).
-- Por cada producto en lastapp_catalog_product que AÚN no tiene presentación
-- (menu_item con su matrícula), crea las 3 capas:
--   1. recipe_item (artículo físico)  → type='dish', unidad base 'ud',
--      needs_review=true (sin escandallo aún: Pamela lo completa).
--   2. menu_item (presentación)        → nombre, precio, marca, matrícula.
--   3. matrícula                        → external_source='lastapp',
--      external_id=organization_product_id.
--
-- Reglas (anti-invención, principio del proyecto):
--   - Si la marca del catálogo NO existe como brand en la cuenta → SALTA ese
--     producto (no inventa marca). Queda sin sembrar, reportado al final.
--   - Idempotente: no recrea lo que ya existe (por matrícula+marca).
--   - No casa ventas: eso lo hace adapt_lastapp_order después (recast).
--
-- Devuelve: nº de artículos sembrados.
-- NOTA: el casado de ventas se dispara aparte (recast) tras sembrar.

CREATE OR REPLACE FUNCTION public.seed_catalog_from_lastapp(p_account_id uuid)
 RETURNS TABLE(sembrados integer, saltados_sin_marca integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_unit_ud   uuid := '869711c3-eabd-4e95-92f2-555efaaba6b0'; -- "Unidad" (global)
  v_row       record;
  v_brand_id  uuid;
  v_recipe_id uuid;
  v_sembrados integer := 0;
  v_saltados  integer := 0;
BEGIN
  FOR v_row IN
    -- Productos del catálogo con matrícula, agrupados por matrícula+marca,
    -- que NO tienen ya un menu_item con esa matrícula en esa marca.
    SELECT DISTINCT
      lcp.organization_product_id::text AS matricula,
      lcp.product_name,
      lcp.lastapp_brand_name,
      lcp.price_cents
    FROM lastapp_catalog_product lcp
    WHERE lcp.account_id = p_account_id
      AND lcp.organization_product_id IS NOT NULL
      AND lcp.product_name IS NOT NULL
  LOOP
    -- Resolver marca de Folvy por nombre. Si no existe → saltar (no inventar).
    SELECT b.id INTO v_brand_id
    FROM brand b
    WHERE b.account_id = p_account_id
      AND lower(trim(b.name)) = lower(trim(v_row.lastapp_brand_name))
    LIMIT 1;

    IF v_brand_id IS NULL THEN
      v_saltados := v_saltados + 1;
      CONTINUE;
    END IF;

    -- Idempotencia: ¿ya existe menu_item con esta matrícula en esta marca?
    PERFORM 1 FROM menu_item mi
    WHERE mi.account_id = p_account_id
      AND mi.external_source = 'lastapp'
      AND mi.external_id = v_row.matricula
      AND mi.brand_id = v_brand_id;
    IF FOUND THEN
      CONTINUE; -- ya sembrado
    END IF;

    -- 1. Crear el artículo físico (recipe_item) en needs_review.
    INSERT INTO recipe_item (account_id, type, name, base_unit_id, needs_review)
    VALUES (p_account_id, 'dish', v_row.product_name, v_unit_ud, true)
    RETURNING id INTO v_recipe_id;

    -- 2. Crear la presentación (menu_item) con su matrícula.
    INSERT INTO menu_item (account_id, brand_id, name, price,
                           recipe_item_id, external_source, external_id, needs_review)
    VALUES (p_account_id, v_brand_id, v_row.product_name,
            COALESCE(v_row.price_cents,0)/100.0,
            v_recipe_id, 'lastapp', v_row.matricula, true);

    v_sembrados := v_sembrados + 1;
  END LOOP;

  RETURN QUERY SELECT v_sembrados, v_saltados;
END;
$function$;
