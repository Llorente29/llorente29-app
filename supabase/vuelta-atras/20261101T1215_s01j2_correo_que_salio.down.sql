-- supabase/vuelta-atras/20261101T1215_s01j2_correo_que_salio.down.sql
--
-- Vuelta atrás de la 1215: conta_correo_facturas como estaba (su respaldo, con su huella).
select public._restaurar_funcion('public.conta_correo_facturas(uuid)', '20261101T1215_s01j2_correo_que_salio');
