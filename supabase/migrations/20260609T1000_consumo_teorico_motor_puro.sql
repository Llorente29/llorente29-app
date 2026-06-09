-- =====================================================================
-- 20260609T1000_consumo_teorico_motor_puro.sql
-- Aplicada: __________  (rellenar al aplicar)
--
-- MOTOR DE CONSUMO TEORICO (Tramo 1 — SQL puro, sin repo ni UI).
-- Gemelo estructural de compute_sale_line_cost: misma travesia
-- (product -> combo_item -> modifier 'confirmed'), misma aritmetica de
-- impact_type (add/remove/multiply/bundle/replace), misma conversion de
-- unidades; pero emite CANTIDADES de raw (no euros) y las escribe como
-- movimientos de salida en stock_movement.
--
-- PARIDAD POR CONSTRUCCION: el primitivo explode_recipe_to_raws(item, mult)
-- espeja kitchen_recompute_item EXACTAMENTE (misma _qty_in_base, NO divide
-- por yield, igual que el coste). Por induccion:
--   Sum( raw.cost * explode(item,1) ) == item.computed_cost
-- => Sum( raw.cost * |qty_base de los movimientos| ) == sale_line.computed_cost
-- El consumo solo se escribe cuando sale_line.computed_cost IS NOT NULL
-- (cobertura de consumo == cobertura de coste; las lineas "ciegas" no
-- consumen, igual que no costean).
--
-- FRONTERA UNICA (principio rector 5): el MOTOR es puro (sin guard de
-- usuario); la unica entrada con guard es recompute_sales_consumption
-- (frontera de la app). El webhook (frontera de TPV, service_role) llama
-- a compute_sale_line_consumption por venta. DEUDA (misma del motor de
-- coste, ya declarada): las funciones puras tienen EXECUTE PUBLIC por
-- defecto; norte = migrar las entradas app a Edge.
--
-- IDEMPOTENTE: cada (re)calculo de una linea borra sus movimientos
-- previos (source_type='sale', source_id=sale_line.id, movement_type=
-- 'consumo') y reescribe. El backfill no duplica. NOTA: source_type='sale'
-- es el valor del CHECK stock_movement_source_valid; la granularidad por
-- LINEA vive en source_id (= sale_line.id), no en source_type.
--
-- DEUDA DECLARADA (no del consumo): kitchen_recompute_item NO divide por
-- yield_portions. Con escandallos planos (Llorente29: 673 lineas a raw, 0
-- anidamiento) no afecta. Para cocina central con preparaciones autoradas
-- POR LOTE, el coste se inflaria x tamano-de-lote; el consumo lo espeja
-- (paridad intacta). DISPARADOR: primera preparacion anidada autorada por
-- lote -> fijar convencion de autorado en el motor de coste.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) _qty_in_base: conversion (cantidad, unidad) -> cantidad en unidad
--    base del item objetivo. CLONADA VERBATIM de la logica de
--    kitchen_recompute_item / _impact_cost. NULL = no convertible (no
--    inventa), igual que el coste trata esas lineas como 0.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._qty_in_base(
  p_target_item_id uuid,
  p_quantity       numeric,
  p_unit_id        uuid
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_child           recipe_item%ROWTYPE;
  v_line_unit       kitchen_unit%ROWTYPE;
  v_child_base_unit kitchen_unit%ROWTYPE;
  v_conv            numeric;
BEGIN
  IF p_target_item_id IS NULL OR p_quantity IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_child FROM recipe_item WHERE id = p_target_item_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_line_unit       FROM kitchen_unit WHERE id = p_unit_id;
  SELECT * INTO v_child_base_unit FROM kitchen_unit WHERE id = v_child.base_unit_id;
  IF v_line_unit.id IS NULL OR v_child_base_unit.id IS NULL THEN RETURN NULL; END IF;

  IF v_line_unit.dimension = v_child_base_unit.dimension THEN
    RETURN p_quantity * v_line_unit.factor_to_base / v_child_base_unit.factor_to_base;
  ELSE
    SELECT qty_in_base INTO v_conv
      FROM recipe_item_unit_conversion
      WHERE item_id = v_child.id AND from_unit_id = p_unit_id
      LIMIT 1;
    IF v_conv IS NOT NULL THEN
      RETURN p_quantity * v_conv;
    ELSE
      RETURN NULL;  -- no convertible -> sin contribucion (honesto)
    END IF;
  END IF;
END;
$$;


-- ---------------------------------------------------------------------
-- 2) explode_recipe_to_raws: explosion RECURSIVA de un item a sus raws,
--    en unidad base, escalada por p_multiplier (que ya viene en unidades
--    base del item). Usa quantity_gross (lo que se paga). Espeja el coste.
--    PARADA: raw/tool, O preparacion stockable (is_stockable). Una
--    preparacion stockable ya consumio sus raws al producirse -> se
--    descuenta ELLA MISMA (su base unit), no se vuelve a estallar (evita
--    doble conteo). Hoy is_stockable=0 en todo -> baja a raws siempre.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.explode_recipe_to_raws(
  p_item_id    uuid,
  p_multiplier numeric
) RETURNS TABLE (raw_item_id uuid, qty_base numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item recipe_item%ROWTYPE;
  v_line recipe_line%ROWTYPE;
  v_qb   numeric;
BEGIN
  IF p_item_id IS NULL OR p_multiplier IS NULL THEN RETURN; END IF;
  SELECT * INTO v_item FROM recipe_item WHERE id = p_item_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Condicion de parada: hoja del arbol de consumo.
  IF v_item.type IN ('raw', 'tool')
     OR (v_item.type = 'recipe' AND COALESCE(v_item.is_stockable, false)) THEN
    raw_item_id := p_item_id;
    qty_base    := p_multiplier;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Nodo compuesto (recipe no-stockable o dish): recurrir por cada linea.
  FOR v_line IN
    SELECT * FROM recipe_line WHERE parent_item_id = p_item_id
    ORDER BY position ASC, created_at ASC
  LOOP
    v_qb := public._qty_in_base(
              v_line.child_item_id,
              COALESCE(v_line.quantity_gross, v_line.quantity_net),
              v_line.unit_id);
    IF v_qb IS NULL THEN
      CONTINUE;  -- no convertible -> 0, exactamente como el coste
    END IF;
    RETURN QUERY
      SELECT * FROM public.explode_recipe_to_raws(v_line.child_item_id, p_multiplier * v_qb);
  END LOOP;
  RETURN;
END;
$$;


-- ---------------------------------------------------------------------
-- 3) _sale_line_raw_consumption: contribuciones de raw (CON SIGNO, sin
--    netear, ya escaladas por todas las cantidades) de UNA linea
--    'product'. Replica la travesia de compute_sale_line_cost:
--      - product simple: base + modificadores (confirmados) de la linea.
--      - combo: por cada combo_item hijo, su base + sus modificadores,
--        x cantidad del hijo; todo x cantidad de la linea.
--    multiply = escalar la base del plato/hijo por (quantity-1) (igual
--    que el coste: v_base_cost*(q-1)). El neteo (p.ej. "sin queso" deja
--    el queso a 0) lo hace el consumidor al agregar.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._sale_line_raw_consumption(
  p_sale_line_id uuid
) RETURNS TABLE (raw_item_id uuid, qty_base numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line     sale_line%ROWTYPE;
  v_is_combo boolean := false;
  v_qty      numeric;
BEGIN
  SELECT * INTO v_line FROM sale_line WHERE id = p_sale_line_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF COALESCE(v_line.line_type, 'product') <> 'product' THEN
    RETURN;  -- modifier/combo_item no conducen; lo hace su padre product
  END IF;
  v_qty := COALESCE(v_line.quantity, 1);

  SELECT EXISTS (
    SELECT 1 FROM sale_line c
    WHERE c.parent_sale_line_id = p_sale_line_id AND c.line_type = 'combo_item'
  ) INTO v_is_combo;

  IF v_is_combo THEN
    -- --- COMBO: base de cada hijo ---
    RETURN QUERY
    SELECT e.raw_item_id, e.qty_base * COALESCE(c.quantity, 1) * v_qty
    FROM sale_line c
    JOIN menu_item mi ON mi.id = c.menu_item_id
    CROSS JOIN LATERAL public.explode_recipe_to_raws(mi.recipe_item_id, 1) e
    WHERE c.parent_sale_line_id = p_sale_line_id AND c.line_type = 'combo_item';

    -- modificadores de hijo: add / bundle / replace (+)
    RETURN QUERY
    SELECT e.raw_item_id, e.qty_base * COALESCE(c.quantity, 1) * v_qty
    FROM sale_line c
    JOIN sale_line m ON m.parent_sale_line_id = c.id AND m.line_type = 'modifier'
    JOIN modifier_recipe_impact mri
         ON mri.modifier_option_id = m.modifier_option_id AND mri.status = 'confirmed'
    CROSS JOIN LATERAL public.explode_recipe_to_raws(
         mri.target_recipe_item_id,
         public._qty_in_base(mri.target_recipe_item_id, mri.quantity * COALESCE(m.quantity, 1), mri.unit_id)) e
    WHERE c.parent_sale_line_id = p_sale_line_id AND c.line_type = 'combo_item'
      AND mri.impact_type IN ('add_item', 'bundle', 'replace_item');

    -- modificadores de hijo: remove (-)
    RETURN QUERY
    SELECT e.raw_item_id, - e.qty_base * COALESCE(c.quantity, 1) * v_qty
    FROM sale_line c
    JOIN sale_line m ON m.parent_sale_line_id = c.id AND m.line_type = 'modifier'
    JOIN modifier_recipe_impact mri
         ON mri.modifier_option_id = m.modifier_option_id AND mri.status = 'confirmed'
    CROSS JOIN LATERAL public.explode_recipe_to_raws(
         mri.target_recipe_item_id,
         public._qty_in_base(mri.target_recipe_item_id, mri.quantity * COALESCE(m.quantity, 1), mri.unit_id)) e
    WHERE c.parent_sale_line_id = p_sale_line_id AND c.line_type = 'combo_item'
      AND mri.impact_type = 'remove_item';

    -- modificadores de hijo: multiply (escala la base del hijo x (q-1))
    RETURN QUERY
    SELECT e.raw_item_id, e.qty_base * (COALESCE(mri.quantity, 1) - 1) * COALESCE(c.quantity, 1) * v_qty
    FROM sale_line c
    JOIN menu_item mi ON mi.id = c.menu_item_id
    JOIN sale_line m ON m.parent_sale_line_id = c.id AND m.line_type = 'modifier'
    JOIN modifier_recipe_impact mri
         ON mri.modifier_option_id = m.modifier_option_id AND mri.status = 'confirmed'
            AND mri.impact_type = 'multiply'
    CROSS JOIN LATERAL public.explode_recipe_to_raws(mi.recipe_item_id, 1) e
    WHERE c.parent_sale_line_id = p_sale_line_id AND c.line_type = 'combo_item';

  ELSE
    -- --- PRODUCT simple: base del plato ---
    RETURN QUERY
    SELECT e.raw_item_id, e.qty_base * v_qty
    FROM menu_item mi
    CROSS JOIN LATERAL public.explode_recipe_to_raws(mi.recipe_item_id, 1) e
    WHERE mi.id = v_line.menu_item_id;

    -- modificadores de la linea: add / bundle / replace (+)
    RETURN QUERY
    SELECT e.raw_item_id, e.qty_base * v_qty
    FROM sale_line m
    JOIN modifier_recipe_impact mri
         ON mri.modifier_option_id = m.modifier_option_id AND mri.status = 'confirmed'
    CROSS JOIN LATERAL public.explode_recipe_to_raws(
         mri.target_recipe_item_id,
         public._qty_in_base(mri.target_recipe_item_id, mri.quantity * COALESCE(m.quantity, 1), mri.unit_id)) e
    WHERE m.parent_sale_line_id = p_sale_line_id AND m.line_type = 'modifier'
      AND mri.impact_type IN ('add_item', 'bundle', 'replace_item');

    -- modificadores de la linea: remove (-)
    RETURN QUERY
    SELECT e.raw_item_id, - e.qty_base * v_qty
    FROM sale_line m
    JOIN modifier_recipe_impact mri
         ON mri.modifier_option_id = m.modifier_option_id AND mri.status = 'confirmed'
    CROSS JOIN LATERAL public.explode_recipe_to_raws(
         mri.target_recipe_item_id,
         public._qty_in_base(mri.target_recipe_item_id, mri.quantity * COALESCE(m.quantity, 1), mri.unit_id)) e
    WHERE m.parent_sale_line_id = p_sale_line_id AND m.line_type = 'modifier'
      AND mri.impact_type = 'remove_item';

    -- modificadores de la linea: multiply (escala la base x (q-1))
    RETURN QUERY
    SELECT e.raw_item_id, e.qty_base * (COALESCE(mri.quantity, 1) - 1) * v_qty
    FROM sale_line m
    JOIN modifier_recipe_impact mri
         ON mri.modifier_option_id = m.modifier_option_id AND mri.status = 'confirmed'
            AND mri.impact_type = 'multiply'
    JOIN menu_item mi ON mi.id = v_line.menu_item_id
    CROSS JOIN LATERAL public.explode_recipe_to_raws(mi.recipe_item_id, 1) e
    WHERE m.parent_sale_line_id = p_sale_line_id AND m.line_type = 'modifier';
  END IF;
  RETURN;
END;
$$;


-- ---------------------------------------------------------------------
-- 4) recompute_location_stock: SPLIT en nucleo PURO + wrapper con guard.
--    El nucleo (sin guard) lo usa el motor de consumo en batch/servicio
--    (auth.uid() null no lo revienta). El wrapper conserva FIRMA y guard
--    exactos -> apply_inventory_count / confirm_goods_receipt /
--    void_goods_receipt siguen llamandolo sin cambios.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_location_stock_core(
  p_item_id     uuid,
  p_location_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_account_id uuid;
  v_qty        numeric;
  v_value      numeric;
  v_avg        numeric;
BEGIN
  SELECT account_id INTO v_account_id FROM recipe_item WHERE id = p_item_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'recompute_location_stock_core: item % no existe', p_item_id;
  END IF;
  -- Suma con signo del ledger: qty_base ya es + (entra) / - (sale).
  SELECT
    COALESCE(SUM(qty_base), 0),
    COALESCE(SUM(qty_base * COALESCE(unit_cost, 0)), 0)
  INTO v_qty, v_value
  FROM stock_movement
  WHERE recipe_item_id = p_item_id
    AND location_id    = p_location_id;
  IF abs(v_qty) < 0.0000001 THEN
    v_qty   := 0;
    v_value := 0;
  END IF;
  v_avg := CASE WHEN v_qty > 0 THEN v_value / v_qty ELSE NULL END;
  INSERT INTO recipe_item_location_stock
    (account_id, recipe_item_id, location_id, qty_on_hand, avg_unit_cost, stock_value, updated_at)
  VALUES
    (v_account_id, p_item_id, p_location_id, v_qty, v_avg, v_value, now())
  ON CONFLICT (recipe_item_id, location_id) DO UPDATE
    SET qty_on_hand   = EXCLUDED.qty_on_hand,
        avg_unit_cost = EXCLUDED.avg_unit_cost,
        stock_value   = EXCLUDED.stock_value,
        updated_at    = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_location_stock(
  p_item_id     uuid,
  p_location_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_account_id uuid;
BEGIN
  SELECT account_id INTO v_account_id FROM recipe_item WHERE id = p_item_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'recompute_location_stock: item % no existe', p_item_id;
  END IF;
  IF NOT (current_user_is_admin()
          OR current_user_is_admin_or_manager_of(v_account_id)) THEN
    RAISE EXCEPTION 'recompute_location_stock: sin acceso al item %', p_item_id;
  END IF;
  PERFORM public.recompute_location_stock_core(p_item_id, p_location_id);
END;
$$;


-- ---------------------------------------------------------------------
-- 5) compute_sale_line_consumption: motor PURO por linea de venta.
--    Idempotente (borra+reescribe por source). Solo escribe si la linea
--    es 'product', tiene local y tiene computed_cost (paridad con coste).
--    qty_base NEGATIVO (salida). unit_cost SELLADO (coste del raw ahora).
--    Recalcula el stock de cada (raw, local) tocado (viejos + nuevos).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_sale_line_consumption(
  p_sale_line_id uuid
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line      sale_line%ROWTYPE;
  v_loc       uuid;
  v_sold_at   timestamptz;
  v_old_items uuid[];
  v_new_items uuid[];
  v_written   integer := 0;
  v_item      uuid;
BEGIN
  SELECT * INTO v_line FROM sale_line WHERE id = p_sale_line_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT location_id, sold_at INTO v_loc, v_sold_at FROM sale WHERE id = v_line.sale_id;

  -- Items afectados por movimientos PREVIOS de esta linea (para recalcular
  -- aunque ahora consuma raws distintos).
  -- NOTA: source_type='sale' (valor del CHECK stock_movement_source_valid;
  -- no existe 'sale_line'). La granularidad por LINEA vive en source_id
  -- (= sale_line.id), no en source_type.
  v_old_items := ARRAY(
    SELECT DISTINCT recipe_item_id FROM stock_movement
    WHERE source_type = 'sale' AND source_id = p_sale_line_id
      AND movement_type = 'consumo'
  );

  -- Idempotencia: borrar el consumo previo de esta linea.
  DELETE FROM stock_movement
  WHERE source_type = 'sale' AND source_id = p_sale_line_id
    AND movement_type = 'consumo';

  -- Escribir nuevo consumo solo si procede (paridad con el coste).
  IF COALESCE(v_line.line_type, 'product') = 'product'
     AND v_line.computed_cost IS NOT NULL
     AND v_loc IS NOT NULL THEN

    INSERT INTO stock_movement
      (account_id, location_id, recipe_item_id, movement_type, qty_base,
       unit_cost, cost_provisional, source_type, source_id, occurred_at, notes)
    SELECT
      v_line.account_id,
      v_loc,
      t.raw_item_id,
      'consumo',
      - t.net_qty,                                   -- salida = negativo
      COALESCE(ri.computed_cost, ri.fixed_cost, 0),  -- coste sellado del raw
      (ri.computed_cost IS NULL),                    -- provisional si solo hay fixed
      'sale',
      p_sale_line_id,
      COALESCE(v_sold_at, now()),
      'consumo teorico'
    FROM (
      SELECT raw_item_id, SUM(qty_base) AS net_qty
      FROM public._sale_line_raw_consumption(p_sale_line_id)
      GROUP BY raw_item_id
      HAVING SUM(qty_base) > 0.0000001
    ) t
    JOIN recipe_item ri ON ri.id = t.raw_item_id;

    GET DIAGNOSTICS v_written = ROW_COUNT;
  END IF;

  -- Recalcular stock de los (raw, local) tocados (viejos UNION nuevos).
  IF v_loc IS NOT NULL THEN
    v_new_items := ARRAY(
      SELECT DISTINCT recipe_item_id FROM stock_movement
      WHERE source_type = 'sale' AND source_id = p_sale_line_id
        AND movement_type = 'consumo'
    );
    FOR v_item IN
      SELECT DISTINCT x FROM unnest(COALESCE(v_old_items, '{}') || COALESCE(v_new_items, '{}')) AS x
      WHERE x IS NOT NULL
    LOOP
      PERFORM public.recompute_location_stock_core(v_item, v_loc);
    END LOOP;
  END IF;

  RETURN v_written;
END;
$$;


-- ---------------------------------------------------------------------
-- 6) recompute_sales_consumption: FRONTERA de la app (CON guard). Recalcula
--    el consumo de todas las lineas 'product' de una cuenta en un rango.
--    Es la entrada del boton "Recalcular consumo" (sesion valida). El
--    motor por debajo es puro. (DEUDA: redundancia de recompute por linea
--    aceptable a este volumen; optimizar si una cuenta escala.)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_sales_consumption(
  p_account_id uuid,
  p_from       timestamptz DEFAULT NULL,
  p_to         timestamptz DEFAULT NULL
) RETURNS TABLE (lines_processed integer, movements_written integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line_id uuid;
  v_lines   integer := 0;
  v_moves   integer := 0;
BEGIN
  IF NOT (current_user_is_admin()
          OR current_user_is_admin_or_manager_of(p_account_id)) THEN
    RAISE EXCEPTION 'recompute_sales_consumption: sin acceso a la cuenta %', p_account_id;
  END IF;

  FOR v_line_id IN
    SELECT sl.id
    FROM sale_line sl
    JOIN sale s ON s.id = sl.sale_id
    WHERE sl.account_id = p_account_id
      AND COALESCE(sl.line_type, 'product') = 'product'
      AND (p_from IS NULL OR s.sold_at >= p_from)
      AND (p_to   IS NULL OR s.sold_at <  p_to)
  LOOP
    v_moves := v_moves + public.compute_sale_line_consumption(v_line_id);
    v_lines := v_lines + 1;
  END LOOP;

  lines_processed   := v_lines;
  movements_written := v_moves;
  RETURN NEXT;
END;
$$;
