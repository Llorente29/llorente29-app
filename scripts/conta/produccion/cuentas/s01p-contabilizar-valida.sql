-- scripts/conta/produccion/cuentas/s01p-contabilizar-valida.sql
--
-- S01p·18 · 2 · «Contabilizar» valida lo que propone (1915) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
--   1. Las liquidaciones del socio de Foodint, por estado: no cambia (la tanda no confirma ninguna).
--   2. Los asientos de Foodint, por estado: no cambia (la tanda no valida nada; cambia lo que hará «Contabilizar»).
select clave, valor from (
  -- corte: las liquidaciones del socio de Foodint creadas antes del 13/11/2026
  select 1 o, 'Liquidaciones del socio de Foodint por estado' clave,
    (select string_agg(status || ' ' || n, ' · ' order by status) from (select status, count(*) n from public.licensed_settlement
       where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-11-13 00:00+00' group by status) x) valor
  union all
  -- corte: los asientos de Foodint creados antes del 13/11/2026
  select 2, 'Asientos de Foodint por estado',
    (select string_agg(status || ' ' || n, ' · ' order by status) from (select status, count(*) n from public.journal_entry
       where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-11-13 00:00+00' group by status) x)
) t order by o;
