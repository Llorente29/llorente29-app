-- supabase/vuelta-atras/20261110T0857_gd_vaciar_por_tandas.down.sql
--
-- Vuelta atrás de la 0857: se quita la función por tandas. La migración no
-- vacía nada por sí sola (solo el botón, en una demo), así que no hay datos que
-- devolver. La de la 1731 sigue donde estaba.
drop function if exists public.demo_gestoria_volver_a_empezar_tanda(uuid, int);
