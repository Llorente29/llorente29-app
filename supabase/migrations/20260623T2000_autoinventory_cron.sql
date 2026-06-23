-- supabase/migrations/20260623T2000_autoinventory_cron.sql
-- Aplicada: 2026-06-23
--
-- AUTOINVENTARIO AUTOMÁTICO DIARIO (cron 06:00 hora española).
--
-- Hasta ahora la cola del día solo se generaba cuando alguien ABRÍA la pantalla
-- de Autoinventario (el front llamaba a generate_daily_count). Eso obliga a que
-- una persona entre cada mañana para que el sistema reparta — inaceptable.
--
-- Esta migración monta la generación AUTÓNOMA: cada día a las 06:00 (Europe/Madrid)
-- pg_cron genera y reparte la cola de TODAS las cuentas con autoinventario activo,
-- en TODOS sus locales, sin que nadie entre. El trabajador se encuentra su cola
-- ya repartida al abrir la app.
--
-- PIEZAS:
--  1) _generate_daily_count_core(): el cuerpo real de generación, SIN el check de
--     usuario (lo ejecuta el sistema, no una persona → auth.uid() es null en cron).
--  2) generate_daily_count(): pasa a ser un wrapper fino que comprueba acceso y
--     delega en el core. El front sigue llamándolo igual (firma idéntica) — cero
--     cambios en TypeScript, cero regeneración de tipos.
--  3) _resolve_day_counters(): replica en SQL la lógica del front resolveTodayCounters
--     (cuadrante del día − vacaciones aprobadas, fallback a empleados activos del local).
--  4) cron_generate_daily_counts(): recorre cuentas activas × locales y dispara la
--     generación repartida.
--  5) cron.schedule a las 04:00 UTC (06:00 Europe/Madrid en horario de verano).
--
-- REGLA SQL Editor: este fichero solo DEFINE funciones y programa el cron; NO las
-- ejecuta. La verificación se hace por separado.

-- ── 1) CORE sin check de usuario ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._generate_daily_count_core(
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

-- ── 2) WRAPPER público: comprueba acceso y delega en el core ──────────────────
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
BEGIN
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'generate_daily_count: sin acceso a la cuenta %', p_account_id;
  END IF;
  RETURN QUERY
  SELECT * FROM public._generate_daily_count_core(
    p_account_id, p_location_id, p_employee_ids, p_per_person, p_coverage_target, p_ignore_freshness);
END;
$function$;

-- ── 3) Resolución del cuadrante del día EN SQL (réplica de resolveTodayCounters) ──
-- Devuelve los empleados que trabajan HOY en el local: del cuadrante de la semana
-- (cells[tpl][díaSemana], solo plantillas activas) menos vacaciones aprobadas que
-- cubran el día. Fallback: si no hay cuadrante, empleados activos del local.
-- díaSemana: 0=lunes..6=domingo (igual que el front: (extract(dow)+6)%7).
CREATE OR REPLACE FUNCTION public._resolve_day_counters(
  p_location_id uuid,
  p_date date
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_monday date := p_date - ((extract(dow from p_date)::int + 6) % 7);
  v_daykey text := ((extract(dow from p_date)::int + 6) % 7)::text;
  v_cells jsonb;
  v_ids uuid[];
BEGIN
  -- cuadrante de la semana del local
  SELECT cells INTO v_cells
  FROM public.schedules
  WHERE location_id = p_location_id AND week_start = v_monday
  ORDER BY updated_at DESC LIMIT 1;

  IF v_cells IS NOT NULL THEN
    -- recorrer cells[tplId][diaSemana], solo plantillas activas, juntar empleados
    SELECT array_agg(DISTINCT emp)::uuid[] INTO v_ids
    FROM jsonb_each(v_cells) AS tpl(tpl_id, days)
    JOIN public.shift_templates st ON st.id = tpl.tpl_id::uuid AND st.active = true
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(days -> v_daykey, '[]'::jsonb)) AS e(emp);
  END IF;

  -- fallback: empleados activos del local
  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    SELECT array_agg(id)::uuid[] INTO v_ids
    FROM public.employees
    WHERE active = true AND location_id = p_location_id;
  END IF;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  -- quitar vacaciones/permiso aprobado que cubran el día
  SELECT array_agg(x) INTO v_ids
  FROM unnest(v_ids) AS x
  WHERE NOT EXISTS (
    SELECT 1 FROM public.vacations v
    WHERE v.employee_id = x AND v.status = 'aprobada'
      AND v.start_date <= p_date AND v.end_date >= p_date
  );

  RETURN v_ids;
END;
$function$;

-- ── 4) Lanzador del cron: todas las cuentas activas × sus locales ─────────────
CREATE OR REPLACE FUNCTION public.cron_generate_daily_counts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_counters uuid[];
  v_per_person integer;
BEGIN
  FOR r IN
    SELECT s.account_id, l.id AS location_id,
           COALESCE(s.autoinventory_per_person, 8) AS per_person
    FROM public.supply_settings s
    JOIN public.locations l ON l.account_id = s.account_id
    WHERE COALESCE(s.autoinventory_enabled, true) = true
  LOOP
    v_counters := public._resolve_day_counters(r.location_id, current_date);
    -- genera y reparte (idempotente: si ya hay cola de hoy, no duplica)
    PERFORM public._generate_daily_count_core(
      r.account_id, r.location_id, v_counters, r.per_person, 80, false);
  END LOOP;
END;
$function$;

-- ── 5) Programar el cron a las 04:00 UTC (06:00 Europe/Madrid en verano) ──────
-- Se elimina primero por si ya existía (re-ejecución idempotente de la migración).
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'autoinventory_daily') THEN
    PERFORM cron.unschedule('autoinventory_daily');
  END IF;
  PERFORM cron.schedule(
    'autoinventory_daily',
    '0 4 * * *',
    'SELECT public.cron_generate_daily_counts();'
  );
END
$cron$;
