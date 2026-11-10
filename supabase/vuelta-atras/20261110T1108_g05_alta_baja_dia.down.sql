-- supabase/vuelta-atras/20261110T1108_g05_alta_baja_dia.down.sql
-- G05 · Vuelta atrás de la 1108: fuera el alta y la baja con día y documento, la
-- comprobación del documento y su columna.
drop function if exists public.conta_gestoria_alta_trabajador(uuid, uuid, uuid, text, date, text);
drop function if exists public.conta_gestoria_baja_trabajador(uuid, date);
drop function if exists public._conta_dni_nie_valido(text);
alter table public.conta_linea drop constraint if exists conta_linea_empleado_documento;
alter table public.conta_linea drop column if exists empleado_documento;
