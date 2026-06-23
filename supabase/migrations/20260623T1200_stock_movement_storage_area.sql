-- supabase/migrations/20260623T1200_stock_movement_storage_area.sql
-- Aplicada: 2026-06-23
--
-- ENRUTADO POR ZONA EN LA RECEPCIÓN (golea a tspoon).
-- tspoon obliga a elegir el almacén línea a línea EN PLENA RECEPCIÓN (el "pensar
-- en el muelle" diagnosticado el 16/06). Folvy conoce la ZONA PRINCIPAL del
-- artículo (recipe_item_storage_area.position más baja, en el local de la
-- recepción) y enruta AUTOMÁTICO al recibir; el trabajador solo cuenta.
--
-- (1) El movimiento de stock pasa a llevar la zona destino (nullable: si el
--     artículo no tiene zona asignada en ese local, queda null → no se inventa).
-- (2) confirm_goods_receipt fija storage_area_id desde la zona principal del
--     artículo al postear cada línea. Sin cambios en el resto de su lógica.
--
-- NOTA: el SALDO de stock sigue siendo a nivel de LOCAL (recipe_item_location_stock
-- y recompute_location_stock no se tocan). Llevar el saldo POR ZONA es re-granular
-- el inventario (movimiento+snapshot+AvT+conteos+autoinventario) y vive en el
-- módulo de inventario, no aquí. Esta migración deja la zona REGISTRADA en cada
-- entrada (trazabilidad + base para ese grano cuando se aborde), sin romper nada.

-- ── (1) Columna + FK + índice ──
ALTER TABLE public.stock_movement
  ADD COLUMN IF NOT EXISTS storage_area_id uuid
  REFERENCES public.storage_area(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movement_storage_area
  ON public.stock_movement (storage_area_id)
  WHERE storage_area_id IS NOT NULL;

-- ── (2) confirm_goods_receipt: enruta a la zona principal del artículo ──
-- Misma función que la vigente; SOLO se añade la resolución de v_area_id (zona
-- principal del artículo en el local de la recepción) y su escritura en el INSERT.
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
  v_area_id   uuid;      -- zona principal del artículo en el local (nullable)
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
    -- qty_in_base SERVER-SIDE (cantidad que entra al stock) — sin cambios.
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

    -- €/base CANÓNICO: precio_del_formato / qty_in_base_del_formato.
    -- NO usa qty_received → imposible el doble de ALB-00009.
    v_eur_base := public._eur_base_from_format(v_line.purchase_format_id, v_line.unit_cost);

    -- ZONA PRINCIPAL del artículo EN EL LOCAL de la recepción: la asignación de
    -- menor `position` entre las zonas ACTIVAS de ese local. Si el artículo no
    -- tiene zona en ese local → null (no se inventa). El trabajador no elige nada.
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

    INSERT INTO stock_movement (
      account_id, location_id, recipe_item_id, storage_area_id,
      movement_type, qty_base, unit_cost, cost_provisional,
      source_type, source_id, lot_code, expiry_date,
      occurred_at, created_by, created_by_name
    )
    VALUES (
      v_receipt.account_id, v_receipt.location_id, v_line.recipe_item_id, v_area_id,
      'recepcion', v_qib,
      -- Sin formato utilizable, fallback al coste total/base (no regresivo) solo
      -- para valorar el movimiento; ese caso NO escribe last_price (abajo).
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

    -- last_price = €/base canónico. Solo si la conversión es fiable (hay formato).
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
