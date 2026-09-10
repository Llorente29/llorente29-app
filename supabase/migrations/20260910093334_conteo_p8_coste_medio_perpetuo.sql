-- 20260910093334_conteo_p8_coste_medio_perpetuo.sql
--
-- CONTAR POR FORMATOS · PASO 8 (§2.5) — EL € DE VERDAD
--
-- ESTO NO ES SÓLO DEL RECUENTO: es el valor del stock en todo Folvy.
--
-- Lo que había: `avg_unit_cost = SUM(qty_base × unit_cost) / SUM(qty_base)`
-- sobre TODO el libro del artículo y local. Eso no es un coste medio, es una
-- media aritmética de un libro que incluye las salidas — y las salidas llevan
-- el coste que tenían cuando salieron. Consecuencias medidas el 10/09 en las
-- 453 filas artículo × local activas de Foodint:
--
--     120 sin coste  ·  50 con coste NEGATIVO  ·  y de ahí salen los absurdos
--     3.860 g de Carne de Birria = 18.086 €   (19/08)
--     −5 latas de Coca-Cola      = +346 €
--     +60 Focaccias              = 0 €
--
-- Un coste negativo no es un número raro: es un número que INVIERTE el signo de
-- la conclusión. Una merma sale con beneficio, y quien mira la pantalla aprende
-- a no creérsela.
--
-- Lo que hay a partir de ahora: MEDIA PONDERADA PERPETUA, recorriendo el libro
-- en orden. Sólo las RECEPCIONES mueven la media; todo lo demás, no.
--
-- ─────────────────────────────────────────────────────────────────────────
-- DOS CORRECCIONES DE JULIO SOBRE EL PRIMER ENSAYO (10/09), Y SON LAS QUE
-- HACEN QUE ESTO SIRVA PARA ALGO
--
-- (1) SÓLO LAS RECEPCIONES. El encargo decía «en cada entrada con coste», y mi
--     primera versión lo cumplía al pie de la letra: un ajuste POSITIVO de
--     recuento entra con `unit_cost = COALESCE(avg_unit_cost, 0)` —el coste
--     medio viejo, el envenenado— y, si el stock previo era ≤ 0, se convertía
--     en la media nueva. El caso que lo destapa:
--
--       Aceite de Oliva Suave 0,4º · Carabanchel · ficha 0,0045 €/ml
--         16/06  recepción  250 ml  0,0122
--         24/06  recepción  250 ml  0,0122
--         05/08  AJUSTE      31 ml  0,1070   ← coste medio viejo, arrastrado
--       Mi media nueva daba 0,1070 €/ml. Eso son 107 € el litro de aceite.
--
--     Mueven la media `goods_receipt_line` y `traspaso_entrada`, que traen el
--     coste de ORIGEN. Un ajuste de recuento entra al coste medio vigente y no
--     lo cambia — y `apply_inventory_count` (migración p6) pasa a escribirlo
--     así, con `avg_unit_cost` a secas y NULL cuando no se sabe, nunca con un
--     `COALESCE(..., 0)`. Eso cierra el bucle: sin él, un coste negativo
--     engendraba movimientos negativos que volvían a alimentarlo.
--
-- (2) UNA RECEPCIÓN CON EL COSTE MAL PUESTO ENVENENA LA MEDIA NUEVA.
--
--       CAJA GENERICA 780 Ml · Alcalá · ficha 0,2241 €/ud
--         07/07  250 ud a 56,0200   ← el precio de la caja entera, por unidad
--       Media nueva 6,5461 €/ud: 79,80 € de stock pasaban a 3.273,06 €.
--
--     Medido: 53 recepciones de 23 artículos se apartan más de ×5 de su coste
--     de ficha (de 911 con coste en Foodint). Una recepción fuera de esa banda
--     NO mueve la media hasta que alguien la corrija. No se rechaza, no se
--     borra y no se toca: se queda fuera de la media y sale listada con nombre,
--     fecha, cantidad, coste puesto y coste de ficha en el ensayo. Corregirlas
--     es un dato de producción y se hace con Julio delante, no en una
--     migración.
--
--     La banda es `supply_settings.cost_band_factor` (5 por defecto), no un
--     número escrito aquí. Y si el artículo NO tiene coste de ficha, no hay
--     con qué juzgar: la recepción entra. Rechazarla dejaría sin coste para
--     siempre a cualquier artículo nuevo, que es peor que el riesgo que cubre.
-- ─────────────────────────────────────────────────────────────────────────
--
--     avg = (max(qty_antes,0) × avg + qty_recibe × coste_recibe)
--           ───────────────────────────────────────────────────
--                    max(qty_antes,0) + qty_recibe
--
-- El `max(qty_antes, 0)` es lo que impide que un stock negativo envenene el
-- coste: si el libro está en −3 kg y entran 10 con coste, la media es la del
-- lote que entra, no una división por 7 que no significa nada.
--
-- CUANDO NO HAY NINGUNA ENTRADA CON COSTE se usa `recipe_item.computed_cost`.
-- Y CUANDO TAMPOCO HAY ESO, el coste queda en NULL — no en 0. Cero no es «no
-- lo sé»: cero es «vale cero», y es lo que hacía que 60 Focaccias valieran
-- 0 € en silencio. La pantalla dirá «sin coste», que es la verdad.
--
-- Y UN DETALLE QUE NO ES UN DETALLE: `avg` puede estar en NULL cuando llega la
-- primera entrada CON coste habiendo ya cantidad de entradas SIN coste. La
-- fórmula pediría multiplicar esa cantidad por NULL. No se resuelve poniendo un
-- cero (diría que lo anterior era gratis, y hunde la media): se resuelve
-- tomando el coste de la entrada que llega como el de todo lo que hay. Es lo
-- único que sabemos, y se dice aquí para que nadie lo descubra midiendo.

