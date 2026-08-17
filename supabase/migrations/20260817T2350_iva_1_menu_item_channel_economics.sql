-- IVA 1/3 — menu_item_channel_economics. Aplicada: (pendiente, 17/08 tras 23:45)
--
-- EL HALLAZGO (17/08, confirmado con datos y con el propio código)
-- ================================================================
-- `menu_item.price` es el precio CON IVA incluido, no la base imponible. Folvy
-- lo trataba como base y le sumaba el IVA encima. Consecuencia: el "PVP cliente"
-- que pintaba no existía, y todos los márgenes iban inflados en el importe del
-- IVA — 1,23 € por unidad en una hamburguesa de 13,50 €.
--
-- El dato está bien. La interpretación estaba mal. NO se migra ni un precio.
--
-- Cuatro pruebas independientes, todas de solo lectura:
--   1. 2.925 líneas de venta en 299 productos con sale_line.unit_price = price
--      EXACTO (30 días, vías lastapp y folvy_pos). Cero a price*1,10.
--   2. Prueba estricta por producto: NINGÚN producto tiene una sola línea
--      cobrada a price*1,10. (Los 74 casos con ratio "1.10" eran redondeo de
--      1,095–1,105, no coincidencia.)
--   3. upsert_pos_sale — el camino de ESCRITURA del TPV — ya hacía
--      `v_lbase := round(v_ltotal / (1 + v_vat/100.0), 2)`. Ya DIVIDE.
--   4. preview_bogo_mirror_price hace `coalesce(o.price, m.price) as pvp_gross`
--      y divide. Ya implementaba esta misma corrección.
-- Es decir: la base de código ya se contradecía a sí misma, y la lectura
-- correcta ya estaba escrita en dos sitios.
--
-- LA FÓRMULA (decidida por Julio, 17/08)
-- ======================================
--   ingreso_neto = price / (1 + vat/100)
--   comisión     = pct × price (+ fijo)      <-- sobre BRUTO, sin cambios
--   margen       = ingreso_neto − comisión − coste
--
-- La comisión sigue sobre BRUTO porque es como facturan las plataformas:
-- comisionan sobre el total que paga el cliente, IVA incluido. Por eso existe
-- `commission_base = 'pvp_con_iva'`. Los dos valores de commission_base
-- CONSERVAN su significado exacto: 'pvp_con_iva' = comisión sobre el bruto,
-- 'pvp_sin_iva' = comisión sobre el neto. Lo único que cambia es qué expresión
-- ocupa cada papel: antes eff_price hacía de "neto" y pvp_con_iva de "bruto";
-- ahora eff_price ES el bruto e ingreso_neto es el neto.
--
-- QUÉ NO SE TOCA, Y POR QUÉ
-- =========================
-- · `target_food_cost_pct` — decisión explícita de Julio. Los semáforos se van a
--   mover y productos hoy 'under' pasarán a 'over': eso es el dato real
--   apareciendo, no una regresión. Si se moviera el cálculo Y el objetivo a la
--   vez, nadie sabría qué movió qué.
-- · `vat_rate` — los productos de las dos cuentas están al 10 % y es correcto:
--   en hostelería todo va al 10 %, bebidas incluidas.
-- · El IVA del 21 % de la comisión de plataforma (deducible). Sobre 13,50 € al
--   30 %, la comisión bruta son 4,05 € y el coste real 3,35 €. Mismo orden de
--   magnitud que el error que arregla esta migración, pero es FRENTE PROPIO —
--   declarado, no olvidado. Nótese que `order_costs_per_item` YA divide la parte
--   FIJA entre 1,21; la parte porcentual no. Esa asimetría se queda como está
--   hoy a propósito: meterla aquí duplicaría el alcance.
-- · `effective_price()` — verificado: no menciona IVA. Fuera del radio.
-- · `sales_history_daily` / `sales_hourly_agg` — solo conteos y unidades, cero
--   columnas de importe. No hay nada inflado ahí.
-- · Lo que se publica a las plataformas — hubrise-catalog-publish envía
--   `price` crudo, no `price_with_vat`. Esta corrección NO cambia ni un
--   escaparate vivo ni obliga a republicar nada.
--
-- CÓMO VERIFICARLO (ojo, aquí es fácil equivocarse)
-- =================================================
-- El margen NO baja un 9,09 %. Baja 9,09 % DEL PRECIO:
--     margen_viejo − margen_nuevo = price − price/1,10 = price × 0,0909…
-- En la hamburguesa de 13,50 € son 1,23 € exactos — que es el 9,09 % de 13,50,
-- pero puede ser el 25 % o el 40 % DEL MARGEN según el coste. Una comprobación
-- hecha contra el margen en vez de contra el precio dará "mal" estando bien.
--
-- Se divide SIN redondeo intermedio y se redondea solo en la salida, para que la
-- diferencia sea exactamente price × (1 − 1/1,10) y no arrastre céntimos.
--
-- 1 de 3. Las tres van SEPARADAS a propósito (decisión de Julio): salen de noche
-- y sin nadie mirando, y poder revertir la del modal sin arrastrar la de promos
-- vale más que la atomicidad. Son cálculos de SOLO LECTURA: no pueden corromper
-- ningún dato. Orden: ésta -> menu_item_economics -> preview_platform_promo_impact.

