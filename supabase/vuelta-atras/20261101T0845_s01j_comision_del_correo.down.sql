-- supabase/vuelta-atras/20261101T0845_s01j_comision_del_correo.down.sql
-- S01j · Vuelta atrás de la 0845: quita las dos funciones nuevas. Las facturas
-- que ya hubiera creado se quedan (son recibidas «Por revisar», como cualquiera).
drop function if exists public.conta_correo_releer_lista(uuid, text[], text);
drop function if exists public.conta_comision_del_correo(uuid, jsonb);
