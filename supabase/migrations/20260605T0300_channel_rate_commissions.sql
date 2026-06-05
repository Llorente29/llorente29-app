-- 20260605T0300_channel_rate_commissions.sql
--
-- E1 — Comisiones: defecto por canal + fallback en el motor de margen.
--
-- Contexto: menu_item_economics ya resolvía la comisión por marca×canal vía
-- brand_channel_rate, SIN fallback (NULL si no había tarifa de esa marca). El
-- caso real de Llorente29 (Glovo/JustEat 15% en TODAS las marcas; Uber variable
-- por marca) exige un DEFECTO por canal que siembre todas las marcas + override
-- por marca donde difiera.
--
-- brand_channel_rate.brand_channel_id es NOT NULL, así que el defecto "sin marca"
-- NO cabe ahí. Se crea channel_rate (defecto a nivel canal). Resolución por
-- especificidad: override marca×canal (brand_channel_rate) > defecto canal
-- (channel_rate) > NULL. El defecto NO es invención: es un valor que el gestor
-- configura una vez; solo NULL si no hay ninguno.
--
-- Nota: la modificación de menu_item_economics (CREATE OR REPLACE) está al final.
-- Es SECURITY DEFINER: NO se prueba en SQL Editor (auth.uid() null dispara el
-- RAISE EXCEPTION); se verifica desde la app, con sesión.

-- ─────────────────────────────────────────────────────────────────────
-- 1) Tabla channel_rate (defecto por canal). Misma forma que brand_channel_rate
--    pero colgando de sales_channel, no de brand_channel.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.channel_rate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  sales_channel_id uuid NOT NULL REFERENCES public.sales_channel(id) ON DELETE CASCADE,
  service_type text NOT NULL CHECK (service_type = ANY (ARRAY['platform_delivery'::text, 'own_delivery'::text, 'pickup'::text])),
  commission_pct numeric,
  commission_fixed numeric,
  commission_base text NOT NULL DEFAULT 'pvp_con_iva' CHECK (commission_base = ANY (ARRAY['pvp_con_iva'::text, 'pvp_sin_iva'::text])),
  own_customer_fee numeric,
  own_courier_cost numeric,
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_by_name text
);

-- 2) Un defecto por (cuenta, canal, tipo de servicio) entre los no archivados.
CREATE UNIQUE INDEX uq_channel_rate_scope
  ON public.channel_rate (account_id, sales_channel_id, service_type)
  WHERE archived_at IS NULL;

CREATE TRIGGER trg_channel_rate_updated_at
  BEFORE UPDATE ON public.channel_rate
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3) RLS: lectura por miembros de la cuenta, escritura por admins.
ALTER TABLE public.channel_rate ENABLE ROW LEVEL SECURITY;

CREATE POLICY channel_rate_read ON public.channel_rate
  FOR SELECT USING (account_id = ANY (current_user_account_ids()));

CREATE POLICY channel_rate_write ON public.channel_rate
  FOR ALL USING (current_user_is_admin_of(account_id))
  WITH CHECK (current_user_is_admin_of(account_id));

