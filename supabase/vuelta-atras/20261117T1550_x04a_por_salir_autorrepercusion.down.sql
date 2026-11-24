-- supabase/vuelta-atras/20261117T1550_x04a_por_salir_autorrepercusion.down.sql
--
-- X04a · Vuelta atrás: conta_erp10_por_salir como estaba antes de la 1550 (la de la
-- X02), restaurada byte a byte del respaldo que guardó la migración
-- (_restaurar_funcion comprueba la huella). Misma firma.

select public._restaurar_funcion('public.conta_erp10_por_salir(uuid,date)', '20261117T1550_x04a_por_salir_autorrepercusion');
