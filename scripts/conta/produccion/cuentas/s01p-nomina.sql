-- scripts/conta/produccion/cuentas/s01p-nomina.sql
--
-- S01p · La nómina de octubre de Foodint (2310) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
--   1. Asientos vivos de octubre con sueldos (640): 0 → 1.
--   2. Su importe en la 640: 0 → 7.268,20.
--   3. payroll_summary de Foodint: igual (no se toca Laboral).
select clave, valor from (
  -- corte: asientos de octubre de 2026 de Foodint
  select 1 o, 'Asientos de octubre con sueldos (640)' clave,
    (select count(distinct e.id)::text from public.journal_entry e join public.journal_line l on l.entry_id = e.id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and e.status <> 'anulado' and e.entry_date between '2026-10-01' and '2026-10-31' and a.code like '640%') valor
  union all
  -- corte: asientos de octubre de 2026 de Foodint
  select 2, 'Sueldos de octubre en la 640',
    (select coalesce(sum(l.debit - l.credit), 0)::text from public.journal_entry e join public.journal_line l on l.entry_id = e.id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and e.status <> 'anulado' and e.entry_date between '2026-10-01' and '2026-10-31' and a.code like '640%')
  union all
  -- corte: creados antes del 04/11 22:30Z
  select 3, 'payroll_summary de Foodint (no se toca)',
    (select count(*)::text from public.payroll_summary p where p.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and p.created_at < timestamptz '2026-11-04 22:30+00')
) t order by o;
