-- supabase/migrations/20260623T2500_post_pending_receipt_v3.sql
-- Aplicada: 2026-06-23
--
-- post_pending_receipt v3: reporta TODAS las líneas que no entraron, con su
-- RAZÓN concreta, no solo las que tienen artículo. Dos motivos de no-entrada:
--   · 'sin_articulo'  → la línea no está casada a ningún recipe_item (no se sabe
--                       qué es) → hay que casarla primero.
--   · 'sin_formato'   → tiene artículo pero ni la línea ni el proveedor tienen
--                       formato de compra → hay que montar el formato.
-- Así el front puede mostrar exactamente qué resolver y dónde, línea a línea.
--
-- pending_items: jsonb array de {line_id, item_id, name, reason}.

CREATE OR REPLACE FUNCTION public.post_pending_receipt(p_receipt_id uuid)
RETURNS TABLE(posted integer, still_pending integer, pending_items jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_receipt goods_receipt%ROWTYPE;
  v_line    goods_receipt_line%ROWTYPE;
  v_ok      boolean;
  v_posted  integer := 0;
  v_pending integer := 0;
  v_items   jsonb := '[]'::jsonb;
  v_reason  text;
BEGIN
  SELECT * INTO v_receipt FROM goods_receipt WHERE id = p_receipt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_pending_receipt: recepción % no existe', p_receipt_id;
  END IF;
  IF NOT belongs_to_account(v_receipt.account_id) THEN
    RAISE EXCEPTION 'post_pending_receipt: sin acceso';
  END IF;

  -- Recorre TODAS las líneas sin movimiento (con o sin artículo).
  FOR v_line IN
    SELECT * FROM goods_receipt_line grl
    WHERE grl.goods_receipt_id = p_receipt_id
      AND NOT EXISTS (SELECT 1 FROM stock_movement sm
        WHERE sm.source_type='goods_receipt_line' AND sm.source_id = grl.id)
    ORDER BY grl.position ASC
  LOOP
    -- Sin artículo casado: no se puede postear, razón clara.
    IF v_line.recipe_item_id IS NULL THEN
      v_pending := v_pending + 1;
      v_items := v_items || jsonb_build_object(
        'line_id', v_line.id, 'item_id', NULL,
        'name', COALESCE(v_line.product_name, 'Artículo sin nombre'),
        'reason', 'sin_articulo'
      );
      CONTINUE;
    END IF;

    -- Tiene artículo: intentar postear.
    v_ok := public.post_pending_receipt_line(v_line.id);
    IF v_ok THEN
      v_posted := v_posted + 1;
    ELSE
      v_pending := v_pending + 1;
      v_items := v_items || jsonb_build_object(
        'line_id', v_line.id, 'item_id', v_line.recipe_item_id,
        'name', COALESCE(
          (SELECT ri.name FROM recipe_item ri WHERE ri.id = v_line.recipe_item_id),
          v_line.product_name, 'Artículo sin nombre'),
        'reason', 'sin_formato'
      );
    END IF;
  END LOOP;

  posted := v_posted; still_pending := v_pending; pending_items := v_items;
  RETURN NEXT;
END;
$function$;
