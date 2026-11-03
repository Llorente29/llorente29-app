-- supabase/vuelta-atras/20261103T0812_dm1_invitaciones.down.sql
-- Vuelta atrás de la 0812 (DM1 · Accesos 1): fuera las funciones y la tabla de
-- invitaciones. Los accesos que ya se aceptaron (filas de user_profiles) se
-- quedan: son personas que ya entran, y quitarlas es «quitar el acceso».
drop function if exists public.acceso_quitar(uuid, uuid);
drop function if exists public.accesos_de_cuenta(uuid);
drop function if exists public.invitacion_anular(uuid);
drop function if exists public.invitaciones_de_cuenta(uuid);
drop function if exists public.invitacion_aceptar(uuid[]);
drop function if exists public.mis_invitaciones();
drop function if exists public.invitacion_por_token(text);
drop function if exists public.invitacion_reenviar(uuid, text, uuid);
drop function if exists public.invitacion_crear(text, jsonb, text, uuid, text);
drop function if exists public._invitacion_dar_acceso(uuid[], uuid);
drop function if exists public._soy_admin_de(uuid);
drop table if exists public.invitacion;
