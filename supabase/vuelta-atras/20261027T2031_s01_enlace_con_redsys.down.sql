-- supabase/vuelta-atras/20261027T2031_s01_enlace_con_redsys.down.sql
--
-- Vuelta atrás de la 2031: las cuatro funciones del enlace vuelven a ser
-- EXACTAMENTE las de antes (las de la 1121, las de producción el 27/10), desde
-- su respaldo y con la huella comprobada (_restaurar_funcion). Misma firma:
-- ninguna sobrecarga. Después de esto, la 2030 se puede quitar.

select public._restaurar_funcion('public.conta_enlace_pago_para(uuid)', '20261027T2031_s01_enlace_con_redsys');
select public._restaurar_funcion('public.conta_enlace_pago_ver(text)', '20261027T2031_s01_enlace_con_redsys');
select public._restaurar_funcion('public.conta_enlace_pago_datos(text)', '20261027T2031_s01_enlace_con_redsys');
select public._restaurar_funcion('public.conta_enlace_pago_cobrado(text,text,text,numeric,text,date)', '20261027T2031_s01_enlace_con_redsys');
