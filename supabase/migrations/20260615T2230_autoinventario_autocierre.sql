-- ============================================================================
-- Autoinventario — Auto-cierre del conteo del día (sin cuello de botella)
-- ============================================================================
-- Verificado en producción el 15/06/2026 (build verde).
--
-- Quita el cierre manual diario (se atascaba y acumulaba):
--   1) apply_inventory_count gana p_partial: aplica SOLO las líneas resueltas
--      (dentro de tolerancia o con motivo) sin abortar por anomalías pendientes,
--      y deja el conteo en 'en_revision' si aún quedan, o 'aprobado' si no.
--      Modo normal (p_partial=false) = comportamiento anterior INTACTO.
--   2) autoclose_daily_count: close + apply(partial=true) en un paso. Lo dispara
--      el trabajador al contar la última pieza del dia (front), y el barrido.
--   3) generate_daily_count: BARRIDO de conteos cycle de DÍAS ANTERIORES que
--      quedaron en 'contando' → autoclose con lo que haya. Nunca se acumulan.
--
-- Resultado: lo limpio se auto-aplica al stock; solo las anomalías reales
-- (fuera de tolerancia) esperan al gestor, sin urgencia, sin bloquear nada.
-- ============================================================================

-- Higiene: una versión vieja de apply_inventory_count (3 args, sin p_partial)
-- convivía por sobrecarga. Se elimina; la de 4 args con default la cubre.
DROP FUNCTION IF EXISTS public.apply_inventory_count(uuid, uuid, text);

-- ── apply_inventory_count (con modo parcial p_partial) ─────────────────────
CREATE OR REPLACE FUNCTION public.apply_inventory_count(p_count_id uuid, p_user_id uuid DEFAULT NULL::uuid, p_user_name text DEFAULT NULL::text, p_partial boolean DEFAULT false)
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

  SELECT COUNT(*) INTO v_missing
    FROM public.inventory_count_line
    WHERE inventory_count_id = p_count_id
      AND counted_qty IS NOT NULL
      AND within_tolerance = false
      AND (reason_code IS NULL OR reason_code = '');

  -- Modo normal (manual del gestor): exige todo resuelto antes de aprobar.
  -- Modo parcial (autoinventario): NO aborta; aplica lo resuelto y deja las
  -- anomalías pendientes para el gestor (el conteo no se da por aprobado).
  IF NOT v_is_opening AND NOT p_partial AND v_missing > 0 THEN
    RAISE EXCEPTION 'apply_inventory_count: % línea(s) fuera de tolerancia sin motivo. Asigna un motivo antes de aprobar.', v_missing;
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
       -- En modo parcial, SOLO se aplican las líneas RESUELTAS (dentro de
       -- tolerancia, o fuera pero ya con motivo). Las anomalías sin motivo se
       -- dejan sin aplicar hasta que el gestor las resuelva.
       AND (
         NOT p_partial
         OR l.within_tolerance = true
         OR (l.reason_code IS NOT NULL AND l.reason_code <> '')
       )
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

  -- Estado final: aprobado solo si NO quedan anomalías pendientes; si en modo
  -- parcial aún quedan, se mantiene en revisión para el gestor.
  IF v_missing > 0 AND p_partial THEN
    UPDATE public.inventory_count
      SET updated_at = now()
      WHERE id = p_count_id;   -- sigue en_revision
  ELSE
    UPDATE public.inventory_count
      SET status = 'aprobado',
          approved_at = now(),
          approved_by = p_user_id,
          approved_by_name = p_user_name,
          updated_at = now()
      WHERE id = p_count_id;
  END IF;

  RETURN QUERY SELECT v_adj, v_rec;
END;
$function$;

