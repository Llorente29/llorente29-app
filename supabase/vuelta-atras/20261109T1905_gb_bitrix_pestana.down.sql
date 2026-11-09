-- supabase/vuelta-atras/20261109T1905_gb_bitrix_pestana.down.sql
--
-- Vuelta atrás de la 1905 del GB: se quita la función de la pestaña. Solo leía:
-- no hay datos que devolver.
drop function if exists public.conta_bitrix_pestana_leer(text, text, text, text);
