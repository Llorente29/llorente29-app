-- IVA 2/3 — menu_item_economics. Ver repo:
-- supabase/migrations/20260817T2355_iva_2_menu_item_economics.sql
--
-- Misma correccion que la 1/3: price_with_vat = price; ingreso_neto =
-- price/(1+iva); comision sobre BRUTO; margenes y % de coste contra el neto.
--
-- FLUJO DE CEDIDAS (licensed) INTACTO a proposito: no tiene comision sino
-- revenue_share, que es INGRESO, y si va sobre bruto o neto es clausula de
-- contrato. Verificado que hoy no afecta: 18 marcas cedidas, revenue_share_pct
-- NULL en todas. DISPARADOR: el primer acuerdo de cesion.
--
-- NOTA de alcance (17/08): esta RPC hace INNER JOIN sales_channel por
-- mi.channel_id, y HOY ningun producto tiene channel_id (0 de 520 en Foodint,
-- 0 de 582 en Folvy Interno) -> devuelve cero filas. La correccion es para
-- cuando vuelva a alimentarse; no cambia nada observable hoy.

CREATE OR REPLACE FUNCTION public.menu_item_economics(
  p_brand_id uuid,
  p_service_type text DEFAULT 'platform_delivery'::text
)
 RETURNS TABLE(menu_item_id uuid, menu_item_name text, recipe_item_id uuid, channel_id uuid, channel_name text, flow_type text, cost numeric, packaging_cost numeric, food_cost numeric, cost_available boolean, price numeric, vat_rate numeric, price_with_vat numeric, food_cost_pct numeric, contribution_margin numeric, commission_pct numeric, commission_amount numeric, commission_fixed numeric, delivery_fee numeric, revenue_share_pct numeric, revenue_share_amount numeric, consumption_reimb numeric, net_margin numeric, net_margin_pct numeric, target_food_cost_pct numeric, food_cost_status text, plate_cost_pct numeric, target_plate_cost_pct numeric, plate_cost_status text)
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
      COALESCE(ri.packaging_cost, 0)          AS packaging_cost,
      (ri.computed_cost IS NOT NULL) AS cost_available,
      mi.price             AS price,
      mi.vat_rate          AS vat_rate,
      -- ANTES: ROUND(mi.price * (1 + mi.vat_rate / 100), 4)
      mi.price                                AS price_with_vat,
      mi.consumption_price AS consumption_price,
      COALESCE(bcr.commission_pct,   cr.commission_pct)   AS commission_pct,
      COALESCE(bcr.commission_fixed, cr.commission_fixed) AS commission_fixed,
      COALESCE(bcr.commission_base,  cr.commission_base)  AS commission_base,
      COALESCE(bcr.own_courier_cost, cr.own_courier_cost) AS own_courier_cost,
      bla.revenue_share_pct      AS revenue_share_pct,
      bla.reimburses_consumption AS reimburses_consumption,
      ks.target_food_cost_pct    AS target_food_cost_pct,
      ks.target_plate_cost_pct   AS target_plate_cost_pct
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
      (base.cost - COALESCE(base.packaging_cost, 0)) AS food_cost,
      base.price / (1 + COALESCE(base.vat_rate, 0)/100.0) AS ingreso_neto,
      CASE base.commission_base
        WHEN 'pvp_sin_iva' THEN base.price / (1 + COALESCE(base.vat_rate, 0)/100.0)
        ELSE base.price
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
    calc.packaging_cost,
    calc.food_cost,
    calc.cost_available,
    calc.price,
    calc.vat_rate,
    calc.price_with_vat,
    CASE WHEN calc.flow_type = 'own' AND calc.cost_available AND calc.ingreso_neto > 0
         THEN ROUND(calc.food_cost / calc.ingreso_neto * 100, 2) END AS food_cost_pct,
    CASE WHEN calc.flow_type = 'own' AND calc.cost_available
         THEN ROUND(calc.ingreso_neto - calc.cost, 4) END AS contribution_margin,
    CASE WHEN calc.flow_type = 'own' THEN calc.commission_pct END AS commission_pct,
    CASE WHEN calc.flow_type = 'own' AND calc.commission_pct IS NOT NULL
         THEN ROUND(calc.commission_basis * calc.commission_pct / 100, 4) END AS commission_amount,
    CASE WHEN calc.flow_type = 'own' THEN calc.commission_fixed END AS commission_fixed,
    CASE WHEN calc.flow_type = 'own' THEN calc.own_courier_cost END AS delivery_fee,
    CASE WHEN calc.flow_type = 'licensed' THEN calc.revenue_share_pct END AS revenue_share_pct,
    -- CEDIDAS: intacto, sobre calc.price. Ver cabecera.
    CASE WHEN calc.flow_type = 'licensed' AND calc.revenue_share_pct IS NOT NULL
         THEN ROUND(calc.price * calc.revenue_share_pct / 100, 4) END AS revenue_share_amount,
    CASE WHEN calc.flow_type = 'licensed' AND COALESCE(calc.reimburses_consumption, false)
         THEN calc.consumption_price END AS consumption_reimb,
    CASE
      WHEN calc.flow_type = 'own' AND calc.cost_available AND calc.commission_pct IS NOT NULL
        THEN ROUND(calc.ingreso_neto - calc.cost - (calc.commission_basis * calc.commission_pct / 100), 4)
      WHEN calc.flow_type = 'licensed' AND calc.cost_available AND calc.revenue_share_pct IS NOT NULL
        THEN ROUND(
               (calc.price * calc.revenue_share_pct / 100)
               + (CASE WHEN COALESCE(calc.reimburses_consumption, false)
                       THEN COALESCE(calc.consumption_price, 0) ELSE 0 END)
               - calc.cost, 4)
    END AS net_margin,
    CASE
      WHEN calc.flow_type = 'own' AND calc.cost_available AND calc.commission_pct IS NOT NULL AND calc.ingreso_neto > 0
        THEN ROUND((calc.ingreso_neto - calc.cost - (calc.commission_basis * calc.commission_pct / 100)) / calc.ingreso_neto * 100, 2)
    END AS net_margin_pct,
    calc.target_food_cost_pct,
    CASE
      WHEN calc.flow_type = 'licensed'       THEN 'n_a'
      WHEN NOT calc.cost_available           THEN 'no_cost'
      WHEN calc.target_food_cost_pct IS NULL THEN 'no_target'
      WHEN calc.ingreso_neto <= 0            THEN 'no_cost'
      WHEN (calc.food_cost / calc.ingreso_neto * 100) <= calc.target_food_cost_pct
           THEN 'under'
      ELSE 'over'
    END AS food_cost_status,
    CASE WHEN calc.flow_type = 'own' AND calc.cost_available AND calc.ingreso_neto > 0
         THEN ROUND(calc.cost / calc.ingreso_neto * 100, 2) END AS plate_cost_pct,
    calc.target_plate_cost_pct,
    CASE
      WHEN calc.flow_type = 'licensed'        THEN 'n_a'
      WHEN NOT calc.cost_available            THEN 'no_cost'
      WHEN calc.target_plate_cost_pct IS NULL THEN 'no_target'
      WHEN calc.ingreso_neto <= 0             THEN 'no_cost'
      WHEN (calc.cost / calc.ingreso_neto * 100) <= calc.target_plate_cost_pct
           THEN 'under'
      ELSE 'over'
    END AS plate_cost_status
  FROM calc
  ORDER BY calc.channel_name, calc.menu_item_name;
END;
$function$;

COMMENT ON FUNCTION public.menu_item_economics(uuid, text) IS
'Economia por producto de una marca (rejilla de Cartas + T7). menu_item.price es PRECIO CON IVA INCLUIDO (17/08). ingreso_neto = price/(1+iva); comision sobre BRUTO; price_with_vat = price. El flujo licensed (revenue_share) queda INTACTO: si el share va sobre bruto o neto es clausula de contrato. No toca los targets. OJO: hace INNER JOIN por mi.channel_id, hoy NULL en todos los productos -> devuelve cero filas.';