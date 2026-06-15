-- 20260615T1830_saneamiento_appcc_fk_y_apply_inventory_count.sql
-- Aplicada: 2026-06-15 (Folvy Interno + Llorente29, vía SQL Editor)
-- SANEAMIENTO: versiona drift que vivía solo en BBDD. Capturado byte-fiel de
-- pg_get_constraintdef / pg_get_functiondef sobre la BBDD viva (no de memoria).
--   (1) FK de APPCC: assigned_to apuntaba a auth.users (vacío) → roto /appcc/hoy.
--       Reapuntadas a employees(id) ON DELETE SET NULL (tabla canónica de personas).
--   (2) apply_inventory_count v3: el conteo SUSTITUYE en su instante
--       (delta = contado − SUM(ledger con occurred_at < instante)); apertura sin
--       chequeo de tolerancia; idempotente (borra asientos previos del conteo).
-- Idempotente: usa IF EXISTS en los DROP y CREATE OR REPLACE en la función.

-- (1) FK de APPCC → employees ──────────────────────────────────────────
ALTER TABLE public.appcc_executions
  DROP CONSTRAINT IF EXISTS appcc_executions_assigned_to_fkey;
ALTER TABLE public.appcc_executions
  ADD CONSTRAINT appcc_executions_assigned_to_fkey
  FOREIGN KEY (assigned_to) REFERENCES public.employees(id) ON DELETE SET NULL;

ALTER TABLE public.appcc_incidents
  DROP CONSTRAINT IF EXISTS appcc_incidents_assigned_to_fkey;
ALTER TABLE public.appcc_incidents
  ADD CONSTRAINT appcc_incidents_assigned_to_fkey
  FOREIGN KEY (assigned_to) REFERENCES public.employees(id) ON DELETE SET NULL;

-- (2) apply_inventory_count v3 (definición viva) ───────────────────────
CREATE OR REPLACE FUNCTION public.apply_inventory_count(p_count_id uuid, p_user_id uuid DEFAULT NULL::uuid, p_user_name text DEFAULT NULL::text)
 RETURNS TABLE(adjustments integer, items_recomputed integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_location_id uuid;
  v_status text;
  v_is_opening boolean;
  v_instant timestamptz;
  v_missing integer;
  v_adj integer := 0;
  v_rec integer := 0;
  v_mtype text;
  v_note text;
  v_delta numeric;
  r RECORD;
BEGIN
  SELECT account_id, location_id, status, is_opening,
         COALESCE(started_at, closed_at, created_at, now())
    INTO v_account_id, v_location_id, v_status, v_is_opening, v_instant
    FROM public.inventory_count WHERE id = p_count_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'apply_inventory_count: conteo % no existe', p_count_id;
  END IF;
  IF v_status = 'aprobado' THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;
  IF v_status <> 'en_revision' THEN
    RAISE EXCEPTION 'apply_inventory_count: el conteo debe estar en revisión (está en %)', v_status;
  END IF;
  -- El chequeo de tolerancia NO aplica a aperturas (son el punto de partida,
  -- no hay stock previo contra el que medir desviación).
  IF NOT v_is_opening THEN
    SELECT COUNT(*) INTO v_missing
      FROM public.inventory_count_line
      WHERE inventory_count_id = p_count_id
        AND counted_qty IS NOT NULL
        AND within_tolerance = false
        AND (reason_code IS NULL OR reason_code = '');
    IF v_missing > 0 THEN
      RAISE EXCEPTION 'apply_inventory_count: % línea(s) fuera de tolerancia sin motivo. Asigna un motivo antes de aprobar.', v_missing;
    END IF;
  END IF;
  IF v_is_opening THEN
    v_mtype := 'apertura';
    v_note  := 'Inventario de apertura (stock inicial)';
  ELSE
    v_mtype := 'ajuste';
    v_note  := 'Ajuste por conteo de inventario';
  END IF;
  -- Idempotencia: elimina cualquier asiento previo generado por ESTE conteo.
  DELETE FROM public.stock_movement
    WHERE source_type = 'inventory_count'
      AND source_id   = p_count_id;
  FOR r IN
    SELECT l.recipe_item_id,
           l.counted_qty,
           COALESCE((
             SELECT SUM(sm.qty_base)
               FROM public.stock_movement sm
              WHERE sm.recipe_item_id = l.recipe_item_id
                AND sm.location_id    = v_location_id
                AND sm.occurred_at    < v_instant
           ), 0) AS ledger_before,
           COALESCE(ril.avg_unit_cost, 0) AS unit_cost
      FROM public.inventory_count_line l
      LEFT JOIN public.recipe_item_location_stock ril
        ON ril.recipe_item_id = l.recipe_item_id
       AND ril.location_id = v_location_id
       AND ril.account_id  = v_account_id
     WHERE l.inventory_count_id = p_count_id
       AND l.counted_qty IS NOT NULL
  LOOP
    v_delta := r.counted_qty - r.ledger_before;
    IF abs(v_delta) > 0.0000001 THEN
      INSERT INTO public.stock_movement (
        account_id, location_id, recipe_item_id, movement_type, qty_base,
        unit_cost, cost_provisional, source_type, source_id, occurred_at,
        created_by, created_by_name, notes
      ) VALUES (
        v_account_id, v_location_id, r.recipe_item_id, v_mtype, v_delta,
        r.unit_cost, false, 'inventory_count', p_count_id, v_instant,
        p_user_id, p_user_name, v_note
      );
      v_adj := v_adj + 1;
    END IF;
    PERFORM public.recompute_location_stock(r.recipe_item_id, v_location_id);
    v_rec := v_rec + 1;
  END LOOP;
  UPDATE public.inventory_count
    SET status = 'aprobado',
        approved_at = now(),
        approved_by = p_user_id,
        approved_by_name = p_user_name,
        updated_at = now()
    WHERE id = p_count_id;
  RETURN QUERY SELECT v_adj, v_rec;
END;
$function$;
