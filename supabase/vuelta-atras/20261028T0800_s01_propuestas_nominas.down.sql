-- supabase/vuelta-atras/20261028T0800_s01_propuestas_nominas.down.sql
--
-- Vuelta atrás de la 0800 (las nóminas se proponen solas), que solo añade: se
-- quita el disparador y sus funciones. Las propuestas que ya hizo se quedan en
-- el libro (son asientos como los del botón: se descartan o se validan allí).
-- Va antes que la de la 0753.
drop trigger if exists conta_nomina_proponer on public.payroll_summary;
drop function if exists public.tg_conta_nomina_proponer();
drop function if exists public.conta_proponer_nominas(uuid, date, date, text);
drop function if exists public.conta_propuesta_nomina(uuid);
