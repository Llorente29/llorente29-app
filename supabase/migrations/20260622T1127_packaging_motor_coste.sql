-- ============================================================================
-- Folvy — Hueco 1 (packaging), TRAMO 1: motor de coste con desglose
-- Plate cost = computed_cost (total, sin cambio de semántica para lo existente)
-- Food cost  = computed_cost − packaging_cost (limpio, para el semáforo de cocina)
-- Packaging  = subconjunto del coste, solo líneas DIRECTAS child.type='packaging'
--
-- NOTA: sin backfill que llame a funciones recompute (auth.uid() es null fuera de
-- sesión → el guard de tenancy abortaría). No hace falta: aún no existe ninguna
-- línea 'packaging', así que packaging_cost = 0 para todos (DEFAULT 0). El recompute
-- real ocurre al añadir el primer packaging a un plato, desde la app (con sesión).
--
-- VERIFICACIÓN: NO incluir aquí SELECT que invoque funciones SECURITY DEFINER.
-- Verificar después por separado (columnas/constraint con information_schema; las
-- funciones, desde la app que sí tiene sesión).
-- ============================================================================

-- 1) recipe_item.type admite 'packaging' --------------------------------------
ALTER TABLE recipe_item DROP CONSTRAINT IF EXISTS recipe_item_type_check;
ALTER TABLE recipe_item ADD CONSTRAINT recipe_item_type_check
  CHECK (type = ANY (ARRAY['raw'::text, 'recipe'::text, 'tool'::text, 'dish'::text, 'packaging'::text]));

-- 2) recipe_item.packaging_cost (subconjunto del coste) -----------------------
ALTER TABLE recipe_item
  ADD COLUMN IF NOT EXISTS packaging_cost numeric NOT NULL DEFAULT 0;

-- 3) kitchen_settings.target_plate_cost_pct (objetivo del plato con packaging) -
ALTER TABLE kitchen_settings
  ADD COLUMN IF NOT EXISTS target_plate_cost_pct numeric;

-- Defecto sensato para cuentas existentes (el cliente lo ajusta en Ajustes).
UPDATE kitchen_settings
  SET target_plate_cost_pct = 33
  WHERE target_plate_cost_pct IS NULL;

-- 4) Coste del raw: 'packaging' se costea como raw/tool -----------------------
CREATE OR REPLACE FUNCTION public.kitchen_recompute_raw_cost(p_item_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item recipe_item%ROWTYPE;
  v_link article_supplier%ROWTYPE;
  v_cost numeric;
BEGIN
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kitchen_recompute_raw_cost: item % no existe', p_item_id;
  END IF;
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(v_item.account_id)) THEN
    RAISE EXCEPTION 'kitchen_recompute_raw_cost: sin acceso al item %', p_item_id;
  END IF;
  IF v_item.type NOT IN ('raw','tool','packaging') THEN
    RETURN COALESCE(v_item.computed_cost, 0);
  END IF;
  IF v_item.cost_strategy = 'fixed' THEN
    v_cost := COALESCE(v_item.fixed_cost, 0);
    UPDATE recipe_item SET computed_cost = v_cost, cost_updated_at = now() WHERE id = p_item_id;
    RETURN v_cost;
  END IF;
  -- DESACOPLADO: basta precio €/base; el formato ya NO es requisito del coste.
  SELECT a.* INTO v_link FROM article_supplier a
    WHERE a.recipe_item_id = p_item_id AND a.is_active AND a.last_price IS NOT NULL
    ORDER BY a.is_preferred DESC, a.updated_at DESC LIMIT 1;
  IF FOUND THEN
    v_cost := v_link.last_price;             -- last_price ES €/base
    UPDATE recipe_item SET computed_cost = v_cost, cost_updated_at = now() WHERE id = p_item_id;
    RETURN v_cost;
  END IF;
  -- Sin precio utilizable: no inventamos, marcamos y conservamos el anterior.
  UPDATE recipe_item SET needs_review = true, cost_updated_at = now() WHERE id = p_item_id;
  RETURN COALESCE(v_item.computed_cost, v_item.fixed_cost, 0);
END;
$function$;

