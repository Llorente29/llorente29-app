-- supabase/vuelta-atras/20261125T1533_x14f_sumas_de_erp10.down.sql
-- X14 · 2 · Quita conta_traer_poner_sumas y devuelve las tres funciones de sus respaldos: vuelve a darse por comparado el
-- sumas y saldos calculado de los asientos. Las sumas de fichero ya guardadas en una carga se quedan en su detalle.
select public._restaurar_funcion('public.conta_traer_dar_por_bueno(uuid,text)', '20261125T1533_x14f_sumas_de_erp10');
select public._restaurar_funcion('public.conta_traer_antes_de_dar_por_bueno(uuid)', '20261125T1533_x14f_sumas_de_erp10');
select public._restaurar_funcion('public._conta_traer_comparar(uuid)', '20261125T1533_x14f_sumas_de_erp10');
drop function if exists public.conta_traer_poner_sumas(uuid, jsonb, text);
