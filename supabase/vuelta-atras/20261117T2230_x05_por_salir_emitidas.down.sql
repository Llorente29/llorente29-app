-- supabase/vuelta-atras/20261117T2230_x05_por_salir_emitidas.down.sql
--
-- X05 · Vuelta atrás: conta_erp10_por_salir como estaba antes de la 2230 (la del
-- X04a), restaurada byte a byte del respaldo que guardó la migración
-- (_restaurar_funcion comprueba la huella). Misma firma.

select public._restaurar_funcion('public.conta_erp10_por_salir(uuid,date)', '20261117T2230_x05_por_salir_emitidas');
