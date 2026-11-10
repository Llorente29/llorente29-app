-- supabase/vuelta-atras/20261110T0700_g05_trabajo_suelto.down.sql
-- G05 · Vuelta atrás de la 0700: fuera las funciones del trabajo suelto. Las líneas
-- «suelto» que se hayan puesto se quedan: son de la tabla de siempre (conta_linea).
drop function if exists public.conta_trabajo_suelto_poner(uuid, uuid, uuid, text, numeric);
drop function if exists public.conta_trabajos_sueltos(uuid, uuid);
drop function if exists public._conta_suelto_precio(uuid, uuid, uuid, date);
drop function if exists public._conta_suelto_mes(uuid, uuid);
