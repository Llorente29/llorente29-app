-- ============================================================================
-- Autoinventario A3/A4 — Cola del día asignada por persona + stock anómalo
-- ============================================================================
-- Construido y verificado en producción el 15/06/2026.
--
-- Cierra el bucle del autoinventario sobre A1/A2 (autoinventory_queue):
--   QUÉ contar  : valor + rotación + riesgo + STOCK ANÓMALO (negativos/ceros
--                 con rotación = error de almacén) como must_count (override).
--   CUÁNTO      : cobertura FRESCA del valor (verificado dentro de su horizonte
--                 por clase A=7/B=14/C=30 días) + cupo por persona ADAPTATIVO
--                 (arranque alto <40% = x1.5, normal 40-75% = x1, crucero >75% = x0.5).
--   QUIÉN       : reparto round-robin entre quienes trabajan hoy (horario
--                 planificado + sin vacaciones; resuelto en el service, como APPCC v2).
--   AVISO       : check_count_variance da veredicto blind (ok/low/high) al
--                 trabajador sin exponer el stock del sistema.
--
-- Esquema: inventory_count_line.assigned_to + supply_settings flags.
-- NOTA: estas funciones SECURITY DEFINER NO se prueban en el SQL Editor
-- (current_user_* es null sin sesión → EXCEPTION); se prueban desde la app.
-- ============================================================================

-- ── Esquema ──────────────────────────────────────────────────────────────
ALTER TABLE public.inventory_count_line
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_count_line_assigned_to
  ON public.inventory_count_line(assigned_to);

ALTER TABLE public.supply_settings
  ADD COLUMN IF NOT EXISTS autoinventory_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS autoinventory_per_person integer NOT NULL DEFAULT 8;

-- Higiene: una versión vieja de generate_daily_count (5 args, con tabla temporal)
-- convivía por sobrecarga y causaba estado errático. Se elimina explícitamente.
DROP FUNCTION IF EXISTS public.generate_daily_count(uuid, uuid, uuid[], integer, numeric);

