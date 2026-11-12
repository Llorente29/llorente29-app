-- supabase/vuelta-atras/20261109T2345_gp_portal_bitrix.down.sql
--
-- GP · La vuelta atrás de la 2345: fuera las tres funciones de la pestaña de
-- Bitrix24. Lo que ya se hizo con ellas (accesos, mensajes) se queda: es uso de
-- verdad, igual que desde Sumied.
-- sin prueba con datos: la prueba de staging (20261109_gp_portal_bitrix_prueba.sql) la pasa en ROLLBACK y comprueba que no queda ninguna.

drop function if exists public.conta_portal_bitrix_contestar(text, text, text, text, text);
drop function if exists public.conta_portal_bitrix_invitar(text, text, text, text, text, text, text);
drop function if exists public._conta_portal_bitrix_quien(text, text, text, text);