BEGIN;

CREATE OR REPLACE FUNCTION public.recompute_location_stock_core(p_item_id uuid, p_location_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_qty        numeric := 0;
  v_avg        numeric := NULL;
  v_base       numeric;
  v_value      numeric;
  v_ficha      numeric;
  v_banda      numeric;
  r            RECORD;
BEGIN
  SELECT account_id,
         COALESCE(NULLIF(computed_cost, 0), NULLIF(fixed_cost, 0))
    INTO v_account_id, v_ficha
    FROM recipe_item WHERE id = p_item_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'recompute_location_stock_core: item % no existe', p_item_id;
  END IF;

  SELECT COALESCE(cost_band_factor, 5) INTO v_banda
    FROM supply_settings WHERE account_id = v_account_id;
  v_banda := COALESCE(v_banda, 5);
  IF v_banda <= 1 THEN v_banda := 5; END IF;

  -- El libro en orden. `id` desempata para que dos movimientos con el mismo
  -- instante se recorran siempre igual: sin ese desempate, el mismo libro daría
  -- dos costes distintos en dos ejecuciones y nadie sabría cuál creerse.
  FOR r IN
    SELECT qty_base, unit_cost,
           (source_type = 'goods_receipt_line'
            OR movement_type IN ('recepcion', 'traspaso_entrada')) AS es_recepcion
      FROM stock_movement
     WHERE recipe_item_id = p_item_id
       AND location_id    = p_location_id
     ORDER BY occurred_at, id
  LOOP
    -- SÓLO LAS RECEPCIONES, y sólo si su coste es creíble.
    --
    -- `unit_cost > 0` y no `IS NOT NULL`: un coste negativo o cero no es un
    -- coste, es un hueco (regla 3, la misma lección que `computed_cost = 0`).
    --
    -- Y la banda: `v_ficha IS NULL` deja pasar a propósito —sin coste de ficha
    -- no hay con qué juzgar, y rechazar dejaría sin coste para siempre a un
    -- artículo nuevo.
    IF r.qty_base > 0
       AND r.es_recepcion
       AND r.unit_cost > 0
       AND (v_ficha IS NULL
            OR (r.unit_cost <= v_ficha * v_banda AND r.unit_cost >= v_ficha / v_banda))
    THEN
      v_base := GREATEST(v_qty, 0);
      IF v_avg IS NULL OR v_base = 0 THEN
        v_avg := r.unit_cost;
      ELSE
        v_avg := (v_base * v_avg + r.qty_base * r.unit_cost) / (v_base + r.qty_base);
      END IF;
    END IF;
    -- Todo lo demás mueve la CANTIDAD y no el coste: las salidas, los ajustes
    -- de recuento, las mermas y las aperturas.
    v_qty := v_qty + r.qty_base;
  END LOOP;

  IF abs(v_qty) < 0.0000001 THEN
    v_qty := 0;
  END IF;

  -- Sin ninguna entrada con coste: el coste de ficha. Y si tampoco, NULL.
  IF v_avg IS NULL THEN
    SELECT computed_cost INTO v_avg FROM recipe_item WHERE id = p_item_id;
    IF v_avg IS NOT NULL AND v_avg <= 0 THEN
      -- Regla 3: `computed_cost = 0` tapa el `fixed_cost` real. Aquí un cero no
      -- es un coste, es un hueco: se trata como lo que es.
      SELECT fixed_cost INTO v_avg FROM recipe_item WHERE id = p_item_id;
      IF v_avg IS NOT NULL AND v_avg <= 0 THEN v_avg := NULL; END IF;
    END IF;
  END IF;

  v_value := CASE WHEN v_avg IS NULL THEN NULL ELSE v_qty * v_avg END;

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
$function$;

COMMENT ON FUNCTION public.recompute_location_stock_core(uuid, uuid) IS
  'Media ponderada PERPETUA: recorre el libro en orden y SÓLO las recepciones '
  'con coste dentro de banda (cost_band_factor × coste de ficha) mueven la '
  'media. Los ajustes de recuento, las mermas y las salidas no la tocan. Un '
  'stock negativo no la envenena (max(qty,0)). Sin recepciones válidas, coste '
  'de ficha; sin eso, NULL — nunca 0 callado (§2.5 + correcciones de Julio del '
  '10/09/2026).';

-- ═════════════════════════════════════════════════════════════════════════
-- close_inventory_count · valora con ese coste, y NULL cuando no lo hay
-- ═════════════════════════════════════════════════════════════════════════
--
-- El cambio de una palabra: `COALESCE(ril.avg_unit_cost, 0)` pasa a
-- `ril.avg_unit_cost`. Ese COALESCE es el que convertía «no sé lo que vale»
-- en «vale 0 €», y con él la pantalla de aprobación sumaba a la franja de
-- «valor de lo que hay que revisar» un montón de ceros que no eran ceros.
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
