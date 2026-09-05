-- 20260825T1400_blindaje_stock_consumo.sql
-- D1 combos sin mapear no consumian · D2 anulaciones no devolvian stock ·
-- D3 el consumo por venta nunca refrescaba la cache de stock.

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
$function$;

CREATE OR REPLACE FUNCTION public.tg_sale_consumption_on_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- 0) ANULACION (nuevo): la venta deja de ser valida -> devolver el stock.
  if tg_op = 'UPDATE'
     and ( coalesce(new.status,'') = 'cancelled'
           or coalesce(new.order_status,'') in ('cancelled','rejected')
           or not coalesce(new.is_active, true) )
     and ( coalesce(old.status,'')       is distinct from coalesce(new.status,'')
           or coalesce(old.order_status,'') is distinct from coalesce(new.order_status,'')
           or coalesce(old.is_active,true) is distinct from coalesce(new.is_active,true) ) then
    perform public.generate_sale_consumption(new.id);
    return new;
  end if;

  -- 1) AL ENTRAR / ACEPTARSE la venta: descuenta ya.
  if new.order_status in ('accepted','received','new','completed')
     and (tg_op = 'INSERT' or old.order_status is distinct from new.order_status)
     and coalesce(new.status,'') <> 'cancelled'
     and coalesce(new.is_active, true) then
    perform public.generate_sale_consumption(new.id);
  end if;

  return new;
end;
$function$;

notify pgrst, 'reload schema';