-- supabase/vuelta-atras/20261109T2300_gb_pestana_portal.down.sql
--
-- Vuelta atrás de la 2300 del GB: fuera las dos funciones. Lo hecho desde la
-- pestaña (peticiones hechas) sigue en Sumied: lo hizo la función de Code 3.
drop function if exists public.conta_bitrix_pestana_portal(text, text, text, text, uuid, uuid);
drop function if exists public._conta_bitrix_pestana_bitrix_de(uuid, text, text);
