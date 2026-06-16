-- ═══════════════════════════════════════════════════════════════════════
-- Aprovisionamiento a €/UNIDAD BASE (sesión 16/06/2026)
-- Reconstrucción del motor de coste/compras: last_price pasa de €/formato a
-- €/base; escritores de recepción/factura, alarmas de precio (puntual/pactado/
-- deriva), anulado que revierte precio. Volcado FIEL del estado vivo de la BBDD.
-- Idempotente: CREATE OR REPLACE + ADD COLUMN IF NOT EXISTS.
-- Los UPDATE de datos del cimiento NO se incluyen: ya se ejecutaron; aquí solo
-- va el ESQUEMA y las FUNCIONES.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Columnas nuevas ──────────────────────────────────────────────────────
ALTER TABLE public.article_supplier
  ADD COLUMN IF NOT EXISTS negotiated_price numeric;
COMMENT ON COLUMN public.article_supplier.negotiated_price IS
  'Precio PACTADO con el proveedor en €/unidad base (€/g, €/ml, €/ud), misma unidad que last_price. Distinto del último pagado: es lo acordado, contra lo que se mide si el proveedor cobra de más. NULL = sin pacto registrado.';

ALTER TABLE public.supply_settings
  ADD COLUMN IF NOT EXISTS negotiated_alert_pct numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drift_alert_pct      numeric NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS drift_window_months  integer NOT NULL DEFAULT 6;

-- ── 1) _eur_base_from_format ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._eur_base_from_format(p_format_id uuid, p_price_per_format numeric)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_price_per_format IS NULL THEN NULL
    ELSE p_price_per_format / NULLIF(f.qty_in_base, 0)
  END
  FROM recipe_item_purchase_format f
  WHERE f.id = p_format_id AND f.is_active;
$function$;

-- ── 2) kitchen_recompute_raw_cost ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kitchen_recompute_raw_cost(p_item_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item recipe_item%ROWTYPE;
  v_link article_supplier%ROWTYPE;
  v_cost numeric;
BEGIN
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kitchen_recompute_raw_cost: item % no existe', p_item_id;
  END IF;
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(v_item.account_id)) THEN
    RAISE EXCEPTION 'kitchen_recompute_raw_cost: sin acceso al item %', p_item_id;
  END IF;
  IF v_item.type NOT IN ('raw','tool') THEN
    RETURN COALESCE(v_item.computed_cost, 0);
  END IF;
  IF v_item.cost_strategy = 'fixed' THEN
    v_cost := COALESCE(v_item.fixed_cost, 0);
    UPDATE recipe_item SET computed_cost = v_cost, cost_updated_at = now() WHERE id = p_item_id;
    RETURN v_cost;
  END IF;
  -- DESACOPLADO: basta precio €/base; el formato ya NO es requisito del coste.
  SELECT a.* INTO v_link FROM article_supplier a
    WHERE a.recipe_item_id = p_item_id AND a.is_active AND a.last_price IS NOT NULL
    ORDER BY a.is_preferred DESC, a.updated_at DESC LIMIT 1;
  IF FOUND THEN
    v_cost := v_link.last_price;             -- last_price ES €/base
    UPDATE recipe_item SET computed_cost = v_cost, cost_updated_at = now() WHERE id = p_item_id;
    RETURN v_cost;
  END IF;
  -- Sin precio utilizable: no inventamos, marcamos y conservamos el anterior.
  UPDATE recipe_item SET needs_review = true, cost_updated_at = now() WHERE id = p_item_id;
  RETURN COALESCE(v_item.computed_cost, v_item.fixed_cost, 0);
END;
$function$;

-- ── 3) supplier_format_prices ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.supplier_format_prices(p_account_id uuid, p_supplier_id uuid)
 RETURNS TABLE(format_id uuid, eur_per_base numeric)
 LANGUAGE sql
 STABLE
