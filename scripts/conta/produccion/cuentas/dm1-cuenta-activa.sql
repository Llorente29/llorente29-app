-- scripts/conta/produccion/cuentas/dm1-cuenta-activa.sql
--
-- DM1 · PR 1 (30/10) · LO QUE CUENTA LA TANDA (1950 y 1951), antes y después.
-- SOLO LEE. Los perfiles son de la TABLA ENTERA, todas las cuentas a propósito:
-- lo que se mide es que nadie gana ni pierde acceso por aplicarla.
select clave, valor from (
  select 1 o, 'user_active_account existe · filas (antes false · 0, después true · 0)' clave,
    (to_regclass('public.user_active_account') is not null)::text || ' · ' ||
    coalesce((select (xpath('/row/n/text()', query_to_xml('select count(*) n from public.user_active_account', false, true, '')))[1]::text
               where to_regclass('public.user_active_account') is not null), '0') valor union all
  select 2, 'funciones nuevas: _cuenta_activa, mis_empresas, cambiar_empresa, _usuario_por_correo (antes 0, después 4)',
    ((to_regprocedure('public._cuenta_activa()') is not null)::int + (to_regprocedure('public.mis_empresas()') is not null)::int
     + (to_regprocedure('public.cambiar_empresa(uuid)') is not null)::int + (to_regprocedure('public._usuario_por_correo(text)') is not null)::int)::text union all
  select 3, 'current_user_account_ids: huella (antes 3b6f755f; después otra; deshecha, 3b6f755f)',
    left(md5(pg_get_functiondef('public.current_user_account_ids()'::regprocedure)), 8) union all
  select 4, 'personas con más de una cuenta activa (antes 0, después 0)',
    -- quieta: una pertenencia de más solo la da invitar-persona, que no está desplegada hasta fusionar
    (select count(*) from (select user_id from public.user_profiles where active group by 1 having count(*) > 1) x)::text union all
  select 5, 'perfiles creados antes del 30/10 20:00 UTC (igual antes y después)',
    (select count(*) from public.user_profiles where created_at < timestamptz '2026-10-30 20:00:00+00')::text
) t order by o;
