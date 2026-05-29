-- ════════════════════════════════════════════════════════════════════
-- 2026-05-29 — Corrección de revenue en las funciones de ventas
-- Tras el fix de sale_line: revenue = SUM(line_total), NO quantity×unit_price.
-- (unit_price ahora es unitario real; line_total es el total de la línea.)
-- ════════════════════════════════════════════════════════════════════

-- ── 1) menu_item_units_sold: revenue desde line_total ──
CREATE OR REPLACE FUNCTION public.menu_item_units_sold(
  p_brand_id uuid,
  p_from     timestamptz DEFAULT (now() - interval '90 days'),
  p_to       timestamptz DEFAULT now()
)
RETURNS TABLE(
  menu_item_id   uuid,
  units_sold     numeric,
  revenue        numeric,
  lines_count    bigint,
  first_sold_at  timestamptz,
  last_sold_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
BEGIN
  SELECT b.account_id INTO v_account_id FROM brand b WHERE b.id = p_brand_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Marca % no encontrada', p_brand_id;
  END IF;
  IF NOT (current_user_is_admin()
          OR current_user_is_admin_or_manager_of(v_account_id)) THEN
    RAISE EXCEPTION 'Sin permiso para las ventas de la marca %', p_brand_id;
  END IF;

  RETURN QUERY
  SELECT
    sl.menu_item_id                          AS menu_item_id,
    SUM(sl.quantity)                         AS units_sold,
    -- revenue = total real de las líneas (line_total), NO quantity×unit_price
    ROUND(SUM(COALESCE(sl.line_total, sl.unit_price * sl.quantity)), 2) AS revenue,
    count(*)                                 AS lines_count,
    MIN(s.sold_at)                           AS first_sold_at,
    MAX(s.sold_at)                           AS last_sold_at
  FROM sale_line sl
  JOIN sale s ON s.id = sl.sale_id
  JOIN menu_item mi ON mi.id = sl.menu_item_id
  WHERE s.account_id = v_account_id
    AND mi.brand_id  = p_brand_id
    AND mi.archived_at IS NULL
    AND sl.menu_item_id IS NOT NULL
    AND s.is_active = true
    AND s.sold_at >= p_from
    AND s.sold_at <  p_to
  GROUP BY sl.menu_item_id;
END;
$function$;


-- ── 2) location_economics: revenue desde line_total ──
-- (solo cambia el cálculo de v_revenue / v_revenue_costed; el resto igual)
CREATE OR REPLACE FUNCTION public.location_economics(
  p_location_id uuid,
  p_from        timestamptz DEFAULT (now() - interval '90 days'),
  p_to          timestamptz DEFAULT now()
)
RETURNS TABLE(
  revenue                numeric,
  food_cost              numeric,
  labor_cost             numeric,
  food_cost_pct          numeric,
  labor_cost_pct         numeric,
  prime_cost             numeric,
  prime_cost_pct         numeric,
  food_cost_coverage_pct numeric,
  employee_count         integer,
  is_estimate            boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_revenue        numeric := 0;
  v_revenue_costed numeric := 0;
  v_food_cost      numeric := 0;
  v_labor          numeric := 0;
  v_emp            integer := 0;
  v_coverage       numeric := 0;
  v_food_pct       numeric;
  v_labor_pct      numeric;
  v_prime          numeric;
  v_prime_pct      numeric;
  v_estimate       boolean;
BEGIN
  SELECT
    -- revenue = SUM(line_total); food cost = quantity × coste del plato (correcto)
    COALESCE(SUM(COALESCE(sl.line_total, sl.unit_price * sl.quantity)), 0),
    COALESCE(SUM(COALESCE(sl.line_total, sl.unit_price * sl.quantity))
             FILTER (WHERE ri_cost.dish_cost IS NOT NULL), 0),
    COALESCE(SUM(sl.quantity * ri_cost.dish_cost)
             FILTER (WHERE ri_cost.dish_cost IS NOT NULL), 0)
  INTO v_revenue, v_revenue_costed, v_food_cost
  FROM sale_line sl
  JOIN sale s       ON s.id = sl.sale_id
  JOIN menu_item mi ON mi.id = sl.menu_item_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(ri.computed_cost, ri.fixed_cost) AS dish_cost
    FROM recipe_item ri WHERE ri.id = mi.recipe_item_id
  ) ri_cost ON true
  WHERE s.location_id = p_location_id
    AND s.is_active = true
    AND sl.menu_item_id IS NOT NULL
    AND s.sold_at >= p_from
    AND s.sold_at <  p_to;

  SELECT lc.labor_cost, lc.employee_count
  INTO v_labor, v_emp
  FROM location_labor_cost(p_location_id, p_from, p_to) lc;

  v_labor := COALESCE(v_labor, 0);
  v_emp   := COALESCE(v_emp, 0);

  v_coverage := CASE WHEN v_revenue > 0
                     THEN ROUND(v_revenue_costed / v_revenue * 100, 1)
                     ELSE 0 END;

  v_food_pct  := CASE WHEN v_revenue > 0 THEN ROUND(v_food_cost / v_revenue * 100, 2) END;
  v_labor_pct := CASE WHEN v_revenue > 0 THEN ROUND(v_labor / v_revenue * 100, 2) END;
  v_prime     := ROUND(v_food_cost + v_labor, 2);
  v_prime_pct := CASE WHEN v_revenue > 0 THEN ROUND((v_food_cost + v_labor) / v_revenue * 100, 2) END;
  v_estimate  := (v_coverage < 90);

  RETURN QUERY SELECT
    ROUND(v_revenue, 2), ROUND(v_food_cost, 2), ROUND(v_labor, 2),
    v_food_pct, v_labor_pct, v_prime, v_prime_pct,
    v_coverage, v_emp, v_estimate;
END;
$function$;