-- ── autoinventory_queue (A1/A2 + override de stock anómalo) ────────────────
CREATE OR REPLACE FUNCTION public.autoinventory_queue(p_account_id uuid, p_location_id uuid, p_window_days integer DEFAULT 30, p_coverage_target numeric DEFAULT 80, p_w_value numeric DEFAULT 0.35, p_w_rotation numeric DEFAULT 0.35, p_w_risk numeric DEFAULT 0.30)
 RETURNS TABLE(recipe_item_id uuid, name text, code text, base_unit text, qty_on_hand numeric, stock_value numeric, rotation_eur numeric, risk_eur numeric, must_count boolean, critical_reason text, score numeric, score_value numeric, score_rotation numeric, score_risk numeric, abc_rich text, coverage_pct numeric, in_scope boolean, rank integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'autoinventory_queue: sin acceso a la cuenta %', p_account_id;
  END IF;

  RETURN QUERY
  WITH universe AS (
    SELECT ri.id, ri.name, ri.code,
           ku.abbreviation AS base_unit,
           ri.computed_cost,
           ri.is_operational_critical,
           ri.operational_min_qty
    FROM public.recipe_item ri
    LEFT JOIN public.kitchen_unit ku ON ku.id = ri.base_unit_id
    WHERE ri.account_id = p_account_id
      AND ri.type = 'raw'
      AND ri.is_active = true
  ),
  stk AS (
    SELECT s.recipe_item_id, s.qty_on_hand, s.stock_value, s.avg_unit_cost
    FROM public.recipe_item_location_stock s
    WHERE s.account_id = p_account_id AND s.location_id = p_location_id
  ),
  rot AS (
    SELECT m.recipe_item_id, SUM(ABS(m.qty_base)) AS rot_qty
    FROM public.stock_movement m
    WHERE m.account_id = p_account_id
      AND m.location_id = p_location_id
      AND m.movement_type = 'consumo'
      AND m.occurred_at >= now() - make_interval(days => p_window_days)
    GROUP BY m.recipe_item_id
  ),
  var_risk AS (
    SELECT icl.recipe_item_id, SUM(ABS(COALESCE(icl.variance_value, 0))) AS var_eur
    FROM public.inventory_count_line icl
    JOIN public.inventory_count ic ON ic.id = icl.inventory_count_id
    WHERE icl.account_id = p_account_id
      AND ic.location_id = p_location_id
    GROUP BY icl.recipe_item_id
  ),
  waste_risk AS (
    SELECT w.recipe_item_id, SUM(COALESCE(w.cost_eur, 0)) AS waste_eur
    FROM public.stock_waste w
    WHERE w.account_id = p_account_id AND w.location_id = p_location_id
    GROUP BY w.recipe_item_id
  ),
  raw_scores AS (
    SELECT
      u.id, u.name, u.code, u.base_unit,
      u.is_operational_critical, u.operational_min_qty,
      COALESCE(s.qty_on_hand, 0) AS qty_on_hand,
      COALESCE(s.stock_value, 0) AS stock_value,
      COALESCE(r.rot_qty, 0) * COALESCE(u.computed_cost, s.avg_unit_cost, 0) AS rotation_eur,
      COALESCE(vr.var_eur, 0) + COALESCE(wr.waste_eur, 0) AS risk_eur
    FROM universe u
    LEFT JOIN stk        s  ON s.recipe_item_id  = u.id
    LEFT JOIN rot        r  ON r.recipe_item_id  = u.id
    LEFT JOIN var_risk   vr ON vr.recipe_item_id = u.id
    LEFT JOIN waste_risk wr ON wr.recipe_item_id = u.id
  ),
  maxes AS (
    SELECT
      NULLIF(MAX(stock_value),  0) AS mx_val,
      NULLIF(MAX(rotation_eur), 0) AS mx_rot,
      NULLIF(MAX(risk_eur),     0) AS mx_risk
    FROM raw_scores
  ),
  scored AS (
    SELECT
      rs.*,
      COALESCE(rs.stock_value  / m.mx_val,  0) AS n_val,
      COALESCE(rs.rotation_eur / m.mx_rot,  0) AS n_rot,
      COALESCE(rs.risk_eur     / m.mx_risk, 0) AS n_risk,
      ( rs.is_operational_critical
        OR (rs.operational_min_qty IS NOT NULL AND rs.qty_on_hand < rs.operational_min_qty)
        OR rs.qty_on_hand < 0                                          -- NEGATIVO: error físico seguro
        OR (rs.qty_on_hand = 0 AND rs.rotation_eur > 0)                -- A CERO con rotación: ¿agotado o sin registrar?
      ) AS must_count,
      CASE
        WHEN rs.qty_on_hand < 0 THEN 'stock negativo (revisar)'
        WHEN rs.is_operational_critical
             AND rs.operational_min_qty IS NOT NULL
             AND rs.qty_on_hand < rs.operational_min_qty THEN 'critico + bajo minimo'
        WHEN rs.is_operational_critical THEN 'critico operativo'
        WHEN rs.operational_min_qty IS NOT NULL
             AND rs.qty_on_hand < rs.operational_min_qty THEN 'bajo minimo'
        WHEN rs.qty_on_hand = 0 AND rs.rotation_eur > 0 THEN 'a cero, ¿agotado?'
        ELSE NULL
      END AS critical_reason
    FROM raw_scores rs CROSS JOIN maxes m
  ),
  ranked AS (
    SELECT
      sc.*,
      ROUND(p_w_value * sc.n_val + p_w_rotation * sc.n_rot + p_w_risk * sc.n_risk, 4) AS score,
      ROW_NUMBER() OVER w AS rank,
      SUM(sc.stock_value) OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_value,
      SUM(sc.stock_value) OVER () AS tot_value
    FROM scored sc
    WINDOW w AS (
      ORDER BY sc.must_count DESC,
               (p_w_value * sc.n_val + p_w_rotation * sc.n_rot + p_w_risk * sc.n_risk) DESC,
               sc.stock_value DESC
    )
  )
  SELECT
    rk.id, rk.name, rk.code, rk.base_unit,
    ROUND(rk.qty_on_hand, 4), ROUND(rk.stock_value, 2),
    ROUND(rk.rotation_eur, 2), ROUND(rk.risk_eur, 2),
    rk.must_count, rk.critical_reason,
    rk.score, ROUND(rk.n_val, 4), ROUND(rk.n_rot, 4), ROUND(rk.n_risk, 4),
    CASE WHEN rk.tot_value > 0 THEN
      CASE WHEN rk.cum_value / rk.tot_value * 100 <= 80 THEN 'A'
           WHEN rk.cum_value / rk.tot_value * 100 <= 95 THEN 'B'
           ELSE 'C' END
    END AS abc_rich,
    CASE WHEN rk.tot_value > 0 THEN ROUND(rk.cum_value / rk.tot_value * 100, 2) END AS coverage_pct,
    ( rk.must_count
      OR (rk.tot_value > 0 AND rk.cum_value / rk.tot_value * 100 <= p_coverage_target)
    ) AS in_scope,
    rk.rank::integer
  FROM ranked rk
  ORDER BY rk.rank;
END;
$function$;

-- ── generate_daily_count (A3/A4: cola del día + reparto por persona) ───────
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
BEGIN
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'generate_daily_count: sin acceso a la cuenta %', p_account_id;
  END IF;

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

  -- Métricas de frescura (sin tabla temporal: CTE inline en cada cálculo).
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

  -- Inserta los rancios (críticos primero) hasta el techo del cupo del día.
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

-- ── check_count_variance (veredicto blind para el aviso al trabajador) ─────
CREATE OR REPLACE FUNCTION public.check_count_variance(p_line_id uuid, p_counted numeric)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_system numeric;
BEGIN
  SELECT account_id, system_qty INTO v_account_id, v_system
  FROM public.inventory_count_line WHERE id = p_line_id;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'check_count_variance: línea % no existe', p_line_id;
  END IF;
  IF NOT (public.current_user_is_admin()
          OR v_account_id = ANY(public.current_user_account_ids())) THEN
    RAISE EXCEPTION 'check_count_variance: sin acceso';
  END IF;

  -- Sin dato de sistema (artículo nuevo, stock 0) → no se puede juzgar.
  IF v_system IS NULL OR v_system <= 0 THEN
    RETURN 'ok';
  END IF;

  IF p_counted < v_system / 3.0 THEN
    RETURN 'low';
  ELSIF p_counted > v_system * 3.0 THEN
    RETURN 'high';
  END IF;
  RETURN 'ok';
END;
$function$;
