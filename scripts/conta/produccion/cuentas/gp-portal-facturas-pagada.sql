-- scripts/conta/produccion/cuentas/gp-portal-facturas-pagada.sql
--
-- GP · LO QUE CUENTA LA TANDA de la 1010, antes y después. SOLO LEE.
--   1. conta_portal_facturas devuelve cuándo se pagó: 0 → 1.
--   2. conta_portal_inicio devuelve cuándo se pagó: 0 → 1.
select clave, valor from (
  select 1 o, 'conta_portal_facturas devuelve cuándo se pagó' clave,
    (select count(*)::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'conta_portal_facturas' and position('''pagada''' in p.prosrc) > 0) valor
  union all
  select 2, 'conta_portal_inicio devuelve cuándo se pagó',
    (select count(*)::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'conta_portal_inicio' and position('''pagada''' in p.prosrc) > 0)
) q order by o;
