-- 20260629T1600_classify_resale_ancla_articulo.sql
-- Aplicada:
--
-- Frente "Es reventa" — versión definitiva. Dos cambios sobre la anterior:
--
--  (1) ANCLA AL ARTÍCULO QUE EL HUMANO SEÑALA. Nuevo parámetro p_recipe_item_id
--      (opcional, al final → no rompe llamadas viejas). Cuando viene (Puerta 1: ficha
--      del artículo), la RPC opera sobre ESE recipe_item — cero adivinar por nombre ni
--      por matrícula. Resuelve TODAS las matrículas de sus menu_item y reapunta por cada
--      una. Cubre Nestea (1 matrícula/8 marcas) y Agua (2 matrículas + null) por igual.
--
--  (2) SI NO RESUELVE, NO MUERE: en vez de EXCEPTION 'no se pudo resolver…', devuelve
--      resultado='needs_target' con una lista de candidatos (en la columna nueva
--      candidatos jsonb) para que el front (Puerta 2: Excepciones) muestre un desplegable
--      "¿a qué artículo lo caso?" y el usuario elija. Lo simple: si la máquina no está
--      segura, pregunta; no falla.
--
-- Firma EXTENDIDA (parámetro nuevo opcional + columna nueva en el RETURN). Las llamadas
-- viejas (3 args) siguen válidas. El front se actualiza para pasar p_recipe_item_id y
-- leer 'needs_target'/candidatos.
--
-- DDL: por cambiar el RETURN TABLE hay que DROP antes de CREATE (no se puede CREATE OR
-- REPLACE cambiando columnas de salida). Sin BEGIN/COMMIT. SECURITY DEFINER: no probar
-- en SQL Editor (guard); verificar desde la app.

DROP FUNCTION IF EXISTS public.classify_unmapped_product(uuid, text, text, numeric);

