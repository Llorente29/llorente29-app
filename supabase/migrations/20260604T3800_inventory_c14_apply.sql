-- ============================================================================
-- Folvy Inventario — Capa 1.4: aprobación → ajuste en el ledger
-- ============================================================================
-- apply_inventory_count: al APROBAR un conteo 'en_revision', por cada línea
-- contada con variación ≠ 0 escribe un movimiento 'ajuste' (qty_base con signo
-- = counted − system) en stock_movement, y recalcula el saldo del artículo.
-- Cierra la capa 1: el conteo deja de ser diagnóstico y corrige el stock real.
--
-- Reglas:
--   - Solo desde 'en_revision'. Idempotente: si ya está 'aprobado', no re-aplica.
--   - reason_code OBLIGATORIO en líneas fuera de tolerancia (si falta → EXCEPTION,
--     aborta sin escribir nada; la transacción protege la integridad).
--   - Las líneas sin contar (counted_qty null) se ignoran (no se ajustan).
--   - Variación 0 → no escribe movimiento (no ensucia el ledger).
--   - unit_cost del ajuste = avg_unit_cost actual del saldo (coste al que se valora).
--
-- SECURITY DEFINER. Se ejecuta DESDE LA APP (el gating por rol va en el servicio
-- + RLS). DDL sin BEGIN/COMMIT.
-- ============================================================================

create or replace function public.apply_inventory_count(
  p_count_id uuid,
  p_user_id uuid default null,
  p_user_name text default null
)
returns table (
  adjustments integer,        -- nº de movimientos de ajuste escritos
  items_recomputed integer    -- nº de artículos cuyo saldo se recalculó
)
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_account_id uuid;
  v_location_id uuid;
  v_status text;
  v_missing integer;
  v_adj integer := 0;
  v_rec integer := 0;
  r RECORD;
BEGIN
  SELECT account_id, location_id, status
    INTO v_account_id, v_location_id, v_status
    FROM public.inventory_count WHERE id = p_count_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'apply_inventory_count: conteo % no existe', p_count_id;
  END IF;

  -- Idempotencia: si ya está aprobado, no re-aplica.
  IF v_status = 'aprobado' THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;
  IF v_status <> 'en_revision' THEN
    RAISE EXCEPTION 'apply_inventory_count: el conteo debe estar en revisión (está en %)', v_status;
  END IF;

  -- Regla dura: ninguna línea fuera de tolerancia puede quedar sin motivo.
  SELECT COUNT(*) INTO v_missing
    FROM public.inventory_count_line
    WHERE inventory_count_id = p_count_id
      AND counted_qty IS NOT NULL
      AND within_tolerance = false
      AND (reason_code IS NULL OR reason_code = '');
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'apply_inventory_count: % línea(s) fuera de tolerancia sin motivo. Asigna un motivo antes de aprobar.', v_missing;
  END IF;

  -- Escribir un ajuste por cada línea contada con variación ≠ 0.
  FOR r IN
    SELECT l.recipe_item_id,
           (l.counted_qty - l.system_qty) AS delta,
           COALESCE(ril.avg_unit_cost, 0) AS unit_cost
    FROM public.inventory_count_line l
    LEFT JOIN public.recipe_item_location_stock ril
      ON ril.recipe_item_id = l.recipe_item_id
     AND ril.location_id = v_location_id
     AND ril.account_id = v_account_id
    WHERE l.inventory_count_id = p_count_id
      AND l.counted_qty IS NOT NULL
      AND (l.counted_qty - l.system_qty) <> 0
  LOOP
    INSERT INTO public.stock_movement (
      account_id, location_id, recipe_item_id, movement_type, qty_base,
      unit_cost, cost_provisional, source_type, source_id, occurred_at,
      created_by, created_by_name, notes
    ) VALUES (
      v_account_id, v_location_id, r.recipe_item_id, 'ajuste', r.delta,
      r.unit_cost, false, 'inventory_count', p_count_id, now(),
      p_user_id, p_user_name, 'Ajuste por conteo de inventario'
    );
    v_adj := v_adj + 1;

    -- Recalcular el saldo del artículo en el local (motor existente).
    PERFORM public.recompute_location_stock(r.recipe_item_id, v_location_id);
    v_rec := v_rec + 1;
  END LOOP;

  -- Marcar el conteo como aprobado.
  UPDATE public.inventory_count
    SET status = 'aprobado',
        approved_at = now(),
        approved_by = p_user_id,
        approved_by_name = p_user_name,
        updated_at = now()
    WHERE id = p_count_id;

  RETURN QUERY SELECT v_adj, v_rec;
END;
$$;
