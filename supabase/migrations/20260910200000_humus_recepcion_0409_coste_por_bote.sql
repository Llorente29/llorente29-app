-- 20260910200000_humus_recepcion_0409_coste_por_bote.sql
--
-- HUMUS · la recepción del 04/09 en Alcalá, a 1 céntimo por 1,8 kg
--
-- QUÉ PASÓ. `goods_receipt_line.unit_cost` va por UNIDAD DE COMPRA — aquí el
-- bote de 900 g—, y el apunte lo pasa a unidad base con
-- `_eur_base_from_format`. En la línea 5332d1de alguien escribió 0,006467 en
-- ese campo, que es el precio POR GRAMO. El apunte lo volvió a dividir entre
-- 900 y en el libro quedó a 0,000007186 €/g: 1.800 g de humus valorados en
-- UN CÉNTIMO.
--
-- Las tres de junio (5,82 €/bote → 0,006467 €/g en el libro) están BIEN y no
-- se tocan. Julio lo confirmó el 10/09.
--
-- LO QUE ESTO NO ARREGLA, Y HAY QUE DECIRLO. El coste medio de Humus en
-- Alcalá NO cambia: sigue en 0,006466667 €/g antes y después. La banda ×5
-- contra el coste de ficha (p8, del 10/09) ya estaba descartando esa
-- recepción por absurdamente barata. Lo que se arregla es el VALOR DEL LIBRO
-- —0,01 € → 11,64 €—, que es lo que se sumará cuando se ejecute el PASO 1 del
-- recálculo.
--
-- POR QUÉ EL COSTE NO SE TECLEA. El valor en unidad base se le pide a
-- `_eur_base_from_format`, la MISMA función que usa `post_pending_receipt_line`.
-- Escribir 0,006466667 a mano sería copiar un resultado en vez de calcularlo, y
-- la siguiente vez que cambie el contenido del formato la copia mentiría.

BEGIN;

DO $fix$
DECLARE
  v_linea  uuid := '5332d1de-6c46-43af-8ed9-dfa7d92827e8';
  v_fmt    uuid;
  v_eur    numeric;
  v_n      integer;
  v_junio  numeric;
BEGIN
  SELECT purchase_format_id INTO v_fmt FROM public.goods_receipt_line WHERE id = v_linea;
  IF v_fmt IS NULL THEN
    RAISE EXCEPTION 'La línea % no existe o no tiene formato de compra', v_linea;
  END IF;

  v_eur := public._eur_base_from_format(v_fmt, 5.82);

  -- GUARDA: el resultado tiene que coincidir con el de las de junio, que son
  -- las buenas. Si no coincide, algo ha cambiado y esto no se aplica.
  SELECT DISTINCT round(sm.unit_cost, 9) INTO v_junio
    FROM public.goods_receipt_line grl
    JOIN public.recipe_item ri ON ri.id = grl.recipe_item_id
    JOIN public.stock_movement sm ON sm.source_id = grl.id AND sm.source_type='goods_receipt_line'
   WHERE ri.name = 'Humus' AND grl.unit_cost = 5.82;
  IF v_junio IS NULL OR round(v_eur, 9) <> v_junio THEN
    RAISE EXCEPTION 'El coste calculado (%) no coincide con el de las recepciones buenas de junio (%)',
      round(v_eur,9), v_junio;
  END IF;

  UPDATE public.goods_receipt_line
     SET unit_cost = 5.82, updated_at = now()
   WHERE id = v_linea AND unit_cost <> 5.82;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'Esperaba corregir 1 línea de albarán, no %', v_n; END IF;

  UPDATE public.stock_movement
     SET unit_cost = v_eur
   WHERE source_id = v_linea AND source_type = 'goods_receipt_line';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'Esperaba corregir 1 movimiento, no %', v_n; END IF;
END;
$fix$;

COMMIT;
