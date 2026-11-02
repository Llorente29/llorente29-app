-- supabase/vuelta-atras/20261101T0945_s01m_otras_direcciones.down.sql
-- S01m · Vuelta atrás de la 0945: fuera la función y la tabla (con las otras
-- direcciones que se hubieran escrito). Los enlaces que ya se hicieran se quedan.
drop function if exists public.conta_local_direcciones_guardar(uuid, text[], text);
drop table if exists public.location_address_alias;
