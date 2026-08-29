-- 20260829T0810_generate_daily_count_core_autocierre_no_tumba_generacion.sql
-- ============================================================================
-- Que un rezagado que no se puede cerrar no impida generar el conteo de hoy
-- ============================================================================
-- Segunda mitad de 20260829T0800. Con la cola ya arreglada, el cron dejaba de
-- fallar en autoinventory_queue y pasaba a fallar UN PASO ANTES:
--
--   FALLA: autoclose_daily_count: sin acceso
--
-- Lo primero que hace el generador es cerrar los conteos de dias anteriores que
-- quedaron abiertos. Eso es MANTENIMIENTO. Generar el conteo de HOY es la tarea
-- principal, y estaba muriendo por culpa del mantenimiento.
--
-- Se aisla: si un rezagado no se puede cerrar, se avisa y se sigue.
--
-- EL AVISO VA A system_alert, NO A UN `raise warning`. Es deliberado y viene de
-- lo que se encontro auditando esto: cron_autoclose_daily_counts (jobid 46)
-- envuelve cada conteo en `exception when others` y degrada el fallo a warning.
-- pg_cron NO cuenta los warnings como fallo, asi que el job lleva 144 de 144
-- "succeeded" y CERO movimientos de stock en toda su vida, con 5 conteos
-- esperando. Un `exception when others` puesto para que nada sea silencioso es
-- justo lo que lo vuelve invisible. Aqui no se repite.
--
-- El debounce (p_debounce_kind = 'autoinventario_autocierre') hace que los 5
-- rezagados produzcan UN aviso, no cinco.
--
-- LO QUE ESTO NO ARREGLA, dicho para que no se de por hecho: el autocierre
-- sigue sin funcionar. autoclose_daily_count -> close_inventory_count ->
-- apply_inventory_count llevan guardia las tres y las dos ultimas ESCRIBEN
-- ajustes de stock. Darles core es decision operativa —pondria a un cron a
-- asentar inventario sin nadie delante, con 5 rezagados esperando, dos de ellos
-- de la cuenta DEMO del 15/06 con 194 lineas y 2 contadas— y Julio la ha dejado
-- fuera a proposito el 29/08. Los rezagados se cierran a mano.
--
-- VERIFICADO sin sesion de usuario, en transaccion con rollback:
--   cron_generate_daily_counts() completa sin error y genera
--     Foodint Carabanchel     41 lineas · 2 personas
--     Foodint Plaza Castilla  24 lineas · 2 personas
--     Foodint Alcala          ya existia el de hoy -> no duplica
--
--   Plaza Castilla NO estaba en el diagnostico: eran TRES locales sin conteo
--   automatico, no dos.
--
-- FIDELIDAD: sale de la definicion viva por sustitucion del bucle, no reescrita
-- a mano. Tras aplicar, lo vivo casa con este fichero:
--   _generate_daily_count_core  8.395 car.  48f20f250ff6762779c184540caa1ab3
--
-- MARCHA ATRAS: devolver el bucle a su forma de una linea,
--   LOOP
--     PERFORM public.autoclose_daily_count(v_stale_id);
--   END LOOP;
-- ============================================================================

CREATE OR REPLACE FUNCTION public._generate_daily_count_core(p_account_id uuid, p_location_id uuid, p_employee_ids uuid[] DEFAULT NULL::uuid[], p_per_person integer DEFAULT 8, p_coverage_target numeric DEFAULT 80, p_ignore_freshness boolean DEFAULT false)
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
BEGIN
  FOR v_stale_id IN
    SELECT id FROM public.inventory_count
    WHERE account_id = p_account_id AND location_id = p_location_id
      AND kind = 'cycle' AND status IN ('abierto','contando')
      AND created_at::date < current_date
  LOOP
    -- EL AUTOCIERRE NO PUEDE TUMBAR LA GENERACION (29/08/2026).
    -- Este bucle es mantenimiento: cierra los conteos de dias anteriores que se
    -- quedaron abiertos. Generar el conteo de HOY es la tarea principal, y
    -- estaba muriendo aqui: autoclose_daily_count lleva guardia de sesion y
    -- pg_cron no tiene usuario, asi que el cron reventaba ANTES de generar nada
    -- y el conteo del dia solo aparecia cuando alguien abria la pantalla.
    --
    -- Se aisla el fallo: si no se puede cerrar un rezagado, se avisa y se sigue.
    -- El aviso va a system_alert, NO a un `raise warning`: pg_cron no cuenta los
    -- warnings como fallo, y ese es exactamente el motivo de que
    -- cron_autoclose_daily_counts lleve 144 ejecuciones "correctas" sin haber
    -- asentado un solo movimiento.
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
      -- C4: NO proponer artículos que están HOY en un conteo manual abierto
      -- (inicial/seguridad, kind full/audit) en 'contando'/'en_revision' de este
      -- local. Evita el doble conteo del mismo artículo el mismo día. El
      -- autoinventario NO se desactiva; solo se saltan esos artículos.
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

  IF v_created = 0 THEN
    DROP TABLE IF EXISTS _daily_pick;
    RETURN QUERY SELECT NULL::uuid, 0, false, v_cov_before, v_cov_before, v_per_today;
    RETURN;
  END IF;

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
$function$
;
