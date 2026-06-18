-- 20260618T2300_menu_item_channel_economics.sql
-- Aplicada: 2026-06-18
--
-- FRENTE OVERRIDES — paso 1: el motor de margen por canal (fuente única de verdad).
--
-- Reemplaza en la práctica a menu_item_economics, que (1) NO leía menu_item_override
-- y (2) recibía un service_type GLOBAL para toda la consulta — imposible con canales
-- mixtos (Glovo/JustEat/Shop = own_delivery, Uber = platform_delivery).
--
-- menu_item_channel_economics(p_menu_item_id, p_overrides):
--   · Una fila POR CANAL activo de la cuenta del producto.
--   · service_type resuelto POR CANAL (de su tarifa), no global.
--   · precio efectivo = preview (p_overrides) > override (menu_item_override) > base.
--   · comisión: brand_channel_rate (override marca×canal) > channel_rate (defecto) > NULL.
--   · Reproduce baseFromGross (÷1,21 IVA servicios 21%; envío cliente con su IVA) y
--     DEFAULT_ITEMS_PER_ORDER=2 EXACTAMENTE como la ficha, para que jubilar el cálculo
--     cliente NO cambie ni un céntimo.
--   · Devuelve DOS márgenes separados: contribution_margin (exacto, precio−coste−comisión%)
--     y net_margin (= contribution − costes de pedido diluidos, estimación marcada).
--   · p_overrides jsonb {"<channel_id>": <precio_sin_iva>} → previsualización al teclear
--     en el MISMO motor (NULL = estado guardado).
--   · SECURITY INVOKER: el acceso lo controla RLS (igual que avt_period). En el SQL Editor
--     (sin sesión) devuelve vacío; se verifica DESDE LA APP.

