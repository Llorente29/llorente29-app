-- supabase/migrations/20260623T2100_sale_consumption_engine.sql
-- Aplicada: 2026-06-23
--
-- MOTOR DE CONSUMO TEÓRICO (Frente 2 del MRP II).
--
-- PROBLEMA: vender un plato NO descontaba sus ingredientes del stock teórico.
-- El motor de explosión (explode_recipe_to_raws) y el de coste por línea
-- (compute_sale_line_cost) YA EXISTÍAN, pero NADIE los disparaba al entrar las
-- ventas (solo 4 de 4067 líneas tenían coste). Resultado: el teórico estaba
-- congelado y cada inventario descuadraba contra un teórico que no se movía.
--
-- SOLUCIÓN: cuando una venta pasa a 'completed' (estado final real donde acaban casi todas;
-- 'accepted' apenas se usa de paso, 'cancelled' no debe consumir), se explota a
-- sus ingredientes crudos y se escribe un stock_movement 'consumo' por cada uno.
-- El teórico empieza a moverse solo. De aquí en adelante (el histórico no se toca).
--
-- TRAZA: source_type='sale', source_id=sale.id (sale_line no está permitido por
-- el CHECK). Idempotente: antes de escribir, borra los consumos previos de esa
-- venta (por si se reprocesa/reacepta), así nunca duplica.
-- VALORACIÓN: unit_cost = avg_unit_cost del stock por local (coste real ponderado),
-- fallback a recipe_item.computed_cost.
-- Reusa explode_recipe_to_raws (no duplica la lógica de explosión/conversión).

-- ── Genera el consumo de UNA venta (todas sus líneas de producto) ─────────────
CREATE OR REPLACE FUNCTION public.generate_sale_consumption(p_sale_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sale        sale%ROWTYPE;
  v_line        record;
  v_raw         record;
  v_recipe_id   uuid;
  v_unit_cost   numeric;
  v_written     integer := 0;
BEGIN
  SELECT * INTO v_sale FROM sale WHERE id = p_sale_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- IDEMPOTENCIA: borra cualquier consumo previo de esta venta antes de reescribir.
  DELETE FROM stock_movement
  WHERE account_id = v_sale.account_id
    AND movement_type = 'consumo'
    AND source_type = 'sale'
    AND source_id = p_sale_id;

  -- Recorre las líneas de PRODUCTO de la venta (no modifiers/combo_item sueltos:
  -- la línea producto raíz lleva su quantity; los combos se explotan por su receta).
  FOR v_line IN
    SELECT sl.id, sl.menu_item_id, sl.quantity
    FROM sale_line sl
    WHERE sl.sale_id = p_sale_id
      AND COALESCE(sl.line_type, 'product') = 'product'
      AND sl.menu_item_id IS NOT NULL
      AND sl.ignored_at IS NULL
  LOOP
    -- menu_item -> recipe_item (escandallo)
    SELECT mi.recipe_item_id INTO v_recipe_id FROM menu_item mi WHERE mi.id = v_line.menu_item_id;
    IF v_recipe_id IS NULL THEN CONTINUE; END IF;

    -- Explota la receta a crudos, multiplicado por la cantidad vendida.
    FOR v_raw IN
      SELECT raw_item_id, qty_base
      FROM public.explode_recipe_to_raws(v_recipe_id, COALESCE(v_line.quantity, 1))
    LOOP
      IF v_raw.qty_base IS NULL OR v_raw.qty_base = 0 THEN CONTINUE; END IF;

      -- coste unitario: avg del stock por local, fallback computed_cost del raw
      SELECT COALESCE(ric.avg_unit_cost, ri.computed_cost)
        INTO v_unit_cost
      FROM recipe_item ri
      LEFT JOIN recipe_item_location_stock ric
        ON ric.recipe_item_id = ri.id
       AND ric.account_id = v_sale.account_id
       AND ric.location_id = v_sale.location_id
      WHERE ri.id = v_raw.raw_item_id;

      -- movimiento de consumo: cantidad NEGATIVA (sale del stock)
      INSERT INTO stock_movement(
        account_id, location_id, recipe_item_id, movement_type, qty_base,
        unit_cost, source_type, source_id, occurred_at, notes)
      VALUES (
        v_sale.account_id, v_sale.location_id, v_raw.raw_item_id, 'consumo',
        -ABS(v_raw.qty_base),
        v_unit_cost, 'sale', p_sale_id, COALESCE(v_sale.created_at, now()),
        'Consumo por venta');
      v_written := v_written + 1;
    END LOOP;
  END LOOP;

  RETURN v_written;
END;
$function$;

-- ── Trigger: al ACEPTAR la venta, genera su consumo ──────────────────────────
-- Una venta consume stock cuando se COMPLETA (estado final real: 420/7d entran
-- como null y acaban en 'completed'). 'cancelled' NO consume. Solo en la transición.
CREATE OR REPLACE FUNCTION public.tg_sale_consumption_on_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF new.order_status = 'completed'
     AND (old.order_status IS DISTINCT FROM new.order_status) THEN
    PERFORM public.generate_sale_consumption(new.id);
  END IF;
  RETURN new;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sale_consumption_on_complete ON public.sale;
CREATE TRIGGER trg_sale_consumption_on_complete
  AFTER UPDATE ON public.sale
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_sale_consumption_on_complete();
