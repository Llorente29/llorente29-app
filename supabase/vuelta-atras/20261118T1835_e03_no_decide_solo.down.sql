-- supabase/vuelta-atras/20261118T1835_e03_no_decide_solo.down.sql
--
-- E03 · Vuelta atrás de la 1835: las seis funciones cambiadas vuelven a su
-- definición de antes (su respaldo, con su huella). Va después de la de la 1836
-- y antes que la de la 1833.
select public._restaurar_funcion('public.conta_documentos_recibidos(uuid,date,date)', '20261118T1835_e03_no_decide_solo');
select public._restaurar_funcion('public.conta_motivos_para_validar(uuid)', '20261118T1835_e03_no_decide_solo');
select public._restaurar_funcion('public._conta_factura_segura(uuid)', '20261118T1835_e03_no_decide_solo');
select public._restaurar_funcion('public.conta_recibida_iva_no_deducible(uuid,boolean,text,text,text)', '20261118T1835_e03_no_decide_solo');
select public._restaurar_funcion('public.tg_s01o2_iva_no_deducible()', '20261118T1835_e03_no_decide_solo');
select public._restaurar_funcion('public._conta_iva_no_deducible_auto(uuid)', '20261118T1835_e03_no_decide_solo');
