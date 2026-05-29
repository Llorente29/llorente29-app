-- ════════════════════════════════════════════════════════════════════
-- 2026-05-29 — location_labor_cost
-- Coste de personal TEÓRICO (según contrato) de un local en un periodo.
--
-- ⚠️  ESTIMACIÓN, no coste real: se basa en employees.salary (coste total
--     anual, ya incluye SS empresa) prorrateado por días del periodo.
--     NO usa horas fichadas (clock_entries está vacía). Cuando Llorente29
--     empiece a fichar, esta función evolucionará a horas reales sin cambiar
--     su interfaz.
--
-- Devuelve también employee_count como SEÑAL DE COBERTURA: un local con
-- 0 empleados registrados NO es "labor 0€", es "sin datos de personal".
-- La capa de arriba debe distinguir ambos casos (no enseñar prime cost
-- falsamente bueno en locales sin alta — hoy solo Alcalá tiene empleados).
--
-- Nivel LOCAL, nunca por plato (estándar de industria: Crunchtime/R365).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.location_labor_cost(
  p_location_id uuid,
  p_from        timestamptz DEFAULT (now() - interval '90 days'),
  p_to          timestamptz DEFAULT now()
)
RETURNS TABLE(
  labor_cost     numeric,   -- € coste de personal teórico del periodo
  employee_count integer,   -- empleados activos registrados en el local (cobertura)
  days_in_period integer,   -- días del rango (prorrateo)
  is_estimate    boolean    -- siempre true mientras no haya fichajes
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_days integer;
BEGIN
  -- Días del periodo (mínimo 1 para no dividir por cero)
  v_days := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (p_to - p_from)) / 86400.0)::integer);

  RETURN QUERY
  SELECT
    -- salary = coste total anual; prorrateo lineal por días del periodo
    COALESCE(ROUND(SUM(e.salary / 365.0 * v_days), 2), 0)::numeric AS labor_cost,
    COUNT(e.id)::integer                                           AS employee_count,
    v_days                                                         AS days_in_period,
    true                                                           AS is_estimate
  FROM employees e
  WHERE e.active = true
    AND e.location_id = p_location_id
    AND e.salary IS NOT NULL;
END;
$function$;