CREATE OR REPLACE FUNCTION public.menu_item_channel_economics(
  p_menu_item_id uuid,
  p_overrides jsonb DEFAULT NULL
)
RETURNS TABLE(
  channel_id uuid,
  channel_name text,
  channel_type text,
  service_type text,
  price numeric,                 -- precio efectivo SIN IVA (preview|override|base)
  price_source text,             -- 'preview' | 'override' | 'base'
  is_available boolean,          -- 86 manual (override) — true si no hay override
  vat_rate numeric,
  price_with_vat numeric,        -- PVP cliente
  cost numeric,                  -- escandallo (recipe_item.computed_cost)
  cost_available boolean,
  commission_pct numeric,
  commission_base text,
  commission_amount numeric,     -- por plato, sobre la base correcta
  commission_fixed numeric,      -- por PEDIDO (bruto, informativo)
  own_courier_cost numeric,      -- por PEDIDO (bruto, informativo)
  own_customer_fee numeric,      -- por PEDIDO (bruto, lo paga el cliente)
  order_costs_per_item numeric,  -- ESTIMACIÓN diluida (fija+rider−envío)/2, solo own_delivery
  contribution_margin numeric,   -- EXACTO: precio − coste − comisión%
  contribution_margin_pct numeric,
  net_margin numeric,            -- contribution − order_costs_per_item (= margen de la ficha)
  net_margin_pct numeric,
  food_cost_pct numeric,
  target_food_cost_pct numeric,
  food_cost_status text          -- under | over | no_cost | no_target
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id     uuid;
  v_brand_id       uuid;
  v_recipe_item_id uuid;
  v_base_price     numeric;
  v_vat            numeric;
  v_cost           numeric;
  v_cost_avail     boolean;
  v_target         numeric;
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

  SELECT ri.computed_cost INTO v_cost
  FROM recipe_item ri WHERE ri.id = v_recipe_item_id;
  v_cost_avail := (v_cost IS NOT NULL);

  SELECT ks.target_food_cost_pct INTO v_target
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
      -- costes de pedido (bruto→base, EXACTO como baseFromGross), solo own_delivery
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
    v_cost_avail                                  AS cost_available,
    f.commission_pct,
    f.commission_base,
    f.commission_amount,
    f.commission_fixed,
    f.own_courier_cost,
    f.own_customer_fee,
    f.order_costs_per_item,
    -- contribution: EXACTO, sin estimaciones
    ROUND(f.eff_price - (CASE WHEN v_cost_avail THEN v_cost ELSE 0 END) - COALESCE(f.commission_amount, 0), 2) AS contribution_margin,
    CASE WHEN f.eff_price > 0
         THEN ROUND((f.eff_price - (CASE WHEN v_cost_avail THEN v_cost ELSE 0 END) - COALESCE(f.commission_amount, 0)) / f.eff_price * 100, 2) END AS contribution_margin_pct,
    -- net: contribution − costes de pedido diluidos (= margen que muestra hoy la ficha)
    ROUND(f.eff_price - (CASE WHEN v_cost_avail THEN v_cost ELSE 0 END) - COALESCE(f.commission_amount, 0) - COALESCE(f.order_costs_per_item, 0), 2) AS net_margin,
    CASE WHEN f.eff_price > 0
         THEN ROUND((f.eff_price - (CASE WHEN v_cost_avail THEN v_cost ELSE 0 END) - COALESCE(f.commission_amount, 0) - COALESCE(f.order_costs_per_item, 0)) / f.eff_price * 100, 2) END AS net_margin_pct,
    CASE WHEN v_cost_avail AND f.eff_price > 0
         THEN ROUND(v_cost / f.eff_price * 100, 2) END AS food_cost_pct,
    v_target                                      AS target_food_cost_pct,
    CASE
      WHEN NOT v_cost_avail        THEN 'no_cost'
      WHEN f.eff_price <= 0        THEN 'no_cost'
      WHEN v_target IS NULL        THEN 'no_target'
      WHEN (v_cost / f.eff_price * 100) <= v_target THEN 'under'
      ELSE 'over'
    END AS food_cost_status
  FROM f
  ORDER BY f.channel_name;
END;
$function$;


-- ─── Escritura de overrides (precio + 86 manual por canal) ───────────────────
-- ON CONFLICT sobre la EXPRESIÓN exacta del índice único uq_menu_item_override_scope
-- (menu_item_id, COALESCE(location_id, zero), COALESCE(channel_id, zero)).
-- p_price NULL = hereda el precio base (permite 86 sin tocar precio).

CREATE OR REPLACE FUNCTION public.set_menu_item_override(
  p_menu_item_id uuid,
  p_channel_id   uuid,
  p_price        numeric DEFAULT NULL,
  p_is_available boolean DEFAULT true,
  p_location_id  uuid    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
BEGIN
  SELECT mi.account_id INTO v_account_id FROM menu_item mi WHERE mi.id = p_menu_item_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Producto % no encontrado', p_menu_item_id;
  END IF;
  IF NOT (current_user_is_admin() OR current_user_is_admin_or_manager_of(v_account_id)) THEN
    RAISE EXCEPTION 'Sin permiso para editar precios de este producto';
  END IF;

  INSERT INTO menu_item_override (account_id, menu_item_id, channel_id, location_id, price, is_available)
  VALUES (v_account_id, p_menu_item_id, p_channel_id, p_location_id, p_price, p_is_available)
  ON CONFLICT (menu_item_id,
               COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
               COALESCE(channel_id,  '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET price = EXCLUDED.price, is_available = EXCLUDED.is_available;
END;
$function$;


CREATE OR REPLACE FUNCTION public.clear_menu_item_override(
  p_menu_item_id uuid,
  p_channel_id   uuid,
  p_location_id  uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
BEGIN
  SELECT mi.account_id INTO v_account_id FROM menu_item mi WHERE mi.id = p_menu_item_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Producto % no encontrado', p_menu_item_id;
  END IF;
  IF NOT (current_user_is_admin() OR current_user_is_admin_or_manager_of(v_account_id)) THEN
    RAISE EXCEPTION 'Sin permiso para editar precios de este producto';
  END IF;

  DELETE FROM menu_item_override
  WHERE menu_item_id = p_menu_item_id
    AND COALESCE(channel_id,  '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(p_channel_id,  '00000000-0000-0000-0000-000000000000'::uuid)
    AND COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(p_location_id, '00000000-0000-0000-0000-000000000000'::uuid);
END;
$function$;
