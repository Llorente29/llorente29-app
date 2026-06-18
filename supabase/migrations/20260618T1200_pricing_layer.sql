-- ============================================================================
-- 20260618T1200_pricing_layer.sql
-- CAPA DE PRECIOS · P-A: datos + recálculo del MRR.
--
-- Con forma de Stripe (catálogo de precios + cupones), operable HOY sin Stripe
-- (Folvy es la fuente de verdad estimada hasta conectar stripe_price_id).
--
-- 1) submodules.price_eur — precio de catálogo de los add-ons (type='addon').
--    Los 'tier' (parte del plan) quedan a 0. Al activar un add-on a un cliente,
--    este precio sembrará subscription_items.unit_price_eur (P-C), editable por
--    cliente.
-- 2) account_discount — descuento por cliente, forma de cupón: 'percent' (0-100)
--    o 'fixed' (€). Caducidad opcional. MODELO A: un único descuento ACTIVO por
--    cuenta, impuesto por índice único PARCIAL. Para pasar a B (apilables) en el
--    futuro: basta con DROP de ese índice — la tabla ya soporta varios.
-- 3) platform_metrics — MRR recalculado: plan (base + por-local SOLO sobre el
--    exceso de max_locations; 0 = ILIMITADO, arregla el 169→149 del Enterprise)
--    + add-ons activos − descuento activo del cliente. Sigue "estimado".
--
-- DDL puro + CREATE OR REPLACE de función -> seguro en SQL Editor. El RPC
-- platform_metrics no se prueba aquí (gate de admin); se ve desde la app.
-- ============================================================================

-- ── 1) Precio de catálogo de add-ons ─────────────────────────────────────────
ALTER TABLE public.submodules
  ADD COLUMN IF NOT EXISTS price_eur numeric NOT NULL DEFAULT 0;

-- ── 2) Descuentos por cliente (forma de cupón Stripe) ────────────────────────
CREATE TABLE IF NOT EXISTS public.account_discount (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  discount_type text NOT NULL CHECK (discount_type IN ('percent','fixed')),
  value         numeric NOT NULL CHECK (value > 0),
  note          text,
  valid_until   timestamptz,
  active        boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- un porcentaje no puede pasar de 100
  CONSTRAINT account_discount_percent_max CHECK (discount_type <> 'percent' OR value <= 100)
);

-- MODELO A: un único descuento ACTIVO por cuenta (para B: DROP este índice).
CREATE UNIQUE INDEX IF NOT EXISTS account_discount_one_active
  ON public.account_discount(account_id) WHERE active;

-- RLS: solo platform admins. La lectura del MRR va por SECURITY DEFINER (bypass);
-- esta policy cubre el acceso directo desde la app de admin.
ALTER TABLE public.account_discount ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_discount_admin_all ON public.account_discount;
CREATE POLICY account_discount_admin_all ON public.account_discount
  FOR ALL USING (current_user_is_admin()) WITH CHECK (current_user_is_admin());

-- ── 3) platform_metrics con el MRR recalculado ──────────────────────────────
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

  -- MRR estimado: por suscripción activa de cliente (no interna):
  --   plan base + per_location × exceso(locales, max_locations; 0=ilimitado)
  --   + add-ons activos (unit_price × cantidad)
  --   − descuento activo del cliente (percent o fixed), con suelo en 0.
  SELECT COALESCE(SUM(net), 0) INTO v_mrr
  FROM (
    SELECT GREATEST(0,
      (
        bp.base_price_eur
        + bp.per_location_price * (CASE
            WHEN COALESCE(bp.max_locations, 0) = 0 THEN 0   -- 0 = ilimitado
            ELSE GREATEST(0,
              (SELECT count(*) FROM locations l WHERE l.account_id = s.account_id AND l.active)
              - bp.max_locations)
          END)
        + COALESCE((
            SELECT SUM(si.unit_price_eur * si.quantity)
            FROM subscription_items si
            JOIN submodules sm ON sm.id = si.submodule_id
            WHERE si.subscription_id = s.id AND si.status = 'active' AND sm.type = 'addon'
          ), 0)
      ) * (CASE WHEN d.discount_type = 'percent' THEN (1 - d.value / 100.0) ELSE 1 END)
        - (CASE WHEN d.discount_type = 'fixed' THEN d.value ELSE 0 END)
    ) AS net
    FROM subscriptions s
    JOIN billing_plans bp ON bp.id = s.plan_id
    JOIN accounts a       ON a.id = s.account_id
    LEFT JOIN LATERAL (
      SELECT discount_type, value
      FROM account_discount ad
      WHERE ad.account_id = s.account_id AND ad.active
        AND (ad.valid_until IS NULL OR ad.valid_until > now())
      ORDER BY ad.created_at DESC
      LIMIT 1
    ) d ON true
    WHERE s.status = 'active' AND NOT COALESCE(a.is_internal, false)
  ) t;

  v_result := jsonb_build_object(
    'clients_active', (SELECT count(*) FROM accounts WHERE status='active' AND NOT COALESCE(is_internal,false)),
    'clients_total',  (SELECT count(*) FROM accounts WHERE NOT COALESCE(is_internal,false)),
    'accounts_by_status', (
      SELECT COALESCE(jsonb_object_agg(status, c), '{}'::jsonb)
      FROM (SELECT status, count(*) c FROM accounts WHERE NOT COALESCE(is_internal,false) GROUP BY status) t),
    'mrr_eur', round(v_mrr, 2),
    'arr_eur', round(v_mrr * 12, 2),
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
    'signups_by_month', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('month', m, 'count', c) ORDER BY m), '[]'::jsonb)
      FROM (
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') m, count(*) c
        FROM accounts
        WHERE NOT COALESCE(is_internal, false)
          AND created_at >= date_trunc('month', now()) - interval '11 months'
        GROUP BY date_trunc('month', created_at)) t),
    'usage_active_30d', (SELECT count(DISTINCT s.account_id) FROM sale s JOIN accounts a ON a.id=s.account_id WHERE NOT COALESCE(a.is_internal,false) AND s.created_at >= now()-interval '30 days'),
    'usage_active_7d',  (SELECT count(DISTINCT s.account_id) FROM sale s JOIN accounts a ON a.id=s.account_id WHERE NOT COALESCE(a.is_internal,false) AND s.created_at >= now()-interval '7 days'),
    'client_sales_total', (SELECT count(*) FROM sale s JOIN accounts a ON a.id=s.account_id WHERE NOT COALESCE(a.is_internal,false)),
    'client_sales_30d',   (SELECT count(*) FROM sale s JOIN accounts a ON a.id=s.account_id WHERE NOT COALESCE(a.is_internal,false) AND s.created_at >= now()-interval '30 days'),
    'platform_admins_active', (SELECT count(*) FROM platform_admins WHERE active),
    'generated_at', now()
  );

  RETURN v_result;
END;
$function$;