AS $function$
  -- (1) formatos con precio propio de este proveedor: €/base = last_price directo.
  SELECT pf.id AS format_id,
         as2.last_price AS eur_per_base
  FROM article_supplier as2
  JOIN recipe_item_purchase_format pf ON pf.id = as2.purchase_format_id
  WHERE as2.account_id = p_account_id
    AND as2.supplier_id = p_supplier_id
    AND as2.is_active
    AND as2.last_price IS NOT NULL
  UNION ALL
  -- (2) sub-envases SIN precio propio que heredan el del padre con precio de este
  -- proveedor. Mismo ingrediente → mismo €/base → last_price directo (sin escalar).
  SELECT sub.id AS format_id,
         as2.last_price AS eur_per_base
  FROM recipe_item_purchase_format caja
  JOIN article_supplier as2
    ON as2.purchase_format_id = caja.id
   AND as2.account_id  = p_account_id
   AND as2.supplier_id = p_supplier_id
   AND as2.is_active
   AND as2.last_price IS NOT NULL
  JOIN recipe_item_purchase_format sub
    ON sub.id = caja.parent_format_id
  WHERE caja.account_id = p_account_id
    AND sub.id NOT IN (
      SELECT a3.purchase_format_id FROM article_supplier a3
      WHERE a3.account_id = p_account_id AND a3.supplier_id = p_supplier_id
        AND a3.is_active AND a3.purchase_format_id IS NOT NULL
    );
$function$;

