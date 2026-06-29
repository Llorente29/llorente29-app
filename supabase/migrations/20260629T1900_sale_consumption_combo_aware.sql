-- supabase/migrations/20260629T1900_sale_consumption_combo_aware.sql
--
-- CABLEADO: generate_sale_consumption ahora usa _sale_line_raw_consumption
-- (combo + modifier-aware) en lugar de explotar SOLO la receta propia de la
-- línea. Antes, un combo (recipe_item_id NULL, sus componentes en líneas hijas
-- combo_item) NO descontaba nada del stock; los modificadores tampoco. El motor
-- teórico (_sale_line_raw_consumption, 20260609T1000) YA resolvía combos y
-- modificadores y alimentaba el AvT — pero el motor de STOCK real no lo usaba.
--
-- Ahora una sola lógica de explosión alimenta AvT teórico Y stock real → el
-- stock que descuenta es idéntico al consumo que calcula el AvT (coherencia).
--
-- _sale_line_raw_consumption YA multiplica por la cantidad de la línea (v_qty),
-- así que NO se vuelve a multiplicar aquí. Devuelve (raw_item_id, qty_base) con
-- signo (un modificador 'remove' resta). El resto (coste unitario avg del local,
-- idempotencia, stock_movement negativo, trigger on complete) NO cambia.

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

  -- Recorre las líneas de PRODUCTO de la venta (la raíz, también la de un combo).
  -- Las hijas (modifier / combo_item) NO se recorren aquí: las resuelve
  -- _sale_line_raw_consumption a partir de su línea producto padre.
  FOR v_line IN
    SELECT sl.id, sl.menu_item_id
    FROM sale_line sl
    WHERE sl.sale_id = p_sale_id
      AND COALESCE(sl.line_type, 'product') = 'product'
      AND sl.menu_item_id IS NOT NULL
      AND sl.ignored_at IS NULL
  LOOP
    -- Explota la línea a crudos: producto simple (su receta + modificadores) o
    -- combo (sus componentes hijos + modificadores). Ya viene multiplicado por
    -- la cantidad de la línea y con signo.
    FOR v_raw IN
      SELECT raw_item_id, qty_base
      FROM public._sale_line_raw_consumption(v_line.id)
    LOOP
      IF v_raw.raw_item_id IS NULL OR v_raw.qty_base IS NULL OR v_raw.qty_base = 0 THEN
        CONTINUE;
      END IF;

      -- coste unitario: avg del stock por local, fallback computed_cost del raw
      SELECT COALESCE(ric.avg_unit_cost, ri.computed_cost)
        INTO v_unit_cost
      FROM recipe_item ri
      LEFT JOIN recipe_item_location_stock ric
        ON ric.recipe_item_id = ri.id
       AND ric.account_id = v_sale.account_id
       AND ric.location_id = v_sale.location_id
      WHERE ri.id = v_raw.raw_item_id;

      -- movimiento de consumo. qty_base del teórico viene CON SIGNO:
      --   +N (consumo normal)        → stock_movement -N  (sale del stock)
      --   -N ('remove' de modificador, se usa menos) → stock_movement +N
      -- Por eso negamos el signo del teórico (no -ABS, que ignoraría los remove).
      INSERT INTO stock_movement(
        account_id, location_id, recipe_item_id, movement_type, qty_base,
        unit_cost, source_type, source_id, occurred_at, notes)
      VALUES (
        v_sale.account_id, v_sale.location_id, v_raw.raw_item_id, 'consumo',
        -v_raw.qty_base,
        v_unit_cost, 'sale', p_sale_id, COALESCE(v_sale.created_at, now()),
        'Consumo por venta');
      v_written := v_written + 1;
    END LOOP;
  END LOOP;

  RETURN v_written;
END;
$function$;
