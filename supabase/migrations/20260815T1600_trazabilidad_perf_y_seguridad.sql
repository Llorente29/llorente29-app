-- ============================================================================
-- TRAZABILIDAD DE ARTÍCULO — arreglo de rendimiento + seguridad, aplicado ya
-- en producción por Julio vía MCP/SQL Editor. Esta migración VERSIONA
-- exactamente ese estado (leído en vivo con pg_get_functiondef, no
-- reconstruido de memoria) para que quede en supabase/migrations/.
--
-- SÍNTOMA EN PRODUCCIÓN: "canceling statement due to statement timeout" al
-- abrir la Pantalla 1 (Movimientos del artículo) con un artículo de 361 filas.
--
-- CAUSA (list_item_stock_movements y get_sale_ticket, tal como las creó
-- 20260815T1500, eran SECURITY INVOKER):
--   1) Sin SECURITY DEFINER, la policy de stock_movement se evalúa por cada
--      fila candidata: cada current_user_is_admin_or_manager_of(account_id)
--      es una llamada a función dentro del plan, no una constante.
--   2) El CTE 'resolved' (el que arma el "origen legible") corría sus
--      subconsultas correlacionadas contra sale/sale_line/goods_receipt/etc.
--      para TODA la ventana de fechas y SOLO DESPUÉS paginaba con LIMIT/OFFSET
--      -- con 361 filas, cientos de subconsultas caras para enseñar 20.
--
-- ARREGLO (los 4 puntos que Julio aplicó y verificó en vivo):
--   1) list_item_stock_movements y get_sale_ticket pasan a SECURITY DEFINER,
--      con un guard explícito al principio que sustituye a la RLS (se evalúa
--      UNA vez, no por fila): admin de la cuenta o platform admin, si no
--      RAISE EXCEPTION. Mismo criterio que ya usa el resto de RPC de
--      informe/consulta con SECURITY DEFINER en el proyecto.
--   2) list_item_stock_movements añade el CTE 'pagina' (ORDER BY + LIMIT /
--      OFFSET) ANTES del CTE 'resolved': ahora 'resolved' parte de 'pagina'
--      (ya recortada a la página pedida), no de 'fam' (la ventana completa).
--      'todos' / 'ventana' / 'fam' se conservan intactos porque 'total' y
--      'series' siguen necesitando la ventana completa — son agregados
--      baratos (count/sum), no las subconsultas correlacionadas caras.
--   3) list_stock_movements NO CAMBIA: sigue SECURITY INVOKER. No pagina sobre
--      las mismas subconsultas caras del mismo modo y no daba timeout.
--   4) La policy stock_movement_rw se reescribe envolviendo cada llamada a
--      función en SELECT (become un InitPlan, se resuelve UNA vez por policy,
--      no por fila) — misma semántica, mejor plan.
--
-- REEJECUTABLE: mismas firmas en las dos funciones (list_item_stock_movements
-- cambia de LANGUAGE sql a LANGUAGE plpgsql pero con los mismos argumentos y
-- el mismo tipo de retorno) → CREATE OR REPLACE basta, no hace falta DROP.
-- La policy se recrea con DROP POLICY IF EXISTS + CREATE POLICY porque ALTER
-- POLICY no permite cambiar el USING de esta forma en una sola sentencia.
-- Los REVOKE/GRANT son idempotentes por naturaleza.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1) list_item_stock_movements — SECURITY DEFINER + guard + CTE 'pagina'.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_item_stock_movements(p_account uuid, p_item uuid, p_location uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 200, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res jsonb;
BEGIN
  IF NOT (current_user_is_admin() OR current_user_is_admin_or_manager_of(p_account)) THEN
    RAISE EXCEPTION 'list_item_stock_movements: sin acceso a la cuenta %', p_account;
  END IF;

  WITH todos AS (
    SELECT sm.id, sm.movement_type, sm.source_type, sm.source_id,
           sm.qty_base, sm.unit_cost, sm.occurred_at, sm.created_by_name, sm.notes,
           sum(sm.qty_base) OVER (ORDER BY sm.occurred_at, sm.id
                                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_qty,
           sum(sm.qty_base * coalesce(sm.unit_cost, 0)) OVER (ORDER BY sm.occurred_at, sm.id
                                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_cost
    FROM stock_movement sm
    WHERE sm.account_id = p_account
      AND sm.recipe_item_id = p_item
      AND sm.location_id = p_location
  ),
  ventana AS (
    SELECT * FROM todos
    WHERE (p_from IS NULL OR occurred_at >= p_from)
      AND (p_to IS NULL OR occurred_at < p_to)
  ),
  fam AS (
    SELECT v.*,
      CASE v.movement_type
        WHEN 'recepcion' THEN 'compras'
        WHEN 'consumo' THEN 'ventas'
        WHEN 'merma' THEN 'otros'
        WHEN 'traspaso_entrada' THEN 'otros'
        WHEN 'traspaso_salida' THEN 'otros'
        WHEN 'ajuste' THEN 'inventarios'
        WHEN 'recuento' THEN 'inventarios'
        WHEN 'apertura' THEN 'inventarios'
        ELSE 'otros'
      END AS familia
    FROM ventana v
  ),
  pagina AS (
    SELECT * FROM fam
    ORDER BY occurred_at DESC
    LIMIT greatest(p_limit, 0) OFFSET greatest(p_offset, 0)
  ),
  resolved AS (
    SELECT f.*,
      CASE f.source_type
        WHEN 'sale' THEN coalesce(
          (SELECT s.id FROM sale s WHERE s.id = f.source_id),
          (SELECT sl.sale_id FROM sale_line sl WHERE sl.id = f.source_id))
        ELSE null
      END AS sale_id,
      CASE f.source_type
        WHEN 'sale' THEN (
          SELECT trim(both ' ·' FROM
            coalesce(b.name, sc.name, initcap(s.external_channel_text), 'Venta')
            || coalesce(' · ' || nullif(s.platform_order_code, ''), ''))
          FROM sale s
          LEFT JOIN sales_channel sc ON sc.id = s.channel_id
          LEFT JOIN brand b ON b.id = s.brand_id
          WHERE s.id = coalesce(
            (SELECT s2.id FROM sale s2 WHERE s2.id = f.source_id),
            (SELECT sl.sale_id FROM sale_line sl WHERE sl.id = f.source_id)))
        WHEN 'goods_receipt_line' THEN (
          SELECT coalesce(gr.code, 'Recepción')
            || coalesce(' · ' || nullif(gr.supplier_doc_number, ''), '')
          FROM goods_receipt_line grl
          JOIN goods_receipt gr ON gr.id = grl.goods_receipt_id
          WHERE grl.id = f.source_id)
        WHEN 'adjustment' THEN (
          SELECT 'Ajuste · ' || sa.reason_code FROM stock_adjustment sa WHERE sa.id = f.source_id)
        WHEN 'waste' THEN (
          SELECT 'Merma · ' || sw.reason_code FROM stock_waste sw WHERE sw.id = f.source_id)
        WHEN 'transfer' THEN (
          SELECT CASE WHEN st.from_location_id = p_location
                      THEN '→ ' || coalesce(lt.name, 'otro local')
                      ELSE '← ' || coalesce(lf.name, 'otro local') END
          FROM stock_transfer st
          LEFT JOIN locations lf ON lf.id = st.from_location_id
          LEFT JOIN locations lt ON lt.id = st.to_location_id
          WHERE st.id = f.source_id)
        ELSE null
      END AS reference
    FROM pagina f
  )
  SELECT jsonb_build_object(
    'item', (
      SELECT jsonb_build_object(
        'id', ri.id, 'name', ri.name,
        'unit_abbr', ku.abbreviation,
        'qty_on_hand', coalesce(st.qty_on_hand, 0),
        'avg_unit_cost', st.avg_unit_cost,
        'stock_value', coalesce(st.stock_value, 0))
      FROM recipe_item ri
      LEFT JOIN kitchen_unit ku ON ku.id = ri.base_unit_id
      LEFT JOIN recipe_item_location_stock st
        ON st.recipe_item_id = ri.id AND st.location_id = p_location
      WHERE ri.id = p_item),
    'total', (SELECT count(*) FROM ventana),
    'series', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'dia')
      FROM (
        SELECT jsonb_build_object('dia', occurred_at::date, 'familia', familia,
                                  'qty', round(sum(qty_base), 3)) AS x
        FROM fam GROUP BY occurred_at::date, familia) t
    ), '[]'::jsonb),
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', r.id,
               'movement_type', r.movement_type,
               'source_type', r.source_type,
               'sale_id', r.sale_id,
               'qty_base', r.qty_base,
               'unit_cost', r.unit_cost,
               'cost_eur', round(abs(r.qty_base) * coalesce(r.unit_cost, 0), 2),
               'running_qty', round(r.running_qty, 3),
               'running_cost', round(r.running_cost, 2),
               'occurred_at', r.occurred_at,
               'created_by_name', r.created_by_name,
               'reference', r.reference,
               'notes', r.notes
             ) ORDER BY r.occurred_at DESC)
      FROM resolved r
    ), '[]'::jsonb)
  ) INTO v_res;

  RETURN v_res;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) get_sale_ticket — SECURITY DEFINER + guard. Cuerpo (CTEs s / lineas / tot
--    y el jsonb_build_object) igual que en 20260815T1500; solo cambia la
--    cabecera (plpgsql + DEFINER) y el guard de acceso.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_sale_ticket(p_sale_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_acc uuid;
  v_res jsonb;
BEGIN
  SELECT account_id INTO v_acc FROM sale WHERE id = p_sale_id;
  IF v_acc IS NULL THEN RETURN NULL; END IF;
  IF NOT (current_user_is_admin() OR current_user_is_admin_or_manager_of(v_acc)) THEN
    RAISE EXCEPTION 'get_sale_ticket: sin acceso a la venta';
  END IF;

  WITH s AS (SELECT * FROM sale WHERE id = p_sale_id),
  lineas AS (
    SELECT sl.id, sl.product_name, sl.quantity, sl.unit_price, sl.line_total,
           sl.computed_cost, sl.line_type, sl.parent_sale_line_id,
           sl.discount_label, sl.original_unit_price, sl.map_needs_review,
           sl.unmapped_reason, sl.menu_item_id, sl.ignored_at,
           mi.name AS menu_item_name
    FROM sale_line sl
    LEFT JOIN menu_item mi ON mi.id = sl.menu_item_id
    WHERE sl.sale_id = p_sale_id
  ),
  tot AS (
    SELECT coalesce(sum(computed_cost) FILTER (WHERE coalesce(line_type,'product')='product'),0) AS coste,
           count(*) FILTER (WHERE coalesce(line_type,'product')='product' AND computed_cost IS NULL) AS lineas_sin_coste
    FROM lineas
  )
  SELECT jsonb_build_object(
    'sale', (
      SELECT jsonb_build_object(
        'id', s.id, 'sold_at', s.sold_at,
        'brand', coalesce(b.name, s.external_brand_text),
        'channel', coalesce(sc.name, initcap(s.external_channel_text)),
        'location', l.name,
        'order_status', s.order_status, 'status', s.status, 'source', s.source,
        'ticket_code', coalesce(nullif(s.platform_order_code,''), nullif(s.pos_short_code,''), s.external_ref),
        'total', s.total, 'taxable_base', s.taxable_base, 'tax', s.tax,
        'discount_amount', s.discount_amount, 'service_type', s.service_type,
        'cost', (SELECT round(coste,2) FROM tot),
        'lines_without_cost', (SELECT lineas_sin_coste FROM tot),
        'cost_complete', (SELECT lineas_sin_coste = 0 FROM tot),
        'margin_eur', round(coalesce(s.taxable_base, s.total, 0) - (SELECT coste FROM tot), 2),
        'margin_pct', CASE WHEN coalesce(s.taxable_base, s.total, 0) > 0
          THEN round(((coalesce(s.taxable_base, s.total,0) - (SELECT coste FROM tot))
                      / coalesce(s.taxable_base, s.total)) * 100, 1) ELSE null END)
      FROM s
      LEFT JOIN brand b ON b.id = s.brand_id
      LEFT JOIN sales_channel sc ON sc.id = s.channel_id
      LEFT JOIN locations l ON l.id = s.location_id),
    'lines', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ln.id,
        'product_name', coalesce(ln.menu_item_name, ln.product_name),
        'raw_name', ln.product_name,
        'quantity', ln.quantity,
        'unit_price', ln.unit_price,
        'line_total', ln.line_total,
        'unit_cost', CASE WHEN ln.quantity > 0 THEN round(ln.computed_cost / ln.quantity, 4) ELSE null END,
        'computed_cost', ln.computed_cost,
        'contribution', CASE WHEN ln.computed_cost IS NOT NULL
                             THEN round(coalesce(ln.line_total,0) - ln.computed_cost, 2) ELSE null END,
        'margin_pct', CASE WHEN ln.computed_cost IS NOT NULL AND coalesce(ln.line_total,0) > 0
                           THEN round(((ln.line_total - ln.computed_cost) / ln.line_total) * 100, 1) ELSE null END,
        'line_type', coalesce(ln.line_type,'product'),
        'parent_id', ln.parent_sale_line_id,
        'discount_label', ln.discount_label,
        'original_unit_price', ln.original_unit_price,
        'needs_review', coalesce(ln.map_needs_review,false),
        'unmapped_reason', ln.unmapped_reason,
        'ignored', ln.ignored_at IS NOT NULL,
        'warehouse', null, 'lots', null
      ) ORDER BY ln.parent_sale_line_id NULLS FIRST, ln.product_name)
      FROM lineas ln), '[]'::jsonb)
  ) INTO v_res;

  RETURN v_res;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3) Permisos: solo authenticated ejecuta las dos DEFINER. Nunca anon/public
