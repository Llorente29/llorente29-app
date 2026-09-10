-- supabase/verificacion/20260910_recalcular_coste_medio.sql
--
-- EL BOTÓN GRANDE DEL §2.5, CON SU ENSAYO DELANTE.
-- Segunda vuelta, con las dos correcciones de Julio del 10/09:
--   (1) sólo las RECEPCIONES mueven la media, no los ajustes de recuento;
--   (2) una recepción con el coste más de ×5 fuera de su ficha NO entra en la
--       media hasta que alguien la corrija.
--
-- Cambiar `recompute_location_stock_core` (migración p8) no reescribe nada por
-- sí solo: las 453 filas de `recipe_item_location_stock` siguen con el coste
-- viejo hasta que se vuelvan a calcular. Esto es lo que las recalcula, y §5
-- dice que ningún botón que escriba en lote se pulsa sin su ensayo con nombres
-- propios delante. Va en PASOS y los dos primeros no escriben.

-- ═════════════════════════════════════════════════════════════════════════
-- PASO 0a · LAS RECEPCIONES QUE SE QUEDAN FUERA DE LA MEDIA. NO ESCRIBE.
--
-- 53 de 911, en 23 artículos. Esta lista es para CORREGIRLAS, no para mirarla:
-- mientras estén mal, el artículo se valora por su coste de ficha.
--
-- La última columna es la que dice qué corregir. Si la MEDIANA de todas las
-- recepciones del artículo coincide con la ficha, la rara es esa recepción. Si
-- la mediana también se aparta ×5, entonces las recepciones concuerdan entre
-- ellas y la rara es LA FICHA. Medido el 10/09: en 21 de 23 la rara es la
-- recepción; en DOS es la ficha, y esos dos hay que arreglarlos por ahí:
--
--   Humus              ficha 0,0000072 €/g · mediana de recepciones 0,0065 (×900)
--   Tapa Salsero 120   ficha 0,0045 €/ud   · mediana de recepciones 0,0356 (×8)
--
-- Con la ficha mala, la banda deja fuera las recepciones BUENAS y el artículo
-- cae a un coste que no vale: Tapa Salsero pasa de 562 € a 0,89 €. No es un
-- fallo de la regla, es la regla diciendo dónde mirar.
-- ═════════════════════════════════════════════════════════════════════════
WITH rec AS (
  SELECT sm.id, sm.occurred_at::date AS dia, sm.qty_base, sm.unit_cost,
         sm.recipe_item_id, ri.name AS articulo, l.name AS local,
         u.abbreviation AS base,
         COALESCE(NULLIF(ri.computed_cost, 0), NULLIF(ri.fixed_cost, 0)) AS ficha
    FROM stock_movement sm
    JOIN recipe_item ri ON ri.id = sm.recipe_item_id
    JOIN locations l ON l.id = sm.location_id
    LEFT JOIN kitchen_unit u ON u.id = ri.base_unit_id
   WHERE sm.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     AND sm.qty_base > 0 AND sm.unit_cost > 0
     AND (sm.source_type = 'goods_receipt_line'
          OR sm.movement_type IN ('recepcion', 'traspaso_entrada'))
),
mediana AS (
  SELECT recipe_item_id,
         (percentile_cont(0.5) WITHIN GROUP (ORDER BY unit_cost))::numeric AS med,
         count(*) AS n_rec
    FROM rec GROUP BY recipe_item_id
)
SELECT r.articulo, r.local, r.dia,
       round(r.qty_base, 2) AS cantidad, r.base,
       round(r.unit_cost, 4) AS coste_puesto,
       round(r.ficha, 4)     AS coste_ficha,
       round(r.unit_cost / r.ficha, 1) AS veces,
       m.n_rec AS recepciones_del_articulo,
       round(m.med, 4) AS mediana_de_todas,
       CASE WHEN m.med > 5 * r.ficha OR m.med < r.ficha / 5
            THEN '⚠ LA RARA ES LA FICHA — arregla la ficha, no la recepción'
            ELSE 'la rara es esta recepción' END AS que_corregir
  FROM rec r JOIN mediana m ON m.recipe_item_id = r.recipe_item_id
 WHERE r.ficha IS NOT NULL
   AND (r.unit_cost > 5 * r.ficha OR r.unit_cost < r.ficha / 5)
 ORDER BY que_corregir, abs(ln(r.unit_cost / r.ficha)) DESC;

