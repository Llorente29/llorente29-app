-- scripts/conta/produccion/cuentas/dm1-invitaciones.sql
--
-- DM1 · Accesos 1 (03/11) · LO QUE CUENTA LA TANDA (0812), antes y después.
-- SOLO LEE, y solo el catálogo de la base: si existe la tabla de invitaciones
-- y cuántas de sus once funciones. Antes: no y 0. Después: sí y 11. Tras la
-- vuelta atrás: como antes. Los accesos de user_profiles no cambian al aplicar.
select clave, valor from (
  select 1 o, 'la tabla invitacion existe (antes false, después true)' clave,
    (to_regclass('public.invitacion') is not null)::text valor union all
  select 2, 'funciones de la 0812 que existen (antes 0, después 11)',
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in
      ('_invitacion_dar_acceso', '_soy_admin_de', 'acceso_quitar', 'accesos_de_cuenta', 'invitacion_aceptar', 'invitacion_anular',
       'invitacion_crear', 'invitacion_por_token', 'invitacion_reenviar', 'invitaciones_de_cuenta', 'mis_invitaciones'))::text
) t order by o;
