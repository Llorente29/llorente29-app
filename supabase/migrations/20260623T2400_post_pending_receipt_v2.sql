-- supabase/migrations/20260623T2400_post_pending_receipt_v2.sql
-- Aplicada: 2026-06-23
--
-- Mejora el aviso "ciego": post_pending_receipt ahora devuelve, además de los
-- contadores, la LISTA de artículos que NO pudieron entrar (les falta formato),
-- con su nombre y el id del artículo (para enlazar a su ficha). Así el usuario
-- sabe EXACTAMENTE qué resolver, en vez de un "no entró" sin más.
--
-- pending_items: jsonb array de {line_id, item_id, name}. Vacío si todo entró.

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
BEGIN
  SELECT * INTO v_receipt FROM goods_receipt WHERE id = p_receipt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_pending_receipt: recepción % no existe', p_receipt_id;
  END IF;
  IF NOT belongs_to_account(v_receipt.account_id) THEN
    RAISE EXCEPTION 'post_pending_receipt: sin acceso';
  END IF;

  FOR v_line IN
    SELECT * FROM goods_receipt_line grl
    WHERE grl.goods_receipt_id = p_receipt_id
      AND grl.recipe_item_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM stock_movement sm
        WHERE sm.source_type='goods_receipt_line' AND sm.source_id = grl.id)
    ORDER BY grl.position ASC
  LOOP
    v_ok := public.post_pending_receipt_line(v_line.id);
    IF v_ok THEN
      v_posted := v_posted + 1;
    ELSE
      v_pending := v_pending + 1;
      v_items := v_items || jsonb_build_object(
        'line_id', v_line.id,
        'item_id', v_line.recipe_item_id,
        'name', COALESCE(
          (SELECT ri.name FROM recipe_item ri WHERE ri.id = v_line.recipe_item_id),
          v_line.product_name,
          'Artículo sin nombre'
        )
      );
    END IF;
  END LOOP;

  posted := v_posted; still_pending := v_pending; pending_items := v_items;
  RETURN NEXT;
END;
$function$;
