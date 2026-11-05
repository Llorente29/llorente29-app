-- scripts/conta/produccion/cuentas/s01p-alquileres.sql
--
-- S01p·15 · Los alquileres de Foodint (1140 y 1141) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
--   1. Los 5 alquileres esperados de Foodint: cuántos cubre un contrato (0 → 1) y cuántos terminan el 30/09 (0 → 3).
--   2. Los contratos de alquiler de Foodint (0 → 1).
--   3. Los apuntes de alquiler propuestos de octubre y noviembre de 2026 (0 → 2) y lo que deben al arrendador 1 (0 → 1.596,68).
--   4. Lo validado de 2026 en la 621, la 472 y la 4751: no cambia (la tanda solo propone).
select clave, valor from (
  -- corte: los 5 alquileres esperados de Foodint medidos el 05/11 (por su id)
  select 1 o, 'Alquileres esperados de Foodint cubiertos por un contrato' clave,
    (select count(*)::text from public.supplier_expected_invoice x
      where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and x.kind = 'alquiler' and x.covered_by_recurring_id is not null
        and x.id in ('f2c13b5e-ee18-4281-8f1e-1508486e9b36', '6bfc4317-570f-4c5c-8cd9-ccaa8f74a6ae', '42b1c16f-238d-4d09-8510-33e0a03a27ca',
                     'c7d5e755-e8c9-42d7-930f-7f6de6914ff1', 'bbb2a2e7-9e5b-463b-a899-785f448abc08')) valor
  union all
  -- corte: los 5 alquileres esperados de Foodint medidos el 05/11 (por su id)
  select 2, 'Alquileres esperados de Foodint terminados el 30/09/2026',
    (select count(*)::text from public.supplier_expected_invoice x
      where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and x.kind = 'alquiler'
        and to_jsonb(x)->>'ends_on' = '2026-09-30'
        and x.id in ('f2c13b5e-ee18-4281-8f1e-1508486e9b36', '6bfc4317-570f-4c5c-8cd9-ccaa8f74a6ae', '42b1c16f-238d-4d09-8510-33e0a03a27ca',
                     'c7d5e755-e8c9-42d7-930f-7f6de6914ff1', 'bbb2a2e7-9e5b-463b-a899-785f448abc08'))
  union all
  -- corte: contratos de alquiler de Foodint creados antes del 06/11/2026
  select 3, 'Contratos de alquiler de Foodint',
    (select count(*)::text from public.recurring_contract c
      where c.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and c.kind = 'alquiler' and c.created_at < timestamptz '2026-11-06 00:00+00')
  union all
  -- corte: apuntes propuestos de alquiler de octubre y noviembre de 2026, creados antes del 06/11/2026
  select 4, 'Apuntes de alquiler propuestos de Foodint, octubre y noviembre',
    (select count(*)::text from public.journal_entry e
      where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
        and e.source_type = 'manual' and e.status = 'propuesto' and e.created_by_name = 'Sumied (alquiler del mes)'
        and e.entry_date between '2026-10-01' and '2026-11-30' and e.created_at < timestamptz '2026-11-06 00:00+00')
  union all
  -- corte: lo mismo, lo que deben al arrendador 1 (41000027)
  select 5, 'Lo propuesto a la 41000027 en octubre y noviembre',
    (select coalesce(sum(l.credit), 0)::numeric(14,2)::text from public.journal_entry e join public.journal_line l on l.entry_id = e.id
       join public.company_account a on a.id = l.company_account_id
      where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
        and e.source_type = 'manual' and e.status = 'propuesto' and e.created_by_name = 'Sumied (alquiler del mes)' and a.code = '41000027'
        and e.entry_date between '2026-10-01' and '2026-11-30' and e.created_at < timestamptz '2026-11-06 00:00+00')
  union all
  -- quieta: la tanda no valida nada
  select 6, 'Validado de Foodint en 2026 · ' || q.c,
    (select coalesce(sum(l.debit - l.credit), 0)::numeric(14,2)::text from public.journal_line l join public.journal_entry e on e.id = l.entry_id
       join public.company_account a on a.id = l.company_account_id
      where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
        and e.status = 'validado' and e.entry_date between '2026-01-01' and '2026-12-31' and a.code like q.c || '%')
    from unnest(array['621', '472', '4751']) q(c)
) t order by o, clave;
