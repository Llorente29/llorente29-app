-- supabase/vuelta-atras/20261110T1010_gb_pestana_suelto.down.sql
--
-- Vuelta atrás de la 1010 del GB: fuera las dos funciones. Los trabajos sueltos
-- ya puestos siguen en Sumied (los puso la función de Code 1) y lo apuntado
-- desde la pestaña se queda (la acción «suelto» es de la 0950).
drop function if exists public.conta_bitrix_pestana_suelto_poner(text, text, text, text, uuid, uuid, text, numeric);
drop function if exists public.conta_bitrix_pestana_sueltos(text, text, text, text, uuid);
