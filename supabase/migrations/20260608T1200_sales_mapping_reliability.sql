-- 20260608T1200_sales_mapping_reliability.sql
-- Aplicada: 2026-06-08
--
-- LA SEÑAL CENTRAL de fiabilidad del casado de ventas (capa 4 del subsistema).
-- La leerán food cost, inventario y compras: "calculado sobre el X% fiable".
--
-- Denominador HONESTO (lo que location_economics NO tiene): casado / TOTAL,
-- incluyendo las líneas sin casar. location_economics.food_cost_coverage_pct mide
-- sobre base casado-only y por eso sobreestima → se arregla en la migración 1300.
--
-- Mide por IMPORTE (line_total), que es la métrica que manda: un food cost ciego en
-- el 8% del dinero ≠ ciego en el 15% de los platos. Separa el no-casado en:
--   no_recipe     → coste DESCONOCIDO (no estimable): el dinero verdaderamente a oscuras.
--   no_menu_item  → tiene receta, coste CALCULABLE (merma fantasma, capa 5).
--   resto de razones (no_brand/ambiguous/...) → agrupado.
-- Esto golea a tspoon, que junta todo en "no vinculado".
--
-- Alcance: line_type='product' (no dobla con modificadores/combos hijos), s.is_active.
-- Cualquier source (la señal es del casado en general; hoy solo hay lastapp, pero NO
-- se cablea a una fuente concreta).
--
-- SECURITY DEFINER + guard de tenancy (igual que location_economics/menu_item_economics).
-- NO probar dentro de esta transacción (auth.uid() null en SQL Editor revienta el guard);
-- verificar desde la app con script autenticado.

BEGIN;

CREATE OR REPLACE FUNCTION public.sales_mapping_reliability(
  p_account_id uuid,
  p_from timestamp with time zone DEFAULT (now() - '90 days'::interval),
  p_to   timestamp with time zone DEFAULT now()
)
RETURNS TABLE(
  revenue_total            numeric,   -- € de todas las líneas product
  revenue_casado           numeric,   -- € de las líneas con menu_item
  revenue_sin_casar        numeric,   -- € sin casar (total - casado)
  reliability_pct          numeric,   -- casado / total * 100 (denominador honesto)
  threshold_pct            numeric,   -- umbral configurado (kitchen_settings)
  status                   text,      -- 'verde' | 'ambar' | 'rojo'
  lineas_total             integer,
  lineas_casadas           integer,
  -- desglose del no-casado, por importe y por líneas
  ciego_desconocido_eur    numeric,   -- no_recipe: coste no estimable
  ciego_desconocido_lineas integer,
  ciego_calculable_eur     numeric,   -- no_menu_item: coste calculable
  ciego_calculable_lineas  integer,
  ciego_otros_eur          numeric,   -- no_brand/ambiguous/null residual/otros
  ciego_otros_lineas       integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total      numeric := 0;
  v_casado     numeric := 0;
  v_sincasar   numeric := 0;
  v_rel        numeric := 0;
  v_thr        numeric;
  v_status     text;
  v_lin_tot    integer := 0;
  v_lin_cas    integer := 0;
  v_desc_eur   numeric := 0;
  v_desc_lin   integer := 0;
  v_calc_eur   numeric := 0;
  v_calc_lin   integer := 0;
  v_otros_eur  numeric := 0;
  v_otros_lin  integer := 0;
BEGIN
  -- Guard de tenancy.
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'sales_mapping_reliability: sin acceso a la cuenta %', p_account_id;
  END IF;

  -- Umbral configurado por cuenta (defecto duro 90 si no hubiera fila).
  SELECT COALESCE(ks.reliability_min_pct, 90)
  INTO v_thr
  FROM kitchen_settings ks
  WHERE ks.account_id = p_account_id;
  v_thr := COALESCE(v_thr, 90);

  -- Agregación única sobre las líneas de producto del periodo.
  SELECT
    COALESCE(SUM(amt), 0),
    COALESCE(SUM(amt) FILTER (WHERE casado), 0),
    COUNT(*),
    COUNT(*) FILTER (WHERE casado),
    -- ciego DESCONOCIDO (no_recipe)
    COALESCE(SUM(amt) FILTER (WHERE NOT casado AND reason = 'no_recipe'), 0),
    COUNT(*)          FILTER (WHERE NOT casado AND reason = 'no_recipe'),
    -- ciego CALCULABLE (no_menu_item)
    COALESCE(SUM(amt) FILTER (WHERE NOT casado AND reason = 'no_menu_item'), 0),
    COUNT(*)          FILTER (WHERE NOT casado AND reason = 'no_menu_item'),
    -- ciego OTROS (todo lo demás sin casar: no_brand, ambiguous, null residual, etc.)
    COALESCE(SUM(amt) FILTER (WHERE NOT casado
                                AND COALESCE(reason,'') NOT IN ('no_recipe','no_menu_item')), 0),
    COUNT(*)          FILTER (WHERE NOT casado
                                AND COALESCE(reason,'') NOT IN ('no_recipe','no_menu_item'))
  INTO v_total, v_casado, v_lin_tot, v_lin_cas,
       v_desc_eur, v_desc_lin, v_calc_eur, v_calc_lin, v_otros_eur, v_otros_lin
  FROM (
    SELECT
      COALESCE(sl.line_total, sl.unit_price * sl.quantity) AS amt,
      (sl.menu_item_id IS NOT NULL)                        AS casado,
      sl.unmapped_reason                                   AS reason
    FROM sale_line sl
    JOIN sale s ON s.id = sl.sale_id
    WHERE sl.account_id = p_account_id
      AND s.is_active = true
      AND COALESCE(sl.line_type, 'product') = 'product'
      AND s.sold_at >= p_from
      AND s.sold_at <  p_to
  ) q;

  v_sincasar := ROUND(v_total - v_casado, 2);
  v_rel := CASE WHEN v_total > 0 THEN ROUND(v_casado / v_total * 100, 2) ELSE NULL END;

  v_status := CASE
    WHEN v_rel IS NULL              THEN 'verde'   -- sin ventas en el periodo: nada que casar
    WHEN v_rel >= v_thr             THEN 'verde'
    WHEN v_rel >= (v_thr - 10)      THEN 'ambar'   -- hasta 10 puntos por debajo del umbral
    ELSE 'rojo'
  END;

  RETURN QUERY SELECT
    ROUND(v_total, 2), ROUND(v_casado, 2), v_sincasar, v_rel, v_thr, v_status,
    v_lin_tot, v_lin_cas,
    ROUND(v_desc_eur, 2), v_desc_lin,
    ROUND(v_calc_eur, 2), v_calc_lin,
    ROUND(v_otros_eur, 2), v_otros_lin;
END;
$function$;

COMMIT;
