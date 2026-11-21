-- supabase/vuelta-atras/20261120T2011_x10f_lote_desde_el_servidor.down.sql
--
-- X10f · Vuelta atrás: conta_erp10_lote_apuntar como estaba antes de la 2011 (la del X02),
-- restaurada byte a byte del respaldo que guardó la migración (_restaurar_funcion comprueba la
-- huella). Misma firma.

select public._restaurar_funcion('public.conta_erp10_lote_apuntar(uuid,date,jsonb,jsonb,text)', '20261120T2011_x10f_lote_desde_el_servidor');
