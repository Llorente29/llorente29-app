-- 20260609T1700_supply_recepcion_t1_cimiento.sql
-- Aplicada:
--
-- TRAMO 1 del frente "Recepción usable y fiable" (cimiento BBDD).
--
-- (1) goods_receipt_line.doc_qty / doc_amount: lo que el albarán DECLARA por
--     línea (cantidad e importe). Referencia para el cuadre a dos ejes del
--     Tramo 3. Nullable; nada los usa aún (no rompe build).
--
-- (2) qty_in_base SERVER-SIDE en confirm_goods_receipt: hoy el navegador calcula
--     qty_in_base y el confirm se fía. Ahora el confirm lo RECALCULA desde el
--     nodo de formato (qty_received × recipe_item_purchase_format.qty_in_base) y
--     lo SELLA en la línea. RECON probado: el formulario siempre persiste
--     qty_in_base = qty_received × formato.qty_in_base (y crea el nodo si falta),
--     así que el recálculo es EXACTO. Fallback no regresivo: si una línea no
--     tiene formato utilizable, se respeta el qty_in_base almacenado.
--
-- DDL idempotente, sin BEGIN/COMMIT (regla SQL Editor). NO se prueba la función
-- SECURITY DEFINER dentro de esta aplicación (auth.uid() null en SQL Editor):
-- verificar aparte y probar funcionalmente desde la app.

ALTER TABLE public.goods_receipt_line
  ADD COLUMN IF NOT EXISTS doc_qty    numeric,
  ADD COLUMN IF NOT EXISTS doc_amount numeric;

COMMENT ON COLUMN public.goods_receipt_line.doc_qty    IS 'Cantidad declarada por el albarán en esta línea (referencia del cuadre a dos ejes). Null si no consta.';
COMMENT ON COLUMN public.goods_receipt_line.doc_amount IS 'Importe declarado por el albarán en esta línea, si valorado. Null si no consta.';

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
  v_fmt_qib   numeric;   -- qty_in_base del nodo de formato (servidor)
  v_qib       numeric;   -- qty_in_base AUTORITATIVO de la línea (servidor)
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
    -- ── qty_in_base SERVER-SIDE: desde el nodo de formato, no del navegador ──
    -- recipe_item_purchase_format.qty_in_base ya está en la unidad base del
    -- artículo (la Caja sabe que son 6 Kg). qty_in_base de la línea =
    -- qty_received × ese factor del nodo. Si no hay formato utilizable,
    -- fallback al valor almacenado (no regresivo).
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
      v_qib := v_line.qty_in_base;   -- fallback: respeta lo almacenado
    END IF;

    -- Anti-invención: sin artículo o sin conversión utilizable → no postea.
    IF v_line.recipe_item_id IS NULL
       OR v_qib IS NULL
       OR v_qib <= 0 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Sella el qty_in_base recalculado en la línea (línea y ledger coinciden).
    IF v_qib IS DISTINCT FROM v_line.qty_in_base THEN
      UPDATE goods_receipt_line
        SET qty_in_base = v_qib, updated_at = now()
        WHERE id = v_line.id;
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
      v_qib,
      CASE
        WHEN v_line.unit_cost IS NOT NULL AND v_line.qty_received > 0
        THEN (v_line.unit_cost * v_line.qty_received) / v_qib
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

  -- AUTO-ESTADO DEL PEDIDO: si el albarán está ligado a un pedido, recalcula su
  -- estado según lo recibido. No interviene el humano.
  IF v_receipt.purchase_order_id IS NOT NULL THEN
    PERFORM recompute_purchase_order_status(v_receipt.purchase_order_id);
  END IF;

  posted_lines  := v_posted;
  skipped_lines := v_skipped;
  RETURN NEXT;
END;
$function$;
