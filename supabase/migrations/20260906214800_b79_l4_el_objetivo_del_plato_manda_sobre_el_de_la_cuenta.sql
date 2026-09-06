-- B79 lote 4 · pieza C (06/09/2026) — §3.11: el objetivo del PLATO manda sobre el
-- de la CUENTA, en las DOS funciones de economia.
--
-- ── POR QUE ESTA ESCRITURA HACE DOS FUNCIONES Y NO UNA (regla 13) ───────────
-- La regla 13 dice que una escritura hace UNA cosa. Esta hace una: «el objetivo
-- del plato manda». Lo que no puede es hacerla a medias. `menu_item_economics`
-- alimenta Rentabilidad e Ingenieria; `menu_item_channel_economics` alimenta
-- Precios y la ficha del plato. Si solo cambiara una, Precios y Rentabilidad
-- dirian cosas distintas DEL MISMO PLATO — que es peor que el defecto que
-- venimos a arreglar. Van juntas o no van.
--
-- ── EL PROBLEMA, MEDIDO ─────────────────────────────────────────────────────
-- `target_food_cost_pct` vive en dos tablas: `kitchen_settings` (una por cuenta)
-- y `menu_item` (una por plato). Medido el 06/09/2026:
--   · `kitchen_settings`: 3 filas, una por cuenta, LAS TRES con el valor a NULL.
--   · `menu_item`: **10 platos sin archivar** lo tienen puesto a mano desde la
--     pestana Ficha, que es la unica pantalla que lo edita. De esos 10, **8 estan
--     en carta** (`is_active IS NOT FALSE`); los otros dos estan desactivados sin
--     archivar. Las dos cifras son ciertas y miden cosas distintas: el motor filtra
--     por `archived_at IS NULL` y ve 10; el contador del Resumen dice «en carta» y
--     cuenta 8. Se escriben las dos para que nadie tenga que adivinar cual es.
--   · Y NINGUNA de las dos funciones miraba `mi.target_food_cost_pct`: las dos
--     leian solo el de la cuenta. Diez decisiones tomadas a mano sin efecto
--     ninguno — la mas reciente, «Budapest» de Lovers Burgers al 25 %, guardada
--     el mismo 06/09 a las 12:09 de Madrid.
--
-- ── QUE CAMBIA DE VERDAD, CONTADO ANTES DE APLICARLO ────────────────────────
-- Con la misma vara a los dos lados, sobre las 1.144 filas de `menu_item` sin
-- archivar de las tres cuentas: **cambian 6**. Ni una mas.
--
--   Birria Chicken Bowl      Bendito Burrito  obj 30  food 25,6   no_target -> under
--   Budapest                 Lovers Burgers   obj 25  food 15,8   no_target -> under
--   Cheeseburger             Lovers Burgers   obj 25  food 15,8   no_target -> under
--   Marquesa Choco-Avellanas Bendito Burrito  obj 50  food 41,4   no_target -> under
--   Marquesa Choco-Avellanas Dirty Burger     obj 50  food 41,4   no_target -> under
--   Marquesa Dulce de Leche  Dirty Burger     obj 50  food 41,6   no_target -> under
--
-- Los otros cuatro de los diez son de marcas CEDIDAS, y para una cedida las dos
-- funciones devuelven 'n_a' pase lo que pase: su semaforo no se mueve. (Uno de
-- ellos es «Agua pet.» de Ay Mamita, con objetivo de comida del 30 % y coste 0:
-- ruido del catalogo, no algo que arreglar aqui.)
--
-- **Los seis van a `under`. Ninguno se pone en rojo.** Es informacion, no alarma:
-- lo unico que pasa manana es que seis platos dejan de decir «sin objetivo» y
-- empiezan a decir «dentro del objetivo».
--
-- ── LO QUE NO SE TOCA ───────────────────────────────────────────────────────
-- El objetivo de COSTE DE PLATO (`target_plate_cost_pct`) se queda solo en la
-- cuenta: `menu_item` NO tiene esa columna (comprobado en `information_schema`
-- el 06/09). No se inventa una.
--
-- ── REGLA 2: `CREATE OR REPLACE`, NO `DROP` + `CREATE` ──────────────────────
-- Ninguna de las dos cambia de firma ni de tipo de retorno: mismos parametros,
-- mismas columnas devueltas, mismos tipos. No puede nacer una sobrecarga.
--
-- ── DE DONDE SALE EL TEXTO DE CADA UNA (regla 5: la base es la verdad) ──────
-- No se ha reescrito nada de memoria. `menu_item_economics` sale del fichero cuya
-- huella ya casaba con la funcion viva (`ca61a77588db57bee15549718df10b30`), y
-- `menu_item_channel_economics` de
-- `20260817215259_iva_1_menu_item_channel_economics.sql`, cuyo cuerpo tiene la
-- huella EXACTA del `prosrc` vivo (`2beefa9c5ab27289d162c8ec15e5fad1`, 8.296
-- caracteres). Sobre esos dos textos se aplican los cambios de arriba y nada mas.
--
-- Aviso para quien venga: en el repo hay OTRO fichero,
-- `20260817T2350_iva_1_menu_item_channel_economics.sql`, con un cuerpo distinto y
-- mas largo (9.425 caracteres) que NO es el que corre en produccion. No se ha
-- tocado; queda anotado para que nadie lo tome por bueno.
--
-- ── CONSUMIDORES MIRADOS ANTES (regla 32) ───────────────────────────────────
-- `food_cost_status` lo pintan `RecipeEscandalloTab.tsx` (semaforo de la ficha) y
-- `EditPricesModal.tsx` (ambar cuando es 'over'); `kitchenDashboardService.ts` lo
-- usa para la barra de salud. Los tres cambian de comportamiento SOLO en esos seis
-- platos, y solo de «sin objetivo» a «dentro». `priceGridService.ts` lleva un
-- comentario que dice que no usa `food_cost_status` «porque sale 'no_target' en
-- toda la cuenta»: ese motivo deja de ser cierto hoy y se corrige en el lote de
-- front, no aqui.

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
      -- ANTES: ROUND(mi.price * (1 + mi.vat_rate / 100), 4)
      mi.price                                AS price_with_vat,
      mi.consumption_price AS consumption_price,
      COALESCE(bcr.commission_pct,   cr.commission_pct)   AS commission_pct,
      COALESCE(bcr.commission_fixed, cr.commission_fixed) AS commission_fixed,
      COALESCE(bcr.commission_base,  cr.commission_base)  AS commission_base,
      COALESCE(bcr.own_courier_cost, cr.own_courier_cost) AS own_courier_cost,
      bla.revenue_share_pct      AS revenue_share_pct,
      bla.reimburses_consumption AS reimburses_consumption,
      -- EL OBJETIVO DEL PLATO MANDA SOBRE EL DE LA CUENTA (B79 3.11,
      -- 06/09/2026). 8 platos de Foodint tenian el suyo puesto a mano desde la
      -- pestana Ficha y esta funcion no lo miraba: leia solo el de la cuenta,
      -- que esta a NULL en las tres cuentas. Ocho decisiones sin efecto.
      COALESCE(mi.target_food_cost_pct, ks.target_food_cost_pct) AS target_food_cost_pct,
      -- El de COSTE DE PLATO no lleva COALESCE: `menu_item` no tiene esa
      -- columna (comprobado en information_schema, 06/09/2026). Sigue siendo
      -- de la cuenta.
      ks.target_plate_cost_pct   AS target_plate_cost_pct
    FROM menu_item mi
    JOIN brand b          ON b.id = mi.brand_id
    LEFT JOIN sales_channel sc ON sc.id = mi.channel_id
    LEFT JOIN recipe_item ri   ON ri.id = mi.recipe_item_id
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
  -- B79 3.11 (06/09/2026): el objetivo PROPIO del plato, si lo tiene.
  v_target_own      numeric;
  v_items_per_order numeric := 2;
