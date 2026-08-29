-- 20260829T0800_autoinventory_queue_core_para_el_cron.sql
-- ============================================================================
-- El autoinventario nunca lo generaba el cron: lo generaba Julio al entrar
-- ============================================================================
-- jobid 6 `autoinventory_daily` (0 4 * * * UTC) esta activo, se ejecuta puntual
-- y ha FALLADO 14 de 14 veces en 14 dias. Los conteos aparecian igualmente
-- porque los creaba la pantalla: con la sesion de Julio el guardia pasa. De ahi
-- «solo se genera si entro» — es literalmente lo que pasaba.
--
-- CAUSA. La cadena del cron atraviesa funciones con guardia de permisos que
-- exige sesion de usuario. pg_cron no tiene usuario: sin auth.uid(),
-- current_user_is_admin() da false y current_user_account_ids() da {}.
-- Comprobado en la propia base, no deducido.
--
--   cron_generate_daily_counts          sin guardia
--     -> _generate_daily_count_core     sin guardia
--          -> autoclose_daily_count     GUARDIA   (sigue bloqueando, ver abajo)
--          -> autoinventory_queue       GUARDIA   <- lo que arregla este fichero
--
-- ARREGLO: el patron que la casa ya usa en generate_daily_count ->
-- _generate_daily_count_core y en set_product_availability ->
-- _set_product_availability_core. La logica baja a un core sin guardia; la
-- funcion publica se queda con el guardia y delega; el cron llama al core.
--
-- NO se toca la firma de autoinventory_queue: mismos argumentos, mismos
-- DEFAULTs, mismo RETURNS TABLE. Por eso NO hace falta DROP y no puede
-- aparecer una sobrecarga. Verificado despues de aplicar con
-- pg_get_function_identity_arguments: UNA firma por funcion, las tres.
--
-- El core NO relaja ningun permiso de cara al exterior: lo unico que puede
-- llamarlo sin guardia es SQL de dentro de la base. Quien entra por PostgREST
-- sigue pasando por autoinventory_queue, que conserva el guardia intacto.
--
-- FIDELIDAD. El core y el generador salen de la definicion VIVA por
-- sustitucion, no reescritos a mano. Transcritas y verificadas byte a byte
-- ANTES de tocar nada:
--   autoinventory_queue          5.899 car.  a5b478d0154da1f773c0a9ad482b7e9d
--   _generate_daily_count_core   7.301 car.  85a6726eadcc8592d133950e61f3885e
-- Y despues de aplicar, lo vivo casa con este fichero:
--   _autoinventory_queue_core    5.567 car.  52c65b33979884c547c453d0d87cb85b
--   autoinventory_queue          1.094 car.  5d17c29469ac7062f11ce1c6ae6abdda
--   _generate_daily_count_core   7.157 car.  5e19ffdd29268fb7bc8c9438531235e2
-- Finales de linea normalizados a LF (el catalogo los traia CRLF).
--
-- ⚠️ ESTO NO BASTA POR SI SOLO, y conviene que conste. Tras aplicarlo, el cron
-- ya no falla en autoinventory_queue: falla un paso ANTES, en el bucle de
-- autocierre de conteos rezagados, que es lo primero que hace el generador:
--
--   FALLA: autoclose_daily_count: sin acceso
--
-- autoclose_daily_count -> close_inventory_count -> apply_inventory_count
-- llevan guardia las tres, y las dos ultimas ESCRIBEN AJUSTES DE STOCK.
-- Darles core es una decision operativa, no un refactor: pondria a un cron a
-- asentar inventario sin nadie delante. Queda fuera de esta migracion a
-- proposito, pendiente de decision.
--
-- MARCHA ATRAS: volver a poner el cuerpo entero en autoinventory_queue (esta
-- arriba, con su md5) y DROP FUNCTION public._autoinventory_queue_core(...);
-- y devolver las dos llamadas de _generate_daily_count_core a
-- public.autoinventory_queue(...).
-- ============================================================================

-- 1) CORE: identico a lo que habia, sin el guardia.
CREATE OR REPLACE FUNCTION public._autoinventory_queue_core(p_account_id uuid, p_location_id uuid, p_window_days integer DEFAULT 30, p_coverage_target numeric DEFAULT 80, p_w_value numeric DEFAULT 0.35, p_w_rotation numeric DEFAULT 0.35, p_w_risk numeric DEFAULT 0.30)
 RETURNS TABLE(recipe_item_id uuid, name text, code text, base_unit text, qty_on_hand numeric, stock_value numeric, rotation_eur numeric, risk_eur numeric, must_count boolean, critical_reason text, score numeric, score_value numeric, score_rotation numeric, score_risk numeric, abc_rich text, coverage_pct numeric, in_scope boolean, rank integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
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
$function$
;

-- 2) PUBLICA: conserva el guardia y delega. Misma firma exacta.
CREATE OR REPLACE FUNCTION public.autoinventory_queue(p_account_id uuid, p_location_id uuid, p_window_days integer DEFAULT 30, p_coverage_target numeric DEFAULT 80, p_w_value numeric DEFAULT 0.35, p_w_rotation numeric DEFAULT 0.35, p_w_risk numeric DEFAULT 0.30)
 RETURNS TABLE(recipe_item_id uuid, name text, code text, base_unit text, qty_on_hand numeric, stock_value numeric, rotation_eur numeric, risk_eur numeric, must_count boolean, critical_reason text, score numeric, score_value numeric, score_rotation numeric, score_risk numeric, abc_rich text, coverage_pct numeric, in_scope boolean, rank integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'autoinventory_queue: sin acceso a la cuenta %', p_account_id;
  END IF;

  RETURN QUERY
  SELECT * FROM public._autoinventory_queue_core(
    p_account_id, p_location_id, p_window_days, p_coverage_target,
    p_w_value, p_w_rotation, p_w_risk);
END;
$function$
;

-- 3) El generador llama al core (dos ocurrencias, las dos CTE `sel`).
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