-- 5) Coste del plato: acumula packaging en paralelo al total ------------------
CREATE OR REPLACE FUNCTION public.kitchen_recompute_item(p_item_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item            recipe_item%ROWTYPE;
  v_line            recipe_line%ROWTYPE;
  v_child           recipe_item%ROWTYPE;
  v_line_unit       kitchen_unit%ROWTYPE;
  v_child_base_unit kitchen_unit%ROWTYPE;
  v_qty             numeric;
  v_qty_in_base     numeric;
  v_child_cost      numeric;
  v_conv            numeric;
  v_line_cost       numeric;
  v_total           numeric := 0;
  v_packaging       numeric := 0;
  v_incomplete      boolean := false;
BEGIN
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kitchen_recompute_item: item % no existe', p_item_id;
  END IF;
  -- GUARD DE TENANCY: admin de plataforma (CEO) O admin/manager de la cuenta.
  -- SECURITY DEFINER salta RLS, así que validamos acceso explícitamente.
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(v_item.account_id)) THEN
    RAISE EXCEPTION 'kitchen_recompute_item: sin acceso al item %', p_item_id;
  END IF;
  -- Raw/tool/packaging: UNA sola verdad del coste -> función dedicada
  -- (fixed / last_purchase + fallback honesto + needs_review).
  IF v_item.type IN ('raw', 'tool', 'packaging') THEN
    RETURN public.kitchen_recompute_raw_cost(p_item_id);
  END IF;
  FOR v_line IN
    SELECT * FROM recipe_line WHERE parent_item_id = p_item_id
  LOOP
    SELECT * INTO v_child           FROM recipe_item  WHERE id = v_line.child_item_id;
    SELECT * INTO v_line_unit       FROM kitchen_unit WHERE id = v_line.unit_id;
    SELECT * INTO v_child_base_unit FROM kitchen_unit WHERE id = v_child.base_unit_id;
    v_child_cost := COALESCE(v_child.computed_cost, v_child.fixed_cost, 0);
    v_qty := COALESCE(v_line.quantity_gross, v_line.quantity_net);
    IF v_line_unit.dimension = v_child_base_unit.dimension THEN
      v_qty_in_base := v_qty * v_line_unit.factor_to_base / v_child_base_unit.factor_to_base;
    ELSE
      SELECT qty_in_base INTO v_conv
        FROM recipe_item_unit_conversion
        WHERE item_id = v_child.id AND from_unit_id = v_line.unit_id
        LIMIT 1;
      IF v_conv IS NOT NULL THEN
        v_qty_in_base := v_qty * v_conv;
      ELSE
        v_incomplete := true;
        v_qty_in_base := 0;
      END IF;
    END IF;
    v_line_cost := v_child_cost * v_qty_in_base;
    v_total := v_total + v_line_cost;
    -- Desglose: solo líneas DIRECTAS de packaging (no propaga de sub-recetas).
    IF v_child.type = 'packaging' THEN
      v_packaging := v_packaging + v_line_cost;
    END IF;
  END LOOP;
  UPDATE recipe_item
    SET computed_cost   = v_total,
        packaging_cost  = v_packaging,
        cost_updated_at = now(),
        needs_review    = CASE WHEN v_incomplete THEN true ELSE needs_review END
    WHERE id = p_item_id;
  RETURN v_total;
END;
$function$;

