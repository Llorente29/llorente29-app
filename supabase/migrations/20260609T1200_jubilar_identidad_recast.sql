-- =====================================================================
-- 20260609T1200_jubilar_identidad_recast.sql
-- Aplicada: __________  (rellenar al aplicar)
--
-- FRENTE #2 (1/3): JUBILAR LA IDENTIDAD DEL RECAST VIEJO.
--
-- recast_lastapp_sales hacia DOS cosas:
--   A) CASADO/IDENTIDAD leyendo raw_products (JSON de Last.app) -> acoplado a
--      un TPV, duplica lo que adapt_lastapp_order ya hace por el CANONICO.
--   B) AUTO-PROPAGACION MULTIMARCA (crear menu_item que faltan para productos
--      con coste) -> NO la hace el adaptador; se CONSERVA (ya es casi canonica:
--      usa catalogo + mapeo, no el JSON crudo).
--
-- Esta migracion:
--   1) Crea reprocess_sale(p_sale_id): POST-PROCESO UNIFICADO DE FRONTERAS =
--      adapt_lastapp_order -> por cada linea product: compute_sale_line_cost +
--      compute_sale_line_consumption. Motor puro (sin guard). Una sola verdad
--      de "reprocesar una venta", compartida por webhook / recast / resolvedores.
--      Evita que el consumo quede huerfano cuando el adaptador recrea sale_line
--      (IDs nuevos) y mata la duplicacion de post-proceso entre fronteras.
--   2) Reescribe recast_lastapp_sales: conserva la pieza B (auto-propagacion) y
--      SUSTITUYE el casado por raw_products por un BUCLE reprocess_sale sobre las
--      ventas lastapp de la cuenta. Firma y metricas de salida INTACTAS (los dos
--      llamadores resolve_unmapped_sales / classify_unmapped_product, el script
--      recast-sales.mjs y database.ts siguen funcionando sin cambios).
--      La pieza A (casado por JSON) MUERE: nadie vuelve a leer raw_products para
--      casar identidad.
--
-- Metrica lineas_ambiguous: el casado canonico (por organizationProductId) es
-- determinista y NO produce 'ambiguous'. Se conserva en la firma y saldra 0 de
-- forma natural (mejor que la ambiguedad por nombre del casado viejo).
--
-- SECURITY DEFINER. NO probar dentro de la tx que las crea (auth.uid() null en
-- SQL Editor revienta el guard del recast). reprocess_sale es PURO: se puede
-- verificar desde SQL Editor sin sesion.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) reprocess_sale: post-proceso unificado de una venta (PURO, sin guard).
--    adapt -> (por linea product) coste + consumo. Idempotente (cada paso lo es).
--    Devuelve el nº de lineas product reprocesadas.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reprocess_sale(p_sale_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line_id uuid;
  v_n       integer := 0;
BEGIN
  -- 1) Reconstruir las lineas canonicas (respeta manual/ignored/delisted).
  PERFORM public.adapt_lastapp_order(p_sale_id);

  -- 2) Por cada linea product: coste y consumo (mismo orden que el webhook;
  --    el consumo solo escribe si la linea tiene computed_cost).
  FOR v_line_id IN
    SELECT id FROM sale_line
    WHERE sale_id = p_sale_id AND line_type = 'product'
  LOOP
    PERFORM public.compute_sale_line_cost(v_line_id);
    PERFORM public.compute_sale_line_consumption(v_line_id);
    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$$;