-- 4) menu_item_economics: añade fallback a channel_rate (COALESCE override→defecto).
--    Solo cambia la resolución de comisión; el resto del cálculo es idéntico.
CREATE OR REPLACE FUNCTION public.menu_item_economics(p_brand_id uuid, p_service_type text DEFAULT 'platform_delivery'::text)
 RETURNS TABLE(menu_item_id uuid, menu_item_name text, recipe_item_id uuid, channel_id uuid, channel_name text, flow_type text, cost numeric, cost_available boolean, price numeric, vat_rate numeric, price_with_vat numeric, food_cost_pct numeric, contribution_margin numeric, commission_pct numeric, commission_amount numeric, commission_fixed numeric, delivery_fee numeric, revenue_share_pct numeric, revenue_share_amount numeric, consumption_reimb numeric, net_margin numeric, net_margin_pct numeric, target_food_cost_pct numeric, food_cost_status text)
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
    RAISE EXCEPTION 'Sin permiso para la economía de la marca %', p_brand_id;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      mi.id                AS menu_item_id,
      mi.name              AS menu_item_name,
      mi.recipe_item_id    AS recipe_item_id,
      mi.channel_id        AS channel_id,
      sc.name              AS channel_name,
      b.ownership_type     AS flow_type,
      ri.computed_cost     AS cost,
      (ri.computed_cost IS NOT NULL) AS cost_available,
      mi.price             AS price,
      mi.vat_rate          AS vat_rate,
      ROUND(mi.price * (1 + mi.vat_rate / 100), 4) AS price_with_vat,
      mi.consumption_price AS consumption_price,
      -- Comisión: resolución por especificidad. Override marca×canal
      -- (brand_channel_rate) > defecto del canal (channel_rate) > NULL (honesto).
      COALESCE(bcr.commission_pct,   cr.commission_pct)   AS commission_pct,
      COALESCE(bcr.commission_fixed, cr.commission_fixed) AS commission_fixed,
      COALESCE(bcr.commission_base,  cr.commission_base)  AS commission_base,
      COALESCE(bcr.own_courier_cost, cr.own_courier_cost) AS own_courier_cost,
      bla.revenue_share_pct      AS revenue_share_pct,
      bla.reimburses_consumption AS reimburses_consumption,
      ks.target_food_cost_pct    AS target_food_cost_pct
    FROM menu_item mi
    JOIN brand b          ON b.id = mi.brand_id
    JOIN sales_channel sc ON sc.id = mi.channel_id
    JOIN recipe_item ri   ON ri.id = mi.recipe_item_id
    LEFT JOIN brand_channel bc
           ON bc.brand_id = mi.brand_id
          AND bc.channel_id = mi.channel_id
          AND bc.is_active = true
    LEFT JOIN brand_channel_rate bcr
           ON bcr.brand_channel_id = bc.id
          AND bcr.service_type = p_service_type
          AND bcr.is_active = true
          AND bcr.archived_at IS NULL
    LEFT JOIN channel_rate cr
           ON cr.sales_channel_id = mi.channel_id
          AND cr.service_type = p_service_type
          AND cr.is_active = true
          AND cr.archived_at IS NULL
    LEFT JOIN brand_licensing_agreement bla
           ON bla.brand_id = mi.brand_id AND bla.is_active = true
    LEFT JOIN kitchen_settings ks ON ks.account_id = mi.account_id
    WHERE mi.brand_id = p_brand_id
      AND mi.archived_at IS NULL
  ),
  calc AS (
    SELECT
      base.*,
      CASE base.commission_base
        WHEN 'pvp_sin_iva' THEN base.price
        ELSE base.price_with_vat
      END AS commission_basis
    FROM base
  )
  SELECT
    calc.menu_item_id,
    calc.menu_item_name,
    calc.recipe_item_id,
    calc.channel_id,
    calc.channel_name,
    calc.flow_type,
    calc.cost,
    calc.cost_available,
    calc.price,
    calc.vat_rate,
    calc.price_with_vat,
    CASE WHEN calc.flow_type = 'own' AND calc.cost_available AND calc.price > 0
         THEN ROUND(calc.cost / calc.price * 100, 2) END AS food_cost_pct,
    CASE WHEN calc.flow_type = 'own' AND calc.cost_available
         THEN ROUND(calc.price - calc.cost, 4) END AS contribution_margin,
    CASE WHEN calc.flow_type = 'own' THEN calc.commission_pct END AS commission_pct,
    CASE WHEN calc.flow_type = 'own' AND calc.commission_pct IS NOT NULL
         THEN ROUND(calc.commission_basis * calc.commission_pct / 100, 4) END AS commission_amount,
    CASE WHEN calc.flow_type = 'own' THEN calc.commission_fixed END AS commission_fixed,
    CASE WHEN calc.flow_type = 'own' THEN calc.own_courier_cost END AS delivery_fee,
    CASE WHEN calc.flow_type = 'licensed' THEN calc.revenue_share_pct END AS revenue_share_pct,
    CASE WHEN calc.flow_type = 'licensed' AND calc.revenue_share_pct IS NOT NULL
         THEN ROUND(calc.price * calc.revenue_share_pct / 100, 4) END AS revenue_share_amount,
    CASE WHEN calc.flow_type = 'licensed' AND COALESCE(calc.reimburses_consumption, false)
         THEN calc.consumption_price END AS consumption_reimb,
    CASE
      WHEN calc.flow_type = 'own' AND calc.cost_available AND calc.commission_pct IS NOT NULL
        THEN ROUND(calc.price - calc.cost - (calc.commission_basis * calc.commission_pct / 100), 4)
      WHEN calc.flow_type = 'licensed' AND calc.cost_available AND calc.revenue_share_pct IS NOT NULL
        THEN ROUND(
               (calc.price * calc.revenue_share_pct / 100)
               + (CASE WHEN COALESCE(calc.reimburses_consumption, false)
                       THEN COALESCE(calc.consumption_price, 0) ELSE 0 END)
               - calc.cost, 4)
    END AS net_margin,
    CASE
      WHEN calc.flow_type = 'own' AND calc.cost_available AND calc.commission_pct IS NOT NULL AND calc.price > 0
        THEN ROUND((calc.price - calc.cost - (calc.commission_basis * calc.commission_pct / 100)) / calc.price * 100, 2)
    END AS net_margin_pct,
    calc.target_food_cost_pct,
    CASE
      WHEN calc.flow_type = 'licensed'       THEN 'n_a'
      WHEN NOT calc.cost_available           THEN 'no_cost'
      WHEN calc.target_food_cost_pct IS NULL THEN 'no_target'
      WHEN calc.price <= 0                   THEN 'no_cost'
      WHEN (calc.cost / calc.price * 100) <= calc.target_food_cost_pct
           THEN 'under'
      ELSE 'over'
    END AS food_cost_status
  FROM calc
  ORDER BY calc.channel_name, calc.menu_item_name;
END;
$function$;
