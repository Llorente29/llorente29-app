-- 20260910173224_conteo_p14_que_el_packaging_se_cuente.sql
--
-- QUE EL PACKAGING SE CUENTE (§2.1 del encargo del 10/09)
--
-- `build_inventory_count` y `_autoinventory_queue_core` filtraban `type = 'raw'`,
-- así que un inventario de la zona Packaging salía con CERO líneas: es lo que
-- veía Julio. Sin esto no hay recuento de apertura posible.
--
-- EL `tool` NO ENTRA, y no es una opinión: en toda la cuenta hay UNO, se llama
-- «Portes», tiene 0 zonas, 0 líneas de escandallo y 3 recepciones. Es un cargo
-- de factura, no una cosa que esté en una estantería. Aunque se incluyera, sin
-- zona no aparecería en ningún recuento.
--
-- EL TAMAÑO DEL CAMBIO, medido antes de aplicarlo (artículos activos con zona):
--   Alcalá           136 raw  +  58 packaging  =  194
--   Carabanchel      133 raw  +  57 packaging  =  190
--   Plaza Castilla   133 raw  +  57 packaging  =  190
--
-- EL AUTOINVENTARIO DIARIO se regula solo de momento: su ranking pesa la
-- ROTACIÓN, que sale de los movimientos de `consumo`, y el packaging todavía no
-- tiene ninguno. Hasta que se encienda el descuento al vender, el packaging
-- entra en el universo pero puntúa bajo y casi no se propondrá. Va dicho para
-- que no sorprenda cuando el descuento se encienda y empiece a salir.

BEGIN;

CREATE OR REPLACE FUNCTION public.build_inventory_count(p_count_id uuid, p_area_ids uuid[] DEFAULT NULL::uuid[], p_full boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_location_id uuid;
  v_n integer := 0;
  v_p90 numeric;
  v_p50 numeric;
  v_has_opening boolean;
BEGIN
  SELECT account_id, location_id INTO v_account_id, v_location_id
    FROM public.inventory_count WHERE id = p_count_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'build_inventory_count: conteo % no existe', p_count_id;
  END IF;
  -- C3: solo el empleado asignado (o un manager/admin) puede EMPEZAR un conteo manual.
  IF NOT public.can_operate_manual_count(p_count_id) THEN
    RAISE EXCEPTION 'build_inventory_count: este inventario está asignado a otra persona';
  END IF;
  -- ¿El local ya tiene una apertura en el ledger? Si no, este conteo lo es.
  SELECT EXISTS (
    SELECT 1 FROM public.stock_movement
    WHERE account_id = v_account_id
      AND location_id = v_location_id
      AND movement_type = 'apertura'
  ) INTO v_has_opening;
  UPDATE public.inventory_count
    SET is_opening = NOT v_has_opening
    WHERE id = p_count_id;
  DELETE FROM public.inventory_count_line WHERE inventory_count_id = p_count_id;
  SELECT
    percentile_cont(0.90) WITHIN GROUP (ORDER BY COALESCE(qty_on_hand,0)*COALESCE(avg_unit_cost,0)),
    percentile_cont(0.50) WITHIN GROUP (ORDER BY COALESCE(qty_on_hand,0)*COALESCE(avg_unit_cost,0))
  INTO v_p90, v_p50
  FROM public.recipe_item_location_stock
  WHERE account_id = v_account_id AND location_id = v_location_id;
  INSERT INTO public.inventory_count_line (
    account_id, inventory_count_id, recipe_item_id, storage_area_id, position,
    system_qty, counted_qty, abc_class
  )
  SELECT
    v_account_id,
    p_count_id,
    ri.id,
    risa.storage_area_id,
    COALESCE(sa.position, 9999) * 1000 + COALESCE(risa.position, 999),
    -- CAMBIO 20260825: siembra desde el LEDGER, no desde qty_on_hand. La
    -- materialización va atrasada (medido: Crispy Wings qty_on_hand 0 con
    -- ledger -250) y esa foto es la que veía el aviso blind del contador.
    -- Da igual para el informe final (close vuelve a reconstruirlo), pero
    -- así el arranque y el cierre hablan de lo mismo.
    public.theoretical_qty_at(ri.id, v_location_id, now()),
    NULL,
    -- La clasificación ABC sigue midiéndose por VALOR de stock con la
    -- materialización (que es donde vive avg_unit_cost). No es dinero de
    -- merma, solo prioridad de recuento.
    CASE
      WHEN v_p90 IS NULL OR COALESCE(ril.avg_unit_cost,0) = 0 THEN NULL
      WHEN COALESCE(ril.qty_on_hand,0)*COALESCE(ril.avg_unit_cost,0) >= v_p90 THEN 'A'
      WHEN COALESCE(ril.qty_on_hand,0)*COALESCE(ril.avg_unit_cost,0) >= v_p50 THEN 'B'
      ELSE 'C'
    END
  FROM public.recipe_item ri
  LEFT JOIN public.recipe_item_storage_area risa
    ON risa.recipe_item_id = ri.id AND risa.account_id = v_account_id
  LEFT JOIN public.storage_area sa
    ON sa.id = risa.storage_area_id AND sa.location_id = v_location_id
  LEFT JOIN public.recipe_item_location_stock ril
    ON ril.recipe_item_id = ri.id AND ril.location_id = v_location_id AND ril.account_id = v_account_id
  WHERE ri.account_id = v_account_id
    AND ri.type IN ('raw', 'packaging')
    AND ri.is_active = true
    AND (
      p_full = true
      OR (p_area_ids IS NOT NULL AND risa.storage_area_id = ANY(p_area_ids))
      OR (p_area_ids IS NULL AND p_full = false AND sa.id IS NOT NULL)
    );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.inventory_count
    SET status = 'contando', started_at = COALESCE(started_at, now()), updated_at = now()
    WHERE id = p_count_id;
  RETURN v_n;
END;
$function$;

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
      AND ri.type IN ('raw', 'packaging')
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
COMMIT;
