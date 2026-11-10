-- scripts/conta/produccion/cuentas/gp-portal-gestoria.sql
--
-- GP · LO QUE CUENTA LA TANDA de la 2030, antes y después. SOLO LEE.
--   1. Las funciones nuevas (hacer y rechazar, avisos, despertador): 0 → 5.
--   2. «Tu próximo recibo» dice la cuenta de cargo (_conta_portal_proximo lee cuenta_final): 0 → 1.
--   3. El cron portal-avisos: 0 → 1 donde está el cron_secret (producción).
select clave, valor from (
  select 1 o, 'Funciones nuevas del portal (2030)' clave,
    (select count(*)::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('conta_portal_solicitud_hacer', 'conta_portal_solicitud_rechazar',
        'conta_portal_avisos_pendientes', 'conta_portal_avisos_hechos', 'conta_portal_despertar')) valor union all
  select 2, '_conta_portal_proximo lee cuenta_final',
    (select count(*)::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = '_conta_portal_proximo' and position('cuenta_final' in p.prosrc) > 0) union all
  select 3, 'Cron portal-avisos',
    -- quieta: el cron solo cambia con esta tanda (y donde no hay pg_cron, 0).
    (xpath('/row/n/text()', query_to_xml(case when to_regclass('cron.job') is null then 'select 0 as n'
       else 'select count(*) as n from cron.job where jobname = ''portal-avisos''' end, false, true, '')))[1]::text
) q order by o;
