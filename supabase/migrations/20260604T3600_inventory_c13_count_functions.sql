-- ============================================================================
-- Folvy Inventario — Capa 1.3: funciones de conteo
-- ============================================================================
-- build_inventory_count: genera las líneas del conteo con snapshot del saldo y
--   clase ABC provisional (por valor de stock). Alcance: por áreas o completo.
-- close_inventory_count: calcula variación/% /€ por línea vs tolerancia ABC,
--   pasa la cabecera a 'en_revision', devuelve resumen.
--
-- SECURITY DEFINER (escriben con permisos). Se ejecutan DESDE LA APP.
-- NO escriben en stock_movement (eso es 1.4 al aprobar). Solo diagnostican.
-- DDL sin BEGIN/COMMIT.
-- ============================================================================

-- ── build_inventory_count: generar la hoja ─────────────────────────────────
create or replace function public.build_inventory_count(
  p_count_id uuid,
  p_area_ids uuid[] default null,   -- null + p_full=false → todos los artículos asignados a alguna área del local
  p_full boolean default false      -- true → todos los raws con stock o asignados, del local
)
returns integer                      -- nº de líneas generadas
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_account_id uuid;
  v_location_id uuid;
  v_n integer := 0;
  v_p90 numeric;
  v_p50 numeric;
BEGIN
  SELECT account_id, location_id INTO v_account_id, v_location_id
    FROM public.inventory_count WHERE id = p_count_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'build_inventory_count: conteo % no existe', p_count_id;
  END IF;

  -- Limpiar líneas previas (idempotente: re-generar reemplaza).
  DELETE FROM public.inventory_count_line WHERE inventory_count_id = p_count_id;

  -- Umbrales ABC provisionales por valor de stock (qty_on_hand × avg_unit_cost)
  -- del local: percentil 90 → 'A', 50–90 → 'B', <50 → 'C'. Simple y suficiente
  -- para la capa 1; el ABC fino (rotación/anomalías) llega con el autoinventario.
  SELECT
    percentile_cont(0.90) WITHIN GROUP (ORDER BY COALESCE(qty_on_hand,0)*COALESCE(avg_unit_cost,0)),
    percentile_cont(0.50) WITHIN GROUP (ORDER BY COALESCE(qty_on_hand,0)*COALESCE(avg_unit_cost,0))
  INTO v_p90, v_p50
  FROM public.recipe_item_location_stock
  WHERE account_id = v_account_id AND location_id = v_location_id;

  -- Insertar líneas según alcance.
  INSERT INTO public.inventory_count_line (
    account_id, inventory_count_id, recipe_item_id, storage_area_id, position,
    system_qty, counted_qty, abc_class
  )
  SELECT
    v_account_id,
    p_count_id,
    ri.id,
    risa.storage_area_id,
    COALESCE(sa.position, 9999) * 1000 + COALESCE(risa.position, 999),
    COALESCE(ril.qty_on_hand, 0),
    NULL,
    CASE
      WHEN v_p90 IS NULL OR COALESCE(ril.avg_unit_cost,0) = 0 THEN NULL
      WHEN COALESCE(ril.qty_on_hand,0)*COALESCE(ril.avg_unit_cost,0) >= v_p90 THEN 'A'
      WHEN COALESCE(ril.qty_on_hand,0)*COALESCE(ril.avg_unit_cost,0) >= v_p50 THEN 'B'
      ELSE 'C'
    END
  FROM public.recipe_item ri
  LEFT JOIN public.recipe_item_storage_area risa
    ON risa.recipe_item_id = ri.id AND risa.account_id = v_account_id
  LEFT JOIN public.storage_area sa
    ON sa.id = risa.storage_area_id AND sa.location_id = v_location_id
  LEFT JOIN public.recipe_item_location_stock ril
    ON ril.recipe_item_id = ri.id AND ril.location_id = v_location_id AND ril.account_id = v_account_id
  WHERE ri.account_id = v_account_id
    AND ri.type = 'raw'
    AND ri.is_active = true
    AND (
      p_full = true
      OR (p_area_ids IS NOT NULL AND risa.storage_area_id = ANY(p_area_ids))
      OR (p_area_ids IS NULL AND p_full = false AND sa.id IS NOT NULL)
    );

  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.inventory_count
    SET status = 'contando', started_at = COALESCE(started_at, now()), updated_at = now()
    WHERE id = p_count_id;

  RETURN v_n;
