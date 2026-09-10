-- supabase/verificacion/20260910_conteo_por_formatos.sql
--
-- LOS NUEVE PUNTOS DEL §4 DEL ENCARGO, PARA EJECUTAR JUSTO DESPUÉS DE APLICAR
-- LAS DIEZ MIGRACIONES. Sólo lectura salvo donde se dice; lo que escribe va en
-- una transacción que TERMINA EN ROLLBACK y lo lleva escrito al lado.
--
-- Se ejecuta de arriba abajo y se PEGA EL RESULTADO, no el resumen (regla 5).
--
-- Todo va anclado a la cuenta Foodint. Regla 9: `Folvy Interno` comparte tablas
-- Y NOMBRES con producción, y una cifra sin cuenta no es una cifra equivocada,
-- es una cifra que no es de nadie.

\set cuenta '51ad1792-6629-4ef7-833a-b57b09a86710'

-- ═════════════════════════════════════════════════════════════════════════
-- §2.1 · CÓMO HA QUEDADO use_in_count
-- Esperado (medido el 10/09, ANTES de aplicar): 189 true / 86 false de 275.
-- ═════════════════════════════════════════════════════════════════════════
SELECT count(*) AS activos,
       count(*) FILTER (WHERE use_in_count)     AS en_true,
       count(*) FILTER (WHERE NOT use_in_count) AS en_false
  FROM recipe_item_purchase_format
 WHERE account_id = :'cuenta' AND is_active AND archived_at IS NULL;

-- Y los que esperan decisión, con nombre, primero los que más se cuentan.
SELECT ri.name AS articulo,
       string_agg(f.name || ' = ' || f.qty_in_base, ' · ' ORDER BY f.qty_in_base) AS esperando
  FROM recipe_item_purchase_format f
  JOIN recipe_item ri ON ri.id = f.item_id
 WHERE f.account_id = :'cuenta' AND f.is_active AND f.archived_at IS NULL
   AND NOT f.use_in_count
 GROUP BY ri.name ORDER BY count(*) DESC, ri.name LIMIT 25;

-- ═════════════════════════════════════════════════════════════════════════
-- §4.1 · PATATAS BASTÓN: 2 bolsas + 750 g → counted_qty = 5750, 2 entradas
--
-- ESCRIBE Y DESHACE. La línea se elige entre las que están SIN CONTAR de un
-- conteo abierto; si no hay ninguna, no toca nada y lo dice.
-- ═════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  v_line uuid;
  v_bolsa uuid;
  v_res jsonb;
  v_qty numeric;
  v_n integer;
BEGIN
  SELECT f.id INTO v_bolsa
    FROM recipe_item_purchase_format f JOIN recipe_item ri ON ri.id = f.item_id
   WHERE f.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     AND ri.name = 'Patatas Bastón' AND f.qty_in_base = 2500 AND f.is_active;

  SELECT l.id INTO v_line
    FROM inventory_count_line l
    JOIN inventory_count ic ON ic.id = l.inventory_count_id
    JOIN recipe_item ri ON ri.id = l.recipe_item_id
   WHERE l.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     AND ri.name = 'Patatas Bastón' AND ic.status IN ('abierto','contando')
   ORDER BY l.created_at DESC LIMIT 1;

  IF v_line IS NULL OR v_bolsa IS NULL THEN
    RAISE NOTICE '§4.1 SIN PROBAR: no hay línea de Patatas Bastón en un conteo abierto (línea=%, bolsa=%)', v_line, v_bolsa;
    RETURN;
  END IF;

  v_res := save_count_line(v_line, jsonb_build_array(
    jsonb_build_object('method','formato','format_id', v_bolsa, 'qty', 2),
    jsonb_build_object('method','peso','qty', 750)));

  SELECT counted_qty INTO v_qty FROM inventory_count_line WHERE id = v_line;
  SELECT count(*)   INTO v_n   FROM inventory_count_entry WHERE line_id = v_line;

  RAISE NOTICE '§4.1  respuesta=%  counted_qty=%  entradas=%  (esperado: ok / 5750 / 2)', v_res, v_qty, v_n;
END $$;
ROLLBACK;   -- ← NO SE QUEDA NADA

