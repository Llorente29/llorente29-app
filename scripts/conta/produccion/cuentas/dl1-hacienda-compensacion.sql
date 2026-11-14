-- scripts/conta/produccion/cuentas/dl1-hacienda-compensacion.sql
--
-- DL1·27 · Hacienda, la compensación de oficio y el embargo de la TGSS (1155) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0 (sin Foodint, 0 antes y después).
-- La vara de los saldos, la de la DL1·20: validados y anulados con su contraasiento.
--   1. 47090000 (la devolución del IS 2025) a 31/12/2026: 1.126,10 → 0.
--   2. 47510000 del acuerdo 282630448208C, menos 306,99: −306,99 → 0.
--   3. 67800000 del acuerdo 282630448208C, menos 33,07: −33,07 → 0.
--   4. 47600000 del embargo 28 01 25 01471259, menos 786,04: −786,04 → 0.
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay),
l as (
  select a.code, e.entry_date, e.concept, l.debit, l.credit
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     and e.status in ('validado', 'anulado') and (e.voided_at is null or e.voided_by_entry_id is not null)
     -- corte: asientos hasta el 31/12/2026
     and e.entry_date <= date '2026-12-31'
)
select clave, valor from (
  select 1 o, '47090000 a 31/12/2026' clave,
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) end::numeric(14,2)::text from l where l.code = '47090000') valor
  union all
  select 2, '47510000 del acuerdo 282630448208C, menos 306,99',
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) - 306.99 end::numeric(14,2)::text from l where l.code = '47510000' and l.concept like '%282630448208C%')
  union all
  select 3, '67800000 del acuerdo 282630448208C, menos 33,07',
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) - 33.07 end::numeric(14,2)::text from l where l.code = '67800000' and l.concept like '%282630448208C%')
  union all
  select 4, '47600000 del embargo 28 01 25 01471259, menos 786,04',
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) - 786.04 end::numeric(14,2)::text from l where l.code = '47600000' and l.concept like '%28 01 25 01471259%')
) x order by o, clave;
