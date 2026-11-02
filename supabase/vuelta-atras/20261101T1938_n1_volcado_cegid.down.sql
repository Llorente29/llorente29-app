-- supabase/vuelta-atras/20261101T1938_n1_volcado_cegid.down.sql
--
-- Vuelta atrás de la 1938: fuera las funciones del volcado. Lo que ya se
-- volcó se queda (las bajas creadas en employees y las filas lab_*): lo quita,
-- si hiciera falta, la vuelta atrás de la 1937, que borra las tablas lab_*.
-- Las bajas creadas en employees se ven por lab_import_fila.destino_id del
-- lote, con su mensaje «entra como baja».
drop function if exists public.lab_volcar_lote(uuid);
drop function if exists public.lab_confirmar_centro(uuid, text, uuid);
drop function if exists public.lab_centros_del_lote(uuid);
drop function if exists public._lab_campo(uuid, text, text);
drop function if exists public._lab_norm(text);
drop function if exists public._lab_si(text);
drop function if exists public._lab_nif(text);
drop function if exists public._lab_num(text);
drop function if exists public._lab_fecha(text);
drop function if exists public._lab_txt(jsonb, text);
