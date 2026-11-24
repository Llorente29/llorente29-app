-- supabase/vuelta-atras/20261121T1600_x22_nombre_de_la_cuenta.down.sql
--
-- X22 · Vuelta atrás: las ocho funciones como estaban antes de la 1600, restauradas byte a byte del respaldo que
-- guardó la migración (_restaurar_funcion comprueba la huella). Misma firma.

select public._restaurar_funcion('public.bank_saldos_cuentas(uuid,date,text[])', '20261121T1600_x22_nombre_de_la_cuenta');
select public._restaurar_funcion('public.conta_banco_a_mano(uuid,date,text,text,numeric,text)', '20261121T1600_x22_nombre_de_la_cuenta');
select public._restaurar_funcion('public.conta_impuesto_retenciones_diario(uuid,integer,text)', '20261121T1600_x22_nombre_de_la_cuenta');
select public._restaurar_funcion('public.conta_recibida_pagar_con_cuenta(uuid,uuid,text,date,text)', '20261121T1600_x22_nombre_de_la_cuenta');
select public._restaurar_funcion('public.conta_saldos_terceros(uuid,date)', '20261121T1600_x22_nombre_de_la_cuenta');
select public._restaurar_funcion('public.conta_tpv_dia_ejemplo(uuid,jsonb,uuid)', '20261121T1600_x22_nombre_de_la_cuenta');
select public._restaurar_funcion('public.conta_tpv_factura_de(uuid,date)', '20261121T1600_x22_nombre_de_la_cuenta');
select public._restaurar_funcion('public.conta_tpv_factura_guardar(uuid,text,text)', '20261121T1600_x22_nombre_de_la_cuenta');
