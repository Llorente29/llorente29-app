-- supabase/vuelta-atras/20261109T2235_gb_pestana_alta_baja.down.sql
--
-- Vuelta atrás de la 2235 del GB: fuera las dos funciones y la tabla de lo
-- hecho desde la pestaña. Las altas y bajas hechas siguen en Sumied (son de las
-- funciones de la ficha): solo se pierde el registro de qué se hizo desde Bitrix24.
drop function if exists public.conta_bitrix_pestana_bitrix(uuid, jsonb);
drop function if exists public.conta_bitrix_pestana_hacer(text, text, text, text, text, jsonb);
drop table if exists public.conta_bitrix_pestana_cambio;
