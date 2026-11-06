-- scripts/conta/produccion/cuentas/s01p-intereses.sql
--
-- S01p·6 · Borrar el 4/3313 (intereses duplicados) · LO QUE CUENTA LA TANDA,
-- antes y después. SOLO LEE. Lo que tiene que pasar en Foodint:
--   1. El asiento 4/3313 (del 30/10): 1 → 0.
--   2. Apuntes de 115,68 € en la 66230000 de la cuota de octubre: 2 → 1.
--   3. Serie 4 de 2026: el último número y cuántos, uno menos (seguida).
--   4. El borrador del 303 del 4T: su resultado, recalculado (sin IVA en el 3313, igual).
select clave, valor from (
  select 1 o, 'Asiento 4/3313 (intereses duplicados, 30/10)' clave,
    -- quieta: un asiento fijo por su id; solo lo borra esta tanda (y lo devuelve su vuelta atrás)
    (select count(*)::text from public.journal_entry e
      where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.id = 'c078b68f-2a34-45df-a506-d62e82022500') valor union all
  select 2, 'Intereses de 115,68 € de la cuota de octubre (6623)',
    -- corte: asientos validados del 28/09 al 30/11/2026, creados antes del 04/11 19:30Z
    (select count(*)::text from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.status = 'validado'
        and a.code = '66230000' and l.debit = 115.68 and e.entry_date between '2026-09-28' and '2026-11-30'
        and e.created_at < timestamptz '2026-11-04 19:30+00') union all
  select 3, 'Serie 4 de 2026: último número y cuántos',
    (select max(e.number)::text || ' · ' || count(*)::text from public.journal_entry e join public.fiscal_year y on y.id = e.fiscal_year_id
      -- quieta: la serie 4 crece con lo que se valida; se mide lo validado antes del corte de la medida
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and y.code = '2026' and e.series = 4
        and e.number is not null and e.validated_at < timestamptz '2026-11-04 19:30+00') union all
  select 4, 'Borrador del 303 del 4T de 2026: resultado',
    -- quieta: una declaración fija por su id; solo la recalcula esta tanda (y la devuelve su vuelta atrás)
    (select t.result_kind || ' · ' || t.amount::text from public.tax_return t where t.id = '8ae554ae-4853-42c9-b5b0-346840223d47')
) t order by o;
