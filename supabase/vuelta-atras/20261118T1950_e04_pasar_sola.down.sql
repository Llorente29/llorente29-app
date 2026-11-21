-- supabase/vuelta-atras/20261118T1950_e04_pasar_sola.down.sql
--
-- E04 · Vuelta atrás de la 1950: quita las funciones nuevas. Va la última (la 1951
-- y la 1952 las usan).
drop function if exists public.conta_pasadas_solas(uuid, timestamptz);
drop function if exists public.conta_pasada_sola(uuid);
drop function if exists public.conta_recibida_devolver(uuid, text);
drop function if exists public._conta_pasar_sola(uuid);
drop function if exists public._conta_recibida_mover(uuid, uuid, text, boolean, text);
drop function if exists public._conta_recibida_trabas(uuid);
