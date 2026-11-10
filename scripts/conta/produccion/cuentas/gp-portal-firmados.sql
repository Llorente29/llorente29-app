-- scripts/conta/produccion/cuentas/gp-portal-firmados.sql
--
-- GP · LO QUE CUENTA LA TANDA de la 0005, antes y después. SOLO LEE.
--   1. conta_portal_documentos devuelve «firmados»: 0 → 1.
select clave, valor from (
  select 1 o, 'conta_portal_documentos devuelve lo firmado' clave,
    (select count(*)::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'conta_portal_documentos' and position('''firmados''' in p.prosrc) > 0) valor
) q order by o;
