-- supabase/vuelta-atras/20261118T2029_q05_interruptor_nucleo.down.sql
--
-- Q05 · la vuelta atrás: las dos funciones de la ficha, desde su respaldo (las tres claves de la
-- S01f). Las filas conta_nucleo de feature_flags se quedan como estén: no se borra nada.
select public._restaurar_funcion('public.conta_interruptores_de_cuenta(uuid)', '20261118T2029_q05_interruptor_nucleo');
select public._restaurar_funcion('public.conta_interruptor_cambiar(uuid,text,boolean,text)', '20261118T2029_q05_interruptor_nucleo');
