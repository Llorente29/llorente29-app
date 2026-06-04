-- supabase/migrations/20260604T1200_supply_c2_ledger_logic.sql
--
-- C2 — lógica del LIBRO MAYOR de stock (sobre la estructura de la migración A).
-- Tres funciones SECURITY DEFINER con guard de tenancy (patrón kitchen_recompute_*):
--   1) recompute_location_stock(item, location) — recalcula el snapshot EXACTO
--      desde el ledger (SUM con signo de qty × unit_cost). Reconstruible siempre.
--   2) confirm_goods_receipt(receipt)            — borrador→confirmado: postea una
--      entrada por línea resuelta (anti-invención: needs_review NO postea) y
--      refresca el snapshot. Actualiza last_price del article_supplier (dispara el
--      recompute de coste de escandallo que YA existe → ripple al margen por canal).
--   3) void_goods_receipt(receipt)               — confirmado→anulado: postea el
--      REVERSO de cada movimiento (mismo coste sellado) y refresca. Ledger
--      append-only: no se borra ni edita nada, se deshace con asientos contrarios.
--
-- INVARIANTE DE VALORACIÓN (WAC perpetuo, append-only):
--   · Cada stock_movement lleva su unit_cost SELLADO en el momento del asiento.
--   · ENTRADAS (recepcion, ajuste +, traspaso_entrada): unit_cost = coste real de
--     la entrada (provisional si viene de albarán sin factura; C3 lo revalúa).
--   · SALIDAS (consumo, ajuste −, traspaso_salida): unit_cost = WAC del instante,
--     leído del snapshot ANTES de postear la salida. (Lo usará el frente de consumo;
--     se deja documentado para enchufar sin reescribir la valoración.)
--   · Valor del stock = SUM(qty_base × unit_cost) con signo  → SIEMPRE exacto.
--   · WAC = stock_value / qty_on_hand (NULL si qty_on_hand = 0).
--   Un SUM "ingenuo" solo de recepciones sería INCORRECTO con salidas: por eso el
--   coste se sella por movimiento, no se reconstruye de las compras.
--
-- SEGURIDAD: SECURITY DEFINER salta RLS → validamos acceso explícitamente.
--   auth.uid() es NULL en el SQL Editor → estas funciones NO se prueban ahí:
--   se prueban DESDE LA APP (con sesión) y NUNCA en la misma transacción que las crea.
-- Sin BEGIN/COMMIT. Verificar con information_schema/pg_proc en transacción aparte.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. recompute_location_stock — snapshot EXACTO desde el ledger (reconstruible)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.recompute_location_stock(
  p_item_id     uuid,
  p_location_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_qty        numeric;
  v_value      numeric;
  v_avg        numeric;
BEGIN
  SELECT account_id INTO v_account_id FROM recipe_item WHERE id = p_item_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'recompute_location_stock: item % no existe', p_item_id;
  END IF;

  IF NOT (current_user_is_admin()
          OR current_user_is_admin_or_manager_of(v_account_id)) THEN
    RAISE EXCEPTION 'recompute_location_stock: sin acceso al item %', p_item_id;
  END IF;

  -- Suma con signo del ledger: qty_base ya es + (entra) / − (sale).
  -- El valor usa el unit_cost SELLADO de cada movimiento.
  SELECT
    COALESCE(SUM(qty_base), 0),
    COALESCE(SUM(qty_base * COALESCE(unit_cost, 0)), 0)
  INTO v_qty, v_value
  FROM stock_movement
  WHERE recipe_item_id = p_item_id
    AND location_id    = p_location_id;

  -- Guarda anti-negativos por redondeo: si el neto es ~0, normaliza a 0.
  IF abs(v_qty) < 0.0000001 THEN
    v_qty   := 0;
    v_value := 0;
  END IF;

  v_avg := CASE WHEN v_qty > 0 THEN v_value / v_qty ELSE NULL END;

  INSERT INTO recipe_item_location_stock
    (account_id, recipe_item_id, location_id, qty_on_hand, avg_unit_cost, stock_value, updated_at)
  VALUES
    (v_account_id, p_item_id, p_location_id, v_qty, v_avg, v_value, now())
  ON CONFLICT (recipe_item_id, location_id) DO UPDATE
    SET qty_on_hand   = EXCLUDED.qty_on_hand,
        avg_unit_cost = EXCLUDED.avg_unit_cost,
        stock_value   = EXCLUDED.stock_value,
        updated_at    = now();
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. confirm_goods_receipt — borrador→confirmado: postea entradas + refresca
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.confirm_goods_receipt(p_receipt_id uuid)
RETURNS TABLE (
  posted_lines   integer,
  skipped_lines  integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt   goods_receipt%ROWTYPE;
  v_line      goods_receipt_line%ROWTYPE;
  v_user      uuid;
  v_user_name text;
  v_posted    integer := 0;
  v_skipped   integer := 0;
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

  -- Autoría del asiento (auth.uid() existe porque se llama DESDE LA APP).
  v_user := auth.uid();
  SELECT display_name INTO v_user_name FROM user_profiles WHERE id = v_user;

  FOR v_line IN
    SELECT * FROM goods_receipt_line
    WHERE goods_receipt_id = p_receipt_id
    ORDER BY position ASC, created_at ASC
  LOOP
    -- ANTI-INVENCIÓN: solo postea líneas con artículo Y cantidad-en-base resueltos
    -- y con cantidad real positiva. Lo demás se queda sin postear (needs_review).
    IF v_line.recipe_item_id IS NULL
       OR v_line.qty_in_base IS NULL
       OR v_line.qty_in_base <= 0 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Asiento de ENTRADA. unit_cost del albarán = provisional (lo fija C3).
    -- Coste por unidad BASE = unit_cost (de compra) / (qty_in_base / qty_received)
    -- → es decir, coste_total_línea / qty_in_base. Si no hay precio, NULL.
    INSERT INTO stock_movement (
      account_id, location_id, recipe_item_id,
      movement_type, qty_base,
      unit_cost, cost_provisional,
      source_type, source_id,
      lot_code, expiry_date,
      occurred_at, created_by, created_by_name
    )
    VALUES (
      v_receipt.account_id,
      v_receipt.location_id,
      v_line.recipe_item_id,
      'recepcion',
      v_line.qty_in_base,
      CASE
        WHEN v_line.unit_cost IS NOT NULL AND v_line.qty_received > 0
        THEN (v_line.unit_cost * v_line.qty_received) / v_line.qty_in_base
        ELSE NULL
      END,
      true,                       -- provisional: albarán sin factura confirmada
      'goods_receipt_line',
      v_line.id,
      v_line.lot_code,
      v_line.expiry_date,
      COALESCE(v_receipt.received_at, now()),
      v_user, v_user_name
    );

    -- Snapshot exacto para ese artículo+local.
    PERFORM recompute_location_stock(v_line.recipe_item_id, v_receipt.location_id);

    -- Eslabón al coste de escandallo: si la línea trae precio, refresca last_price
    -- del vínculo proveedor↔artículo del formato recibido. El trigger
    -- trg_article_supplier_recompute_cost recalcula el escandallo → ripple a
    -- menu_item_economics (margen por marca/canal). NO tocamos kitchen_recompute_*.
    IF v_line.unit_cost IS NOT NULL AND v_line.purchase_format_id IS NOT NULL THEN
      UPDATE article_supplier
        SET last_price = v_line.unit_cost,
            updated_at = now()
        WHERE account_id        = v_receipt.account_id
          AND recipe_item_id    = v_line.recipe_item_id
          AND purchase_format_id = v_line.purchase_format_id
          AND is_active;
    END IF;

    v_posted := v_posted + 1;
  END LOOP;

  -- Cierra el albarán. Si quedaron líneas sin postear, lo deja marcado.
  UPDATE goods_receipt
    SET status       = 'confirmado',
        received_at  = COALESCE(received_at, now()),
        needs_review = (v_skipped > 0),
        updated_at   = now()
    WHERE id = p_receipt_id;

  posted_lines  := v_posted;
  skipped_lines := v_skipped;
  RETURN NEXT;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. void_goods_receipt — confirmado→anulado: REVERSO append-only
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.void_goods_receipt(p_receipt_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt   goods_receipt%ROWTYPE;
  v_mov       stock_movement%ROWTYPE;
  v_user      uuid;
  v_user_name text;
  v_reversed  integer := 0;
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

  -- Por cada movimiento original de este albarán, postea su CONTRARIO con el
  -- MISMO coste sellado (deshacer exacto). No se borra el original: append-only.
  FOR v_mov IN
    SELECT sm.* FROM stock_movement sm
    JOIN goods_receipt_line grl ON grl.id = sm.source_id
    WHERE sm.source_type = 'goods_receipt_line'
      AND grl.goods_receipt_id = p_receipt_id
      AND sm.movement_type = 'recepcion'
  LOOP
    INSERT INTO stock_movement (
      account_id, location_id, recipe_item_id,
      movement_type, qty_base,
      unit_cost, cost_provisional,
      source_type, source_id,
      lot_code, expiry_date,
      occurred_at, notes, created_by, created_by_name
    )
    VALUES (
      v_mov.account_id, v_mov.location_id, v_mov.recipe_item_id,
      'ajuste', -v_mov.qty_base,          -- reverso: signo contrario
      v_mov.unit_cost, v_mov.cost_provisional,
      'goods_receipt_line', v_mov.source_id,
      v_mov.lot_code, v_mov.expiry_date,
      now(), 'Reverso por anulación de albarán ' || COALESCE(v_receipt.code, p_receipt_id::text),
      v_user, v_user_name
    );

    PERFORM recompute_location_stock(v_mov.recipe_item_id, v_mov.location_id);
    v_reversed := v_reversed + 1;
  END LOOP;

  UPDATE goods_receipt
    SET status = 'anulado', updated_at = now()
    WHERE id = p_receipt_id;

  RETURN v_reversed;
END;
$$;
