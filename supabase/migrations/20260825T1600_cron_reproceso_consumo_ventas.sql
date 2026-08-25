-- 20260825T1600_cron_reproceso_consumo_ventas.sql
-- APLICADA en producción el 25-08-2026.
--
-- El consumo se calcula UNA sola vez, al vender. Si el escandallo o el mapeo
-- llegan después, esa venta se queda sin consumo para siempre (medido: 75-81
-- ventas / ~2.100 € congeladas). `recompute_sales_consumption()` ya existía
-- para esto, pero tiene guard de sesión (`current_user_is_admin`), así que en
-- cron falla: no hay auth.uid().
--
-- Este wrapper es para cron: corre como owner y va ACOTADO — solo toca ventas
-- que DEBERÍAN tener consumo y tienen cero. Así no reescribe ventas sanas (que
-- falsearía su created_at y con él la métrica de latencia T10) ni multiplica el
-- trabajo nocturno.
--
-- CAVEAT conocido (ver claude/folvy_auditoria_cadena_stock_20260825.md §9):
-- reprocesar una venta anterior al último conteo APROBADO de su local mete
-- consumo en un tramo que el ajuste de ese conteo ya había absorbido. Con
-- p_days = 7 eso puede pasar; bajar a 2 lo reduce casi a cero.

CREATE OR REPLACE FUNCTION public.cron_recompute_missing_sale_consumption(p_days integer DEFAULT 7)
 RETURNS TABLE(sales_reprocessed integer, movements_written integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r      record;
  v_n    integer := 0;
  v_mov  integer := 0;
BEGIN
  FOR r IN
    SELECT s.id
    FROM sale s
    WHERE s.sold_at >= now() - make_interval(days => GREATEST(COALESCE(p_days,7), 1))
      AND COALESCE(s.is_active, true)
      AND COALESCE(s.status, '') <> 'cancelled'
      AND COALESCE(s.order_status, '') NOT IN ('cancelled', 'rejected')
      AND NOT EXISTS (
        SELECT 1 FROM stock_movement sm
         WHERE sm.source_type = 'sale' AND sm.movement_type = 'consumo'
           AND sm.source_id = s.id)
      AND EXISTS (
        SELECT 1 FROM sale_line sl
         WHERE sl.sale_id = s.id
           AND COALESCE(sl.line_type, 'product') = 'product'
           AND sl.ignored_at IS NULL
           AND ( EXISTS (SELECT 1 FROM menu_item mi
                          WHERE mi.id = sl.menu_item_id AND mi.recipe_item_id IS NOT NULL)
                 OR EXISTS (SELECT 1 FROM sale_line c
                             WHERE c.parent_sale_line_id = sl.id AND c.line_type = 'combo_item') ))
    ORDER BY s.sold_at
  LOOP
    v_mov := v_mov + COALESCE(public.generate_sale_consumption(r.id), 0);
    v_n := v_n + 1;
  END LOOP;

  IF v_n > 0 THEN
    RAISE NOTICE 'cron_recompute_missing_sale_consumption: % ventas, % movimientos', v_n, v_mov;
  END IF;

  sales_reprocessed := v_n;
  movements_written := v_mov;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.cron_recompute_missing_sale_consumption(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cron_recompute_missing_sale_consumption(integer) FROM anon, authenticated;

notify pgrst, 'reload schema';
