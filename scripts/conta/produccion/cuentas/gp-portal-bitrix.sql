-- scripts/conta/produccion/cuentas/gp-portal-bitrix.sql
--
-- GP · LO QUE CUENTA LA TANDA de la 2345, antes y después. SOLO LEE.
--   1. Las funciones nuevas de la pestaña de Bitrix24 (invitar, contestar y la de dentro): 0 → 3.
select clave, valor from (
  select 1 o, 'Funciones del portal para la pestaña de Bitrix24 (2345)' clave,
    (select count(*)::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('_conta_portal_bitrix_quien', 'conta_portal_bitrix_invitar', 'conta_portal_bitrix_contestar')) valor
) q order by o;
