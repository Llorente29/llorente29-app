-- supabase/vuelta-atras/20261109T1731_gd_volver_a_empezar.down.sql
--
-- Vuelta atrás de la 1731: se quitan las dos funciones. La migración no vacía
-- nada por sí sola (solo el botón, en una demo), así que no hay datos que devolver.
drop function if exists public.demo_gestoria_volver_a_empezar(uuid);
drop function if exists public._gd_se_queda();
