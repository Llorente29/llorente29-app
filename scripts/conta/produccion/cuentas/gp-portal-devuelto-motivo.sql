-- scripts/conta/produccion/cuentas/gp-portal-devuelto-motivo.sql
--
-- GP · LO QUE CUENTA LA TANDA de la 1222, antes y después. SOLO LEE.
--   1. _conta_portal_devueltos devuelve el motivo: 0 → 1.
select clave, valor from (
  select 1 o, '_conta_portal_devueltos devuelve el motivo' clave,
    (select count(*)::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = '_conta_portal_devueltos' and position('''motivo''' in p.prosrc) > 0) valor
) q order by o;
