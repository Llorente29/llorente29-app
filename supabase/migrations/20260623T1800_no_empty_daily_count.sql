-- supabase/migrations/20260623T1800_no_empty_daily_count.sql
-- Aplicada: 2026-06-23
--
-- AUTOINVENTARIO: no generar conteos vacíos. Antes la función creaba el conteo
-- ('contando') y DESPUÉS insertaba líneas; si hoy no tocaba contar nada (todo
-- fresco), insertaba 0 líneas y anulaba el conteo recién creado → una fila basura
-- "0 líneas · Anulado" cada día sin trabajo. Ahora se CALCULA primero la selección
-- (tabla temporal) y SOLO se crea el conteo si hay ≥1 línea. Resto idéntico:
-- mismo score/cobertura, mismo reparto round-robin, mismo barrido de huérfanos.

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
  WITH sel AS (
    SELECT q.recipe_item_id, q.stock_value, q.abc_rich,
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

  -- CALCULA la selección ANTES de crear nada. Tabla temporal de esta sesión.
  CREATE TEMP TABLE _daily_pick ON COMMIT DROP AS
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
  SELECT r.recipe_item_id, r.qty_on_hand, r.abc_rich, r.must_count, r.pickn
  FROM ranked r
  WHERE r.must_count = true OR r.pickn <= v_cap;

  SELECT count(*)::int INTO v_created FROM _daily_pick;

  -- Si no hay NADA que contar hoy, no se crea conteo (cero filas basura).
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