-- ── autoclose_daily_count (close + apply parcial en un paso) ───────────────
CREATE OR REPLACE FUNCTION public.autoclose_daily_count(p_count_id uuid)
 RETURNS TABLE(closed boolean, applied integer, pending_anomalies integer, final_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_status text;
  v_applied integer := 0;
  v_pending integer := 0;
  v_final text;
BEGIN
  SELECT account_id, status INTO v_account_id, v_status
    FROM public.inventory_count WHERE id = p_count_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'autoclose_daily_count: conteo % no existe', p_count_id;
  END IF;
  IF NOT (public.current_user_is_admin()
          OR v_account_id = ANY(public.current_user_account_ids())) THEN
    RAISE EXCEPTION 'autoclose_daily_count: sin acceso';
  END IF;

  IF v_status = 'aprobado' OR v_status = 'anulado' THEN
    RETURN QUERY SELECT false, 0, 0, v_status;
    RETURN;
  END IF;

  IF v_status = 'contando' OR v_status = 'abierto' THEN
    PERFORM public.close_inventory_count(p_count_id);
  END IF;

  SELECT adjustments INTO v_applied
    FROM public.apply_inventory_count(p_count_id, NULL, 'Autoinventario', true);

  SELECT COUNT(*) INTO v_pending
    FROM public.inventory_count_line
    WHERE inventory_count_id = p_count_id
      AND counted_qty IS NOT NULL
      AND within_tolerance = false
      AND (reason_code IS NULL OR reason_code = '');

  SELECT status INTO v_final FROM public.inventory_count WHERE id = p_count_id;

  RETURN QUERY SELECT true, v_applied, v_pending, v_final;
END;
$function$;

-- ── generate_daily_count (con BARRIDO del día anterior al inicio) ──────────
CREATE OR REPLACE FUNCTION public.generate_daily_count(p_account_id uuid, p_location_id uuid, p_employee_ids uuid[] DEFAULT NULL::uuid[], p_per_person integer DEFAULT 8, p_coverage_target numeric DEFAULT 80, p_ignore_freshness boolean DEFAULT false)
 RETURNS TABLE(count_id uuid, lines_created integer, already_existed boolean, coverage_before numeric, coverage_after numeric, per_person_today integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing uuid;
  v_count_id uuid;
  v_n_people integer;
  v_per_today integer;
  v_cap integer;
  v_total_value numeric;
  v_fresh_before numeric;
  v_cov_before numeric;
  v_cov_after numeric;
  v_created integer := 0;
  v_h_a integer := 7; v_h_b integer := 14; v_h_c integer := 30;
  v_stale_id uuid;
BEGIN
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'generate_daily_count: sin acceso a la cuenta %', p_account_id;
  END IF;

  -- BARRIDO: cierra (con lo que haya) los conteos cycle de DÍAS ANTERIORES que
  -- quedaron sin cerrar, para que nunca se acumulen huérfanos en 'contando'.
  FOR v_stale_id IN
    SELECT id FROM public.inventory_count
    WHERE account_id = p_account_id AND location_id = p_location_id
      AND kind = 'cycle' AND status IN ('abierto','contando')
      AND created_at::date < current_date
  LOOP
    PERFORM public.autoclose_daily_count(v_stale_id);
  END LOOP;

  SELECT id INTO v_existing FROM public.inventory_count
   WHERE account_id = p_account_id AND location_id = p_location_id
     AND kind = 'cycle' AND status <> 'anulado' AND created_at::date = current_date
   ORDER BY created_at DESC LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT v_existing,
      (SELECT count(*)::int FROM public.inventory_count_line WHERE inventory_count_id = v_existing),
      true, NULL::numeric, NULL::numeric, NULL::integer;
    RETURN;
  END IF;

  v_n_people := COALESCE(array_length(p_employee_ids, 1), 0);

  WITH sel AS (
    SELECT q.recipe_item_id, q.qty_on_hand, q.stock_value, q.abc_rich, q.must_count, q.rank,
           f.last_approved_at,
           ( p_ignore_freshness
             OR f.last_approved_at IS NULL
             OR f.last_approved_at < now() - make_interval(days =>
                  CASE q.abc_rich WHEN 'A' THEN v_h_a WHEN 'B' THEN v_h_b ELSE v_h_c END) ) AS is_stale
    FROM public.autoinventory_queue(p_account_id, p_location_id, 30, p_coverage_target) q
    LEFT JOIN (
      SELECT icl.recipe_item_id, MAX(ic.approved_at) AS last_approved_at
      FROM public.inventory_count_line icl
      JOIN public.inventory_count ic ON ic.id = icl.inventory_count_id
      WHERE ic.account_id = p_account_id AND ic.location_id = p_location_id AND ic.status = 'aprobado'
      GROUP BY icl.recipe_item_id
    ) f ON f.recipe_item_id = q.recipe_item_id
    WHERE q.in_scope
  )
  SELECT COALESCE(SUM(stock_value),0),
         COALESCE(SUM(stock_value) FILTER (WHERE NOT is_stale),0)
    INTO v_total_value, v_fresh_before
  FROM sel;

  v_cov_before := CASE WHEN v_total_value > 0 THEN ROUND(v_fresh_before / v_total_value * 100, 1) ELSE 0 END;

  v_per_today := CASE
    WHEN v_cov_before < 40 THEN CEIL(p_per_person * 1.5)::int
    WHEN v_cov_before <= 75 THEN p_per_person
    ELSE GREATEST(1, FLOOR(p_per_person * 0.5)::int)
  END;
  v_cap := GREATEST(v_per_today, v_n_people * v_per_today);

  INSERT INTO public.inventory_count(account_id, location_id, kind, status, blind, is_opening, started_at, notes)
  VALUES (p_account_id, p_location_id, 'cycle', 'contando', true, false, now(), 'Autoinventario del día')
  RETURNING id INTO v_count_id;

  WITH sel AS (
    SELECT q.recipe_item_id, q.qty_on_hand, q.stock_value, q.abc_rich, q.must_count, q.rank,
           f.last_approved_at,
           ( p_ignore_freshness
             OR f.last_approved_at IS NULL
             OR f.last_approved_at < now() - make_interval(days =>
                  CASE q.abc_rich WHEN 'A' THEN v_h_a WHEN 'B' THEN v_h_b ELSE v_h_c END) ) AS is_stale
    FROM public.autoinventory_queue(p_account_id, p_location_id, 30, p_coverage_target) q
    LEFT JOIN (
      SELECT icl.recipe_item_id, MAX(ic.approved_at) AS last_approved_at
      FROM public.inventory_count_line icl
      JOIN public.inventory_count ic ON ic.id = icl.inventory_count_id
      WHERE ic.account_id = p_account_id AND ic.location_id = p_location_id AND ic.status = 'aprobado'
      GROUP BY icl.recipe_item_id
    ) f ON f.recipe_item_id = q.recipe_item_id
    WHERE q.in_scope
  ),
  ranked AS (
    SELECT s.*, ROW_NUMBER() OVER w AS pickn
    FROM sel s
    WHERE s.is_stale
    WINDOW w AS (ORDER BY s.must_count DESC, s.stock_value DESC, s.last_approved_at ASC NULLS FIRST, s.rank ASC)
  )
  INSERT INTO public.inventory_count_line(
    account_id, inventory_count_id, recipe_item_id, storage_area_id, position,
    system_qty, counted_qty, abc_class, assigned_to)
  SELECT p_account_id, v_count_id, r.recipe_item_id, NULL, r.pickn::int,
         COALESCE(r.qty_on_hand, 0), NULL, r.abc_rich,
         CASE WHEN v_n_people > 0 THEN p_employee_ids[((r.pickn - 1) % v_n_people) + 1] ELSE NULL END
  FROM ranked r
  WHERE r.must_count = true OR r.pickn <= v_cap;

  GET DIAGNOSTICS v_created = ROW_COUNT;

  IF v_created = 0 THEN
    UPDATE public.inventory_count SET status = 'anulado', updated_at = now() WHERE id = v_count_id;
    v_cov_after := v_cov_before;
  ELSE
    SELECT CASE WHEN v_total_value > 0
      THEN ROUND((v_fresh_before + COALESCE(SUM(l.system_qty * 0 + ric.stock_value),0)) / v_total_value * 100, 1)
      ELSE 100 END
    INTO v_cov_after
    FROM public.inventory_count_line l
    JOIN public.recipe_item_location_stock ric
      ON ric.recipe_item_id = l.recipe_item_id AND ric.account_id = p_account_id AND ric.location_id = p_location_id
    WHERE l.inventory_count_id = v_count_id;
    v_cov_after := COALESCE(v_cov_after, v_cov_before);
  END IF;

  RETURN QUERY SELECT v_count_id, v_created, false, v_cov_before, v_cov_after, v_per_today;
END;
$function$;
