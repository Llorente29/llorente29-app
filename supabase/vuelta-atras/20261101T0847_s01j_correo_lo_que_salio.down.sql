-- supabase/vuelta-atras/20261101T0847_s01j_correo_lo_que_salio.down.sql
-- S01j · Vuelta atrás de la 0847: conta_correo_facturas como estaba (su respaldo).
select public._restaurar_funcion('public.conta_correo_facturas(uuid)', '20261101T0847_s01j_correo_lo_que_salio');
