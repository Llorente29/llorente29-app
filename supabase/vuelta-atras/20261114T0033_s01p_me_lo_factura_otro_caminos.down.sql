-- supabase/vuelta-atras/20261114T0033_s01p_me_lo_factura_otro_caminos.down.sql
--
-- S01p·20·2 · la vuelta atrás de lo que cambia: las cuatro funciones desde su respaldo.
select public._restaurar_funcion('public._compras_camino_calcula(uuid)', '20261114T0033_s01p_me_lo_factura_otro_caminos');
select public._restaurar_funcion('public.compras_ficha_le_falta(uuid)', '20261114T0033_s01p_me_lo_factura_otro_caminos');
select public._restaurar_funcion('public.compras_mirar(uuid)', '20261114T0033_s01p_me_lo_factura_otro_caminos');
select public._restaurar_funcion('public._compras_forma_facturar(uuid,text,boolean,text)', '20261114T0033_s01p_me_lo_factura_otro_caminos');
