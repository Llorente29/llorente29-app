-- supabase/vuelta-atras/20261031T0931_s01g_soporte.down.sql
--
-- Vuelta atrás de la 0931: conta_documentos_recibidos y
-- brand_partner_settlement_prepare como estaban (de su respaldo, con su
-- huella). Las recepciones de soporte vuelven a «Por aclarar»; el proveedor
-- que ya guardó una liquidación se queda.
select public._restaurar_funcion('public.brand_partner_settlement_prepare(uuid,uuid,date,date,text)', '20261031T0931_s01g_soporte');
select public._restaurar_funcion('public.conta_documentos_recibidos(uuid,date,date)', '20261031T0931_s01g_soporte');
