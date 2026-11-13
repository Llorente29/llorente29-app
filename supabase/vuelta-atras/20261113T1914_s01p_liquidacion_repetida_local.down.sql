-- supabase/vuelta-atras/20261113T1914_s01p_liquidacion_repetida_local.down.sql
--
-- S01p·21b · la vuelta atrás: conta_liquidacion_dejar_esta desde su respaldo (copia los apuntes tal cual).
select public._restaurar_funcion('public.conta_liquidacion_dejar_esta(uuid,uuid,text)', '20261113T1914_s01p_liquidacion_repetida_local');
