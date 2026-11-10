-- supabase/vuelta-atras/20261110T0010_g05_deshacer_lineas.down.sql
-- Vuelta atrás de la 0010: fuera las funciones de deshacer y su tabla. Lo ya
-- deshecho se queda como está (las líneas vuelven a estar como antes del cambio).
drop function if exists public.conta_linea_deshacer(uuid, uuid, timestamptz);
drop function if exists public.conta_linea_operaciones_hoy(uuid, uuid);
drop function if exists public._conta_linea_no_se_deshace(uuid, uuid, timestamptz, text, jsonb);
drop function if exists public._conta_linea_operaciones(uuid, uuid, date);
drop table if exists public.conta_linea_deshecha;
