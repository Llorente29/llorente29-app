-- supabase/vuelta-atras/20261118T0745_x07_por_salir_asientos.down.sql
--
-- X07 · Vuelta atrás: conta_erp10_por_salir como estaba antes de la 0745 (la del
-- X05), restaurada byte a byte del respaldo que guardó la migración
-- (_restaurar_funcion comprueba la huella). Misma firma.

select public._restaurar_funcion('public.conta_erp10_por_salir(uuid,date)', '20261118T0745_x07_por_salir_asientos');
