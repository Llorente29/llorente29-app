-- supabase/migrations/20260604T1400_supply_c2_auto_estado_pedido.sql
--
-- C2 — AUTO-ESTADO DEL PEDIDO. Un sistema automatizado no deja el estado del
-- pedido en manos de un selector manual: al confirmar/anular una recepción, el
-- pedido pasa SOLO a recibido / recibido_parcial / enviado según lo recibido.
--
-- recompute_purchase_order_status(order):
--   · Por cada línea del pedido, suma lo recibido en recepciones CONFIRMADAS
--     (goods_receipt_line.purchase_order_line_id) vs qty_ordered.
--   · TODAS completas (recibido >= pedido; "de más" cuenta como completa) → 'recibido'.
--   · Algo recibido pero no todo → 'recibido_parcial'.
--   · Nada recibido (p. ej. tras anular la única recepción) → 'enviado'.
--   · NO toca estados TERMINALES/MANUALES: 'borrador', 'cancelado', 'cerrado'.
--     Ahí manda el humano (cancelar un pendiente, cerrar uno que no se completará).
--     La automatización nunca cancela ni cierra sola: eso es decisión de negocio.
--
-- Se llama al final de confirm_goods_receipt y void_goods_receipt (cuando la
-- recepción está ligada a un pedido). Atómico con el posteo, server-side.
--
-- "De más" no bloquea (recibido >= pedido = completa). Si recibir de más resulta
-- ser un problema, se tratará con AVISOS del copiloto IA en recepción (C2.2), no
-- alterando el auto-estado.
--
-- SECURITY DEFINER con guard de tenancy. Se prueba DESDE LA APP (auth.uid() null
-- en SQL Editor). Sin BEGIN/COMMIT. CREATE OR REPLACE no invoca las funciones
-- → seguro en SQL Editor.

-- ════════════════════════════════════════════════════════════════════════════
-- 1. recompute_purchase_order_status — el auto-estado
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.recompute_purchase_order_status(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order          purchase_order%ROWTYPE;
  v_total_lines    integer;
  v_complete_lines integer;
  v_any_received   boolean;
  v_new_status     text;
BEGIN
  SELECT * INTO v_order FROM purchase_order WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF NOT (current_user_is_admin()
          OR current_user_is_admin_or_manager_of(v_order.account_id)) THEN
    RAISE EXCEPTION 'recompute_purchase_order_status: sin acceso al pedido %', p_order_id;
  END IF;

  -- Estados terminales/manuales: la automatización no los toca.
  IF v_order.status IN ('borrador', 'cancelado', 'cerrado') THEN
    RETURN v_order.status;
  END IF;

  -- Recibido acumulado por línea (solo recepciones CONFIRMADAS de este pedido)
  -- vs lo pedido. Líneas extra (sin purchase_order_line_id) no cuentan aquí.
  WITH recv AS (
    SELECT grl.purchase_order_line_id AS pol_id,
           SUM(grl.qty_received)       AS qty_recv
    FROM goods_receipt_line grl
    JOIN goods_receipt gr ON gr.id = grl.goods_receipt_id
    WHERE gr.purchase_order_id = p_order_id
      AND gr.status = 'confirmado'
      AND grl.purchase_order_line_id IS NOT NULL
    GROUP BY grl.purchase_order_line_id
  ),
  per_line AS (
    SELECT pol.id,
           pol.qty_ordered,
           COALESCE(r.qty_recv, 0) AS qty_recv
    FROM purchase_order_line pol
    LEFT JOIN recv r ON r.pol_id = pol.id
    WHERE pol.purchase_order_id = p_order_id
  )
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE qty_recv >= qty_ordered),
         COALESCE(bool_or(qty_recv > 0), false)
  INTO v_total_lines, v_complete_lines, v_any_received
  FROM per_line;

  IF v_total_lines = 0 THEN
    RETURN v_order.status;                 -- pedido sin líneas: no tocar
  ELSIF v_complete_lines = v_total_lines THEN
    v_new_status := 'recibido';
  ELSIF v_any_received THEN
    v_new_status := 'recibido_parcial';
  ELSE
    v_new_status := 'enviado';             -- nada recibido (p. ej. tras anular)
  END IF;

  IF v_new_status <> v_order.status THEN
    UPDATE purchase_order
      SET status = v_new_status, updated_at = now()
      WHERE id = p_order_id;
  END IF;

  RETURN v_new_status;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. confirm_goods_receipt — IDÉNTICA a la migración B + auto-estado al final
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

  v_user := auth.uid();
  SELECT display_name INTO v_user_name FROM user_profiles WHERE id = v_user;

  FOR v_line IN
    SELECT * FROM goods_receipt_line
    WHERE goods_receipt_id = p_receipt_id
    ORDER BY position ASC, created_at ASC
  LOOP
    IF v_line.recipe_item_id IS NULL
       OR v_line.qty_in_base IS NULL
       OR v_line.qty_in_base <= 0 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

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
      true,
      'goods_receipt_line',
      v_line.id,
      v_line.lot_code,
      v_line.expiry_date,
      COALESCE(v_receipt.received_at, now()),
      v_user, v_user_name
    );

    PERFORM recompute_location_stock(v_line.recipe_item_id, v_receipt.location_id);

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

  UPDATE goods_receipt
    SET status       = 'confirmado',
        received_at  = COALESCE(received_at, now()),
        needs_review = (v_skipped > 0),
        updated_at   = now()
    WHERE id = p_receipt_id;

  -- AUTO-ESTADO DEL PEDIDO (nuevo): si el albarán está ligado a un pedido,
  -- recalcula su estado según lo recibido. No interviene el humano.
  IF v_receipt.purchase_order_id IS NOT NULL THEN
    PERFORM recompute_purchase_order_status(v_receipt.purchase_order_id);
  END IF;

  posted_lines  := v_posted;
  skipped_lines := v_skipped;
  RETURN NEXT;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. void_goods_receipt — IDÉNTICA a la migración B + auto-estado al final
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
      'ajuste', -v_mov.qty_base,
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

  -- AUTO-ESTADO DEL PEDIDO (nuevo): al anular, el recibido acumulado baja →
  -- el pedido recalcula (recibido_parcial o vuelve a enviado si no queda nada).
  IF v_receipt.purchase_order_id IS NOT NULL THEN
    PERFORM recompute_purchase_order_status(v_receipt.purchase_order_id);
  END IF;

  RETURN v_reversed;
END;
$$;
