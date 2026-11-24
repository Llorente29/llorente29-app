-- K10b · vuelta atrás de 20261121T2151: conta_motivos_para_validar desde su respaldo (la regla 11 con el tipo de su ficha,
-- como antes). Va antes que la de la 2150, que quita conta_operacion_clase y conta_operacion_nombre (las que lee esta).
select public._restaurar_funcion('public.conta_motivos_para_validar(uuid)', '20261121T2151_k10b_regla_11_lee_la_factura');