-- ---------------------------------------------------------------------
-- 2) recast_lastapp_sales reescrito: pieza B (auto-propagacion) + bucle
--    reprocess_sale. Firma y metricas IDENTICAS a la version anterior.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recast_lastapp_sales(p_account_id uuid)
RETURNS TABLE(
  ventas_procesadas    integer,
  lineas_total         integer,
  lineas_casadas       integer,
  lineas_no_brand      integer,
  lineas_no_recipe     integer,
  lineas_no_menu_item  integer,
  lineas_ambiguous     integer,
  lineas_respetadas    integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale_id  uuid;
  v_ventas   integer := 0;
  v_total    integer := 0;
  v_ok       integer := 0;
  v_nb       integer := 0;
  v_nr       integer := 0;
  v_nm       integer := 0;
  v_amb      integer := 0;
  v_resp     integer := 0;
BEGIN
  -- Guard de tenancy (SECURITY DEFINER salta RLS): admin de plataforma o de la cuenta.
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'recast_lastapp_sales: sin acceso a la cuenta %', p_account_id;
  END IF;

  -- ── PIEZA B (CONSERVADA): AUTO-PROPAGACION MULTIMARCA ──
  -- Crear los menu_item que faltan para productos cuyo recipe_item TIENE COSTE y se
  -- venden en esa marca. Solo con coste (anti-invencion: los sin coste siguen en
  -- excepciones). Usa catalogo + mapeo (NO raw_products) -> agnostica de TPV.
  INSERT INTO menu_item (account_id, brand_id, recipe_item_id, name, price, product_type, source, needs_review)
  SELECT DISTINCT
    p_account_id,
    cand.brand_id,
    cand.recipe_item_id,
    COALESCE(NULLIF(btrim(cand.prod_name), ''), cand.recipe_name) AS name,
    COALESCE(cand.price_cents, 0)::numeric / 100.0 AS price,
    'item', 'auto', false
  FROM (
    SELECT
      b.id AS brand_id,
      lpm.recipe_item_id,
      max(lcp.product_name)  AS prod_name,
      max(lcp.price_cents)   AS price_cents,
      max(ri.name)           AS recipe_name
    FROM lastapp_catalog_product lcp
    JOIN lastapp_product_map lpm
      ON lpm.account_id = lcp.account_id
     AND lpm.organization_product_id = lcp.organization_product_id
    JOIN recipe_item ri
      ON ri.id = lpm.recipe_item_id
     AND ri.account_id = p_account_id
     AND (ri.computed_cost IS NOT NULL OR ri.fixed_cost IS NOT NULL)
    JOIN brand b
      ON b.account_id = lcp.account_id
     AND b.is_active IS NOT FALSE
     AND upper(COALESCE(b.name, '')) <> 'FOODINT'
     AND lower(public.unaccent(b.name)) = lower(public.unaccent(lcp.lastapp_brand_name))
    WHERE lcp.account_id = p_account_id
    GROUP BY b.id, lpm.recipe_item_id
  ) cand
  WHERE NOT EXISTS (
    SELECT 1 FROM menu_item mi
    WHERE mi.account_id = p_account_id
      AND mi.brand_id = cand.brand_id
      AND mi.recipe_item_id = cand.recipe_item_id
      AND mi.archived_at IS NULL
  );

  -- ── PIEZA A (JUBILADA): casado por el CANONICO via reprocess_sale ──
  -- En vez del CTE por raw_products, re-adaptamos cada venta lastapp de la cuenta.
  -- adapt_lastapp_order reconstruye la identidad canonica (menu_item, brand_id,
  -- unmapped_reason) y respeta manual/ignored/delisted; reprocess_sale ademas
  -- recostea y re-consume (el consumo no queda huerfano).
  FOR v_sale_id IN
    SELECT id FROM sale
    WHERE account_id = p_account_id AND source = 'lastapp' AND raw_products IS NOT NULL
  LOOP
    PERFORM public.reprocess_sale(v_sale_id);
  END LOOP;

  -- ── METRICAS: leidas del canonico ya reescrito (no del JSON) ──
  SELECT
    count(DISTINCT sl.sale_id),
    count(*),
    count(*) FILTER (WHERE sl.menu_item_id IS NOT NULL),
    count(*) FILTER (WHERE sl.unmapped_reason = 'no_brand'),
    count(*) FILTER (WHERE sl.unmapped_reason = 'no_recipe'),
    count(*) FILTER (WHERE sl.unmapped_reason = 'no_menu_item'),
    count(*) FILTER (WHERE sl.unmapped_reason = 'ambiguous'),
    count(*) FILTER (WHERE sl.map_source = 'manual'
                        OR COALESCE(sl.unmapped_reason, '') IN ('ignored', 'delisted'))
  INTO v_ventas, v_total, v_ok, v_nb, v_nr, v_nm, v_amb, v_resp
  FROM sale_line sl
  JOIN sale s ON s.id = sl.sale_id
  WHERE sl.account_id = p_account_id AND s.source = 'lastapp'
    AND COALESCE(sl.line_type, 'product') = 'product';

  ventas_procesadas   := v_ventas;
  lineas_total        := v_total;
  lineas_casadas      := v_ok;
  lineas_no_brand     := v_nb;
  lineas_no_recipe    := v_nr;
  lineas_no_menu_item := v_nm;
  lineas_ambiguous    := v_amb;
  lineas_respetadas   := v_resp;
  RETURN NEXT;
END;
$$;
