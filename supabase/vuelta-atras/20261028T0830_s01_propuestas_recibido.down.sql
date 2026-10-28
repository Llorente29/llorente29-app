-- supabase/vuelta-atras/20261028T0830_s01_propuestas_recibido.down.sql
--
-- Vuelta atrás de la 0830 (lo recibido sin factura se propone solo), que solo
-- añade: se quitan sus dos funciones. Las propuestas que ya hizo se quedan en
-- el libro (son asientos como los del botón: se descartan o se validan allí).
-- Va antes que la de la 0753.
drop function if exists public.conta_proponer_recibidos(uuid, date, date, text);
drop function if exists public.conta_propuestas_recibido(uuid);
