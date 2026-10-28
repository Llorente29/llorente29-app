-- scripts/conta/produccion/cuentas/l1a-correcciones-e-informe.sql
--
-- L1a · PR 2 (28/10) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Todo es del catálogo (pg_proc, pg_policy, privilegios, columnas), salvo el
-- cerrojo de la 0700, que lee el rastro de las últimas 24 h con el mismo
-- criterio que la migración (de todas las cuentas: la tanda no toca filas).
select clave, valor from (
  select 1 o, 'huellas de las cinco funciones que cambia' clave,
    (select string_agg(p.proname || ' ' || left(md5(pg_get_functiondef(p.oid)), 8), ' · ' order by p.proname) from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname in ('edit_clock_entry', 'void_clock_entry', 'resolve_clock_correction', 'request_clock_correction', 'export_gestoria_mensual')) valor union all
  select 2, 'escritura directa de authenticated en clock_entries (insert · update · delete)',
    has_table_privilege('authenticated', 'public.clock_entries', 'INSERT')::text || ' · ' || has_table_privilege('authenticated', 'public.clock_entries', 'UPDATE')::text
      || ' · ' || has_table_privilege('authenticated', 'public.clock_entries', 'DELETE')::text union all
  select 3, 'políticas de escritura de clock_entries',
    (select count(*) from pg_policy where polrelid = 'public.clock_entries'::regclass and polcmd in ('a', 'w', 'd'))::text union all
  select 4, 'export_gestoria_mensual, de servidor',
    (select prosecdef::text from pg_proc where oid = to_regprocedure('public.export_gestoria_mensual(uuid,date,date)')) union all
  select 5, 'funciones nuevas (conformidad, firma, informe, enlace, para revisar)',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('responder_correccion', 'firmar_registro_mes', 'informe_registro_jornada', '_informe_registro_jornada', 'crear_enlace_inspeccion',
                        'revocar_enlace_inspeccion', 'informe_por_enlace', 'jornadas_para_revisar', '_puede_corregir', '_huella_registro_mes', '_mes_madrid',
                        '_clock_audit_conformidad', '_registro_firma_invalidar'))::text union all
  select 6, 'tablas nuevas (firma del mes, enlace)',
    (select count(*) from (values ('public.registro_jornada_firma'), ('public.registro_jornada_enlace')) x(t) where to_regclass(x.t) is not null)::text union all
  select 7, 'columnas nuevas del rastro (conformidad, peticion_id)',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'clock_entry_audit'
      and column_name in ('conformidad', 'conformidad_at', 'conformidad_nota', 'peticion_id'))::text union all
  select 8, 'el cerrojo: fichajes por el INSERT directo en las últimas 24 h (todas las cuentas)',
    (select count(*) from public.clock_entry_audit a
      where a.action = 'create' and a.created_at > now() - interval '24 hours' and a.actor_user_id is not null
        and coalesce(a.reason, '') not like 'Fichaje propio desde el móvil%' and coalesce(a.reason, '') not like 'Fichaje en la tablet%')::text
) t order by o;
