-- ============================================================================
-- 20260527_folvy_kitchen_capa2_economics.sql
-- Folvy Kitchen — Capa 2: economía de carta por marca × canal (menu_item_economics)
-- Ramifica por brand.ownership_type:
--   'own'      → margen = price - coste - comisión% (comisión de brand_channel
--                con fallback a sales_channel; commission_fixed informativa,
--                NO se resta al margen por plato: es coste por pedido)
--   'licensed' → margen = revenue_share + reembolso_consumos - coste
-- Fuente única de verdad. Solo lectura. delivery_fee = raíl 0.
-- NOTA: requiere DROP previo si ya existe (el RETURNS cambió al añadir commission_fixed).
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.menu_item_economics(uuid);

CREATE OR REPLACE FUNCTION public.menu_item_economics(p_brand_id uuid)
RETURNS TABLE (
  menu_item_id         uuid,
  menu_item_name       text,
  recipe_item_id       uuid,
  channel_id           uuid,
  channel_name         text,
  flow_type            text,
  cost                 numeric,
  cost_available       boolean,
  price                numeric,
  vat_rate             numeric,
  price_with_vat       numeric,
  food_cost_pct        numeric,
  contribution_margin  numeric,
  commission_pct       numeric,
  commission_amount    numeric,
  commission_fixed     numeric,
  delivery_fee         numeric,
  revenue_share_pct    numeric,
  revenue_share_amount numeric,
  consumption_reimb    numeric,
  net_margin           numeric,
  net_margin_pct       numeric,
  target_food_cost_pct numeric,
  food_cost_status     text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      mi.consumption_price AS consumption_price,
      COALESCE(bc.commission_pct, sc.default_commission_pct, 0) AS commission_pct,
      COALESCE(bc.commission_fixed, 0) AS commission_fixed,
      bla.revenue_share_pct      AS revenue_share_pct,
      bla.reimburses_consumption AS reimburses_consumption,
      ks.target_food_cost_pct    AS target_food_cost_pct
    FROM menu_item mi
    JOIN brand b          ON b.id = mi.brand_id
    JOIN sales_channel sc ON sc.id = mi.channel_id
    JOIN recipe_item ri   ON ri.id = mi.recipe_item_id
    LEFT JOIN brand_channel bc
           ON bc.brand_id = mi.brand_id AND bc.channel_id = mi.channel_id AND bc.is_active = true
    LEFT JOIN brand_licensing_agreement bla
           ON bla.brand_id = mi.brand_id AND bla.is_active = true
    LEFT JOIN kitchen_settings ks ON ks.account_id = mi.account_id
    WHERE mi.brand_id = p_brand_id
      AND mi.archived_at IS NULL
  )
  SELECT
    base.menu_item_id,
    base.menu_item_name,
    base.recipe_item_id,
    base.channel_id,
    base.channel_name,
    base.flow_type,
    base.cost,
    base.cost_available,
    base.price,
    base.vat_rate,
    ROUND(base.price * (1 + base.vat_rate / 100), 4) AS price_with_vat,
    CASE WHEN base.flow_type = 'own' AND base.cost_available AND base.price > 0
         THEN ROUND(base.cost / base.price * 100, 2) END AS food_cost_pct,
    CASE WHEN base.flow_type = 'own' AND base.cost_available
         THEN ROUND(base.price - base.cost, 4) END AS contribution_margin,
    CASE WHEN base.flow_type = 'own' THEN base.commission_pct END AS commission_pct,
    CASE WHEN base.flow_type = 'own'
         THEN ROUND(base.price * base.commission_pct / 100, 4) END AS commission_amount,
    CASE WHEN base.flow_type = 'own' THEN base.commission_fixed END AS commission_fixed,
    CASE WHEN base.flow_type = 'own' THEN 0::numeric END AS delivery_fee,
    CASE WHEN base.flow_type = 'licensed' THEN base.revenue_share_pct END AS revenue_share_pct,
    CASE WHEN base.flow_type = 'licensed' AND base.revenue_share_pct IS NOT NULL
         THEN ROUND(base.price * base.revenue_share_pct / 100, 4) END AS revenue_share_amount,
    CASE WHEN base.flow_type = 'licensed' AND COALESCE(base.reimburses_consumption, false)
         THEN base.consumption_price END AS consumption_reimb,
    CASE
      WHEN base.flow_type = 'own' AND base.cost_available
        THEN ROUND(base.price - base.cost - (base.price * base.commission_pct / 100), 4)
      WHEN base.flow_type = 'licensed' AND base.cost_available AND base.revenue_share_pct IS NOT NULL
        THEN ROUND(
               (base.price * base.revenue_share_pct / 100)
               + (CASE WHEN COALESCE(base.reimburses_consumption, false)
                       THEN COALESCE(base.consumption_price, 0) ELSE 0 END)
               - base.cost, 4)
    END AS net_margin,
    CASE
      WHEN base.flow_type = 'own' AND base.cost_available AND base.price > 0
        THEN ROUND((base.price - base.cost - (base.price * base.commission_pct / 100)) / base.price * 100, 2)
    END AS net_margin_pct,
    base.target_food_cost_pct,
    CASE
      WHEN base.flow_type = 'licensed'       THEN 'n_a'
      WHEN NOT base.cost_available           THEN 'no_cost'
      WHEN base.target_food_cost_pct IS NULL THEN 'no_target'
      WHEN base.price <= 0                   THEN 'no_cost'
      WHEN (base.cost / base.price * 100) <= base.target_food_cost_pct
           THEN 'under'
      ELSE 'over'
    END AS food_cost_status
  FROM base
  ORDER BY base.channel_name, base.menu_item_name;
END;
$$;

COMMIT;
