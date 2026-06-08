-- 20260608T1300_fix_location_economics_coverage.sql
-- Aplicada: 2026-06-08
--
-- DEUDA DECLARADA, ahora pagada. location_economics.food_cost_coverage_pct medía la
-- cobertura sobre base CASADO-ONLY: su SELECT hace JOIN menu_item + filtra
-- sl.menu_item_id IS NOT NULL, así que el revenue de las líneas SIN CASAR no entraba
-- ni en numerador ni en denominador → sobreestimaba (no se enteraba de lo ciego).
--
-- Fix: el revenue TOTAL (v_revenue) pasa a contar TODAS las líneas de producto
-- (casadas o no), por LEFT JOIN a menu_item. El food cost y el revenue_costed siguen
-- contando solo lo casado (no se inventa coste de lo que no casa). Resultado:
--   - coverage = revenue_costed / revenue_TOTAL  → honesto, baja si hay ventas ciegas.
--   - food_cost_pct = food_cost / revenue_TOTAL  → idem, deja de inflarse.
-- El resto de la función es IDÉNTICO (labor, prime, estimate, firma de retorno).
--
-- DDL puro, sin test dentro (SECURITY DEFINER). Verificar aparte desde la app.

BEGIN;

CREATE OR REPLACE FUNCTION public.location_economics(
  p_location_id uuid,
  p_from timestamp with time zone DEFAULT (now() - '90 days'::interval),
  p_to   timestamp with time zone DEFAULT now()
)
RETURNS TABLE(revenue numeric, food_cost numeric, labor_cost numeric, food_cost_pct numeric, labor_cost_pct numeric, prime_cost numeric, prime_cost_pct numeric, food_cost_coverage_pct numeric, employee_count integer, is_estimate boolean)
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
    -- revenue TOTAL = SUM(line_total) de TODAS las líneas de producto (casadas o no).
    -- (Antes: solo casadas → base falsa.)
    COALESCE(SUM(COALESCE(sl.line_total, sl.unit_price * sl.quantity)), 0),
    -- revenue CON COSTE = solo líneas casadas cuyo plato tiene coste.
    COALESCE(SUM(COALESCE(sl.line_total, sl.unit_price * sl.quantity))
             FILTER (WHERE sl.menu_item_id IS NOT NULL AND ri_cost.dish_cost IS NOT NULL), 0),
    -- food cost = quantity × coste del plato, solo donde hay coste.
    COALESCE(SUM(sl.quantity * ri_cost.dish_cost)
             FILTER (WHERE sl.menu_item_id IS NOT NULL AND ri_cost.dish_cost IS NOT NULL), 0)
  INTO v_revenue, v_revenue_costed, v_food_cost
  FROM sale_line sl
  JOIN sale s ON s.id = sl.sale_id
  -- LEFT JOIN: las líneas sin casar (menu_item_id null) SÍ cuentan al revenue total.
  LEFT JOIN menu_item mi ON mi.id = sl.menu_item_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(ri.computed_cost, ri.fixed_cost) AS dish_cost
    FROM recipe_item ri WHERE ri.id = mi.recipe_item_id
  ) ri_cost ON true
  WHERE s.location_id = p_location_id
    AND s.is_active = true
    AND COALESCE(sl.line_type, 'product') = 'product'
    AND s.sold_at >= p_from
    AND s.sold_at <  p_to;

  SELECT lc.labor_cost, lc.employee_count
  INTO v_labor, v_emp
  FROM location_labor_cost(p_location_id, p_from, p_to) lc;

  v_labor := COALESCE(v_labor, 0);
  v_emp   := COALESCE(v_emp, 0);

  -- cobertura = lo costeado sobre el revenue TOTAL (honesto: baja si hay ventas ciegas).
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

COMMIT;
