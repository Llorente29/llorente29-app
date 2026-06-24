-- supabase/migrations/20260623T2300_post_pending_receipt.sql
-- Aplicada: 2026-06-23
--
-- RPC envolvente: postea TODAS las líneas pendientes de una recepción confirmada
-- (las que quedaron sin movimiento de stock). Las que ya tienen formato resoluble
-- entran; las que aún no, se cuentan como "siguen pendientes". La llama el botón
-- "Meter al stock" de la pantalla de Recepciones (con sesión → pasa el guard).

CREATE OR REPLACE FUNCTION public.post_pending_receipt(p_receipt_id uuid)
RETURNS TABLE(posted integer, still_pending integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_receipt goods_receipt%ROWTYPE;
  v_line_id uuid;
  v_ok      boolean;
  v_posted  integer := 0;
  v_pending integer := 0;
BEGIN
  SELECT * INTO v_receipt FROM goods_receipt WHERE id = p_receipt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_pending_receipt: recepción % no existe', p_receipt_id;
  END IF;
  IF NOT belongs_to_account(v_receipt.account_id) THEN
    RAISE EXCEPTION 'post_pending_receipt: sin acceso';
  END IF;

  FOR v_line_id IN
    SELECT grl.id FROM goods_receipt_line grl
    WHERE grl.goods_receipt_id = p_receipt_id
      AND grl.recipe_item_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM stock_movement sm
        WHERE sm.source_type='goods_receipt_line' AND sm.source_id = grl.id)
    ORDER BY grl.position ASC
  LOOP
    v_ok := public.post_pending_receipt_line(v_line_id);
    IF v_ok THEN v_posted := v_posted + 1; ELSE v_pending := v_pending + 1; END IF;
  END LOOP;

  posted := v_posted; still_pending := v_pending;
  RETURN NEXT;
END;
$function$;
