-- 20260610T1800_autoinventory_queue.sql
-- Aplicada: 2026-06-10
-- A1 del AUTOINVENTARIO IA — cola priorizada AL VUELO (no persistida).
--
-- QUE contar  = score rico independiente: valor (stock parado) + rotacion (consumo en
--               ventana) + riesgo (varianza historica + merma). Normalizado 0-1 por el max
--               del local. La criticidad operativa es OVERRIDE DURO (must_count), no peso:
--               rescata el consumible barato cuyo fallo cierra la marca (bolsa de envio).
-- CUANTO contar = COBERTURA de valor, no cadencia fija: recorriendo la cola por score se
--               acumula stock_value; in_scope = must_count OR cobertura <= objetivo.
--
-- Universo = type='raw' AND is_active (MISMO que build_inventory_count; NO is_stockable,
--            que hoy esta a 0 en todos los raw -> filtrar por el daria cola vacia).
-- Frontera: autoriza en el borde con el MISMO idioma que sales_mapping_reliability /
--           menu_item_economics. Motor de solo lectura por dentro.
--
-- DEUDA DECLARADA (disparador: A1 validada en uso): build_inventory_count seguira
--   sellando su abc_class por percentiles (foto historica, intacta hoy); cuando A1 este
--   validada, build/close pasaran a sellar la clase rica que dicte A1 (una sola verdad de
--   "clase A"). Hoy NO se toca build_inventory_count.

CREATE OR REPLACE FUNCTION public.autoinventory_queue(
  p_account_id      uuid,
  p_location_id     uuid,
  p_window_days     integer DEFAULT 30,
  p_coverage_target numeric DEFAULT 80,
  p_w_value         numeric DEFAULT 0.35,
  p_w_rotation      numeric DEFAULT 0.35,
  p_w_risk          numeric DEFAULT 0.30
)
RETURNS TABLE (
  recipe_item_id  uuid,
  name            text,
  code            text,
  base_unit       text,
  qty_on_hand     numeric,
  stock_value     numeric,
  rotation_eur    numeric,
  risk_eur        numeric,
  must_count      boolean,
  critical_reason text,
  score           numeric,
  score_value     numeric,
  score_rotation  numeric,
  score_risk      numeric,
  abc_rich        text,
  coverage_pct    numeric,
  in_scope        boolean,
  rank            integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  -- Frontera: autorizacion en el borde (idem sales_mapping_reliability / menu_item_economics).
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
  -- ROTACION: consumo entra en negativo en el ledger -> ABS(). En la ventana indicada.
  rot AS (
    SELECT m.recipe_item_id, SUM(ABS(m.qty_base)) AS rot_qty
    FROM public.stock_movement m
    WHERE m.account_id = p_account_id
      AND m.location_id = p_location_id
      AND m.movement_type = 'consumo'
      AND m.occurred_at >= now() - make_interval(days => p_window_days)
    GROUP BY m.recipe_item_id
  ),
  -- RIESGO 1: varianza historica de conteos (la linea no lleva location_id -> join al conteo).
  var_risk AS (
    SELECT icl.recipe_item_id, SUM(ABS(COALESCE(icl.variance_value, 0))) AS var_eur
    FROM public.inventory_count_line icl
    JOIN public.inventory_count ic ON ic.id = icl.inventory_count_id
    WHERE icl.account_id = p_account_id
      AND ic.location_id = p_location_id
    GROUP BY icl.recipe_item_id
  ),
  -- RIESGO 2: merma registrada (en euros).
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
      -- rotacion en EUR: qty consumida x coste actual (coalesce a coste medio del stock).
      COALESCE(r.rot_qty, 0) * COALESCE(u.computed_cost, s.avg_unit_cost, 0) AS rotation_eur,
      COALESCE(vr.var_eur, 0) + COALESCE(wr.waste_eur, 0) AS risk_eur
    FROM universe u
    LEFT JOIN stk        s  ON s.recipe_item_id  = u.id
    LEFT JOIN rot        r  ON r.recipe_item_id  = u.id
    LEFT JOIN var_risk   vr ON vr.recipe_item_id = u.id
    LEFT JOIN waste_risk wr ON wr.recipe_item_id = u.id
  ),
  -- Normalizacion por el max del local (NULLIF evita division por cero -> componente 0).
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
      ) AS must_count,
      CASE
        WHEN rs.is_operational_critical
             AND rs.operational_min_qty IS NOT NULL
             AND rs.qty_on_hand < rs.operational_min_qty THEN 'critico + bajo minimo'
        WHEN rs.is_operational_critical THEN 'critico operativo'
        WHEN rs.operational_min_qty IS NOT NULL
             AND rs.qty_on_hand < rs.operational_min_qty THEN 'bajo minimo'
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
$$;

GRANT EXECUTE ON FUNCTION
  public.autoinventory_queue(uuid, uuid, integer, numeric, numeric, numeric, numeric)
  TO authenticated;
