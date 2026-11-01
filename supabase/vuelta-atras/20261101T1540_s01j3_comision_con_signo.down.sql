-- supabase/vuelta-atras/20261101T1540_s01j3_comision_con_signo.down.sql
--
-- Vuelta atrás de la 1540: conta_liquidacion_registrar como estaba (su respaldo, byte a byte).
select public._restaurar_funcion('public.conta_liquidacion_registrar(uuid,jsonb,text)', '20261101T1540_s01j3_comision_con_signo');
