-- 20260910093000_conteo_p7_recuentos_en_el_siguiente.sql
--
-- CONTAR POR FORMATOS · PASO 7 (§2.4) — el recuento pedido entra en el
-- SIGUIENTE autoinventario.
--
-- `request_recount` (paso 6) mete la línea en el conteo de hoy si sigue
-- abierto. Cuando ya está cerrado —que es lo normal, porque se aprueba por la
-- mañana el del día anterior— la petición queda en cola. Esto es lo que la
-- vacía: al generar el autoinventario del día, primero se añaden los recuentos
-- pedidos y luego lo que toque por cobertura.
--
-- Van PRIMEROS en el orden (`position` negativa) a propósito: es lo que alguien
-- ha pedido expresamente, no lo que el motor ha elegido. Y con la asignación
-- que se decidió al pedirlo, que nunca es quien contó la original.
--
-- El resto de la función está copiado LETRA A LETRA de la versión del
-- 29/08/2026 (`20260829T0810_generate_daily_count_core_autocierre_no_tumba_generacion.sql`).
-- Lo único nuevo es el bloque marcado «RECUENTOS PEDIDOS».

BEGIN;

CREATE OR REPLACE FUNCTION public._generate_daily_count_core(
  p_account_id uuid,
  p_location_id uuid,
  p_employee_ids uuid[] DEFAULT NULL::uuid[],
  p_per_person integer DEFAULT 8,
  p_coverage_target numeric DEFAULT 80,
  p_ignore_freshness boolean DEFAULT false
)
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
  v_h_a integer := 3; v_h_b integer := 7; v_h_c integer := 14;
  v_stale_id uuid;
  v_recuentos integer := 0;