-- 6) Economía por canal (ficha): food limpio + plate cost + 2º semáforo -------
--    Cambia la firma (columnas nuevas) -> DROP antes de CREATE.
DROP FUNCTION IF EXISTS public.menu_item_channel_economics(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.menu_item_channel_economics(p_menu_item_id uuid, p_overrides jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(channel_id uuid, channel_name text, channel_type text, service_type text, price numeric, price_source text, is_available boolean, vat_rate numeric, price_with_vat numeric, cost numeric, packaging_cost numeric, food_cost numeric, cost_available boolean, commission_pct numeric, commission_base text, commission_amount numeric, commission_fixed numeric, own_courier_cost numeric, own_customer_fee numeric, order_costs_per_item numeric, contribution_margin numeric, contribution_margin_pct numeric, net_margin numeric, net_margin_pct numeric, food_cost_pct numeric, target_food_cost_pct numeric, food_cost_status text, plate_cost_pct numeric, target_plate_cost_pct numeric, plate_cost_status text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id      uuid;
  v_brand_id        uuid;
  v_recipe_item_id  uuid;
  v_base_price      numeric;
  v_vat             numeric;
  v_cost            numeric;
  v_packaging       numeric := 0;
  v_food            numeric;
  v_cost_avail      boolean;
  v_target          numeric;
  v_target_plate    numeric;
  v_items_per_order numeric := 2;  -- DEFAULT_ITEMS_PER_ORDER (idéntico a la ficha)
BEGIN
  SELECT mi.account_id, mi.brand_id, mi.recipe_item_id, mi.price, COALESCE(mi.vat_rate, 0)
    INTO v_account_id, v_brand_id, v_recipe_item_id, v_base_price, v_vat
  FROM menu_item mi
  WHERE mi.id = p_menu_item_id
    AND mi.archived_at IS NULL;

  IF v_account_id IS NULL THEN
    RETURN;  -- no existe, archivado, o sin acceso (RLS)
  END IF;

  SELECT ri.computed_cost, COALESCE(ri.packaging_cost, 0)
    INTO v_cost, v_packaging
  FROM recipe_item ri WHERE ri.id = v_recipe_item_id;
  v_cost_avail := (v_cost IS NOT NULL);
  v_food := COALESCE(v_cost, 0) - COALESCE(v_packaging, 0);  -- comida limpia

  SELECT ks.target_food_cost_pct, ks.target_plate_cost_pct
    INTO v_target, v_target_plate
  FROM kitchen_settings ks WHERE ks.account_id = v_account_id;

  RETURN QUERY
  WITH ch AS (
    SELECT sc.id AS channel_id, sc.name AS channel_name, sc.channel_type
    FROM sales_channel sc
    WHERE sc.account_id = v_account_id
      AND sc.is_active = true
  ),
  rate AS (
    SELECT
      ch.channel_id, ch.channel_name, ch.channel_type,
      COALESCE(bcr.service_type,            cr.service_type)            AS service_type,
      COALESCE(bcr.commission_pct,          cr.commission_pct)          AS commission_pct,
      COALESCE(bcr.commission_fixed,        cr.commission_fixed)        AS commission_fixed,
      COALESCE(bcr.commission_base,         cr.commission_base)         AS commission_base,
      COALESCE(bcr.own_courier_cost,        cr.own_courier_cost)        AS own_courier_cost,
      COALESCE(bcr.own_customer_fee,        cr.own_customer_fee)        AS own_customer_fee,
      COALESCE(bcr.own_customer_fee_vat_pct, cr.own_customer_fee_vat_pct, 10) AS own_customer_fee_vat_pct
    FROM ch
    LEFT JOIN brand_channel bc
           ON bc.brand_id = v_brand_id
          AND bc.channel_id = ch.channel_id
          AND bc.is_active = true
    LEFT JOIN brand_channel_rate bcr
           ON bcr.brand_channel_id = bc.id
          AND bcr.is_active = true
          AND bcr.archived_at IS NULL
    LEFT JOIN channel_rate cr
           ON cr.sales_channel_id = ch.channel_id
          AND cr.is_active = true
          AND cr.archived_at IS NULL
  ),
  ov AS (
    -- esta capa: nivel marca/canal (sin local). Precio por local = capa 2.
    SELECT o.channel_id, o.price AS ov_price, o.is_available AS ov_avail
    FROM menu_item_override o
    WHERE o.menu_item_id = p_menu_item_id
      AND o.location_id IS NULL
  ),
  eff AS (
    SELECT
      rate.*,
      CASE
        WHEN p_overrides IS NOT NULL AND p_overrides ? rate.channel_id::text
             THEN (p_overrides ->> rate.channel_id::text)::numeric
        WHEN ov.ov_price IS NOT NULL THEN ov.ov_price
        ELSE v_base_price
      END AS eff_price,
      CASE
        WHEN p_overrides IS NOT NULL AND p_overrides ? rate.channel_id::text THEN 'preview'
        WHEN ov.ov_price IS NOT NULL THEN 'override'
        ELSE 'base'
      END AS price_source,
      COALESCE(ov.ov_avail, true) AS is_available
    FROM rate
    LEFT JOIN ov ON ov.channel_id = rate.channel_id
  ),
  calc AS (
    SELECT
      eff.*,
      ROUND(eff.eff_price * (1 + v_vat/100.0), 2) AS pvp_con_iva,
      -- costes de pedido (bruto->base, EXACTO como baseFromGross), solo own_delivery
      CASE WHEN eff.service_type = 'own_delivery' THEN
        ROUND(
          ( COALESCE(ROUND(eff.commission_fixed / 1.21, 2), 0)
          + COALESCE(ROUND(eff.own_courier_cost  / 1.21, 2), 0)
          - COALESCE(ROUND(eff.own_customer_fee / (1 + eff.own_customer_fee_vat_pct/100.0), 2), 0)
          ) / v_items_per_order, 2)
      ELSE 0 END AS order_costs_per_item
    FROM eff
  ),
  m AS (
    SELECT
      calc.*,
      CASE calc.commission_base WHEN 'pvp_sin_iva' THEN calc.eff_price ELSE calc.pvp_con_iva END AS comm_basis
    FROM calc
  ),
  f AS (
    SELECT
      m.*,
      CASE WHEN m.commission_pct IS NOT NULL
           THEN ROUND(m.comm_basis * m.commission_pct / 100.0, 2) END AS commission_amount
    FROM m
  )
  SELECT
    f.channel_id,
    f.channel_name,
    f.channel_type,
    f.service_type,
    f.eff_price                                   AS price,
    f.price_source,
    f.is_available,
    v_vat                                         AS vat_rate,
    f.pvp_con_iva                                 AS price_with_vat,
    v_cost                                        AS cost,
    v_packaging                                   AS packaging_cost,
    v_food                                        AS food_cost,
    v_cost_avail                                  AS cost_available,
    f.commission_pct,
    f.commission_base,
    f.commission_amount,
    f.commission_fixed,
    f.own_courier_cost,
    f.own_customer_fee,
    f.order_costs_per_item,
    -- contribution: EXACTO, sobre el coste total del plato (plate cost). Sin estimaciones.
    ROUND(f.eff_price - (CASE WHEN v_cost_avail THEN v_cost ELSE 0 END) - COALESCE(f.commission_amount, 0), 2) AS contribution_margin,
    CASE WHEN f.eff_price > 0
         THEN ROUND((f.eff_price - (CASE WHEN v_cost_avail THEN v_cost ELSE 0 END) - COALESCE(f.commission_amount, 0)) / f.eff_price * 100, 2) END AS contribution_margin_pct,
    -- net: contribution − costes de pedido diluidos (= margen que muestra hoy la ficha)
    ROUND(f.eff_price - (CASE WHEN v_cost_avail THEN v_cost ELSE 0 END) - COALESCE(f.commission_amount, 0) - COALESCE(f.order_costs_per_item, 0), 2) AS net_margin,
    CASE WHEN f.eff_price > 0
         THEN ROUND((f.eff_price - (CASE WHEN v_cost_avail THEN v_cost ELSE 0 END) - COALESCE(f.commission_amount, 0) - COALESCE(f.order_costs_per_item, 0)) / f.eff_price * 100, 2) END AS net_margin_pct,
    -- FOOD COST: solo comida (limpio), para el semáforo de cocina
    CASE WHEN v_cost_avail AND f.eff_price > 0
         THEN ROUND(v_food / f.eff_price * 100, 2) END AS food_cost_pct,
    v_target                                      AS target_food_cost_pct,
    CASE
      WHEN NOT v_cost_avail        THEN 'no_cost'
      WHEN f.eff_price <= 0        THEN 'no_cost'
      WHEN v_target IS NULL        THEN 'no_target'
      WHEN (v_food / f.eff_price * 100) <= v_target THEN 'under'
      ELSE 'over'
    END AS food_cost_status,
    -- PLATE COST: comida + packaging, para el semáforo del plato entregado
    CASE WHEN v_cost_avail AND f.eff_price > 0
         THEN ROUND(v_cost / f.eff_price * 100, 2) END AS plate_cost_pct,
    v_target_plate                                AS target_plate_cost_pct,
    CASE
      WHEN NOT v_cost_avail            THEN 'no_cost'
      WHEN f.eff_price <= 0            THEN 'no_cost'
      WHEN v_target_plate IS NULL      THEN 'no_target'
      WHEN (v_cost / f.eff_price * 100) <= v_target_plate THEN 'under'
      ELSE 'over'
    END AS plate_cost_status
  FROM f
  ORDER BY f.channel_name;
END;
$function$;

-- 7) Economía por marca (lista): mismo desglose ------------------------------
--    SECURITY DEFINER + cambia firma -> DROP la sobrecarga antes de CREATE.
DROP FUNCTION IF EXISTS public.menu_item_economics(uuid, text);
CREATE OR REPLACE FUNCTION public.menu_item_economics(p_brand_id uuid, p_service_type text DEFAULT 'platform_delivery'::text)
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
    calc.packaging_cost,
    calc.food_cost,
    calc.cost_available,
    calc.price,
    calc.vat_rate,
    calc.price_with_vat,
    -- FOOD COST: solo comida (limpio)
    CASE WHEN calc.flow_type = 'own' AND calc.cost_available AND calc.price > 0
         THEN ROUND(calc.food_cost / calc.price * 100, 2) END AS food_cost_pct,
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
      WHEN (calc.food_cost / calc.price * 100) <= calc.target_food_cost_pct
           THEN 'under'
      ELSE 'over'
    END AS food_cost_status,
    -- PLATE COST: comida + packaging
    CASE WHEN calc.flow_type = 'own' AND calc.cost_available AND calc.price > 0
         THEN ROUND(calc.cost / calc.price * 100, 2) END AS plate_cost_pct,
    calc.target_plate_cost_pct,
    CASE
      WHEN calc.flow_type = 'licensed'        THEN 'n_a'
      WHEN NOT calc.cost_available            THEN 'no_cost'
      WHEN calc.target_plate_cost_pct IS NULL THEN 'no_target'
      WHEN calc.price <= 0                    THEN 'no_cost'
      WHEN (calc.cost / calc.price * 100) <= calc.target_plate_cost_pct
           THEN 'under'
      ELSE 'over'
    END AS plate_cost_status
  FROM calc
  ORDER BY calc.channel_name, calc.menu_item_name;
END;
$function$;
