-- supabase/vuelta-atras/20261028T0905_s01_propuestas_socio.down.sql
--
-- Vuelta atrás de la 0905 (el socio de marca se propone solo), que solo añade:
-- se quitan el disparador y sus funciones. Las propuestas que ya hizo se quedan
-- en el libro (se descartan o se validan allí). Va antes que la de la 0753.
drop trigger if exists conta_socio_proponer on public.licensed_settlement;
drop function if exists public.tg_conta_socio_proponer();
drop function if exists public.conta_proponer_socios(uuid, date, date, text);
drop function if exists public._conta_proponer_socio(uuid, uuid, text);
drop function if exists public.conta_propuestas_socio(uuid, uuid);
drop function if exists public._conta_aprendizaje(uuid, text, jsonb, jsonb);
drop function if exists public._conta_cuotas_y_redondeo(jsonb, numeric);
drop function if exists public._conta_tipo_iva(uuid, numeric);
drop function if exists public._conta_enlace(uuid, text, text, text);
drop function if exists public._conta_hoja(uuid, text);
