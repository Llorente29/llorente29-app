-- supabase/vuelta-atras/20261113T0913_s01p_recibida_fecha.down.sql
--
-- S01p·18.2 · la vuelta atrás de la 0913: fuera conta_recibida_fecha. La pantalla,
-- sin ella, apunta con la fecha de la factura y la base la mueve al proponer si toca.

drop function if exists public.conta_recibida_fecha(uuid, date);
