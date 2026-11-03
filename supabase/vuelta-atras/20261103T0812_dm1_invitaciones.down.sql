-- supabase/vuelta-atras/20261103T0812_dm1_invitaciones.down.sql
-- Vuelta atrás de la 0812 (DM1 · Accesos 1): fuera las funciones y la tabla de
-- invitaciones. Los accesos que ya se aceptaron (filas de user_profiles) se
-- quedan: son personas que ya entran, y quitarlas es «quitar el acceso».
--
-- Los candados, en orden y antes de borrar (03/11): primero la tabla, que solo
-- usan las funciones de abajo. Sin clave ajena a accounts (la 0812 no la
-- lleva), borrarla no coge ninguna otra tabla: el 03/11 en staging, con la
-- clave, el borrado esperó a accounts en exclusiva y se interbloqueó. Si alguien
-- la está usando, espera 10 s como mucho y para, sin dejar nada a medias (todo
-- va en la transacción del run).
set local lock_timeout = '10s';
do $$ begin
  if to_regclass('public.invitacion') is not null then
    execute 'lock table public.invitacion in access exclusive mode';
  end if;
end $$;
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
set local lock_timeout to default;