-- ── 4) confirm_goods_receipt ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.confirm_goods_receipt(p_receipt_id uuid)
 RETURNS TABLE(posted_lines integer, skipped_lines integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_receipt   goods_receipt%ROWTYPE;
  v_line      goods_receipt_line%ROWTYPE;
  v_user      uuid;
  v_user_name text;
  v_posted    integer := 0;
  v_skipped   integer := 0;
  v_fmt_qib   numeric;
  v_qib       numeric;
  v_eur_base  numeric;   -- €/base canónico (precio_formato / qty_in_base_formato)
BEGIN
  SELECT * INTO v_receipt FROM goods_receipt WHERE id = p_receipt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirm_goods_receipt: albarán % no existe', p_receipt_id;
  END IF;
  IF NOT (current_user_is_admin()
          OR current_user_is_admin_or_manager_of(v_receipt.account_id)) THEN
    RAISE EXCEPTION 'confirm_goods_receipt: sin acceso al albarán %', p_receipt_id;
  END IF;
  IF v_receipt.status <> 'borrador' THEN
    RAISE EXCEPTION 'confirm_goods_receipt: el albarán % no está en borrador (está %)',
      p_receipt_id, v_receipt.status;
  END IF;

  v_user := auth.uid();
  SELECT display_name INTO v_user_name FROM user_profiles WHERE id = v_user;

  FOR v_line IN
    SELECT * FROM goods_receipt_line
    WHERE goods_receipt_id = p_receipt_id
    ORDER BY position ASC, created_at ASC
  LOOP
    v_qib := NULL;
    IF v_line.purchase_format_id IS NOT NULL THEN
      SELECT f.qty_in_base INTO v_fmt_qib
        FROM recipe_item_purchase_format f
        WHERE f.id = v_line.purchase_format_id AND f.is_active;
      IF v_fmt_qib IS NOT NULL AND v_fmt_qib > 0
         AND v_line.qty_received IS NOT NULL AND v_line.qty_received > 0 THEN
        v_qib := v_line.qty_received * v_fmt_qib;
      END IF;
    END IF;
    IF v_qib IS NULL THEN
      v_qib := v_line.qty_in_base;
    END IF;

    IF v_line.recipe_item_id IS NULL OR v_qib IS NULL OR v_qib <= 0 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_qib IS DISTINCT FROM v_line.qty_in_base THEN
      UPDATE goods_receipt_line
        SET qty_in_base = v_qib, updated_at = now()
        WHERE id = v_line.id;
    END IF;

    v_eur_base := public._eur_base_from_format(v_line.purchase_format_id, v_line.unit_cost);

    INSERT INTO stock_movement (
      account_id, location_id, recipe_item_id,
      movement_type, qty_base, unit_cost, cost_provisional,
      source_type, source_id, lot_code, expiry_date,
      occurred_at, created_by, created_by_name
    )
    VALUES (
      v_receipt.account_id, v_receipt.location_id, v_line.recipe_item_id,
      'recepcion', v_qib,
      COALESCE(
        v_eur_base,
        CASE WHEN v_line.unit_cost IS NOT NULL AND v_line.qty_received > 0
             THEN (v_line.unit_cost * v_line.qty_received) / v_qib END
      ),
      true,
      'goods_receipt_line', v_line.id,
      v_line.lot_code, v_line.expiry_date,
      COALESCE(v_receipt.received_at, now()), v_user, v_user_name
    );

    PERFORM recompute_location_stock(v_line.recipe_item_id, v_receipt.location_id);

    IF v_eur_base IS NOT NULL AND v_line.purchase_format_id IS NOT NULL THEN
      UPDATE article_supplier
        SET last_price = v_eur_base, updated_at = now()
        WHERE account_id        = v_receipt.account_id
          AND recipe_item_id    = v_line.recipe_item_id
          AND purchase_format_id = v_line.purchase_format_id
          AND is_active;
    END IF;

    v_posted := v_posted + 1;
  END LOOP;

  UPDATE goods_receipt
    SET status = 'confirmado', received_at = COALESCE(received_at, now()),
        needs_review = (v_skipped > 0), updated_at = now()
    WHERE id = p_receipt_id;

  IF v_receipt.purchase_order_id IS NOT NULL THEN
    PERFORM recompute_purchase_order_status(v_receipt.purchase_order_id);
  END IF;

  posted_lines := v_posted; skipped_lines := v_skipped;
  RETURN NEXT;
END;
$function$;

-- ── 5) learn_from_receipt ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.learn_from_receipt(p_receipt_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_receipt goods_receipt%ROWTYPE;
  v_line    goods_receipt_line%ROWTYPE;
  v_count   integer := 0;
  v_eur_base numeric;
BEGIN
  SELECT * INTO v_receipt FROM goods_receipt WHERE id = p_receipt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'learn_from_receipt: albarán % no existe', p_receipt_id;
  END IF;
  IF NOT (current_user_is_admin()
          OR current_user_is_admin_or_manager_of(v_receipt.account_id)) THEN
    RAISE EXCEPTION 'learn_from_receipt: sin acceso al albarán %', p_receipt_id;
  END IF;
  IF v_receipt.supplier_id IS NULL THEN RETURN 0; END IF;

  FOR v_line IN
    SELECT * FROM goods_receipt_line
    WHERE goods_receipt_id = p_receipt_id AND recipe_item_id IS NOT NULL
  LOOP
    v_eur_base := public._eur_base_from_format(v_line.purchase_format_id, v_line.unit_cost);

    INSERT INTO article_supplier (
      account_id, recipe_item_id, supplier_id,
      supplier_code, supplier_item_name, last_price, purchase_format_id,
      is_preferred, is_active
    )
    VALUES (
      v_receipt.account_id, v_line.recipe_item_id, v_receipt.supplier_id,
      NULLIF(btrim(coalesce(v_line.supplier_code, '')), ''),
      NULLIF(btrim(coalesce(v_line.raw_text, v_line.product_name, '')), ''),
      v_eur_base,
      v_line.purchase_format_id,
      false, true
    )
    ON CONFLICT (recipe_item_id, supplier_id) DO UPDATE SET
      supplier_code      = COALESCE(NULLIF(btrim(coalesce(EXCLUDED.supplier_code, '')), ''), article_supplier.supplier_code),
      supplier_item_name = COALESCE(EXCLUDED.supplier_item_name, article_supplier.supplier_item_name),
      last_price         = COALESCE(EXCLUDED.last_price, article_supplier.last_price),
      purchase_format_id = COALESCE(EXCLUDED.purchase_format_id, article_supplier.purchase_format_id),
      is_active          = true,
      updated_at         = now();

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- ── 6) apply_invoice_costs ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_invoice_costs(p_invoice_id uuid)
 RETURNS TABLE(recipe_item_id uuid, item_name text, old_cost numeric, new_cost numeric, old_price numeric, new_price numeric, pct numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_supplier_id uuid;
  v_line record;
  v_old_cost numeric;
  v_new_cost numeric;
  v_old_price numeric;
  v_fmt uuid;
  v_new_base numeric;
BEGIN
  SELECT account_id, supplier_id INTO v_account_id, v_supplier_id
    FROM public.supplier_invoice WHERE id = p_invoice_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Factura % no encontrada', p_invoice_id;
  END IF;

  CREATE TEMP TABLE _impact (
    recipe_item_id uuid, item_name text, old_cost numeric, new_cost numeric,
    old_price numeric, new_price numeric, pct numeric
  ) ON COMMIT DROP;

  FOR v_line IN
    SELECT sil.recipe_item_id, sil.unit_price
      FROM public.supplier_invoice_line sil
      WHERE sil.supplier_invoice_id = p_invoice_id
        AND sil.recipe_item_id IS NOT NULL
        AND sil.unit_price IS NOT NULL
  LOOP
    IF v_supplier_id IS NULL THEN CONTINUE; END IF;

    SELECT computed_cost INTO v_old_cost FROM public.recipe_item WHERE id = v_line.recipe_item_id;
    SELECT last_price, purchase_format_id INTO v_old_price, v_fmt
      FROM public.article_supplier
      WHERE account_id = v_account_id AND recipe_item_id = v_line.recipe_item_id
        AND supplier_id = v_supplier_id;

    v_new_base := public._eur_base_from_format(v_fmt, v_line.unit_price);
    IF v_new_base IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.article_supplier (account_id, recipe_item_id, supplier_id, last_price)
    VALUES (v_account_id, v_line.recipe_item_id, v_supplier_id, v_new_base)
    ON CONFLICT (recipe_item_id, supplier_id)
    DO UPDATE SET last_price = EXCLUDED.last_price;

    SELECT computed_cost INTO v_new_cost FROM public.recipe_item WHERE id = v_line.recipe_item_id;

    INSERT INTO _impact (recipe_item_id, item_name, old_cost, new_cost, old_price, new_price, pct)
    SELECT v_line.recipe_item_id,
           (SELECT name FROM public.recipe_item WHERE id = v_line.recipe_item_id),
           v_old_cost, v_new_cost, v_old_price, v_new_base,
           CASE WHEN v_old_price IS NOT NULL AND v_old_price > 0
                THEN round(((v_new_base - v_old_price) / v_old_price) * 100, 1) END
    WHERE NOT EXISTS (SELECT 1 FROM _impact i WHERE i.recipe_item_id = v_line.recipe_item_id);
  END LOOP;

  RETURN QUERY
    SELECT i.recipe_item_id, i.item_name, i.old_cost, i.new_cost, i.old_price, i.new_price, i.pct
    FROM _impact i ORDER BY abs(COALESCE(i.pct, 0)) DESC;
END;
$function$;

-- ── 7) price_drift_for ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.price_drift_for(p_account_id uuid, p_item_id uuid, p_window_months integer DEFAULT 6)
 RETURNS TABLE(actual_eur_base numeric, median_eur_base numeric, n_recepciones integer, pct_vs_median numeric)
 LANGUAGE sql
 STABLE