CREATE OR REPLACE FUNCTION public.classify_unmapped_product(
  p_account_id     uuid,
  p_product_name   text,
  p_action         text,
  p_unit_cost      numeric DEFAULT NULL::numeric,
  p_recipe_item_id uuid    DEFAULT NULL::uuid
)
 RETURNS TABLE(resultado text, recipe_item_id uuid, marcas_creadas integer, lineas_casadas integer, candidatos jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_norm        text;
  v_matricula   text;
  v_brand_id    uuid;
  v_is_combo    boolean := false;
  v_cat_name    text;
  v_cat_price   numeric;
  v_unit        uuid;
  v_recipe_id   uuid;
  v_menu_id     uuid;
  v_marcas      integer := 0;
  v_casadas     integer := 0;
  v_reapuntados integer := 0;
  v_borrados    integer := 0;
  v_cand        jsonb;
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

  -- ── PUERTA 1: el humano señaló un recipe_item (ficha). Ancla directa, sin adivinar. ──
  IF p_recipe_item_id IS NOT NULL THEN
    SELECT ri.id INTO v_recipe_id FROM recipe_item ri
    WHERE ri.id = p_recipe_item_id AND ri.account_id = p_account_id;
    IF v_recipe_id IS NULL THEN
      RAISE EXCEPTION 'classify_unmapped_product: el artículo % no existe en la cuenta.', p_recipe_item_id;
    END IF;
  END IF;

  -- ── PUERTA 2: solo nombre (Excepciones). Resolver matrícula+marca por nombre. ──
  IF v_recipe_id IS NULL THEN
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

    -- ¿menu_item ya existente por matrícula? → su recipe_item es el ancla.
    IF v_matricula IS NOT NULL THEN
      SELECT mi.recipe_item_id INTO v_recipe_id
      FROM menu_item mi
      JOIN recipe_item ri ON ri.id = mi.recipe_item_id
      WHERE mi.account_id = p_account_id
        AND mi.external_source = 'lastapp'
        AND mi.external_id = v_matricula
        AND mi.archived_at IS NULL
      ORDER BY (ri.type = 'raw') DESC, ri.is_sellable DESC,
               (SELECT count(*) FROM menu_item m2 WHERE m2.recipe_item_id = ri.id) DESC
      LIMIT 1;
    END IF;
  END IF;

  -- ── NO HAY ANCLA y es reventa/plato → NO morir: devolver candidatos para elegir. ──
  IF v_recipe_id IS NULL AND p_action IN ('resale','dish') THEN
    SELECT coalesce(jsonb_agg(c ORDER BY c->>'name'), '[]'::jsonb) INTO v_cand
    FROM (
      SELECT jsonb_build_object('recipe_item_id', ri.id, 'name', ri.name, 'type', ri.type) AS c
      FROM recipe_item ri
      WHERE ri.account_id = p_account_id
        AND ri.is_sellable = true
        AND ri.archived_at IS NULL
        AND ri.name ILIKE '%' || coalesce(nullif(btrim(split_part(p_product_name,' ',1)),''), p_product_name) || '%'
      ORDER BY ri.name
      LIMIT 25
    ) q;
    RETURN QUERY SELECT 'needs_target'::text, NULL::uuid, 0, 0, v_cand;
    RETURN;
  END IF;

  -- Datos de catálogo (combo/precio/nombre) — útiles si hay que crear. Por matrícula del ancla.
  IF v_matricula IS NULL AND v_recipe_id IS NOT NULL THEN
    SELECT mi.external_id INTO v_matricula
    FROM menu_item mi
    WHERE mi.recipe_item_id = v_recipe_id AND mi.account_id = p_account_id
      AND mi.external_source = 'lastapp' AND mi.external_id IS NOT NULL
    LIMIT 1;
  END IF;
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

  -- ── COMBO ──
  IF p_action = 'combo' THEN
    IF v_recipe_id IS NOT NULL THEN
      UPDATE recipe_item
      SET needs_review = true,
          review_notes = coalesce(review_notes,'{}'::jsonb) || jsonb_build_object('classify','combo: coste por componentes, frente propio'),
          updated_at = now()
      WHERE id = v_recipe_id;
    END IF;
    RETURN QUERY SELECT 'is_combo'::text, v_recipe_id, 0, 0, '[]'::jsonb;
    RETURN;
  END IF;

  IF coalesce(v_is_combo, false) THEN
    RAISE EXCEPTION 'El producto "%" es un combo en el catálogo; clasifícalo como combo (su coste es Σ componentes).', p_product_name;
  END IF;

  -- ── Crear ancla sellada SOLO si no hay (caso Excepciones con matrícula pero sin menu_item). ──
  IF v_recipe_id IS NULL THEN
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

  -- ── ES UN PLATO ──
  IF p_action = 'dish' THEN
    -- No se reprocesan ventas históricas aquí (timeout con volumen). El recast por lotes,
    -- si se quiere, es aparte. El plato queda marcado; lo nuevo casa solo.
    RETURN QUERY SELECT 'is_dish'::text, v_recipe_id, v_marcas, 0, '[]'::jsonb;
    RETURN;
  END IF;

  -- ── ES REVENTA ──────────────────────────────────────────────────────────────
  -- 1) Convertir el ancla a raw vendible/comprable + coste.
  UPDATE recipe_item ri
  SET type = 'raw',
      is_sellable = true,
      is_purchasable = true,
      cost_strategy = CASE WHEN p_unit_cost IS NOT NULL THEN 'fixed' ELSE ri.cost_strategy END,
      fixed_cost = CASE WHEN p_unit_cost IS NOT NULL THEN p_unit_cost ELSE ri.fixed_cost END,
      needs_review = CASE WHEN p_unit_cost IS NULL AND ri.computed_cost IS NULL THEN true ELSE false END,
      updated_at = now()
  WHERE ri.id = v_recipe_id;

  -- 2) Atraer al ancla TODOS los menu_item que comparten CUALQUIERA de sus matrículas
  --    (cubre Nestea=1 matrícula y Agua=2 matrículas), todas las marcas.
  WITH matriculas AS (
    SELECT DISTINCT mi.external_id
    FROM menu_item mi
    WHERE mi.recipe_item_id = v_recipe_id
      AND mi.account_id = p_account_id
      AND mi.external_source = 'lastapp'
      AND mi.external_id IS NOT NULL
  ),
  upd AS (
    UPDATE menu_item mi
    SET recipe_item_id = v_recipe_id, updated_at = now()
    WHERE mi.account_id = p_account_id
      AND mi.external_source = 'lastapp'
      AND mi.external_id IN (SELECT external_id FROM matriculas)
      AND mi.archived_at IS NULL
      AND mi.recipe_item_id IS DISTINCT FROM v_recipe_id
    RETURNING 1
  )
  SELECT count(*) INTO v_reapuntados FROM upd;

  -- 3) Borrar recipe_items huérfanos (esquirlas dish vacías sin menu_item ni uso).
  WITH del AS (
    DELETE FROM recipe_item ri
    WHERE ri.account_id = p_account_id
      AND ri.id <> v_recipe_id
      AND ri.type = 'dish'
      AND ri.source = 'import'
      AND NOT EXISTS (SELECT 1 FROM menu_item mi WHERE mi.recipe_item_id = ri.id)
      AND NOT EXISTS (SELECT 1 FROM recipe_line rl WHERE rl.parent_item_id = ri.id OR rl.child_item_id = ri.id)
    RETURNING 1
  )
  SELECT count(*) FROM del INTO v_borrados;

  -- 4) Recostear el ancla. NO se reprocesan las ventas históricas aquí: con muchas
  --    ventas (p.ej. 100+ por matrícula) el reprocesado síncrono agota el statement
  --    timeout. El artículo queda bien marcado → las ventas NUEVAS descuentan y casan
  --    solas. El histórico no se regenera (decisión "de hoy en adelante"); si alguna vez
  --    se quiere, es un proceso por lotes aparte, no este botón.
  PERFORM public.kitchen_recompute_raw_cost(v_recipe_id);

  -- 5) Líneas casadas de las matrículas del ancla.
  SELECT count(*) INTO v_casadas
  FROM sale_line sl
  JOIN sale s ON s.id = sl.sale_id
  WHERE sl.account_id = p_account_id AND s.source = 'lastapp'
    AND sl.menu_item_id IS NOT NULL
    AND sl.external_product_id IN (
      SELECT DISTINCT mi.external_id FROM menu_item mi
      WHERE mi.recipe_item_id = v_recipe_id AND mi.account_id = p_account_id
        AND mi.external_source = 'lastapp' AND mi.external_id IS NOT NULL
    );

  RETURN QUERY SELECT 'resale_linked'::text, v_recipe_id, v_reapuntados, v_casadas, '[]'::jsonb;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.classify_unmapped_product(uuid, text, text, numeric, uuid) TO authenticated;
