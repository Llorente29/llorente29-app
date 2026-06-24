-- supabase/migrations/20260623T2200_post_pending_receipt_line.sql
-- Aplicada: 2026-06-23
--
-- TAPA EL AGUJERO: postear líneas de recepción CONFIRMADAS que quedaron SIN
-- movimiento de stock (porque al confirmar no tenían formato y se saltaron).
--
-- Antes, confirm_goods_receipt saltaba (CONTINUE) las líneas sin formato/sin
-- qty_in_base resoluble, marcaba needs_review y seguía. El stock NUNCA entraba,
-- y no había forma de recuperarlo aunque luego se montara el formato. Esta
-- función mete ese stock a posteriori, una vez el artículo ya tiene formato.
--
-- Resuelve el formato así: (1) el de la propia línea si lo tiene; si no,
-- (2) el del proveedor PREFERIDO del artículo (article_supplier.purchase_format_id),
-- que es el formato de compra real. Si no hay ninguno, no postea (sigue pendiente).
-- Idempotente: si la línea ya tiene movimiento, no hace nada.

CREATE OR REPLACE FUNCTION public.post_pending_receipt_line(p_line_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_line     goods_receipt_line%ROWTYPE;
  v_receipt  goods_receipt%ROWTYPE;
  v_fmt_id   uuid;
  v_fmt_qib  numeric;
  v_qib      numeric;
  v_eur_base numeric;
  v_area_id  uuid;
  v_user     uuid;
  v_user_name text;
BEGIN
  SELECT * INTO v_line FROM goods_receipt_line WHERE id = p_line_id;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT * INTO v_receipt FROM goods_receipt WHERE id = v_line.goods_receipt_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT belongs_to_account(v_receipt.account_id) THEN
    RAISE EXCEPTION 'post_pending_receipt_line: sin acceso';
  END IF;

  -- Solo recepciones confirmadas (no borradores: ésos los postea confirm_goods_receipt).
  IF v_receipt.status <> 'confirmado' THEN RETURN false; END IF;

  -- Idempotencia: si ya hay movimiento de esta línea, nada que hacer.
  IF EXISTS (SELECT 1 FROM stock_movement
             WHERE source_type='goods_receipt_line' AND source_id = p_line_id) THEN
    RETURN false;
  END IF;

  IF v_line.recipe_item_id IS NULL THEN RETURN false; END IF;

  -- Resolver formato: el de la línea, o el del proveedor PREFERIDO del artículo.
  v_fmt_id := v_line.purchase_format_id;
  IF v_fmt_id IS NULL THEN
    SELECT a.purchase_format_id INTO v_fmt_id
    FROM article_supplier a
    WHERE a.recipe_item_id = v_line.recipe_item_id
      AND a.account_id = v_receipt.account_id
      AND a.is_active
      AND a.purchase_format_id IS NOT NULL
    ORDER BY a.is_preferred DESC, a.updated_at DESC
    LIMIT 1;
  END IF;

  -- Calcular qty_in_base
  v_qib := NULL;
  IF v_fmt_id IS NOT NULL THEN
    SELECT f.qty_in_base INTO v_fmt_qib
      FROM recipe_item_purchase_format f
      WHERE f.id = v_fmt_id AND f.is_active;
    IF v_fmt_qib IS NOT NULL AND v_fmt_qib > 0
       AND v_line.qty_received IS NOT NULL AND v_line.qty_received > 0 THEN
      v_qib := v_line.qty_received * v_fmt_qib;
    END IF;
  END IF;
  IF v_qib IS NULL THEN v_qib := v_line.qty_in_base; END IF;

  -- Si seguimos sin poder calcular cuánto entra, no posteamos (sigue pendiente).
  IF v_qib IS NULL OR v_qib <= 0 THEN RETURN false; END IF;

  -- Persistir el formato resuelto y la conversión en la línea (deja rastro).
  UPDATE goods_receipt_line
    SET purchase_format_id = COALESCE(purchase_format_id, v_fmt_id),
        qty_in_base = v_qib, updated_at = now()
    WHERE id = p_line_id;

  v_eur_base := public._eur_base_from_format(v_fmt_id, v_line.unit_cost);

  -- Zona principal del artículo en el local
  v_area_id := NULL;
  SELECT sa.id INTO v_area_id
    FROM recipe_item_storage_area risa
    JOIN storage_area sa ON sa.id = risa.storage_area_id
    WHERE risa.recipe_item_id = v_line.recipe_item_id
      AND risa.account_id     = v_receipt.account_id
      AND sa.location_id      = v_receipt.location_id
      AND sa.active
    ORDER BY risa.position ASC, sa.position ASC
    LIMIT 1;

  v_user := auth.uid();
  SELECT display_name INTO v_user_name FROM user_profiles WHERE id = v_user;

  INSERT INTO stock_movement (
    account_id, location_id, recipe_item_id, storage_area_id,
    movement_type, qty_base, unit_cost, cost_provisional,
    source_type, source_id, lot_code, expiry_date,
    occurred_at, created_by, created_by_name, notes
  )
  VALUES (
    v_receipt.account_id, v_receipt.location_id, v_line.recipe_item_id, v_area_id,
    'recepcion', v_qib,
    COALESCE(
      v_eur_base,
      CASE WHEN v_line.unit_cost IS NOT NULL AND v_line.qty_received > 0
           THEN (v_line.unit_cost * v_line.qty_received) / v_qib END
    ),
    true,
    'goods_receipt_line', p_line_id,
    v_line.lot_code, v_line.expiry_date,
    COALESCE(v_receipt.received_at, now()), v_user, v_user_name,
    'Posteo de línea pendiente (formato resuelto tras confirmar)'
  );

  PERFORM recompute_location_stock(v_line.recipe_item_id, v_receipt.location_id);

  IF v_eur_base IS NOT NULL AND v_fmt_id IS NOT NULL THEN
    UPDATE article_supplier
      SET last_price = v_eur_base, updated_at = now()
      WHERE account_id = v_receipt.account_id
        AND recipe_item_id = v_line.recipe_item_id
        AND purchase_format_id = v_fmt_id
        AND is_active;
  END IF;

  -- ¿Quedan líneas pendientes en esta recepción? Pendiente = CUALQUIER línea sin
  -- movimiento de stock (tenga o no artículo: una línea sin casar también está
  -- pendiente). Solo si NO queda ninguna se baja needs_review. Esto evita el
  -- desajuste "indicador dice OK pero falta meter género".
  IF NOT EXISTS (
    SELECT 1 FROM goods_receipt_line grl
    WHERE grl.goods_receipt_id = v_receipt.id
      AND NOT EXISTS (SELECT 1 FROM stock_movement sm
        WHERE sm.source_type='goods_receipt_line' AND sm.source_id = grl.id)
  ) THEN
    UPDATE goods_receipt SET needs_review = false, updated_at = now()
    WHERE id = v_receipt.id;
  END IF;

  RETURN true;
END;
$function$;
