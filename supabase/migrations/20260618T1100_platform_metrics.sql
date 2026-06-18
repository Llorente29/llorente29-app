-- ============================================================================
-- 20260618T1100_platform_metrics.sql
-- MÉTRICAS · panel de control de la plataforma (Portal de staff → Métricas).
--
-- platform_metrics() -> jsonb con TODO lo medible de la BBDD en una llamada.
-- Solo platform admins (gate current_user_is_admin). STABLE SECURITY DEFINER.
--
-- HONESTIDAD (norma deuda 0): solo se calcula lo que la BBDD puede dar de verdad.
--   · MRR/ARR = ESTIMADO calculado (modelo B: base del plan + per_location_price
--     SOLO por locales por encima de max_locations; Enterprise sin límite = 0
--     exceso). Cuando la facturación pase por Stripe (stripe_price_id), el MRR
--     vendrá de Stripe (caja real), no de aquí.
--   · Clientes y uso EXCLUYEN cuentas is_internal (Folvy Interno = sandbox).
--   · Churn, CAC, LTV, NRR NO se calculan aquí: no hay datos históricos/marketing.
--     El front los muestra como "se mide desde ahora" / "cuando haya datos",
--     nunca como un 0 falso.
--
-- auth.uid() null en SQL Editor -> el gate da "acceso denegado"; verificar desde
-- la app. DDL puro al crearse -> seguro en SQL Editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.platform_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mrr    numeric := 0;
  v_result jsonb;
BEGIN
  IF NOT current_user_is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado: solo platform admins pueden ver las métricas.';
  END IF;

  -- MRR estimado (modelo B). Solo suscripciones ACTIVAS con plan, de clientes
  -- (no internas). Trials = 0 € (no entran). Exceso de locales = locales activos
  -- por encima de max_locations (NULL = ilimitado -> 0 exceso).
  SELECT COALESCE(SUM(
           COALESCE(bp.base_price_eur, 0)
           + COALESCE(bp.per_location_price, 0) * GREATEST(0,
               (SELECT count(*) FROM locations l WHERE l.account_id = s.account_id AND l.active)
               - COALESCE(bp.max_locations, 2147483647))
         ), 0)
  INTO v_mrr
  FROM subscriptions s
  JOIN billing_plans bp ON bp.id = s.plan_id
  JOIN accounts a       ON a.id = s.account_id
  WHERE s.status = 'active' AND NOT COALESCE(a.is_internal, false);

  v_result := jsonb_build_object(
    -- Clientes (logos), excluyendo internas.
    'clients_active', (SELECT count(*) FROM accounts WHERE status='active' AND NOT COALESCE(is_internal,false)),
    'clients_total',  (SELECT count(*) FROM accounts WHERE NOT COALESCE(is_internal,false)),
    'accounts_by_status', (
      SELECT COALESCE(jsonb_object_agg(status, c), '{}'::jsonb)
      FROM (SELECT status, count(*) c FROM accounts WHERE NOT COALESCE(is_internal,false) GROUP BY status) t),

    -- Ingresos recurrentes (ESTIMADO).
    'mrr_eur', round(v_mrr, 2),
    'arr_eur', round(v_mrr * 12, 2),

    -- Suscripciones.
    'subs_active',       (SELECT count(*) FROM subscriptions s JOIN accounts a ON a.id=s.account_id WHERE s.status='active' AND NOT COALESCE(a.is_internal,false)),
    'subs_trial',        (SELECT count(*) FROM subscriptions s JOIN accounts a ON a.id=s.account_id WHERE s.status='trial'  AND NOT COALESCE(a.is_internal,false)),
    'subs_without_plan', (SELECT count(*) FROM subscriptions s JOIN accounts a ON a.id=s.account_id WHERE s.plan_id IS NULL AND NOT COALESCE(a.is_internal,false)),
    'subs_by_plan', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('plan', plan, 'status', st, 'count', c) ORDER BY plan, st), '[]'::jsonb)
      FROM (
        SELECT COALESCE(bp.code, '(sin plan)') plan, s.status st, count(*) c
        FROM subscriptions s
        LEFT JOIN billing_plans bp ON bp.id = s.plan_id
        JOIN accounts a ON a.id = s.account_id
        WHERE NOT COALESCE(a.is_internal, false)
        GROUP BY bp.code, s.status) t),

    -- Crecimiento: altas de clientes por mes (últimos 12).
    'signups_by_month', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('month', m, 'count', c) ORDER BY m), '[]'::jsonb)
      FROM (
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') m, count(*) c
        FROM accounts
        WHERE NOT COALESCE(is_internal, false)
          AND created_at >= date_trunc('month', now()) - interval '11 months'
        GROUP BY date_trunc('month', created_at)) t),

    -- USO REAL del producto (el diferenciador): clientes que ingieren ventas.
    'usage_active_30d', (SELECT count(DISTINCT s.account_id) FROM sale s JOIN accounts a ON a.id=s.account_id WHERE NOT COALESCE(a.is_internal,false) AND s.created_at >= now()-interval '30 days'),
    'usage_active_7d',  (SELECT count(DISTINCT s.account_id) FROM sale s JOIN accounts a ON a.id=s.account_id WHERE NOT COALESCE(a.is_internal,false) AND s.created_at >= now()-interval '7 days'),
    'client_sales_total', (SELECT count(*) FROM sale s JOIN accounts a ON a.id=s.account_id WHERE NOT COALESCE(a.is_internal,false)),
    'client_sales_30d',   (SELECT count(*) FROM sale s JOIN accounts a ON a.id=s.account_id WHERE NOT COALESCE(a.is_internal,false) AND s.created_at >= now()-interval '30 days'),

    -- Plataforma.
    'platform_admins_active', (SELECT count(*) FROM platform_admins WHERE active),

    'generated_at', now()
  );

  RETURN v_result;
END;
$function$;
