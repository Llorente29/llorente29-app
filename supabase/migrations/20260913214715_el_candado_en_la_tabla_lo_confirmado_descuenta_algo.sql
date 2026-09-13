-- ==========================================================================
-- EL CANDADO EN LA TABLA: LO CONFIRMADO DESCUENTA ALGO
--
-- Tercer y ultimo piso del agujero del 13/09. Las dos primeras ya estan
-- puestas:
--
--   1. El freno de pantalla (`loQueLeFaltaAlEfecto`): no deja guardar un
--      efecto sin articulo o sin cantidad.
--   2. Las TRES puertas de escritura de la base --`kitchen_guardar_pregunta`,
--      `kitchen_aplicar_a_las_iguales` y `kitchen_extras_poner_lo_que_lleva`--
--      preguntan a `_impacto_completo` antes de escribir.
--
-- Falta la tabla. Una puerta se puede rodear: un `insert` a mano, una RPC
-- nueva que se escriba manana y no se acuerde de preguntar, un arreglo de
-- madrugada. La tabla no se rodea.
--
-- POR QUE A LAS 23:45 Y NO ANTES. Las tres condiciones de la banda, medidas:
--
--   1. Camino del pedido: `modifier_recipe_impact` SI esta en el.
--      `_sale_line_raw_consumption` y `compute_sale_line_cost` la leen en
--      cada linea de pedido.
--   2. Cierre exclusivo: un `ADD CONSTRAINT ... CHECK` VALIDO toma
--      ACCESS EXCLUSIVE sobre la tabla. Lo toma.
--   3. Se dijo antes, con la medida delante (parte de las 19:25).
--
-- Falla la 1 y falla la 2: espera. Por eso esta tanda va a las 23:45.
--
-- QUE SE VA A VALIDAR, medido hoy a las 19:50 sobre la tabla entera --sin
-- filtro de cuenta, que aqui es lo correcto: el candado es para todas--:
--
--   filas `confirmed` que INCUMPLEN `_impacto_completo` ... 0
--
-- CERO. Las cinco filas torcidas de esta manana ya estan enderezadas, asi
-- que el CHECK entra VALIDO sin reparacion previa y sin tocar una sola fila.
-- Si entre este parte y las 23:45 alguien mete una torcida, el `ALTER` fallara
-- diciendo cual: eso es lo que tiene que pasar, no un problema que resolver
-- por adelantado.
--
-- POR QUE `status <> 'confirmed' OR ...` Y NO A SECAS. Las filas propuestas
-- --las que sugiere la maquina y nadie ha mirado-- pueden estar a medias: eso
-- es justo lo que son. El candado es sobre lo CONFIRMADO, que es lo unico que
-- el motor de consumo se cree.
-- ==========================================================================

BEGIN;

ALTER TABLE public.modifier_recipe_impact
  ADD CONSTRAINT impacto_confirmado_completo
  CHECK (status <> 'confirmed'
         OR public._impacto_completo(impact_type, target_recipe_item_id, quantity));

-- -- HUELLA: existe, esta VALIDA, y muerde ---------------------------------
DO $huella$
DECLARE v_convalidated boolean; v_mordio boolean := false; v_opcion uuid;
BEGIN
  SELECT c.convalidated INTO v_convalidated
    FROM pg_constraint c
   WHERE c.conrelid = 'public.modifier_recipe_impact'::regclass
     AND c.conname  = 'impacto_confirmado_completo';

  IF v_convalidated IS NULL THEN
    RAISE EXCEPTION 'el candado no existe';
  END IF;
  IF NOT v_convalidated THEN
    RAISE EXCEPTION 'el candado existe pero NO esta validado: no dice nada de las filas de hoy';
  END IF;

  -- Que exista no prueba que muerda (regla 31: se mide, no se supone). Se
  -- intenta meter una torcida de verdad y se exige que la tabla la rechace.
  SELECT o.id INTO v_opcion FROM public.modifier_option o LIMIT 1;
  BEGIN
    INSERT INTO public.modifier_recipe_impact
      (account_id, modifier_option_id, impact_type, target_recipe_item_id,
       quantity, status, source)
    SELECT o.account_id, o.id, 'add_item', NULL, NULL, 'confirmed', 'human'
      FROM public.modifier_option o WHERE o.id = v_opcion;
  EXCEPTION WHEN check_violation THEN
    v_mordio := true;
  END;

  IF NOT v_mordio THEN
    RAISE EXCEPTION 'el candado esta puesto y ha dejado entrar un «anade» sin articulo ni cantidad';
  END IF;

  RAISE NOTICE 'candado puesto, validado y mordiendo';
END;
$huella$;

COMMIT;
