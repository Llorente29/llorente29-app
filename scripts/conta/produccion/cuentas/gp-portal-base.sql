-- scripts/conta/produccion/cuentas/gp-portal-base.sql
--
-- GP · LO QUE CUENTA LA TANDA de la 1530, antes y después. SOLO LEE.
--   1. Las tablas conta_portal_*: 0 → 9.
--   2. Las funciones del portal (conta_portal_* y _conta_portal_*): 0 → 37.
--   3. Las columnas nuevas de conta_solicitud: 0 → 5.
--   4. Las filas de conta_solicitud pedidas antes del 09/11: las mismas antes y después (no se toca ninguna).
--   5. Las políticas del portal en storage.objects: 0 → 2.
--   6. «Tu cuenta» lee la cuenta de cargo de Code 1 (la 1720): 0 → 1.
select clave, valor from (
  select 1 o, 'Tablas conta_portal_*' clave,
    (select count(*)::text from pg_catalog.pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'conta\_portal\_%') valor union all
  select 2, 'Funciones del portal',
    (select count(*)::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname like 'conta\_portal\_%' or p.proname like '\_conta\_portal\_%')) union all
  select 3, 'Columnas nuevas de conta_solicitud',
    (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'conta_solicitud'
      and column_name in ('empleado_documento', 'fecha_efecto', 'tipo_contrato', 'horas_semana', 'portal_acceso_id')) union all
  select 4, 'Filas de conta_solicitud pedidas antes del 09/11', (select count(*)::text from public.conta_solicitud where pedida_at < timestamptz '2026-11-09 15:00:00+00') union all
  select 5, 'Políticas del portal en storage.objects',
    (select count(*)::text from pg_catalog.pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'conta\_portal\_%')
union all
  select 6, '«Tu cuenta» lee cuenta_final (1720)',
    (select count(*)::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'conta_portal_cuenta' and position('cuenta_final' in p.prosrc) > 0)
) q order by o;
