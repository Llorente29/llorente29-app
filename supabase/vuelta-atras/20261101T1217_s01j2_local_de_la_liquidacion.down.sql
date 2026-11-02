-- supabase/vuelta-atras/20261101T1217_s01j2_local_de_la_liquidacion.down.sql
--
-- Vuelta atrás de la 1217: fuera el disparador y su función; conta_local_direcciones_guardar
-- como estaba (su respaldo). Los locales que ya puso se quedan (los de Foodint los quita la 1218).
drop trigger if exists s01j2_liquidacion_pon_local on public.channel_settlement;
drop function if exists public._conta_liquidacion_pon_local();
select public._restaurar_funcion('public.conta_local_direcciones_guardar(uuid,text[],text)', '20261101T1217_s01j2_local_de_la_liquidacion');
