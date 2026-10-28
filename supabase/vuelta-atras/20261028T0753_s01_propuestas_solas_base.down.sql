-- supabase/vuelta-atras/20261028T0753_s01_propuestas_solas_base.down.sql
--
-- Vuelta atrás de la 0753 (la base de las propuestas sin botón), que solo
-- añade: se quitan sus funciones y su tabla, con lo que guardaba de «no he
-- podido proponer» (se vuelve a saber en la siguiente pasada). Va la última.
drop function if exists public._conta_proponer(uuid, jsonb, text);
drop function if exists public._conta_no_propuesta(uuid, text, text, text, text, text);
drop function if exists public.conta_dia_abierto(uuid, date);
drop table if exists public.conta_propuesta_pendiente;
