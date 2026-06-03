-- supabase/migrations/20260603T1200_comision_fuente_unica.sql
--
-- DEUDA 0 — Comisión: fuente de verdad ÚNICA en brand_channel_rate.
--
-- Contexto del problema:
--   La comisión vivía duplicada/huérfana en 3 sitios:
--     · brand.commission_pct                 (escrito por el form de marca, IGNORADO por la economía)
--     · brand_channel.commission_pct/fixed   (leído por la RPC, pero pertenece al hijo)
--     · sales_channel.default_commission_pct (fallback comodín que INVENTA comisión)
--   La RPC menu_item_economics leía de brand_channel con fallback al canal, y
--   asumía la base de comisión (IVA) "a mano". Fuente de verdad ambigua + base hardcodeada.
--
-- Cierre deuda 0:
--   1) menu_item_economics ahora lee la comisión SOLO de brand_channel_rate
--      (el hijo correcto de brand_channel), por service_type, respetando
--      commission_base (pvp_con_iva | pvp_sin_iva). SIN fallback.
--      Sin tarifa configurada -> comisión/margen NULL (honesto: "no lo sé",
--      no un cero inventado). food_cost_pct, contribution_margin y
--      food_cost_status siguen calculándose (no dependen de la comisión).
--      Nuevo parámetro p_service_type DEFAULT 'platform_delivery':
--      compatible con los callers actuales (no tocan su llamada);
--      Llorente29 = 100% platform_delivery hoy.
--   2) Se ELIMINAN físicamente las 3 columnas residuales -> la ambigüedad
--      desaparece de la BBDD, no se documenta: se mata.
--
-- Nota SECURITY DEFINER: esta función NO se testea dentro de esta tx
--   (auth.uid() es null en el SQL Editor -> el guard lanzaría EXCEPTION y
--   abortaría todo). La verificación funcional se hace DESPUÉS y DESDE LA APP
--   (con sesión). Aquí solo DROP/CREATE + ALTER, sin SELECT de la función.
--
-- Si algún ALTER ... DROP COLUMN falla por dependencia (alguna vista/función
--   no detectada referencia la columna), la transacción entera hace ROLLBACK
--   automático (nada queda a medias) -> pegar el error y se resuelve antes de COMMIT.
--
-- Aplicada: 2026-06-03 (SQL Editor, producción)

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) RPC: nueva firma (añade p_service_type) -> DROP + CREATE (no es REPLACE)
-- ─────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.menu_item_economics(uuid);

CREATE FUNCTION public.menu_item_economics(
  p_brand_id uuid,
  p_service_type text DEFAULT 'platform_delivery'
)
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
      -- Comisión: FUENTE ÚNICA = brand_channel_rate (hijo de brand_channel),
      -- filtrada por service_type. SIN fallback. Sin tarifa -> NULL (honesto).
      bcr.commission_pct   AS commission_pct,
      bcr.commission_fixed AS commission_fixed,
      bcr.commission_base  AS commission_base,
      bcr.own_courier_cost AS own_courier_cost,
      bla.revenue_share_pct      AS revenue_share_pct,
      bla.reimburses_consumption AS reimburses_consumption,
      ks.target_food_cost_pct    AS target_food_cost_pct
    FROM menu_item mi
    JOIN brand b          ON b.id = mi.brand_id
    JOIN sales_channel sc ON sc.id = mi.channel_id
    JOIN recipe_item ri   ON ri.id = mi.recipe_item_id
    -- cabecera marca×canal (padre)
    LEFT JOIN brand_channel bc
           ON bc.brand_id = mi.brand_id
          AND bc.channel_id = mi.channel_id
          AND bc.is_active = true
    -- tarifa por tipo de servicio (hijo): fuente única de la comisión
    LEFT JOIN brand_channel_rate bcr
           ON bcr.brand_channel_id = bc.id
          AND bcr.service_type = p_service_type
          AND bcr.is_active = true
          AND bcr.archived_at IS NULL
    LEFT JOIN brand_licensing_agreement bla
           ON bla.brand_id = mi.brand_id AND bla.is_active = true
    LEFT JOIN kitchen_settings ks ON ks.account_id = mi.account_id
    WHERE mi.brand_id = p_brand_id
      AND mi.archived_at IS NULL
  ),
  calc AS (
    SELECT
      base.*,
      -- Base sobre la que la plataforma cobra la comisión: DATO, no hardcode.
      -- 'pvp_con_iva' o NULL -> con IVA (lo más común en ES); 'pvp_sin_iva' -> sin IVA.
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
    -- food cost y contribución NO dependen de la comisión -> se calculan siempre
    CASE WHEN calc.flow_type = 'own' AND calc.cost_available AND calc.price > 0
         THEN ROUND(calc.cost / calc.price * 100, 2) END AS food_cost_pct,
    CASE WHEN calc.flow_type = 'own' AND calc.cost_available
         THEN ROUND(calc.price - calc.cost, 4) END AS contribution_margin,
    CASE WHEN calc.flow_type = 'own' THEN calc.commission_pct END AS commission_pct,
    -- Comisión € sobre la base configurada. NULL si no hay tarifa.
    CASE WHEN calc.flow_type = 'own' AND calc.commission_pct IS NOT NULL
         THEN ROUND(calc.commission_basis * calc.commission_pct / 100, 4) END AS commission_amount,
    CASE WHEN calc.flow_type = 'own' THEN calc.commission_fixed END AS commission_fixed,
    -- delivery_fee: coste de repartidor propio (honesto). NULL en platform_delivery
    -- (donde reparte la plataforma) y NULL si no hay tarifa.
    CASE WHEN calc.flow_type = 'own' THEN calc.own_courier_cost END AS delivery_fee,
    CASE WHEN calc.flow_type = 'licensed' THEN calc.revenue_share_pct END AS revenue_share_pct,
    CASE WHEN calc.flow_type = 'licensed' AND calc.revenue_share_pct IS NOT NULL
         THEN ROUND(calc.price * calc.revenue_share_pct / 100, 4) END AS revenue_share_amount,
    CASE WHEN calc.flow_type = 'licensed' AND COALESCE(calc.reimburses_consumption, false)
         THEN calc.consumption_price END AS consumption_reimb,
    -- NET MARGIN own: resta comisión % sobre la base configurada (NO la fija,
    -- que es por pedido). NULL sin tarifa. licensed: igual que antes.
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

-- ─────────────────────────────────────────────────────────────────────
-- 2) Eliminar las 3 columnas residuales -> ambigüedad físicamente muerta
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.brand          DROP COLUMN IF EXISTS commission_pct;
ALTER TABLE public.brand_channel  DROP COLUMN IF EXISTS commission_pct;
ALTER TABLE public.brand_channel  DROP COLUMN IF EXISTS commission_fixed;
ALTER TABLE public.sales_channel  DROP COLUMN IF EXISTS default_commission_pct;

COMMIT;