AS $function$
  WITH recs AS (
    SELECT sm.unit_cost, sm.occurred_at
    FROM stock_movement sm
    JOIN goods_receipt_line grl ON grl.id = sm.source_id AND sm.source_type = 'goods_receipt_line'
    JOIN goods_receipt gr       ON gr.id = grl.goods_receipt_id
    WHERE sm.account_id = p_account_id
      AND sm.recipe_item_id = p_item_id
      AND sm.movement_type = 'recepcion'
      AND sm.unit_cost IS NOT NULL
      AND sm.unit_cost > 0
      AND gr.status = 'confirmado'
      AND sm.occurred_at >= now() - make_interval(months => p_window_months)
  ),
  agg AS (
    SELECT
      (SELECT unit_cost FROM recs ORDER BY occurred_at DESC LIMIT 1)                       AS actual,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY unit_cost)::numeric                       AS mediana,
      count(*)                                                                              AS n
    FROM recs
  )
  SELECT
    agg.actual,
    agg.mediana,
    agg.n::integer,
    CASE WHEN agg.mediana > 0
         THEN round(((agg.actual - agg.mediana) / agg.mediana) * 100, 1)
         ELSE NULL END
  FROM agg
  WHERE agg.n > 0;
$function$;

-- ── 8) void_goods_receipt ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.void_goods_receipt(p_receipt_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_receipt   goods_receipt%ROWTYPE;
  v_mov       stock_movement%ROWTYPE;
  v_line      goods_receipt_line%ROWTYPE;
  v_user      uuid;
  v_user_name text;
  v_reversed  integer := 0;
  v_new_price numeric;
BEGIN
  SELECT * INTO v_receipt FROM goods_receipt WHERE id = p_receipt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_goods_receipt: albarán % no existe', p_receipt_id;
  END IF;
  IF NOT (current_user_is_admin()
          OR current_user_is_admin_or_manager_of(v_receipt.account_id)) THEN
    RAISE EXCEPTION 'void_goods_receipt: sin acceso al albarán %', p_receipt_id;
  END IF;
  IF v_receipt.status <> 'confirmado' THEN
    RAISE EXCEPTION 'void_goods_receipt: el albarán % no está confirmado (está %)',
      p_receipt_id, v_receipt.status;
  END IF;
  v_user := auth.uid();
  SELECT display_name INTO v_user_name FROM user_profiles WHERE id = v_user;

  FOR v_mov IN
    SELECT sm.* FROM stock_movement sm
    JOIN goods_receipt_line grl ON grl.id = sm.source_id
    WHERE sm.source_type = 'goods_receipt_line'
      AND grl.goods_receipt_id = p_receipt_id
      AND sm.movement_type = 'recepcion'
  LOOP
    INSERT INTO stock_movement (
      account_id, location_id, recipe_item_id,
      movement_type, qty_base, unit_cost, cost_provisional,
      source_type, source_id, lot_code, expiry_date,
      occurred_at, notes, created_by, created_by_name
    )
    VALUES (
      v_mov.account_id, v_mov.location_id, v_mov.recipe_item_id,
      'ajuste', -v_mov.qty_base, v_mov.unit_cost, v_mov.cost_provisional,
      'goods_receipt_line', v_mov.source_id, v_mov.lot_code, v_mov.expiry_date,
      now(), 'Reverso por anulación de albarán ' || COALESCE(v_receipt.code, p_receipt_id::text),
      v_user, v_user_name
    );
    PERFORM recompute_location_stock(v_mov.recipe_item_id, v_mov.location_id);
    v_reversed := v_reversed + 1;
  END LOOP;

  UPDATE goods_receipt SET status = 'anulado', updated_at = now()
    WHERE id = p_receipt_id;

  IF v_receipt.supplier_id IS NOT NULL THEN
    FOR v_line IN
      SELECT * FROM goods_receipt_line
      WHERE goods_receipt_id = p_receipt_id AND recipe_item_id IS NOT NULL
    LOOP
      SELECT sm.unit_cost INTO v_new_price
      FROM stock_movement sm
      JOIN goods_receipt_line grl2 ON grl2.id = sm.source_id AND sm.source_type = 'goods_receipt_line'
      JOIN goods_receipt gr2 ON gr2.id = grl2.goods_receipt_id
      WHERE sm.movement_type = 'recepcion'
        AND sm.recipe_item_id = v_line.recipe_item_id
        AND gr2.supplier_id = v_receipt.supplier_id
        AND gr2.status = 'confirmado'
        AND grl2.purchase_format_id IS NOT DISTINCT FROM v_line.purchase_format_id
        AND gr2.id <> p_receipt_id
      ORDER BY sm.occurred_at DESC
      LIMIT 1;

      UPDATE article_supplier
        SET last_price = v_new_price, updated_at = now()
        WHERE account_id = v_receipt.account_id
          AND recipe_item_id = v_line.recipe_item_id
          AND supplier_id = v_receipt.supplier_id
          AND purchase_format_id IS NOT DISTINCT FROM v_line.purchase_format_id
          AND is_active;

      PERFORM kitchen_recompute_raw_cost(v_line.recipe_item_id);
    END LOOP;
  END IF;

  IF v_receipt.purchase_order_id IS NOT NULL THEN
    PERFORM recompute_purchase_order_status(v_receipt.purchase_order_id);
  END IF;

  RETURN v_reversed;
END;
$function$;