BEGIN;

CREATE OR REPLACE FUNCTION public.menu_item_channel_economics(
  p_menu_item_id uuid,
  p_overrides jsonb DEFAULT NULL::jsonb,
  p_location_id uuid DEFAULT NULL::uuid
)
 RETURNS TABLE(channel_id uuid, channel_name text, channel_type text, service_type text, price numeric, price_source text, is_location_override boolean, is_available boolean, vat_rate numeric, price_with_vat numeric, cost numeric, packaging_cost numeric, food_cost numeric, cost_available boolean, commission_pct numeric, commission_base text, commission_amount numeric, commission_fixed numeric, own_courier_cost numeric, own_customer_fee numeric, order_costs_per_item numeric, contribution_margin numeric, contribution_margin_pct numeric, net_margin numeric, net_margin_pct numeric, food_cost_pct numeric, target_food_cost_pct numeric, food_cost_status text, plate_cost_pct numeric, target_plate_cost_pct numeric, plate_cost_status text, orders_30d integer)
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
  v_items_per_order numeric := 2;
BEGIN
  SELECT mi.account_id, mi.brand_id, mi.recipe_item_id, mi.price, COALESCE(mi.vat_rate, 0)
    INTO v_account_id, v_brand_id, v_recipe_item_id, v_base_price, v_vat
  FROM menu_item mi
  WHERE mi.id = p_menu_item_id
    AND mi.archived_at IS NULL;

  IF v_account_id IS NULL THEN
    RETURN;
  END IF;

  SELECT ri.computed_cost, COALESCE(ri.packaging_cost, 0)
    INTO v_cost, v_packaging
  FROM recipe_item ri WHERE ri.id = v_recipe_item_id;
  v_cost_avail := (v_cost IS NOT NULL);
  v_food := COALESCE(v_cost, 0) - COALESCE(v_packaging, 0);

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
  usage_30d AS (
    SELECT s.channel_id, s.service_type, count(*)::integer AS n
    FROM sale s
    WHERE s.account_id = v_account_id
      AND s.created_at >= now() - interval '30 days'
    GROUP BY s.channel_id, s.service_type
  ),
  ov AS (
    SELECT o.channel_id, o.is_available AS ov_avail
    FROM menu_item_override o
    WHERE o.menu_item_id = p_menu_item_id
      AND o.location_id IS NULL
  ),
  eff AS (
    SELECT
      rate.*,
      COALESCE(usage_30d.n, 0) AS orders_30d,
      CASE
        WHEN p_overrides IS NOT NULL AND p_overrides ? rate.channel_id::text
             THEN (p_overrides ->> rate.channel_id::text)::numeric
        ELSE public.effective_price(p_menu_item_id, rate.channel_id, p_location_id)
      END AS eff_price,
      CASE
        WHEN p_overrides IS NOT NULL AND p_overrides ? rate.channel_id::text THEN 'preview'
        WHEN loc_ov.has_location_override OR loc_ov.has_brand_override THEN 'override'
        ELSE 'base'
      END AS price_source,
      (NOT (p_overrides IS NOT NULL AND p_overrides ? rate.channel_id::text))
        AND loc_ov.has_location_override AS is_location_override,
      COALESCE(ov.ov_avail, true) AS is_available
    FROM rate
    LEFT JOIN usage_30d ON usage_30d.channel_id = rate.channel_id AND usage_30d.service_type IS NOT DISTINCT FROM rate.service_type
    LEFT JOIN ov ON ov.channel_id = rate.channel_id
    LEFT JOIN LATERAL (
      SELECT
        EXISTS (
          SELECT 1 FROM menu_item_override mio
          WHERE mio.menu_item_id = p_menu_item_id
            AND p_location_id IS NOT NULL AND mio.location_id = p_location_id
            AND (mio.channel_id = rate.channel_id OR mio.channel_id IS NULL)
            AND mio.price IS NOT NULL
        ) AS has_location_override,
        EXISTS (
          SELECT 1 FROM menu_item_override mio2
          WHERE mio2.menu_item_id = p_menu_item_id
            AND mio2.channel_id = rate.channel_id
            AND mio2.location_id IS NULL
            AND mio2.price IS NOT NULL
        ) AS has_brand_override
    ) loc_ov ON true
  ),
  calc AS (
    SELECT
      eff.*,
      -- ANTES: ROUND(eff.eff_price * (1 + v_vat/100.0), 2) AS pvp_con_iva
      -- eff_price YA es el precio que paga el cliente. Multiplicarlo inventaba
      -- un PVP que no existe. El bruto es el precio, tal cual.
      eff.eff_price                              AS pvp_bruto,
      -- El ingreso real de la casa. Sin ROUND aquí a propósito: se redondea solo
      -- en la salida, para que margen_viejo − margen_nuevo sea exactamente
      -- price × (1 − 1/(1+iva)) y no arrastre céntimos de redondeo intermedio.
      eff.eff_price / (1 + v_vat/100.0)          AS ingreso_neto,
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
      -- Los dos valores de commission_base conservan su significado exacto:
      -- 'pvp_sin_iva' comisiona sobre el NETO, cualquier otro sobre el BRUTO.
      -- Antes eff_price hacía de neto y pvp_con_iva de bruto; ahora los papeles
      -- los ocupan ingreso_neto y pvp_bruto. La semántica no se mueve.
      CASE calc.commission_base WHEN 'pvp_sin_iva' THEN calc.ingreso_neto ELSE calc.pvp_bruto END AS comm_basis
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
    f.is_location_override,
    f.is_available,
    v_vat                                         AS vat_rate,
    -- price_with_vat pasa a ser IGUAL a price: el precio ya lleva el IVA. Se
    -- conserva la columna para no romper el contrato de la RPC; la UI deja de
    -- pintar dos cifras distintas porque ya no lo son.
    f.pvp_bruto                                   AS price_with_vat,
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
    -- Todos los márgenes pasan a medirse contra el INGRESO NETO. Es el único
    -- cambio de fondo: antes se contaba como ingreso el IVA, que es dinero de
    -- Hacienda, no de la casa.
    ROUND(f.ingreso_neto - (CASE WHEN v_cost_avail THEN v_cost ELSE 0 END) - COALESCE(f.commission_amount, 0), 2) AS contribution_margin,
    CASE WHEN f.ingreso_neto > 0
         THEN ROUND((f.ingreso_neto - (CASE WHEN v_cost_avail THEN v_cost ELSE 0 END) - COALESCE(f.commission_amount, 0)) / f.ingreso_neto * 100, 2) END AS contribution_margin_pct,
    ROUND(f.ingreso_neto - (CASE WHEN v_cost_avail THEN v_cost ELSE 0 END) - COALESCE(f.commission_amount, 0) - COALESCE(f.order_costs_per_item, 0), 2) AS net_margin,
    CASE WHEN f.ingreso_neto > 0
         THEN ROUND((f.ingreso_neto - (CASE WHEN v_cost_avail THEN v_cost ELSE 0 END) - COALESCE(f.commission_amount, 0) - COALESCE(f.order_costs_per_item, 0)) / f.ingreso_neto * 100, 2) END AS net_margin_pct,
    -- food cost % y plate cost % se miden contra el neto, igual que antes se
    -- medían contra lo que se creía neto. El denominador baja ~9,09 %, así que
    -- los porcentajes suben y algunos 'under' pasarán a 'over'. Esperado.
    CASE WHEN v_cost_avail AND f.ingreso_neto > 0
         THEN ROUND(v_food / f.ingreso_neto * 100, 2) END AS food_cost_pct,
    v_target                                      AS target_food_cost_pct,
    CASE
      WHEN NOT v_cost_avail          THEN 'no_cost'
      WHEN f.ingreso_neto <= 0       THEN 'no_cost'
      WHEN v_target IS NULL          THEN 'no_target'
      WHEN (v_food / f.ingreso_neto * 100) <= v_target THEN 'under'
      ELSE 'over'
    END AS food_cost_status,
    CASE WHEN v_cost_avail AND f.ingreso_neto > 0
         THEN ROUND(v_cost / f.ingreso_neto * 100, 2) END AS plate_cost_pct,
    v_target_plate                                AS target_plate_cost_pct,
    CASE
      WHEN NOT v_cost_avail              THEN 'no_cost'
      WHEN f.ingreso_neto <= 0           THEN 'no_cost'
      WHEN v_target_plate IS NULL        THEN 'no_target'
      WHEN (v_cost / f.ingreso_neto * 100) <= v_target_plate THEN 'under'
      ELSE 'over'
    END AS plate_cost_status,
    f.orders_30d
  FROM f
  ORDER BY f.channel_name;
END;
$function$;

COMMENT ON FUNCTION public.menu_item_channel_economics(uuid, jsonb, uuid) IS
'Economía por canal de un producto. menu_item.price es PRECIO CON IVA INCLUIDO (verificado 17/08 contra ventas reales: sale_line.unit_price = price exacto en 2.925 líneas, cero a price*1,10). ingreso_neto = price/(1+iva); la comisión sigue sobre BRUTO porque las plataformas comisionan sobre el total que paga el cliente. price_with_vat = price. No toca target_food_cost_pct a propósito.';

COMMIT;
