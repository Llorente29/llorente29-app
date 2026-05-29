-- ════════════════════════════════════════════════════════════════════
-- 2026-05-29 — location_economics
-- PRIME COST por local y periodo: food cost + labor, sobre ventas.
-- La cifra que de verdad manda (objetivo industria: 55-65%).
--
-- food cost = Σ (unidades vendidas × coste del plato) sobre las ventas del
--   local que TIENEN plato costeado. Usa el coste agregado del recipe_item
--   (computed_cost → fixed_cost), coherente con la pantalla Rentabilidad.
--   [Cuando entren compras, el coste por local divergirá entre locales;
--    de momento el coste del plato es el mismo en los 3, varía solo el mix.]
--
-- labor = location_labor_cost (teórico desde contrato, mientras no haya fichajes).
--
-- COBERTURA (dato PERMANENTE de fiabilidad, no temporal):
--   food_cost_coverage_pct = % de las ventas del periodo cuyo plato tiene
--   coste disponible. Hoy es baja (~pocos escandallos costeados) → el prime
--   cost es parcial. Según se costee la carta, sube y el número se vuelve
--   fiable. Si entra un plato nuevo sin costear, baja y avisa. Es el radar
--   permanente de "¿de cuántas de mis ventas tengo coste real?".
--
-- is_estimate = true si labor es teórico O la cobertura de food no es alta.
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.location_economics(
  p_location_id uuid,
  p_from        timestamptz DEFAULT (now() - interval '90 days'),
  p_to          timestamptz DEFAULT now()
)
RETURNS TABLE(
  revenue                numeric,   -- ventas del periodo (€)
  food_cost              numeric,   -- coste de comida de las ventas costeadas (€)
  labor_cost             numeric,   -- coste de personal teórico (€)
  food_cost_pct          numeric,   -- food cost sobre ventas (%)
  labor_cost_pct         numeric,   -- labor sobre ventas (%)
  prime_cost             numeric,   -- food + labor (€)
  prime_cost_pct         numeric,   -- prime cost sobre ventas (%)
  food_cost_coverage_pct numeric,   -- % de ventas con plato costeado (fiabilidad)
  employee_count         integer,   -- empleados registrados en el local (cobertura labor)
  is_estimate            boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_revenue        numeric := 0;   -- ventas totales del local
  v_revenue_costed numeric := 0;   -- ventas cuyas líneas tienen plato costeado
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
  -- ── Ventas y food cost del local en el periodo ──
  -- Recorremos las líneas de venta del local; para cada línea, el coste del
  -- plato sale del recipe_item (computed_cost → fixed_cost). Las líneas sin
  -- coste suman a revenue pero NO a revenue_costed ni a food_cost.
  SELECT
    COALESCE(SUM(sl.quantity * sl.unit_price), 0),
    COALESCE(SUM(sl.quantity * sl.unit_price)
             FILTER (WHERE ri_cost.dish_cost IS NOT NULL), 0),
    COALESCE(SUM(sl.quantity * ri_cost.dish_cost)
             FILTER (WHERE ri_cost.dish_cost IS NOT NULL), 0)
  INTO v_revenue, v_revenue_costed, v_food_cost
  FROM sale_line sl
  JOIN sale s     ON s.id = sl.sale_id
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

  -- ── Labor teórico del local ──
  SELECT lc.labor_cost, lc.employee_count
  INTO v_labor, v_emp
  FROM location_labor_cost(p_location_id, p_from, p_to) lc;

  v_labor := COALESCE(v_labor, 0);
  v_emp   := COALESCE(v_emp, 0);

  -- ── Cobertura del food cost (% de ventas con plato costeado) ──
  v_coverage := CASE WHEN v_revenue > 0
                     THEN ROUND(v_revenue_costed / v_revenue * 100, 1)
                     ELSE 0 END;

  -- ── Porcentajes sobre ventas ──
  v_food_pct  := CASE WHEN v_revenue > 0 THEN ROUND(v_food_cost / v_revenue * 100, 2) END;
  v_labor_pct := CASE WHEN v_revenue > 0 THEN ROUND(v_labor / v_revenue * 100, 2) END;
  v_prime     := ROUND(v_food_cost + v_labor, 2);
  v_prime_pct := CASE WHEN v_revenue > 0 THEN ROUND((v_food_cost + v_labor) / v_revenue * 100, 2) END;

  -- Estimación si el labor es teórico (siempre hoy) o la cobertura no es alta (<90%)
  v_estimate := (v_coverage < 90);

  RETURN QUERY SELECT
    ROUND(v_revenue, 2),
    ROUND(v_food_cost, 2),
    ROUND(v_labor, 2),
    v_food_pct,
    v_labor_pct,
    v_prime,
    v_prime_pct,
    v_coverage,
    v_emp,
    v_estimate;
END;
$function$;