-- ═════════════════════════════════════════════════════════════════════════
-- §4.2 · EL PEPERONI: 0 donde el último aprobado es 9 kg sin entradas.
--
-- Lo que hay que mirar en la respuesta CRUDA: que diga `recount` y que NO
-- contenga ni 8875 ni 9000. Si aparece cualquiera de los dos, el freno ha
-- dejado de ser ciego y hay que parar.
-- ═════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE v_line uuid; v_res jsonb;
BEGIN
  SELECT l.id INTO v_line
    FROM inventory_count_line l
    JOIN inventory_count ic ON ic.id = l.inventory_count_id
    JOIN recipe_item ri ON ri.id = l.recipe_item_id
   WHERE l.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     AND ri.name = 'Peperoni Loncheado' AND ic.status IN ('abierto','contando')
   ORDER BY l.created_at DESC LIMIT 1;
  IF v_line IS NULL THEN
    RAISE NOTICE '§4.2 SIN PROBAR: no hay línea de Peperoni Loncheado en un conteo abierto';
    RETURN;
  END IF;
  v_res := save_count_line(v_line, '[{"method":"cero"}]'::jsonb);
  RAISE NOTICE '§4.2  RESPUESTA CRUDA: %', v_res;
  IF v_res::text LIKE '%8875%' OR v_res::text LIKE '%9000%' THEN
    RAISE EXCEPTION '§4.2 FALLA: la respuesta al móvil contiene la cantidad esperada';
  END IF;
END $$;
ROLLBACK;

-- ═════════════════════════════════════════════════════════════════════════
-- §4.3 · EL SOLOMILLO: «25» en un artículo en gramos con 35 kg esperados.
--
-- El caso real es INV-00162, Foodint Carabanchel, 14/08/2026: 25 g contados
-- contra 35.006 g de teórico, y se APROBÓ. Aquí se comprueba sobre una línea
-- viva del mismo artículo.
--
-- OJO AL ORDEN, que es la contradicción del encargo resuelta: tiene que salir
-- `recount`, NO una excepción FV001. Si sale FV001, el disparador simétrico se
-- ha adelantado al freno y hay que revisar `save_count_line`.
-- ═════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE v_line uuid; v_res jsonb;
BEGIN
  SELECT l.id INTO v_line
    FROM inventory_count_line l
    JOIN inventory_count ic ON ic.id = l.inventory_count_id
    JOIN recipe_item ri ON ri.id = l.recipe_item_id
   WHERE l.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     AND ri.name ILIKE '%Solomillo%Piri-piri%' AND ic.status IN ('abierto','contando')
     AND theoretical_qty_at(l.recipe_item_id, ic.location_id, now()) > 1000
   ORDER BY l.created_at DESC LIMIT 1;
  IF v_line IS NULL THEN
    RAISE NOTICE '§4.3 SIN PROBAR: no hay línea viva de Solomillo Piri-piri con teórico > 1 kg';
    RETURN;
  END IF;
  v_res := save_count_line(v_line, '[{"method":"peso","qty":25}]'::jsonb);
  RAISE NOTICE '§4.3  RESPUESTA CRUDA: %  (esperado: verdict = recount)', v_res;
END $$;
ROLLBACK;

