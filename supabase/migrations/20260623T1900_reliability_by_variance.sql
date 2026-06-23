-- supabase/migrations/20260623T1900_reliability_by_variance.sql
-- Aplicada: 2026-06-23
--
-- FIABILIDAD POR EXACTITUD, NO POR RECENCIA.
--
-- PROBLEMA: el autoinventario consideraba "fiable/fresco" un artículo SOLO por
-- haberse contado hace poco, ignorando si ese conteo CUADRÓ. Resultado absurdo:
-- un almacén que descuadra cientos de euros en cada conteo se reportaba como
-- "fiabilidad al día" porque se había contado ayer. Contar algo que descuadra
-- NO lo hace fiable; lo hace "conocido-como-malo", y debe volver a contarse.
--
-- ARREGLO: un artículo es FIABLE (fresco) solo si su ÚLTIMO conteo aprobado
-- CUADRÓ (within_tolerance, o variación < 5€ y < 3%) Y está dentro de la ventana
-- de recencia. Si la última vez descuadró, sigue STALE → vuelve a la cola,
-- priorizado por valor y por € de varianza (risk_eur, que ya pondera la queue).
-- Además se aprietan los umbrales de recencia: A=3, B=7, C=14 días (antes 7/14/30),
-- para un control más estrecho.
--
-- Nota honesta: mientras el consumo por escandallo no esté activo (el teórico no
-- se mueve), CUALQUIER reconteo descuadrará y el sistema mandará a contar a diario.
-- Eso es la VERDAD del estado actual, no un fallo: el siguiente frente (motor de
-- consumo teórico) es lo que estabilizará la fiabilidad. Esta función ya no miente.

