-- supabase/vuelta-atras/20261110T0040_gb_bitrix_campos.down.sql
--
-- Vuelta atrás de la 0040 del GB: fuera la función. Lo escrito en Bitrix24 se
-- queda allí (y apuntado en conta_bitrix_pestana_cambio).
drop function if exists public.conta_bitrix_pestana_campos(uuid);
