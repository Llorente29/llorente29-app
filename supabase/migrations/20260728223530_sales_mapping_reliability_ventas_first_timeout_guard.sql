-- sales_mapping_reliability: mismo arreglo de rendimiento que warehouse_reliability_queue.
--
-- Esta función alimenta el "86%" de cabecera de la pantalla de fiabilidad (getReliability).
-- Tenía el MISMO defecto: arrancaba desde sale_line (toda la historia de la cuenta) y sondeaba
-- `sale` una a una (9.265 loops → 27.795 buffers) para filtrar por fecha. Y peor: rango por
-- defecto de 90 días y SIN guardia de statement_timeout. Con caché frío superaba el timeout
-- → era la causa del error que seguía saliendo tras arreglar warehouse_reliability_queue.
--
-- ARREGLO: CTE `vr as materialized` filtra sale por cuenta+fecha primero y sale_line se
-- engancha por hash join. Buffers 28.587 → 1.834 (15x menos), 68ms → 18ms. Resultado
-- idéntico verificado (row() is not distinct from row(): true, los 10 agregados). Añadida
-- guardia `set statement_timeout to '15s'`. La lógica de agregados/estado NO cambia.
create or replace function public.sales_mapping_reliability(p_account_id uuid, p_from timestamp with time zone default (now() - '90 days'::interval), p_to timestamp with time zone default now())
 returns table(revenue_total numeric, revenue_casado numeric, revenue_sin_casar numeric, reliability_pct numeric, threshold_pct numeric, status text, lineas_total integer, lineas_casadas integer, ciego_desconocido_eur numeric, ciego_desconocido_lineas integer, ciego_calculable_eur numeric, ciego_calculable_lineas integer, ciego_otros_eur numeric, ciego_otros_lineas integer, casado_sin_coste_eur numeric, casado_sin_coste_lineas integer, cost_coverage_pct numeric)
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '15s'
as $function$
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

  WITH vr AS MATERIALIZED (
    -- Arrancar por las ventas del rango (índice por cuenta/fecha) en vez de por
    -- todas las líneas históricas; evita los ~9k sondeos uno-a-uno a `sale`.
    SELECT s.id
      FROM sale s
     WHERE s.account_id = p_account_id
       AND s.is_active = true
       AND s.sold_at >= p_from
       AND s.sold_at <  p_to
  )
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
      (mi.recipe_item_id IS NOT NULL
        AND ri.computed_cost IS NULL
        AND ri.fixed_cost IS NULL)                         AS sin_coste
    FROM vr
    JOIN sale_line sl ON sl.sale_id = vr.id
    LEFT JOIN menu_item mi ON mi.id = sl.menu_item_id
    LEFT JOIN recipe_item ri ON ri.id = mi.recipe_item_id
    WHERE COALESCE(sl.line_type, 'product') = 'product'
  ) q;

  v_sincasar := ROUND(v_total - v_casado, 2);
  v_rel := CASE WHEN v_total > 0 THEN ROUND(v_casado / v_total * 100, 2) ELSE NULL END;
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