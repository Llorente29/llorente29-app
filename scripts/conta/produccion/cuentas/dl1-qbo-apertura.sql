-- scripts/conta/produccion/cuentas/dl1-qbo-apertura.sql
--
-- DL1 · la apertura de QBO (1035) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0 (sin Foodint, 0 antes y después).
-- La vara de los saldos, la de la DL1·20: validados y anulados con su contraasiento.
--   1. La 41000008 (QBO), menos 537,60 (el pago a cuenta del 12/11): −145,20 → 0.
--   2. La 11300000 a 01/01, más 969,54: +145,20 → 0.
--   3. El IVA del 1T: igual.
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay),
l as (
  select a.code, e.entry_date, l.debit, l.credit
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     and e.status in ('validado', 'anulado') and (e.voided_at is null or e.voided_by_entry_id is not null)
     -- corte: asientos de 2026
     and e.entry_date between date '2026-01-01' and date '2026-12-31'
)
select clave, valor from (
  select 1 o, '41000008 (QBO), menos 537,60' clave,
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) - 537.60 end::numeric(14,2)::text from l where l.code = '41000008') valor
  union all
  select 2, '11300000 a 01/01, más 969,54',
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) + 969.54 end::numeric(14,2)::text from l where l.code = '11300000' and l.entry_date = date '2026-01-01')
  union all
  select 3, 'IVA ' || y.c || ' del 1T', (select coalesce(sum(l.debit - l.credit), 0)::numeric(14,2)::text from l where l.code like y.c || '%' and l.entry_date between date '2026-01-01' and date '2026-03-31')
    from (values ('472'), ('477')) y(c)
) t order by o, clave;