CREATE OR REPLACE FUNCTION public.generate_daily_count(
  p_account_id uuid,
  p_location_id uuid,
  p_employee_ids uuid[] DEFAULT NULL::uuid[],
  p_per_person integer DEFAULT 8,
  p_coverage_target numeric DEFAULT 80,
  p_ignore_freshness boolean DEFAULT false
)
RETURNS TABLE(count_id uuid, lines_created integer, already_existed boolean,
              coverage_before numeric, coverage_after numeric, per_person_today integer)
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
  -- Umbrales de recencia más estrictos (días sin contar para volver a ser stale).
  v_h_a integer := 3; v_h_b integer := 7; v_h_c integer := 14;
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

  -- ¿Ya hay conteo cycle de hoy? Devuélvelo (no duplicar).
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

  -- Cobertura ANTES (sobre lo que está en alcance hoy).
  -- 'fresco' = última cuenta aprobada CUADRÓ y es reciente (misma regla que abajo).
  WITH sel AS (
    SELECT q.recipe_item_id, q.stock_value, q.abc_rich,
           f.last_approved, f.last_ok,
           ( p_ignore_freshness
             OR f.last_approved IS NULL
             OR NOT f.last_ok
             OR f.last_approved < now() - make_interval(days =>
                  CASE q.abc_rich WHEN 'A' THEN v_h_a WHEN 'B' THEN v_h_b ELSE v_h_c END) ) AS is_stale
    FROM public.autoinventory_queue(p_account_id, p_location_id, 30, p_coverage_target) q
    LEFT JOIN (
      SELECT DISTINCT ON (icl.recipe_item_id)
             icl.recipe_item_id,
             ic.approved_at AS last_approved,
             COALESCE(icl.within_tolerance,
                      (ABS(COALESCE(icl.variance_value,0)) < 5
                       AND ABS(COALESCE(icl.variance_pct,0)) < 3)) AS last_ok
      FROM public.inventory_count_line icl
      JOIN public.inventory_count ic ON ic.id = icl.inventory_count_id
      WHERE ic.account_id = p_account_id AND ic.location_id = p_location_id AND ic.status = 'aprobado'
      ORDER BY icl.recipe_item_id, ic.approved_at DESC
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

  -- CALCULA la selección ANTES de crear nada. Tabla temporal de esta sesión.
  CREATE TEMP TABLE _daily_pick ON COMMIT DROP AS
  WITH sel AS (
    SELECT q.recipe_item_id, q.qty_on_hand, q.stock_value, q.abc_rich, q.must_count, q.rank,
           f.last_approved, f.last_ok,
           ( p_ignore_freshness
             OR f.last_approved IS NULL
             OR NOT f.last_ok
             OR f.last_approved < now() - make_interval(days =>
                  CASE q.abc_rich WHEN 'A' THEN v_h_a WHEN 'B' THEN v_h_b ELSE v_h_c END) ) AS is_stale
    FROM public.autoinventory_queue(p_account_id, p_location_id, 30, p_coverage_target) q
    LEFT JOIN (
      SELECT DISTINCT ON (icl.recipe_item_id)
             icl.recipe_item_id,
             ic.approved_at AS last_approved,
             COALESCE(icl.within_tolerance,
                      (ABS(COALESCE(icl.variance_value,0)) < 5
                       AND ABS(COALESCE(icl.variance_pct,0)) < 3)) AS last_ok
      FROM public.inventory_count_line icl
      JOIN public.inventory_count ic ON ic.id = icl.inventory_count_id
      WHERE ic.account_id = p_account_id AND ic.location_id = p_location_id AND ic.status = 'aprobado'
      ORDER BY icl.recipe_item_id, ic.approved_at DESC
    ) f ON f.recipe_item_id = q.recipe_item_id
    WHERE q.in_scope
  ),
  ranked AS (
    SELECT s.*, ROW_NUMBER() OVER w AS pickn
    FROM sel s
    WHERE s.is_stale
    -- Prioridad: obligatorios primero; luego lo de más valor; luego lo que más
    -- tiempo lleva sin contar (lo nunca contado primero). El € de varianza ya
    -- pesa dentro de must_count/score de la queue.
    WINDOW w AS (ORDER BY s.must_count DESC, s.stock_value DESC, s.last_approved ASC NULLS FIRST, s.rank ASC)
  )
  SELECT r.recipe_item_id, r.qty_on_hand, r.abc_rich, r.must_count, r.pickn
  FROM ranked r
  WHERE r.must_count = true OR r.pickn <= v_cap;

  SELECT count(*)::int INTO v_created FROM _daily_pick;

  -- Si no hay NADA que contar hoy (todo cuadró y reciente), no se crea conteo.
  IF v_created = 0 THEN
    DROP TABLE IF EXISTS _daily_pick;
    RETURN QUERY SELECT NULL::uuid, 0, false, v_cov_before, v_cov_before, v_per_today;
    RETURN;
  END IF;

  -- Hay líneas → AHORA sí se crea el conteo y se vuelcan.
  INSERT INTO public.inventory_count(account_id, location_id, kind, status, blind, is_opening, started_at, notes)
  VALUES (p_account_id, p_location_id, 'cycle', 'contando', true, false, now(), 'Autoinventario del día')
  RETURNING id INTO v_count_id;

  INSERT INTO public.inventory_count_line(
    account_id, inventory_count_id, recipe_item_id, storage_area_id, position,
    system_qty, counted_qty, abc_class, assigned_to)
  SELECT p_account_id, v_count_id, p.recipe_item_id, NULL, p.pickn::int,
         COALESCE(p.qty_on_hand, 0), NULL, p.abc_rich,
         CASE WHEN v_n_people > 0 THEN p_employee_ids[((p.pickn - 1) % v_n_people) + 1] ELSE NULL END
  FROM _daily_pick p;

  -- Cobertura DESPUÉS (estimada con el valor de stock de lo seleccionado).
  SELECT CASE WHEN v_total_value > 0
    THEN ROUND((v_fresh_before + COALESCE(SUM(ric.stock_value),0)) / v_total_value * 100, 1)
    ELSE 100 END
  INTO v_cov_after
  FROM public.inventory_count_line l
  JOIN public.recipe_item_location_stock ric
    ON ric.recipe_item_id = l.recipe_item_id AND ric.account_id = p_account_id AND ric.location_id = p_location_id
  WHERE l.inventory_count_id = v_count_id;
  v_cov_after := COALESCE(v_cov_after, v_cov_before);

  DROP TABLE IF EXISTS _daily_pick;

  RETURN QUERY SELECT v_count_id, v_created, false, v_cov_before, v_cov_after, v_per_today;
END;
$function$;
