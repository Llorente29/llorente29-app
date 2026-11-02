-- scripts/conta/produccion/cuentas/a01a-tickets-caducan.sql
--
-- A01a (01/11) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. De Foodint
-- (51ad1792…), regla 9; la última, de la tabla entera a propósito: caducar no
-- borra ningún trabajo.
select clave, valor from (
  select 1 o, 'Foodint: print_job pending creados antes del 31/10 00:00 UTC, de más de 24 h (antes 17, después 0)' clave,
    (select count(*) from public.print_job where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and status = 'pending' and created_at < timestamptz '2026-10-31 00:00:00+00')::text valor union all
  select 2, 'Foodint: print_job caducados creados antes del 31/10 00:00 UTC (antes 0, después 17)',
    (select count(*) from public.print_job where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
      and status::text = 'expired' and created_at < timestamptz '2026-10-31 00:00:00+00')::text union all
  select 3, 'db_health_watchdog: huella (antes dd8f4ead; después otra; deshecha, dd8f4ead)',
    left(md5(pg_get_functiondef('public.db_health_watchdog()'::regprocedure)), 8) union all
  select 4, 'print_job creados antes del 01/11 00:00 UTC, toda la tabla (igual antes y después)',
    (select count(*) from public.print_job where created_at < timestamptz '2026-11-01 00:00:00+00')::text
) t order by o;
