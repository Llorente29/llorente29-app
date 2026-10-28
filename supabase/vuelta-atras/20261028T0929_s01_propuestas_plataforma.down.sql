-- supabase/vuelta-atras/20261028T0929_s01_propuestas_plataforma.down.sql
--
-- Vuelta atrás de la 0929 (la liquidación de plataforma se propone sola), que
-- solo añade: se quitan el disparador y sus funciones. Las propuestas que ya
-- hizo se quedan en el libro (se descartan o se validan allí). Va antes que la
-- de la 0905 (usa sus ayudas) y la de la 0753.
drop trigger if exists conta_plataforma_proponer on public.channel_settlement;
drop function if exists public.tg_conta_plataforma_proponer();
drop function if exists public.conta_proponer_plataformas(uuid, date, date, text);
drop function if exists public._conta_proponer_plataforma(uuid, uuid, text);
drop function if exists public.conta_propuestas_plataforma(uuid, uuid);
drop function if exists public._conta_plataforma_entrada(uuid, uuid);
drop function if exists public._conta_plataforma_regla(jsonb, jsonb);
drop function if exists public.conta_aprendizaje(uuid, text, text[]);
