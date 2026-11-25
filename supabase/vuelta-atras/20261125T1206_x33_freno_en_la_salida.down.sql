-- X33 · vuelta atrás de 20261125T1206: las tres funciones de la salida a ERP10, desde su respaldo (sin el freno).
-- No toca ninguna fila.
select public._restaurar_funcion('public.conta_erp10_por_salir(uuid,date)', '20261125T1206_x33_freno_en_la_salida');
select public._restaurar_funcion('public.conta_erp10_cola(integer)', '20261125T1206_x33_freno_en_la_salida');
select public._restaurar_funcion('public.conta_erp10_atascados(uuid)', '20261125T1206_x33_freno_en_la_salida');
