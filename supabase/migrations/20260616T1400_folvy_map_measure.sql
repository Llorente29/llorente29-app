-- ═══════════════════════════════════════════════════════════════════════
-- Mapa de Folvy — RPC de medición de estado (sesión 16/06/2026)
-- folvy_map_measure(): para cada measure_table DISTINTA y no nula de los nodos
-- del mapa, devuelve un conteo ESTIMADO de filas (pg_stat_user_tables.n_live_tup).
-- Sirve para "vacío vs poblado", que es lo único que el mapa necesita — sin contar
-- filas reales por tabla (caro e innecesario). SECURITY DEFINER: lee el catálogo
-- del sistema. La tabla folvy_map_node NO se toca aquí (ya creada y sembrada con
-- 39 nodos); esta migración solo añade la función de medición.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.folvy_map_measure()
RETURNS TABLE(measure_table text, filas bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT n.measure_table, COALESCE(s.n_live_tup, 0)::bigint
  FROM (SELECT DISTINCT measure_table FROM folvy_map_node
        WHERE measure_table IS NOT NULL) n
  LEFT JOIN pg_stat_user_tables s
    ON s.schemaname='public' AND s.relname = n.measure_table;
$$;
