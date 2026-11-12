-- scripts/conta/produccion/cuentas/dl1-cloudtown.sql
--
-- DL1 · Cloudtown, la AF-02593 (1421) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después de la tanda, todo a 0. Así lo esperado vale igual
-- en producción y en staging (que no tiene Foodint: ahí todo da 0 antes y después).
--   1. La AF-02593 validada por Julio, menos 1: −1 → 0.
--   2. 43000004 validado, menos −4.210,62: −9.064,73 → 0,00.
--   3. IVA repercutido de la AF-02593 (01/10), menos 824,07: −824,07 → 0,00.
--   4. El IVA de Foodint del 1T al 3T (472 y 477, validado): igual.
select clave, valor from (
  -- corte: asientos creados entre el 12/11 y el 31/12
  select 1 o, 'AF-02593 validada por Julio, menos 1' clave,
    (select case when not exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') then 0 else count(*) - 1 end::text
       from public.journal_entry e
      where e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
        and e.concept like 'Autofactura Cloudtown AF-02593 %' and e.status = 'validado'
        and e.validated_by = '673fca49-f6b5-40ed-a8f7-558390acce10' and e.validated_by_name = 'Julio'
        and e.created_at between timestamptz '2026-11-12 00:00+00' and timestamptz '2026-12-31 00:00+00') valor
  union all
  -- corte: asientos de 2026 de Foodint hasta el 31/12
  select 2, '43000004 validado, menos −4.210,62',
    (select case when not exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') then 0
                 else coalesce(sum(l.debit - l.credit), 0) + 4210.62 end::numeric(14,2)::text
       from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and a.code = '43000004' and e.status = 'validado' and e.entry_date between date '2026-01-01' and date '2026-12-31')
  union all
  -- corte: asientos creados entre el 12/11 y el 31/12
  select 3, 'IVA repercutido de la AF-02593 (01/10), menos 824,07',
    (select case when not exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') then 0
                 else coalesce(sum(l.credit - l.debit), 0) - 824.07 end::numeric(14,2)::text
       from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and a.code like '477%' and e.status = 'validado' and e.entry_date = date '2026-10-01' and e.concept like 'Autofactura Cloudtown AF-02593 %'
        and e.created_at between timestamptz '2026-11-12 00:00+00' and timestamptz '2026-12-31 00:00+00')
  union all
  -- quieta: la tanda no toca el IVA presentado
  select 4, 'IVA de Foodint ' || q.c || ' del 1T al 3T de 2026',
    (select coalesce(sum(case when q.c = '472' then l.debit - l.credit else l.credit - l.debit end), 0)::numeric(14,2)::text
       from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and a.code like q.c || '%' and e.status = 'validado' and e.entry_date between date '2026-01-01' and date '2026-09-30')
    from (values ('472'), ('477')) q(c)
) t order by o, clave;