--    (una función DEFINER es, por definición, más sensible que dejarla a la
--    RLS: si se pudiera colar un anon, correría con los privilegios del
--    creador). list_stock_movements no se toca (sigue abierta a PUBLIC, como
--    ya estaba desde antes de esta migración).
-- ────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.list_item_stock_movements(uuid, uuid, uuid, timestamptz, timestamptz, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_item_stock_movements(uuid, uuid, uuid, timestamptz, timestamptz, integer, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.get_sale_ticket(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sale_ticket(uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 4) Policy de stock_movement: misma semántica, funciones envueltas en SELECT
--    para que el planificador las resuelva como InitPlan (una vez) en vez de
--    reevaluarlas fila a fila.
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS stock_movement_rw ON stock_movement;
CREATE POLICY stock_movement_rw ON stock_movement FOR ALL
  USING ((SELECT current_user_is_admin())
         OR (SELECT current_user_is_admin_or_manager_of(stock_movement.account_id)));

-- ────────────────────────────────────────────────────────────────────────────
-- GUARD — seguridad y permisos exactamente como deben quedar.
-- ────────────────────────────────────────────────────────────────────────────
do $guard$
declare
  v_no_definer text;
  v_filtrable_por_anon text;
  v_policy_missing boolean;
begin
  -- Las dos deben ser SECURITY DEFINER (el guard interno sustituye a la RLS).
  select string_agg(p.proname, ', ') into v_no_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('list_item_stock_movements', 'get_sale_ticket')
    and not p.prosecdef;
  if v_no_definer is not null then
    raise exception 'MIGRACIÓN FALLIDA: deberían ser SECURITY DEFINER: %', v_no_definer;
  end if;

  -- anon/public NO deben poder ejecutarlas.
  select string_agg(routine_name || '/' || grantee, ', ') into v_filtrable_por_anon
  from information_schema.role_routine_grants
  where routine_schema = 'public'
    and routine_name in ('list_item_stock_movements', 'get_sale_ticket')
    and grantee in ('anon', 'PUBLIC');
  if v_filtrable_por_anon is not null then
    raise exception 'MIGRACIÓN FALLIDA: acceso indebido de anon/public: %', v_filtrable_por_anon;
  end if;

  -- authenticated SÍ debe poder.
  if (select count(distinct routine_name) from information_schema.role_routine_grants
      where routine_schema = 'public'
        and routine_name in ('list_item_stock_movements', 'get_sale_ticket')
        and grantee = 'authenticated') <> 2 then
    raise exception 'MIGRACIÓN FALLIDA: authenticated no tiene EXECUTE sobre las dos';
  end if;

  -- La policy existe y sigue siendo la única de tipo ALL en stock_movement.
  select not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stock_movement'
      and policyname = 'stock_movement_rw' and cmd = 'ALL'
  ) into v_policy_missing;
  if v_policy_missing then
    raise exception 'MIGRACIÓN FALLIDA: no quedó la policy stock_movement_rw';
  end if;

  raise notice 'OK — list_item_stock_movements y get_sale_ticket son DEFINER, solo authenticated, policy reescrita.';
end
$guard$;

-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (Julio, ya hecha en vivo — se deja aquí para quien reaplique):
--   - La pantalla de movimientos de un artículo con cientos de filas carga sin
--     "statement timeout".
--   - El origen legible sigue saliendo ("Milanesa Haus · 101734474662") y el
--     acumulado sigue siendo correcto: paginar antes de resolver el origen no
--     cambia QUÉ filas se devuelven, solo CUÁNDO se calcula su referencia.
--   - Con la anon key (sin sesión), get_sale_ticket / list_item_stock_movements
--     deben fallar por falta de privilegio (42501), no devolver datos.
-- ============================================================================