-- ═════════════════════════════════════════════════════════════════════════
-- PASO 0b · EL ANTES/DESPUÉS. NO ESCRIBE.
--
-- Los números que tiene que dar, medidos el 10/09 con las dos correcciones:
--
--   453 filas · sin coste 120 → 49 · NEGATIVO 50 → 0 · cambian 339
--   valor total 41.442,43 € → 49.735,98 €
--   Alcalá         196 filas · neg 11 → 0 · 34.566,95 → 38.486,15 €
--   Carabanchel    139 filas · neg 23 → 0 ·  2.551,01 →  6.233,60 €
--   Plaza Castilla 118 filas · neg 16 → 0 ·  4.324,47 →  5.016,23 €
--
-- Y los dos casos que destaparon las correcciones:
--   Aceite Oliva Suave · Carabanchel  0,1070 → 0,0122 €/ml  (107 €/litro → 12,2)
--   CAJA GENERICA 780  · Alcalá       6,5461 → 0,2014 €/ud  (3.273 € → 100,72 €)
--
-- Si NO dan eso, algo se ha movido entre medias: parar y contarlo.
-- ═════════════════════════════════════════════════════════════════════════
WITH RECURSIVE ok AS MATERIALIZED (
  SELECT sm.recipe_item_id AS it, sm.location_id AS lo, sm.qty_base AS q,
         -- El coste que MUEVE la media: recepción, positiva, con coste y en
         -- banda. Todo lo demás va como NULL y sólo mueve la cantidad.
         CASE WHEN sm.qty_base > 0
               AND (sm.source_type = 'goods_receipt_line'
                    OR sm.movement_type IN ('recepcion', 'traspaso_entrada'))
               AND sm.unit_cost > 0
               AND (COALESCE(NULLIF(ri.computed_cost,0), NULLIF(ri.fixed_cost,0)) IS NULL
                    OR (sm.unit_cost <= COALESCE(NULLIF(ri.computed_cost,0), NULLIF(ri.fixed_cost,0)) * 5
                    AND sm.unit_cost >= COALESCE(NULLIF(ri.computed_cost,0), NULLIF(ri.fixed_cost,0)) / 5))
              THEN sm.unit_cost END AS c,
         row_number() OVER (PARTITION BY sm.recipe_item_id, sm.location_id
                            ORDER BY sm.occurred_at, sm.id) AS rn
    FROM stock_movement sm JOIN recipe_item ri ON ri.id = sm.recipe_item_id
   WHERE sm.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
),
walk AS (
  SELECT it, lo, rn, q AS qty, c AS avg FROM ok WHERE rn = 1
  UNION ALL
  SELECT m.it, m.lo, m.rn, w.qty + m.q,
         CASE WHEN m.c IS NULL THEN w.avg
              WHEN w.avg IS NULL OR GREATEST(w.qty, 0) = 0 THEN m.c
              ELSE (GREATEST(w.qty,0) * w.avg + m.q * m.c) / (GREATEST(w.qty,0) + m.q) END
    FROM walk w JOIN ok m ON m.it = w.it AND m.lo = w.lo AND m.rn = w.rn + 1
),
fin AS (SELECT DISTINCT ON (it, lo) it, lo, avg FROM walk ORDER BY it, lo, rn DESC),
comp AS (
  SELECT ri.name AS articulo, l.name AS local, s.qty_on_hand,
         s.avg_unit_cost AS antes, s.stock_value AS valor_antes,
         COALESCE(f.avg, CASE WHEN ri.computed_cost > 0 THEN ri.computed_cost
                              WHEN ri.fixed_cost > 0    THEN ri.fixed_cost END) AS despues,
         (f.avg IS NULL) AS cae_a_ficha
    FROM recipe_item_location_stock s
    JOIN recipe_item ri ON ri.id = s.recipe_item_id
    JOIN locations l ON l.id = s.location_id
    LEFT JOIN fin f ON f.it = s.recipe_item_id AND f.lo = s.location_id
   WHERE s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' AND ri.is_active
)
SELECT COALESCE(local, '★ TOTAL') AS local,
       count(*) AS filas,
       count(*) FILTER (WHERE antes   IS NULL) AS sin_coste_antes,
       count(*) FILTER (WHERE despues IS NULL) AS sin_coste_despues,
       count(*) FILTER (WHERE antes   < 0)     AS negativo_antes,
       count(*) FILTER (WHERE despues < 0)     AS negativo_despues,
       count(*) FILTER (WHERE antes IS DISTINCT FROM despues) AS cambian,
       count(*) FILTER (WHERE cae_a_ficha)     AS caen_al_coste_de_ficha,
       round(sum(valor_antes)::numeric, 2)            AS valor_antes,
       round(sum(qty_on_hand * despues)::numeric, 2)  AS valor_despues
  FROM comp
 GROUP BY ROLLUP (local)
 ORDER BY local NULLS LAST;

