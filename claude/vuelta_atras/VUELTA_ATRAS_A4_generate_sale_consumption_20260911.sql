-- ════════════════════════════════════════════════════════════════════════
-- VUELTA ATRÁS · `generate_sale_consumption` al cuerpo de ANTES de A4
--
-- Se prepara ANTES de aplicar A4, no después. Es la función más caliente del
-- sistema: corre en cada pedido que entra. Si algo va mal de madrugada, esto
-- se pega en el SQL Editor y se acabó.
--
-- HUELLA DE DESTINO: md5(prosrc) = 97a3533602349f6cebb7f55f3ab15fc3 · 3.595 bytes
-- Copiada byte a byte del `pg_proc.prosrc` VIVO el 11/09/2026 a las 13:30
-- (Madrid, reloj de la base) y verificada aparte: el fichero da esa huella exacta, así que lo
-- que hay aquí es lo que está corriendo, no lo que dice el repositorio.
--
-- La firma no cambia (`uuid` → `integer`), así que `CREATE OR REPLACE` basta y
-- NO crea sobrecarga (regla 2). Los permisos tampoco se tocan: hoy son
-- postgres | authenticated | service_role, y esta vuelta atrás los deja igual
-- — devolver el cuerpo viejo no es el momento de cambiar la puerta.
--
-- Al final se comprueba sola: si tras aplicarla la huella no es la de destino,
-- aborta y lo dice. Una vuelta atrás que no verifica es una esperanza.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.generate_sale_consumption(p_sale_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_sale        sale%ROWTYPE;
  v_line        record;
  v_raw         record;
  v_unit_cost   numeric;
  v_written     integer := 0;
  v_touched     uuid[] := '{}'::uuid[];
  v_item        uuid;
  v_void        boolean;
BEGIN
  SELECT * INTO v_sale FROM sale WHERE id = p_sale_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  -- D3: articulos que YA tenia tocados esta venta. Hay que refrescar su cache
  -- aunque la venta se anule y deje de consumir.
  SELECT COALESCE(array_agg(DISTINCT sm.recipe_item_id), '{}'::uuid[])
    INTO v_touched
    FROM stock_movement sm
   WHERE sm.account_id    = v_sale.account_id
     AND sm.movement_type = 'consumo'
     AND sm.source_type   = 'sale'
     AND sm.source_id     = p_sale_id;

  -- IDEMPOTENCIA: borra cualquier consumo previo de esta venta antes de reescribir.
  DELETE FROM stock_movement
  WHERE account_id = v_sale.account_id
    AND movement_type = 'consumo'
    AND source_type = 'sale'
    AND source_id = p_sale_id;

  -- D2: una venta anulada/rechazada/inactiva NO consume. Con el DELETE de
  -- arriba el stock ya vuelve; solo queda refrescar la cache al final.
  v_void := COALESCE(v_sale.status, '') = 'cancelled'
         OR COALESCE(v_sale.order_status, '') IN ('cancelled', 'rejected')
         OR NOT COALESCE(v_sale.is_active, true);

  IF NOT v_void THEN
    FOR v_line IN
      SELECT sl.id, sl.menu_item_id
      FROM sale_line sl
      WHERE sl.sale_id = p_sale_id
        AND COALESCE(sl.line_type, 'product') = 'product'
        AND sl.ignored_at IS NULL
        -- D1: o la linea esta mapeada, o es la cabecera de un COMBO. Un combo
        -- se resuelve por sus hijos: exigirle mapeo a la cabecera dejaba el
        -- combo entero sin descontar.
        AND (
          sl.menu_item_id IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM sale_line c
             WHERE c.parent_sale_line_id = sl.id AND c.line_type = 'combo_item'
          )
        )
    LOOP
      FOR v_raw IN
        SELECT raw_item_id, qty_base
        FROM public._sale_line_raw_consumption(v_line.id)
      LOOP
        IF v_raw.raw_item_id IS NULL OR v_raw.qty_base IS NULL OR v_raw.qty_base = 0 THEN
          CONTINUE;
        END IF;

        SELECT COALESCE(ric.avg_unit_cost, ri.computed_cost)
          INTO v_unit_cost
        FROM recipe_item ri
        LEFT JOIN recipe_item_location_stock ric
          ON ric.recipe_item_id = ri.id
         AND ric.account_id = v_sale.account_id
         AND ric.location_id = v_sale.location_id
        WHERE ri.id = v_raw.raw_item_id;

        -- qty_base del teorico viene CON SIGNO: +N consumo, -N remove.
        INSERT INTO stock_movement(
          account_id, location_id, recipe_item_id, movement_type, qty_base,
          unit_cost, source_type, source_id, occurred_at, notes)
        VALUES (
          v_sale.account_id, v_sale.location_id, v_raw.raw_item_id, 'consumo',
          -v_raw.qty_base,
          v_unit_cost, 'sale', p_sale_id, COALESCE(v_sale.created_at, now()),
          'Consumo por venta');
        v_written := v_written + 1;
        v_touched := v_touched || v_raw.raw_item_id;
      END LOOP;
    END LOOP;
  END IF;

  -- D3: refresca la cache de stock de todos los articulos tocados.
  IF v_sale.location_id IS NOT NULL AND array_length(v_touched, 1) IS NOT NULL THEN
    SELECT COALESCE(array_agg(DISTINCT u), '{}'::uuid[]) INTO v_touched
      FROM unnest(v_touched) u;
    FOREACH v_item IN ARRAY v_touched
    LOOP
      PERFORM public.recompute_location_stock_core(v_item, v_sale.location_id);
    END LOOP;
  END IF;

  RETURN v_written;
END;
$fn$;

DO $verifica$
DECLARE v_md5 text; v_bytes integer;
BEGIN
  SELECT md5(p.prosrc), length(p.prosrc) INTO v_md5, v_bytes
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'generate_sale_consumption';
  IF v_md5 IS DISTINCT FROM '97a3533602349f6cebb7f55f3ab15fc3' THEN
    RAISE EXCEPTION 'VUELTA ATRAS FALLIDA: la huella es % (% bytes), se esperaba 97a3533602349f6cebb7f55f3ab15fc3 (3595)', v_md5, v_bytes;
  END IF;
  RAISE NOTICE 'Vuelta atras OK: generate_sale_consumption = % (% bytes)', v_md5, v_bytes;
END
$verifica$;
