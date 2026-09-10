-- supabase/verificacion/20260910_recalcular_coste_medio.sql
--
-- EL BOTÓN GRANDE DEL §2.5, CON SU ENSAYO DELANTE.
--
-- Cambiar `recompute_location_stock_core` (migración p8) no reescribe nada por
-- sí solo: las 453 filas de `recipe_item_location_stock` siguen con el coste
-- viejo hasta que se vuelvan a calcular. Esto es lo que las recalcula, y §5
-- dice que ningún botón que escriba en lote se pulsa sin su ensayo con nombres
-- propios delante. Así que va en DOS PASOS y el primero no escribe.
--
-- ORDEN: primero el PASO 0 con Julio delante. Sólo si los números cuadran con
-- los del parte, el PASO 1.

-- ═════════════════════════════════════════════════════════════════════════
-- PASO 0 · ENSAYO. NO ESCRIBE NADA.
--
-- Recorre el libro con la fórmula nueva y enseña el antes/después sin tocar la
-- tabla. Los números que tiene que dar, medidos el 10/09 ANTES de aplicar:
--
--   453 filas · sin coste 120 → 49 · negativo 50 → 0 · cambian 334
--   valor total 41.442,43 € → 49.181,59 €
--   Alcalá         34.566,95 → 38.442,12   (neg 11 → 0)
--   Carabanchel     2.551,01 →  5.777,71   (neg 23 → 0)
--   Plaza Castilla  4.324,47 →  4.961,76   (neg 16 → 0)
--
-- Si NO dan eso, algo se ha movido entre medias y hay que parar y contarlo.
-- ═════════════════════════════════════════════════════════════════════════
WITH RECURSIVE mv AS (
  SELECT recipe_item_id, location_id, qty_base, unit_cost,
         row_number() OVER (PARTITION BY recipe_item_id, location_id
                            ORDER BY occurred_at, id) AS rn
    FROM stock_movement
   WHERE account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
),
walk AS (
  SELECT recipe_item_id, location_id, rn, qty_base AS qty,
         CASE WHEN qty_base > 0 AND unit_cost > 0 THEN unit_cost END AS avg
    FROM mv WHERE rn = 1
  UNION ALL
  SELECT m.recipe_item_id, m.location_id, m.rn, w.qty + m.qty_base,
         CASE WHEN m.qty_base > 0 AND m.unit_cost > 0
              THEN CASE WHEN w.avg IS NULL OR GREATEST(w.qty, 0) = 0 THEN m.unit_cost
                        ELSE (GREATEST(w.qty,0) * w.avg + m.qty_base * m.unit_cost)
                             / (GREATEST(w.qty,0) + m.qty_base) END
              ELSE w.avg END
    FROM walk w
    JOIN mv m ON m.recipe_item_id = w.recipe_item_id
             AND m.location_id    = w.location_id
             AND m.rn = w.rn + 1
),
fin AS (
  SELECT DISTINCT ON (recipe_item_id, location_id) recipe_item_id, location_id, avg
    FROM walk ORDER BY recipe_item_id, location_id, rn DESC
),
comp AS (
  SELECT ri.name AS articulo, l.name AS local, s.qty_on_hand,
         s.avg_unit_cost AS antes, s.stock_value AS valor_antes,
         COALESCE(f.avg,
                  CASE WHEN ri.computed_cost > 0 THEN ri.computed_cost
                       WHEN ri.fixed_cost > 0    THEN ri.fixed_cost END) AS despues
    FROM recipe_item_location_stock s
    JOIN recipe_item ri ON ri.id = s.recipe_item_id
    JOIN locations l ON l.id = s.location_id
    LEFT JOIN fin f ON f.recipe_item_id = s.recipe_item_id
                   AND f.location_id    = s.location_id
   WHERE s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' AND ri.is_active
)
SELECT local,
       count(*) AS filas,
       count(*) FILTER (WHERE antes   IS NULL) AS sin_coste_antes,
       count(*) FILTER (WHERE despues IS NULL) AS sin_coste_despues,
       count(*) FILTER (WHERE antes   < 0)     AS negativo_antes,
       count(*) FILTER (WHERE despues < 0)     AS negativo_despues,
       count(*) FILTER (WHERE antes IS DISTINCT FROM despues) AS cambian,
       round(sum(valor_antes)::numeric, 2)                    AS valor_antes,
       round(sum(qty_on_hand * despues)::numeric, 2)          AS valor_despues
  FROM comp
 GROUP BY ROLLUP (local)
 ORDER BY local NULLS LAST;