BEGIN
  FOR v_stale_id IN
    SELECT id FROM public.inventory_count
    WHERE account_id = p_account_id AND location_id = p_location_id
      AND kind = 'cycle' AND status IN ('abierto','contando')
      AND created_at::date < current_date
  LOOP
    -- EL AUTOCIERRE NO PUEDE TUMBAR LA GENERACION (29/08/2026).
    BEGIN
      PERFORM public.autoclose_daily_count(v_stale_id);
    EXCEPTION WHEN OTHERS THEN
      PERFORM public._queue_system_alert(
        'autoinventario',
        'Autoinventario: no se pudo autocerrar un conteo rezagado',
        format('Conteo %s del local %s: %s. El conteo de hoy SI se ha generado; '
               'el rezagado sigue abierto y hay que cerrarlo a mano.',
               v_stale_id, p_location_id, sqlerrm),
        'autoinventario_autocierre');
    END;
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
    SELECT q.recipe_item_id, q.stock_value, q.abc_rich,
           f.last_approved, f.last_ok,
           ( p_ignore_freshness
             OR f.last_approved IS NULL
             OR NOT f.last_ok
             OR f.last_approved < now() - make_interval(days =>
                  CASE q.abc_rich WHEN 'A' THEN v_h_a WHEN 'B' THEN v_h_b ELSE v_h_c END) ) AS is_stale
    FROM public._autoinventory_queue_core(p_account_id, p_location_id, 30, p_coverage_target) q
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

  CREATE TEMP TABLE _daily_pick ON COMMIT DROP AS
  WITH sel AS (
    SELECT q.recipe_item_id, q.qty_on_hand, q.stock_value, q.abc_rich, q.must_count, q.rank,
           f.last_approved, f.last_ok,
           ( p_ignore_freshness
             OR f.last_approved IS NULL
             OR NOT f.last_ok
             OR f.last_approved < now() - make_interval(days =>
                  CASE q.abc_rich WHEN 'A' THEN v_h_a WHEN 'B' THEN v_h_b ELSE v_h_c END) ) AS is_stale
    FROM public._autoinventory_queue_core(p_account_id, p_location_id, 30, p_coverage_target) q
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
      AND NOT EXISTS (
        SELECT 1
        FROM public.inventory_count ic2
        JOIN public.inventory_count_line icl2 ON icl2.inventory_count_id = ic2.id
        WHERE ic2.account_id = p_account_id
          AND ic2.location_id = p_location_id
          AND ic2.kind IN ('full','audit')
          AND ic2.status IN ('contando','en_revision')
          AND icl2.recipe_item_id = s.recipe_item_id
      )
    WINDOW w AS (ORDER BY s.must_count DESC, s.stock_value DESC, s.last_approved ASC NULLS FIRST, s.rank ASC)
  )
  SELECT r.recipe_item_id, r.qty_on_hand, r.abc_rich, r.must_count, r.pickn
  FROM ranked r
  WHERE r.must_count = true OR r.pickn <= v_cap;

  SELECT count(*)::int INTO v_created FROM _daily_pick;

  -- ── RECUENTOS PEDIDOS (NUEVO 10/09) ───────────────────────────────────
  -- Peticiones de `request_recount` de este local que aún no tienen línea hija.
  CREATE TEMP TABLE _recount_pick ON COMMIT DROP AS
  SELECT DISTINCT ON (l.recipe_item_id)
         l.id AS origen_id, l.recipe_item_id, l.abc_class, l.recount_assign_to
    FROM public.inventory_count_line l
    JOIN public.inventory_count ic ON ic.id = l.inventory_count_id
   WHERE l.account_id = p_account_id
     AND ic.location_id = p_location_id
     AND l.recount_requested_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.inventory_count_line h WHERE h.recount_of = l.id)
   ORDER BY l.recipe_item_id, l.recount_requested_at DESC;

  SELECT count(*)::int INTO v_recuentos FROM _recount_pick;

  IF v_created = 0 AND v_recuentos = 0 THEN
    DROP TABLE IF EXISTS _daily_pick;
    DROP TABLE IF EXISTS _recount_pick;
    RETURN QUERY SELECT NULL::uuid, 0, false, v_cov_before, v_cov_before, v_per_today;
    RETURN;
  END IF;

  INSERT INTO public.inventory_count(account_id, location_id, kind, status, blind, is_opening, started_at, notes)
  VALUES (p_account_id, p_location_id, 'cycle', 'contando', true, false, now(), 'Autoinventario del día')
  RETURNING id INTO v_count_id;

  -- Los recuentos pedidos van PRIMEROS: posición negativa, para que quien los
  -- vea sepa que alguien los ha pedido a mano y no salgan detrás de la cola.
  INSERT INTO public.inventory_count_line(
    account_id, inventory_count_id, recipe_item_id, storage_area_id, position,
    system_qty, counted_qty, abc_class, assigned_to, recount_of)
  SELECT p_account_id, v_count_id, rp.recipe_item_id, NULL,
         -1000 + (ROW_NUMBER() OVER (ORDER BY rp.recipe_item_id))::int,
         public.theoretical_qty_at(rp.recipe_item_id, p_location_id, now()),
         NULL, rp.abc_class,
         -- Si no se decidió a quién, entra en el round-robin como una más.
         COALESCE(rp.recount_assign_to,
                  CASE WHEN v_n_people > 0
                       THEN p_employee_ids[((ROW_NUMBER() OVER (ORDER BY rp.recipe_item_id))::int - 1) % v_n_people + 1]
                       ELSE NULL END),
         rp.origen_id
    FROM _recount_pick rp;

  INSERT INTO public.inventory_count_line(
    account_id, inventory_count_id, recipe_item_id, storage_area_id, position,
    system_qty, counted_qty, abc_class, assigned_to)
  SELECT p_account_id, v_count_id, p.recipe_item_id, NULL, p.pickn::int,
         COALESCE(p.qty_on_hand, 0), NULL, p.abc_rich,
         CASE WHEN v_n_people > 0 THEN p_employee_ids[((p.pickn - 1) % v_n_people) + 1] ELSE NULL END
  FROM _daily_pick p
  -- Un artículo que ya entra como recuento pedido no entra dos veces.
  WHERE NOT EXISTS (SELECT 1 FROM _recount_pick rp WHERE rp.recipe_item_id = p.recipe_item_id);

  SELECT count(*)::int INTO v_created
    FROM public.inventory_count_line WHERE inventory_count_id = v_count_id;

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
  DROP TABLE IF EXISTS _recount_pick;

  RETURN QUERY SELECT v_count_id, v_created, false, v_cov_before, v_cov_after, v_per_today;
END;
$function$;

COMMIT;