-- ═════════════════════════════════════════════════════════════════════════
-- §4.4 · UNA LÍNEA `needs_review` NO LA APLICA `autoclose_daily_count`
-- ═════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  v_count uuid; v_line uuid; v_antes integer; v_despues integer; v_r record;
BEGIN
  SELECT ic.id INTO v_count FROM inventory_count ic
   WHERE ic.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     AND ic.kind = 'cycle' AND ic.status IN ('abierto','contando')
   ORDER BY ic.created_at DESC LIMIT 1;
  IF v_count IS NULL THEN
    RAISE NOTICE '§4.4 SIN PROBAR: no hay conteo cíclico abierto';
    RETURN;
  END IF;

  -- Se marca UNA línea contada como needs_review, a mano, para el ensayo.
  SELECT id INTO v_line FROM inventory_count_line
   WHERE inventory_count_id = v_count AND counted_qty IS NOT NULL LIMIT 1;
  IF v_line IS NULL THEN
    RAISE NOTICE '§4.4 SIN PROBAR: el conteo % no tiene ninguna línea contada', v_count;
    RETURN;
  END IF;
  UPDATE inventory_count_line
     SET needs_review = true, reason_code = NULL, within_tolerance = false
   WHERE id = v_line;

  SELECT count(*) INTO v_antes FROM stock_movement
   WHERE source_type = 'inventory_count' AND source_id = v_count;

  SELECT * INTO v_r FROM autoclose_daily_count(v_count);

  SELECT count(*) INTO v_despues FROM stock_movement sm
   JOIN inventory_count_line l ON l.recipe_item_id = sm.recipe_item_id
   WHERE sm.source_type = 'inventory_count' AND sm.source_id = v_count AND l.id = v_line;

  RAISE NOTICE '§4.4  cerrado=%  aplicadas=%  pendientes=%  estado=%  · movimientos de LA línea marcada: % (esperado 0)',
    v_r.closed, v_r.applied, v_r.pending_anomalies, v_r.final_status, v_despues;
  IF v_despues > 0 THEN
    RAISE EXCEPTION '§4.4 FALLA: se ha aplicado una línea needs_review';
  END IF;
END $$;
ROLLBACK;

-- ═════════════════════════════════════════════════════════════════════════
-- §4.5 · «OTRO» SIN NOTA NO SE PUEDE GUARDAR
-- ═════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE v_line uuid;
BEGIN
  SELECT id INTO v_line FROM inventory_count_line
   WHERE account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' LIMIT 1;
  BEGIN
    UPDATE inventory_count_line SET reason_code = 'otro', reason_note = NULL WHERE id = v_line;
    RAISE EXCEPTION '§4.5 FALLA: se ha guardado «otro» sin nota';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '§4.5 OK: «otro» sin nota rechazado por la BBDD (%)', sqlerrm;
  END;
  -- Y con nota, entra.
  UPDATE inventory_count_line
     SET reason_code = 'otro', reason_note = 'Ensayo de verificación del 10/09'
   WHERE id = v_line;
  RAISE NOTICE '§4.5 OK: con nota sí entra';
END $$;
ROLLBACK;

-- Y los dos motivos nuevos existen:
SELECT pg_get_constraintdef(oid) AS motivos_validos
  FROM pg_constraint
 WHERE conrelid = 'public.inventory_count_line'::regclass
   AND conname = 'inventory_count_line_reason_code_check';

-- ═════════════════════════════════════════════════════════════════════════
-- §4.6 · EL COSTE MEDIO, DESPUÉS DE RECALCULAR
--
-- El recálculo NO va aquí: es un botón que escribe en lote y necesita su
-- ensayo con nombres delante (§5). Va en el parte, aparte. Esto MIDE.
-- Esperado tras recalcular: 0 filas con coste negativo, 49 sin coste (de 120),
-- y el valor total del stock 41.442,43 € → 49.181,59 €.
-- ═════════════════════════════════════════════════════════════════════════
SELECT l.name AS local,
       count(*) AS filas,
       count(*) FILTER (WHERE s.avg_unit_cost < 0)    AS coste_negativo,
       count(*) FILTER (WHERE s.avg_unit_cost IS NULL) AS sin_coste,
       round(sum(s.stock_value)::numeric, 2)          AS valor
  FROM recipe_item_location_stock s
  JOIN recipe_item ri ON ri.id = s.recipe_item_id
  JOIN locations l ON l.id = s.location_id
 WHERE s.account_id = :'cuenta' AND ri.is_active
 GROUP BY l.name ORDER BY l.name;

SELECT ri.name AS articulo, l.name AS local,
       round(s.qty_on_hand, 2) AS stock,
       round(s.avg_unit_cost, 4) AS coste,
       round(s.stock_value::numeric, 2) AS valor
  FROM recipe_item_location_stock s
  JOIN recipe_item ri ON ri.id = s.recipe_item_id
  JOIN locations l ON l.id = s.location_id
 WHERE s.account_id = :'cuenta'
   AND ri.name IN ('Coca-Cola Zero Lata', 'Coca-Cola Original Lata', 'Carne de Birria')
 ORDER BY ri.name, l.name;
