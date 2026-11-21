-- scripts/conta/produccion/cuentas/dl1-justeat-regularizacion.sql
--
-- DL1·30 · Just Eat, la regularización (0035) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0 (sin Foodint, 0 antes y después).
-- La vara de los saldos, la de la DL1·20: validados y anulados con su contraasiento.
--   1. 43000003 a 31/10, menos 320,17 (lo que Just Eat debe según sus estados de cuenta): −63,51 → 0.
--   2. 77800000 de 2026 con la regularización de Just Eat, más 63,51: +63,51 → 0.
--   3. El IVA del 4T: igual.
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay),
l as (
  select a.code, e.entry_date, e.concept, l.debit, l.credit
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     and e.status in ('validado', 'anulado') and (e.voided_at is null or e.voided_by_entry_id is not null)
     -- corte: asientos de 2026
     and e.entry_date between date '2026-01-01' and date '2026-12-31'
)
select clave, valor from (
  select 1 o, '43000003 a 31/10, menos 320,17' clave,
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) - 320.17 end::numeric(14,2)::text from l where l.code = '43000003' and l.entry_date <= date '2026-10-31') valor
  union all
  select 2, '77800000 de la regularización de Just Eat, más 63,51',
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) + 63.51 end::numeric(14,2)::text from l where l.code = '77800000' and l.concept like 'Just Eat · regularización%')
  union all
  select 3, 'IVA ' || y.c || ' del 4T', (select coalesce(sum(l.debit - l.credit), 0)::numeric(14,2)::text from l where l.code like y.c || '%' and l.entry_date between date '2026-10-01' and date '2026-12-31')
    from (values ('472'), ('477')) y(c)
) t order by o, clave;