BEGIN
  SELECT mi.account_id, mi.brand_id, mi.recipe_item_id, mi.price, COALESCE(mi.vat_rate, 0),
         mi.target_food_cost_pct
    INTO v_account_id, v_brand_id, v_recipe_item_id, v_base_price, v_vat,
         v_target_own
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

  -- EL OBJETIVO DEL PLATO MANDA SOBRE EL DE LA CUENTA (B79 3.11).
  -- Va DESPUES del SELECT y no dentro de el a proposito: si la cuenta no
  -- tiene fila en kitchen_settings, un `SELECT ... INTO` sin filas NO asigna
  -- nada, y meter el COALESCE dentro dejaria sin objetivo a un plato que si
  -- lo tiene. Asi el del plato sobrevive a que la cuenta no tenga fila.
  v_target := COALESCE(v_target_own, v_target);

  -- El objetivo de COSTE DE PLATO no se toca: `menu_item` no tiene columna
  -- para el (comprobado en information_schema, 06/09/2026), asi que sigue
  -- siendo solo de la cuenta. Si algun dia la tiene, este es su sitio.

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
      -- eff_price YA es el precio que paga el cliente.
      eff.eff_price                              AS pvp_bruto,
      -- Sin ROUND intermedio: se redondea solo en la salida.
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
      -- 'pvp_sin_iva' comisiona sobre el NETO, cualquier otro sobre el BRUTO.
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
    ROUND(f.ingreso_neto - (CASE WHEN v_cost_avail THEN v_cost ELSE 0 END) - COALESCE(f.commission_amount, 0), 2) AS contribution_margin,
    CASE WHEN f.ingreso_neto > 0
         THEN ROUND((f.ingreso_neto - (CASE WHEN v_cost_avail THEN v_cost ELSE 0 END) - COALESCE(f.commission_amount, 0)) / f.ingreso_neto * 100, 2) END AS contribution_margin_pct,
    ROUND(f.ingreso_neto - (CASE WHEN v_cost_avail THEN v_cost ELSE 0 END) - COALESCE(f.commission_amount, 0) - COALESCE(f.order_costs_per_item, 0), 2) AS net_margin,
    CASE WHEN f.ingreso_neto > 0
         THEN ROUND((f.ingreso_neto - (CASE WHEN v_cost_avail THEN v_cost ELSE 0 END) - COALESCE(f.commission_amount, 0) - COALESCE(f.order_costs_per_item, 0)) / f.ingreso_neto * 100, 2) END AS net_margin_pct,
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