-- ═════════════════════════════════════════════════════════════════════════
-- PASO 1 · EL RECÁLCULO. ESCRIBE. Sólo con los PASOS 0a y 0b cuadrando.
--
-- Va en UNA transacción: o quedan las 453 con el coste nuevo o ninguna. Si se
-- queda a medias, el valor total del stock estaría durante minutos sumando dos
-- fórmulas distintas, que es peor que estar mal del todo — porque nadie lo
-- notaría.
-- ═════════════════════════════════════════════════════════════════════════
-- BEGIN;
-- DO $$
-- DECLARE r record; n integer := 0;
-- BEGIN
--   FOR r IN
--     SELECT s.recipe_item_id, s.location_id
--       FROM recipe_item_location_stock s
--      WHERE s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
--   LOOP
--     PERFORM recompute_location_stock_core(r.recipe_item_id, r.location_id);
--     n := n + 1;
--   END LOOP;
--   RAISE NOTICE 'Recalculadas % filas artículo × local', n;   -- regla 8
-- END $$;
-- COMMIT;

-- ═════════════════════════════════════════════════════════════════════════
-- PASO 2 · `variance_value` DE LOS RECUENTOS APROBADOS DESDE EL 01/08.
-- Con ensayo delante: un `variance_value` es lo que alguien miró para decidir,
-- y reescribirlo sin enseñar cuánto se mueve es cambiarle el pasado.
-- ═════════════════════════════════════════════════════════════════════════
SELECT count(*) AS lineas,
       count(*) FILTER (WHERE l.variance_value IS DISTINCT FROM
                              l.variance_qty * ril.avg_unit_cost) AS cambian,
       round(sum(l.variance_value)::numeric, 2)                    AS suma_antes,
       round(sum(l.variance_qty * ril.avg_unit_cost)::numeric, 2)  AS suma_despues
  FROM inventory_count_line l
  JOIN inventory_count ic ON ic.id = l.inventory_count_id
  LEFT JOIN recipe_item_location_stock ril
         ON ril.recipe_item_id = l.recipe_item_id
        AND ril.location_id    = ic.location_id
        AND ril.account_id     = ic.account_id
 WHERE ic.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   AND ic.status = 'aprobado'
   AND ic.created_at >= '2026-08-01'
   AND l.counted_qty IS NOT NULL;

-- ESCRITURA (descomentar sólo con el ensayo delante):
-- BEGIN;
-- UPDATE inventory_count_line l
--    SET variance_value = l.variance_qty * ril.avg_unit_cost
--   FROM inventory_count ic, recipe_item_location_stock ril
--  WHERE ic.id = l.inventory_count_id
--    AND ril.recipe_item_id = l.recipe_item_id
--    AND ril.location_id    = ic.location_id
--    AND ril.account_id     = ic.account_id
--    AND ic.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
--    AND ic.status = 'aprobado'
--    AND ic.created_at >= '2026-08-01'
--    AND l.counted_qty IS NOT NULL
--    -- El saneamiento de negativos NO se toca: ahí el 0 es un cero de verdad.
--    AND COALESCE(l.system_qty, 0) >= 0;
-- COMMIT;
