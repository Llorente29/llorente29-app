-- supabase/vuelta-atras/20261112T1755_s01p_linea_socio.down.sql
-- Vuelta atrás de la 1755: conta_propuestas_socio desde su respaldo, y fuera las reglas y lo pendiente.
select public._restaurar_funcion('public.conta_propuestas_socio(uuid,uuid)', '20261112T1755_s01p_linea_socio');
drop function if exists public.compras_socio_pendiente(uuid, uuid, uuid);
drop function if exists public._conta_socio_pendiente(uuid, uuid, uuid, uuid);
drop function if exists public.compras_socio_regla_guardar(uuid, uuid, text, text);
drop function if exists public.compras_socio_reglas(uuid, uuid);
drop table if exists public.socio_linea_regla;
drop function if exists public._socio_linea_clave(text);
