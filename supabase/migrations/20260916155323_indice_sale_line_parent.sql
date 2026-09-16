-- ============================================================================
-- APLICADA el 16/09 a las 15:53:23 UTC = 17:53 de Madrid, con el sí de Julio y
-- con la ventana nueva: miércoles, las dos tiendas cerradas entre comida y
-- cena, 0 pedidos en la última hora. La regla de «desde las 23:45» la anuló
-- Julio esa misma tarde.
--
-- POR QUÉ ESPERABA: `sale_line` está en el camino del pedido —la escriben
-- adapt_lastapp_order y adapt_hubrise_order, la lee _sale_line_raw_consumption
-- en cada cierre de venta— y un CREATE INDEX toma ACCESS EXCLUSIVE sobre ella.
-- Es el caso 2 de la banda de CLAUDE.md: espera, aunque tarde poco.
--
-- QUÉ ARREGLA, medido el 16/09 y pegado:
--
--   `sale_line` no tiene índice por `parent_sale_line_id`. Cada llamada a
--   _sale_line_raw_consumption hace al menos dos consultas con ese filtro, y
--   las dos barren la tabla entera:
--
--     explain (analyze) select 1 from sale_line c
--      where c.parent_sale_line_id = '…' and c.line_type = 'combo_item';
--     → Seq Scan on sale_line (actual time=9.287..9.287 rows=0 loops=1)
--       Rows Removed by Filter: 31563
--       Execution Time: 9.351 ms
--
--   Efecto en el parte del 15/09 de Foodint (263 líneas):
--     · el cuadre entero .............................. 5,180 s
--     · solo el bloque `esp` (el que llama a la función) 5,139 s
--     · todo lo demás ................................... 0,005 s
--     · reventar las 74 fichas distintas del día ........ 0,078 s
--   O sea: no es la receta lo que cuesta, es el barrido.
--
--   Y no es solo el parte: `generate_sale_consumption` llama a la misma función
--   línea a línea EN CADA VENTA que se cierra. El barrido se está pagando en el
--   camino del pedido, en servicio, desde siempre.
--
-- EL DESPUÉS, MEDIDO CON LA MISMA VARA (regla 31), minutos después de aplicar:
--
--   | lo medido                                    | antes    | después  |
--   |----------------------------------------------|----------|----------|
--   | la consulta por parent_sale_line_id          | 9,205 ms | 0,181 ms |
--   | el cuadre entero del 15/09                   | 5,154 s  | 0,261 s  |
--   | generate_sale_consumption sobre G190 (27 mov.)| 0,208 s | 0,077 s  |
--
--   El plan pasa de `Seq Scan … Rows Removed by Filter: 31615` a
--   `Index Scan using idx_sale_line_parent`. Y las cifras del parte no se
--   mueven: 94 pedidos, 992 bien, 0 faltan, 5 retenidos, antes y después.
--
--   Con eso, la comprobación 6 del §5 (ninguna consulta del parte por encima de
--   2 s) queda CUMPLIDA: 0,261 s.
--
-- Tamaño de la tabla al medir: 31.563 filas, 11 MB. La construcción del índice
-- es de menos de un segundo; aun así espera, porque la regla no mide la
-- duración del cierre sino que lo tome.
-- ============================================================================

create index if not exists idx_sale_line_parent
  on public.sale_line (parent_sale_line_id)
  where parent_sale_line_id is not null;

comment on index public.idx_sale_line_parent is
'Para _sale_line_raw_consumption, que pregunta por los hijos de una línea (combo_item y modifier) en cada cierre de venta y en cada parte del día. Sin él, cada pregunta barría las 31.563 filas de sale_line: 9,35 ms por llamada, 5,1 s por parte. Medido el 16/09.';
