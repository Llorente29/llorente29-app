-- =====================================================================
-- 20260609T1300_reprocess_sale_v2_fix_fosiles.sql
-- Aplicada: __________  (rellenar al aplicar)
--
-- FIX (Opcion A) del consumo FOSIL al reprocesar una venta.
--
-- PROBLEMA: reprocess_sale v1 hacia adapt_lastapp_order (que BORRA y RECREA las
-- sale_line con IDs NUEVOS) y luego compute_sale_line_consumption. Pero el
-- consumo se ancla a sale_line.id via source_id, y stock_movement.source_id NO
-- tiene FK a sale_line -> al recrear las lineas, los movimientos de consumo
-- VIEJOS (sobre los IDs muertos) no se borran en cascada ni los limpia la
-- idempotencia (que borra por la linea NUEVA). Resultado: consumo fosil que
-- crece en cada reproceso -> stock teorico corrupto. Verificado en laboratorio:
-- un recast duplico el consumo (1414 -> 2925).
--
-- FIX: reprocess_sale borra el consumo de la venta ANTES de adaptar (cuando las
-- lineas viejas aun existen y sus source_id son alcanzables), recalcula el stock
-- de los raws afectados, y luego adapta + costea + consume limpio. Idempotente y
-- sin fosiles. Blindaje unico para webhook / recast / resolvedores (todos pasan
-- por aqui).
--
-- PURO (sin guard): autorizacion en la frontera (principio rector 5).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.reprocess_sale(p_sale_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_account_id uuid;
  v_loc        uuid;
  v_line_id    uuid;
  v_item       uuid;
  v_old_items  uuid[];
  v_n          integer := 0;
BEGIN
  SELECT account_id, location_id INTO v_account_id, v_loc FROM sale WHERE id = p_sale_id;
  IF v_account_id IS NULL THEN RETURN 0; END IF;

  -- 0) LIMPIAR EL CONSUMO PREVIO DE LA VENTA, antes de recrear las lineas.
  --    Las lineas viejas aun existen: borramos los movimientos de consumo cuyas
  --    source_id pertenecen a CUALQUIER linea (de cualquier tipo) de esta venta.
  --    Guardamos los raws afectados para recalcular su stock tras la limpieza.
  v_old_items := ARRAY(
    SELECT DISTINCT sm.recipe_item_id
    FROM stock_movement sm
    WHERE sm.account_id = v_account_id
      AND sm.movement_type = 'consumo'
      AND sm.source_type = 'sale'
      AND sm.source_id IN (SELECT id FROM sale_line WHERE sale_id = p_sale_id)
  );

  DELETE FROM stock_movement sm
  WHERE sm.account_id = v_account_id
    AND sm.movement_type = 'consumo'
    AND sm.source_type = 'sale'
    AND sm.source_id IN (SELECT id FROM sale_line WHERE sale_id = p_sale_id);

  -- 1) Reconstruir las lineas canonicas (borra/recrea con IDs nuevos; respeta
  --    manual/ignored/delisted).
  PERFORM public.adapt_lastapp_order(p_sale_id);

  -- 2) Por cada linea product: coste y consumo (el consumo escribe limpio; ya no
  --    hay fosiles porque borramos en el paso 0). compute_sale_line_consumption
  --    recalcula el stock de los raws que toca.
  FOR v_line_id IN
    SELECT id FROM sale_line
    WHERE sale_id = p_sale_id AND line_type = 'product'
  LOOP
    PERFORM public.compute_sale_line_cost(v_line_id);
    PERFORM public.compute_sale_line_consumption(v_line_id);
    v_n := v_n + 1;
  END LOOP;

  -- 3) Recalcular el stock de los raws que SOLO tenia el consumo viejo (los que
  --    se consumian antes y ya no): el paso 0 los borro pero el paso 2 quiza no
  --    los volvio a tocar -> su stock quedaria sin actualizar sin esto.
  IF v_loc IS NOT NULL THEN
    FOREACH v_item IN ARRAY COALESCE(v_old_items, '{}'::uuid[])
    LOOP
      PERFORM public.recompute_location_stock_core(v_item, v_loc);
    END LOOP;
  END IF;

  RETURN v_n;
END;
$$;