END;
$$;

-- ── close_inventory_count: calcular variación y tolerancia ──────────────────
create or replace function public.close_inventory_count(p_count_id uuid)
returns table (
  lines_total integer,
  lines_counted integer,
  lines_ok integer,
  lines_out integer,
  lines_uncounted integer,
  total_variance_value numeric
)
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_account_id uuid;
  v_location_id uuid;
  v_tol_a numeric; v_tol_b numeric; v_tol_c numeric;
BEGIN
  SELECT account_id, location_id INTO v_account_id, v_location_id
    FROM public.inventory_count WHERE id = p_count_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'close_inventory_count: conteo % no existe', p_count_id;
  END IF;

  SELECT COALESCE(tol_a_pct,2), COALESCE(tol_b_pct,3), COALESCE(tol_c_pct,5)
    INTO v_tol_a, v_tol_b, v_tol_c
    FROM public.supply_settings WHERE account_id = v_account_id;
  v_tol_a := COALESCE(v_tol_a,2); v_tol_b := COALESCE(v_tol_b,3); v_tol_c := COALESCE(v_tol_c,5);

  -- Calcular variación por línea contada. avg_unit_cost del snapshot de stock.
  UPDATE public.inventory_count_line l
  SET
    variance_qty = l.counted_qty - l.system_qty,
    variance_pct = CASE WHEN COALESCE(l.system_qty,0) <> 0
                        THEN (l.counted_qty - l.system_qty) / l.system_qty * 100
                        ELSE NULL END,
    variance_value = (l.counted_qty - l.system_qty) * COALESCE(ril.avg_unit_cost, 0),
    within_tolerance = CASE
      WHEN l.counted_qty IS NULL THEN NULL
      WHEN COALESCE(l.system_qty,0) = 0 THEN (l.counted_qty = 0)
      ELSE abs((l.counted_qty - l.system_qty) / l.system_qty * 100) <=
           CASE l.abc_class WHEN 'A' THEN v_tol_a WHEN 'B' THEN v_tol_b ELSE v_tol_c END
    END
  FROM public.recipe_item_location_stock ril
  WHERE l.inventory_count_id = p_count_id
    AND ril.recipe_item_id = l.recipe_item_id
    AND ril.location_id = v_location_id
    AND ril.account_id = v_account_id;

  -- Líneas sin snapshot de stock (avg_unit_cost no encontrado): variación sin €.
  UPDATE public.inventory_count_line l
  SET
    variance_qty = l.counted_qty - l.system_qty,
    variance_pct = CASE WHEN COALESCE(l.system_qty,0) <> 0
                        THEN (l.counted_qty - l.system_qty) / l.system_qty * 100
                        ELSE NULL END,
    variance_value = 0,
    within_tolerance = CASE
      WHEN l.counted_qty IS NULL THEN NULL
      WHEN COALESCE(l.system_qty,0) = 0 THEN (l.counted_qty = 0)
      ELSE abs((l.counted_qty - l.system_qty) / l.system_qty * 100) <=
           CASE l.abc_class WHEN 'A' THEN v_tol_a WHEN 'B' THEN v_tol_b ELSE v_tol_c END
    END
  WHERE l.inventory_count_id = p_count_id
    AND l.counted_qty IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.recipe_item_location_stock ril
      WHERE ril.recipe_item_id = l.recipe_item_id
        AND ril.location_id = v_location_id AND ril.account_id = v_account_id
    );

  UPDATE public.inventory_count
    SET status = 'en_revision', closed_at = now(), updated_at = now()
    WHERE id = p_count_id;

  RETURN QUERY
  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE counted_qty IS NOT NULL)::integer,
    COUNT(*) FILTER (WHERE counted_qty IS NOT NULL AND within_tolerance = true)::integer,
    COUNT(*) FILTER (WHERE counted_qty IS NOT NULL AND within_tolerance = false)::integer,
    COUNT(*) FILTER (WHERE counted_qty IS NULL)::integer,
    COALESCE(SUM(variance_value) FILTER (WHERE counted_qty IS NOT NULL), 0)
  FROM public.inventory_count_line
  WHERE inventory_count_id = p_count_id;
END;
$$;
