-- supabase/vuelta-atras/20261101T0920_s01l_retencion_leida.down.sql
-- S01l · Vuelta atrás de la 0920: conta_factura_desde_lectura como estaba (su respaldo).
select public._restaurar_funcion('public.conta_factura_desde_lectura(uuid,uuid)', '20261101T0920_s01l_retencion_leida');
