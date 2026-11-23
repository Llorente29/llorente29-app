-- K11b · vuelta atrás de 20261123T1750: conta_recibida_otros_datos desde su respaldo (cada línea vuelve a escribir sus
-- tres datos juntos). No toca ninguna fila: lo guardado se queda.
select public._restaurar_funcion('public.conta_recibida_otros_datos(uuid,jsonb,text)', '20261123T1750_k11b_lineas_solo_lo_que_cambia');
