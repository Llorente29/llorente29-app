-- 20260910171544_conteo_p13a_close_apertura_sin_diferencias.sql
--
-- LA APERTURA NO CALCULA DIFERENCIAS (§1 del parte del 10/09 por la noche)
--
-- `is_opening` ya existía y ya hacía DOS de las tres cosas: `apply_inventory_count`
-- escribe el movimiento como `apertura` con la nota «Inventario de apertura
-- (stock inicial)», y se salta la exigencia de motivo. No hacía falta inventar
-- un `kind` nuevo. Faltaba la tercera.
--
-- El UPDATE nuevo va EL ÚLTIMO a propósito: el saneamiento de más arriba escribe
-- `variance_value = 0` cuando el teórico estaba en negativo, y el packaging tiene
-- mucho teórico en negativo. Si fuera antes, ese cero lo pisaría.
--
-- `variance_qty` también se anula. Julio nombró tres columnas; ésta es la cuarta:
-- dejarla viva permitiría que una pantalla escribiera «−125.000 ud» debajo de un
-- inventario que dice no tener diferencias. `counted_qty` y `system_qty` se
-- quedan, así que el dato en bruto no se pierde.

BEGIN;

CREATE OR REPLACE FUNCTION public.close_inventory_count(p_count_id uuid)
RETURNS TABLE(lines_total integer, lines_counted integer, lines_ok integer, lines_out integer, lines_uncounted integer, total_variance_value numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_location_id uuid;
  v_status text;
  v_tol_a numeric; v_tol_b numeric; v_tol_c numeric;
BEGIN
  SELECT account_id, location_id, status INTO v_account_id, v_location_id, v_status
    FROM public.inventory_count WHERE id = p_count_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'close_inventory_count: conteo % no existe', p_count_id;
  END IF;

  IF NOT belongs_to_account(v_account_id) THEN
    RAISE EXCEPTION 'close_inventory_count: sin acceso a la cuenta %', v_account_id;
  END IF;

  IF NOT public.can_operate_manual_count(p_count_id) THEN
    RAISE EXCEPTION 'close_inventory_count: este inventario está asignado a otra persona';
  END IF;

  IF v_status NOT IN ('abierto', 'contando', 'en_revision') THEN
    RAISE EXCEPTION 'close_inventory_count: el conteo está en % y no se puede cerrar', v_status;
  END IF;

  PERFORM public.rebase_count_system_qty(p_count_id);

  SELECT COALESCE(tol_a_pct,2), COALESCE(tol_b_pct,3), COALESCE(tol_c_pct,5)
    INTO v_tol_a, v_tol_b, v_tol_c
    FROM public.supply_settings WHERE account_id = v_account_id;
  v_tol_a := COALESCE(v_tol_a,2); v_tol_b := COALESCE(v_tol_b,3); v_tol_c := COALESCE(v_tol_c,5);

  UPDATE public.inventory_count_line l
  SET
    variance_qty = l.counted_qty - l.system_qty,
    variance_pct = CASE WHEN COALESCE(l.system_qty,0) <> 0
                        THEN (l.counted_qty - l.system_qty) / l.system_qty * 100
                        ELSE NULL END,
    -- CAMBIO 10/09: sin coste fiable, NULL. Nunca 0 callado.
    variance_value = (l.counted_qty - l.system_qty) * ril.avg_unit_cost,
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

  -- Sin fila de stock del artículo en el local: no hay con qué valorar. NULL,
  -- que es lo que es, y la pantalla lo dirá con palabras.
  UPDATE public.inventory_count_line l
  SET
    variance_qty = l.counted_qty - l.system_qty,
    variance_pct = CASE WHEN COALESCE(l.system_qty,0) <> 0
                        THEN (l.counted_qty - l.system_qty) / l.system_qty * 100
                        ELSE NULL END,
    variance_value = NULL,
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

  -- SANEAMIENTO: si el sistema estaba en NEGATIVO, el conteo lo corrige pero NO
  -- es merma del período: variación económica 0 y dentro de tolerancia. Aquí el
  -- 0 SÍ es un cero de verdad —«esto no vale nada porque no es una pérdida»—,
  -- no un «no lo sé» disfrazado. Por eso este se queda.
  UPDATE public.inventory_count_line l
  SET variance_value = 0,
      within_tolerance = true
  WHERE l.inventory_count_id = p_count_id
    AND l.counted_qty IS NOT NULL
    AND COALESCE(l.system_qty, 0) < 0;

  -- ── LA APERTURA NO CALCULA DIFERENCIAS (10/09, noche) ─────────────────
  --
  -- Un inventario de apertura FIJA el stock: el teórico de antes no es una
  -- referencia, es un número que ya sabemos malo. Restarle lo contado no da
  -- una merma, da una resta sin significado — y en el packaging esa resta
  -- son 28.800 € que nadie ha perdido.
  --
  -- NULL Y NO CERO, por la regla que ya costó un incidente: cero afirma «no
  -- ha habido diferencia» y NULL dice «no había con qué compararlo». Aquí lo
  -- segundo es lo cierto.
  --
  -- VA EL ÚLTIMO A PROPÓSITO: el saneamiento de arriba escribe
  -- `variance_value = 0` cuando el teórico estaba en negativo, y el packaging
  -- tiene mucho teórico en negativo. Si esto fuera antes, ese cero lo pisaría.
  --
  -- `variance_qty` TAMBIÉN. Julio nombró tres columnas; ésta es la cuarta y la
  -- añado a propósito: es la diferencia en unidades, y dejarla viva permitiría
  -- que una pantalla o una exportación escribiera «−125.000 ud» debajo de un
  -- inventario que dice no tener diferencias. Queda dicho para que se pueda
  -- deshacer si se quiere conservar el dato en bruto.
  UPDATE public.inventory_count_line l
     SET variance_qty      = NULL,
         variance_pct      = NULL,
         variance_value    = NULL,
         within_tolerance  = NULL
    FROM public.inventory_count ic
   WHERE ic.id = p_count_id
     AND l.inventory_count_id = p_count_id
     AND COALESCE(ic.is_opening, false);

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
    -- SUM ignora los NULL: el total es el de lo que SÍ se sabe valorar. Lo que
    -- no, se cuenta aparte en la pantalla, con su nombre.
    COALESCE(SUM(variance_value) FILTER (WHERE counted_qty IS NOT NULL), 0)
  FROM public.inventory_count_line
  WHERE inventory_count_id = p_count_id;
END;
$function$;
COMMIT;
