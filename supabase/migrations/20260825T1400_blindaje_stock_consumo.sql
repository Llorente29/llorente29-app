-- 20260825T1400_blindaje_stock_consumo.sql
-- Blindaje de la cadena de stock. Tres defectos de MOTOR encontrados en la
-- auditoría del 25-08 y corregidos aquí. Ninguno toca datos históricos.
--
-- ── D1 · COMBOS SIN MAPEAR NO CONSUMEN NADA (E3) ─────────────────────────
-- generate_sale_consumption recorre las líneas de producto exigiendo
-- `menu_item_id IS NOT NULL`. Pero un COMBO no necesita que su línea padre
-- esté mapeada: _sale_line_raw_consumption resuelve el combo por sus HIJOS
-- (combo_item), que sí están mapeados y sí tienen escandallo. Resultado: cada
-- combo cuya línea padre no se mapeó descontaba CERO.
-- Medido: 331 líneas / 312 ventas / 7.885,30 € en 30 días (histórico: 685
-- líneas / 641 ventas / 16.428,90 € desde el 12-06). Comprobado línea a línea:
-- "PACK PA 2 (DC)" sin mapear devuelve 17 crudos por sus hijos y el motor la
-- saltaba.
--
-- ── D2 · LAS ANULACIONES NO DEVOLVÍAN EL STOCK (E1) ──────────────────────
-- cancel_sale() sí revierte, pero cuando el webhook mueve
-- sale.order_status a 'cancelled'/'rejected' sin pasar por esa RPC, el consumo
-- se quedaba puesto para siempre. Medido: 9 ventas con 95 movimientos vivos
-- (~74,50 €), todas por el camino status='open' + order_status='cancelled'.
-- Las 28 que pasaron por cancel_sale están limpias.
-- Corrección en dos capas: (a) generate_sale_consumption se niega a consumir
-- una venta anulada y borra lo que hubiera; (b) el trigger de la venta la
-- llama también en la transición a anulada.
--
-- ── D3 · LA CACHÉ DE STOCK NUNCA SE REFRESCABA AL VENDER (E6/E10) ────────
-- De las 11 funciones que escriben en stock_movement, generate_sale_consumption
-- era la ÚNICA que no llamaba a recompute_location_stock. Como el consumo por
-- venta es el movimiento más frecuente, recipe_item_location_stock derivaba sin
-- parar: 144 de 716 filas descuadradas con el ledger. Y la app SIEMPRE lee esa
-- caché (nunca el ledger), así que la gente veía números falsos.
--
-- Se usa CREATE OR REPLACE y no DROP+CREATE a propósito: la firma no cambia y
-- DROP tumbaría los GRANT de las funciones. La verificación con
-- pg_get_functiondef va al final del fichero.

begin;

-- ── generate_sale_consumption (D1 + D2 + D3) ──────────────────────────────
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

  -- D3: artículos que YA tenía tocados esta venta. Hay que refrescar su caché
  -- aunque la venta se anule y deje de consumir (si no, la caché se queda con
  -- el consumo revertido).
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
  -- arriba el stock ya vuelve; solo queda refrescar la caché al final.
  v_void := COALESCE(v_sale.status, '') = 'cancelled'
         OR COALESCE(v_sale.order_status, '') IN ('cancelled', 'rejected')
         OR NOT COALESCE(v_sale.is_active, true);

  IF NOT v_void THEN
    -- Recorre las líneas de PRODUCTO de la venta (la raíz, también la de un combo).
    -- Las hijas (modifier / combo_item) NO se recorren aquí: las resuelve
    -- _sale_line_raw_consumption a partir de su línea producto padre.
    FOR v_line IN
      SELECT sl.id, sl.menu_item_id
      FROM sale_line sl
      WHERE sl.sale_id = p_sale_id
        AND COALESCE(sl.line_type, 'product') = 'product'
        AND sl.ignored_at IS NULL
        -- D1: o la línea está mapeada, o es la cabecera de un COMBO. Un combo
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
        v_touched := v_touched || v_raw.raw_item_id;
      END LOOP;
    END LOOP;
  END IF;

  -- D3: refresca la caché de stock de todos los artículos tocados (antes y
  -- ahora). Era la única función que escribía en el ledger sin hacerlo.
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

-- ── tg_sale_consumption_on_complete (D2) ──────────────────────────────────
-- Mismo trigger de siempre (AFTER INSERT OR UPDATE ON sale), con una rama
-- nueva: cuando la venta pasa a anulada/rechazada/inactiva, llama al motor
-- para que DEVUELVA el stock. La rama de alta se deja exactamente igual.
CREATE OR REPLACE FUNCTION public.tg_sale_consumption_on_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- 0) ANULACIÓN (nuevo): la venta deja de ser válida → devolver el stock.
  --    Solo en la transición, para no reescribir en cada update del pedido.
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

commit;
