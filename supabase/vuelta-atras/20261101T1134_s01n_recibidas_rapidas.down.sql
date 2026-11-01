-- supabase/vuelta-atras/20261101T1134_s01n_recibidas_rapidas.down.sql
--
-- Vuelta atrás de la 1134: conta_documentos_recibidos como estaba (de su
-- respaldo, con su huella). Vuelve a llamar a conta_gasto_aprendido por cada
-- lectura y a tardar lo de antes (16,9 s en Foodint el 01/11).
select public._restaurar_funcion('public.conta_documentos_recibidos(uuid,date,date)', '20261101T1134_s01n_recibidas_rapidas');
