-- 20260608T1800_reliability_casado_sin_coste.sql
-- Aplicada: 2026-06-08
--
-- Mecanismo de avisos de "productos sin coste" (paso 2 del frente modelo de producto).
-- Amplía sales_mapping_reliability con la medida CASADO PERO SIN COSTE: una línea
-- casada (menu_item_id not null) cuyo recipe_item asociado no tiene coste
-- (computed_cost y fixed_cost ambos NULL) = dinero vendido cuyo food cost es
-- desconocido. Al convertir una bebida a reventa SIN coste, la venta deja de estar
-- ciega por casado pero sigue sin coste: la señal debe seguir marcándola, no mentir.
--
-- Compatibilidad: se AÑADEN columnas al final (los consumidores leen por nombre, no
-- por posición). No se toca ninguna columna existente ni la lógica del % de casado.
-- DROP previo porque cambia la firma de RETURN TABLE.

BEGIN;

DROP FUNCTION IF EXISTS public.sales_mapping_reliability(uuid, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.sales_mapping_reliability(
  p_account_id uuid,
  p_from timestamptz DEFAULT (now() - interval '90 days'),
  p_to   timestamptz DEFAULT now()
)
RETURNS TABLE(
  revenue_total numeric, revenue_casado numeric, revenue_sin_casar numeric,
  reliability_pct numeric, threshold_pct numeric, status text,
  lineas_total integer, lineas_casadas integer,
  ciego_desconocido_eur numeric, ciego_desconocido_lineas integer,
  ciego_calculable_eur numeric, ciego_calculable_lineas integer,
  ciego_otros_eur numeric, ciego_otros_lineas integer,
  -- NUEVO: casado pero sin coste (food cost desconocido)
  casado_sin_coste_eur numeric, casado_sin_coste_lineas integer,
  cost_coverage_pct numeric    -- % del CASADO que SÍ tiene coste
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
  v_scost_eur  numeric := 0;
  v_scost_lin  integer := 0;
  v_cov        numeric := NULL;
BEGIN
  IF NOT (public.current_user_is_admin()
          OR public.current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'sales_mapping_reliability: sin acceso a la cuenta %', p_account_id;
  END IF;

  SELECT COALESCE(ks.reliability_min_pct, 90)
  INTO v_thr
  FROM kitchen_settings ks
  WHERE ks.account_id = p_account_id;
  v_thr := COALESCE(v_thr, 90);

  SELECT
    COALESCE(SUM(amt), 0),
    COALESCE(SUM(amt) FILTER (WHERE casado), 0),
    COUNT(*),
    COUNT(*) FILTER (WHERE casado),
    COALESCE(SUM(amt) FILTER (WHERE NOT casado AND reason = 'no_recipe'), 0),
    COUNT(*)          FILTER (WHERE NOT casado AND reason = 'no_recipe'),
    COALESCE(SUM(amt) FILTER (WHERE NOT casado AND reason = 'no_menu_item'), 0),
    COUNT(*)          FILTER (WHERE NOT casado AND reason = 'no_menu_item'),
    COALESCE(SUM(amt) FILTER (WHERE NOT casado
                                AND COALESCE(reason,'') NOT IN ('no_recipe','no_menu_item')), 0),
    COUNT(*)          FILTER (WHERE NOT casado
                                AND COALESCE(reason,'') NOT IN ('no_recipe','no_menu_item')),
    -- NUEVO: casado y sin coste (vendible cuyo recipe_item no tiene ni computed ni fixed)
    COALESCE(SUM(amt) FILTER (WHERE casado AND sin_coste), 0),
    COUNT(*)          FILTER (WHERE casado AND sin_coste)
  INTO v_total, v_casado, v_lin_tot, v_lin_cas,
       v_desc_eur, v_desc_lin, v_calc_eur, v_calc_lin, v_otros_eur, v_otros_lin,
       v_scost_eur, v_scost_lin
  FROM (
    SELECT
      COALESCE(sl.line_total, sl.unit_price * sl.quantity) AS amt,
      (sl.menu_item_id IS NOT NULL)                        AS casado,
      sl.unmapped_reason                                   AS reason,
      -- sin_coste: la línea está casada a un menu_item cuyo recipe_item no tiene coste
      (mi.recipe_item_id IS NOT NULL
        AND ri.computed_cost IS NULL
        AND ri.fixed_cost IS NULL)                         AS sin_coste
    FROM sale_line sl
    JOIN sale s ON s.id = sl.sale_id
    LEFT JOIN menu_item mi ON mi.id = sl.menu_item_id
    LEFT JOIN recipe_item ri ON ri.id = mi.recipe_item_id
    WHERE sl.account_id = p_account_id
      AND s.is_active = true
      AND COALESCE(sl.line_type, 'product') = 'product'
      AND s.sold_at >= p_from
      AND s.sold_at <  p_to
  ) q;

  v_sincasar := ROUND(v_total - v_casado, 2);
  v_rel := CASE WHEN v_total > 0 THEN ROUND(v_casado / v_total * 100, 2) ELSE NULL END;
  -- cobertura de coste: del dinero CASADO, cuánto SÍ tiene coste conocido
  v_cov := CASE WHEN v_casado > 0
                THEN ROUND((v_casado - v_scost_eur) / v_casado * 100, 2)
                ELSE NULL END;

  v_status := CASE
    WHEN v_rel IS NULL              THEN 'verde'
    WHEN v_rel >= v_thr             THEN 'verde'
    WHEN v_rel >= (v_thr - 10)      THEN 'ambar'
    ELSE 'rojo'
  END;

  RETURN QUERY SELECT
    ROUND(v_total, 2), ROUND(v_casado, 2), v_sincasar, v_rel, v_thr, v_status,
    v_lin_tot, v_lin_cas,
    ROUND(v_desc_eur, 2), v_desc_lin,
    ROUND(v_calc_eur, 2), v_calc_lin,
    ROUND(v_otros_eur, 2), v_otros_lin,
    ROUND(v_scost_eur, 2), v_scost_lin, v_cov;
END;
$function$;

COMMIT;