-- Las 20 que más se mueven, CON SU NOMBRE. Es la parte que hay que leer una a
-- una: aquí es donde se ve si alguna sube o baja por una razón que no cuadra.
-- Ojo a las que BAJAN mucho —Albahaca 7,15 → 0,03 €/g, Tortilla Trigo 30 cm
-- 5,22 → 0,23 €/ud—: son fichas cuyo coste viejo venía de una media sobre un
-- libro con salidas dentro, no de una compra real.
-- (misma CTE; se repite entera para poder ejecutar este bloque suelto)
WITH RECURSIVE mv AS (
  SELECT recipe_item_id, location_id, qty_base, unit_cost,
         row_number() OVER (PARTITION BY recipe_item_id, location_id ORDER BY occurred_at, id) AS rn
    FROM stock_movement WHERE account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'),
walk AS (
  SELECT recipe_item_id, location_id, rn, qty_base AS qty,
         CASE WHEN qty_base > 0 AND unit_cost > 0 THEN unit_cost END AS avg FROM mv WHERE rn = 1
  UNION ALL
  SELECT m.recipe_item_id, m.location_id, m.rn, w.qty + m.qty_base,
         CASE WHEN m.qty_base > 0 AND m.unit_cost > 0
              THEN CASE WHEN w.avg IS NULL OR GREATEST(w.qty,0) = 0 THEN m.unit_cost
                        ELSE (GREATEST(w.qty,0)*w.avg + m.qty_base*m.unit_cost)/(GREATEST(w.qty,0)+m.qty_base) END
              ELSE w.avg END
    FROM walk w JOIN mv m ON m.recipe_item_id = w.recipe_item_id
              AND m.location_id = w.location_id AND m.rn = w.rn + 1),
fin AS (SELECT DISTINCT ON (recipe_item_id, location_id) recipe_item_id, location_id, avg
          FROM walk ORDER BY recipe_item_id, location_id, rn DESC),
comp AS (
  SELECT ri.name AS articulo, l.name AS local, s.qty_on_hand, s.avg_unit_cost AS antes,
         COALESCE(f.avg, CASE WHEN ri.computed_cost > 0 THEN ri.computed_cost
                              WHEN ri.fixed_cost > 0 THEN ri.fixed_cost END) AS despues
    FROM recipe_item_location_stock s JOIN recipe_item ri ON ri.id = s.recipe_item_id
    JOIN locations l ON l.id = s.location_id
    LEFT JOIN fin f ON f.recipe_item_id = s.recipe_item_id AND f.location_id = s.location_id
   WHERE s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' AND ri.is_active)
SELECT articulo, local, round(qty_on_hand, 2) AS stock,
       round(antes, 4) AS coste_antes, round(despues, 4) AS coste_despues,
       round((qty_on_hand * antes)::numeric, 2)   AS valor_antes,
       round((qty_on_hand * despues)::numeric, 2) AS valor_despues
  FROM comp
 WHERE antes IS DISTINCT FROM despues
 ORDER BY abs(COALESCE(qty_on_hand * despues, 0) - COALESCE(qty_on_hand * antes, 0)) DESC
 LIMIT 20;

-- ═════════════════════════════════════════════════════════════════════════
-- PASO 1 · EL RECÁLCULO. ESCRIBE. Sólo con el PASO 0 cuadrando.
--
-- Recorre las 453 filas llamando a la función nueva, una a una. Va en UNA
-- transacción: o quedan todas con el coste nuevo o ninguna, que es lo que hace
-- falta para que el valor total del stock no quede a medias entre dos fórmulas
-- durante minutos.
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
--   -- Regla 8: confirma con CONTENIDO, no con un visto.
--   RAISE NOTICE 'Recalculadas % filas artículo × local', n;
-- END $$;
-- COMMIT;

-- ═════════════════════════════════════════════════════════════════════════
-- PASO 2 · `variance_value` DE LOS RECUENTOS APROBADOS DESDE EL 01/08.
--
-- También con ensayo: primero se mira cuántas líneas cambian y cuánto, y
-- después se escriben. Un `variance_value` es lo que alguien miró para decidir;
-- reescribirlo sin enseñar antes cuánto se mueve es cambiarle el pasado a
-- quien tomó la decisión.
-- ═════════════════════════════════════════════════════════════════════════
-- ENSAYO (no escribe):
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
--   FROM inventory_count ic
--   LEFT JOIN recipe_item_location_stock ril ON true
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
