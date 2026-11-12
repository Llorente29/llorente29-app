-- supabase/vuelta-atras/20261110T1217_g05_liquidado_devuelto.down.sql
-- G05 · Vuelta atrás de la 1217: «facturar» y «seguir» como estaban (de su
-- respaldo, byte a byte). Las facturas y asientos que ya se hayan hecho se quedan:
-- son contabilidad.
select public._restaurar_funcion('public._conta_cobro_facturar(uuid)', '20261110T1217_g05_liquidado_devuelto');
select public._restaurar_funcion('public.conta_cobro_seguir(uuid)', '20261110T1217_g05_liquidado_devuelto');
