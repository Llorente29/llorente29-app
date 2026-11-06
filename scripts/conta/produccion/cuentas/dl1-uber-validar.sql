-- scripts/conta/produccion/cuentas/dl1-uber-validar.sql
--
-- DL1 · Validar los 12 asientos de Uber (1750) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
--   1. Los 12, por su id: cuántos siguen propuestos (12 → 0) y cuántos validados por Julio (0 → 12).
--   2. 43000002 validado, en la apertura (solo los asientos del 01/01 de apertura): −614,96 → 1.754,35.
--   3. 43000002 validado a 30/06: 34.462,43 → 375,90.
--   4. 43000002 validado a 31/10 (con las anuladas, como Sumied): 7.535,75 → 7.387,89.
--   5. 41000003 (Uber) validado a 31/10: 147,86 → 0,00.
--   6. El IVA de Foodint del 1T al 3T (472 y 477, validado): igual.
select clave, valor from (
  -- quieta: solo los 12 asientos de la lista, por su id
  select 1 o, 'Los 12 de Uber · ' || k.t clave,
    (select count(*)::text from public.journal_entry e
      where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
        and e.id in ('bd337a82-cf40-4f71-945f-3eb41a9f103d', 'daac2c29-69ce-4239-a10a-4a9d440c29fc', '4249fd58-75f1-4c47-bbfd-92a85202472b',
                     'a2797334-df9d-49d6-9d30-decd9aa91ece', 'c914d25e-dc13-4519-8622-a776cfc271a1', 'ee851e48-2300-452f-b3dc-e54faf2cc163',
                     '07beeca2-9f2d-4500-bf0a-ca8fcc49ad9d', '18a30474-37bf-4720-a8cd-6f0c8c50a8c1', '3cea8cc9-91ee-49b4-8f8b-b72b811ef138',
                     'e9b99d2e-0f2a-4ea6-8a4e-c6d809fc40d3', '3641b09f-a2f2-4b2b-bb1d-8a3c005b6d24', 'dfbbb625-c576-4f0b-84c9-7e9c5e15e097')
        and ((k.t = 'propuestos' and e.status = 'propuesto')
             or (k.t = 'validados por Julio' and e.status = 'validado' and e.validated_by = '673fca49-f6b5-40ed-a8f7-558390acce10' and e.validated_by_name = 'Julio'))) valor
    from (values ('propuestos'), ('validados por Julio')) k(t)
  union all
  -- corte: asientos de 2026 de Foodint hasta cada fecha
  select 2, '43000002 validado ' || d.t,
    (select coalesce(sum(l.debit - l.credit), 0)::numeric(14,2)::text
       from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and a.code = '43000002' and e.entry_date between date '2026-01-01' and d.f and e.status in ('validado', 'anulado')
        and (d.f > date '2026-01-01' or e.concept = 'Apertura del ejercicio' or e.id = 'bd337a82-cf40-4f71-945f-3eb41a9f103d'))
    from (values ('en la apertura', date '2026-01-01'), ('a 30/06', date '2026-06-30'), ('a 31/10', date '2026-10-31')) d(t, f)
  union all
  -- corte: asientos de 2026 de Foodint hasta el 31/10
  select 3, '41000003 de Uber validado a 31/10',
    (select coalesce(sum(l.credit - l.debit), 0)::numeric(14,2)::text
       from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and a.code = '41000003' and e.entry_date between date '2026-01-01' and date '2026-10-31' and e.status = 'validado')
  union all
  -- quieta: la tanda no toca el IVA presentado
  select 4, 'IVA de Foodint ' || q.c || ' del 1T al 3T de 2026',
    (select coalesce(sum(case when q.c = '472' then l.debit - l.credit else l.credit - l.debit end), 0)::numeric(14,2)::text
       from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and a.code like q.c || '%' and e.status = 'validado' and e.entry_date between date '2026-01-01' and date '2026-09-30')
    from (values ('472'), ('477')) q(c)
) t order by o, clave;
