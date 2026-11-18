-- scripts/conta/produccion/cuentas/dl1-iva-3t-socio.sql
--
-- DL1·28 · el 4/3155 y la liquidación del IVA del 3T (1220) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0 (sin Foodint, 0 antes y después).
-- La vara de los saldos, la de la DL1·20: validados y anulados con su contraasiento.
--   1. 55100001 del 4/3155, más 28,00: 28,00 → 0.
--   2. 477 de la liquidación del 3T, menos 9.855,66 (casilla [27]): −9.855,66 → 0.
--   3. 472 de la liquidación del 3T, menos 13.579,10 (casilla [45]): −13.579,10 → 0.
--   4. 4700 de la liquidación del 3T, menos 3.723,44 (casilla [71], a compensar): −3.723,44 → 0.
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay),
l as (
  select a.code, a.template_code, e.entry_date, e.concept, e.source_type, e.source_id, l.debit, l.credit
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     and e.status in ('validado', 'anulado') and (e.voided_at is null or e.voided_by_entry_id is not null)
     -- corte: asientos de 2026
     and e.entry_date between date '2026-01-01' and date '2026-12-31'
),
q as (select * from l where l.source_type = 'vat_settlement' and l.source_id = '76943ee6-26b3-467a-8410-3733feb1e235')
select clave, valor from (
  select 1 o, '55100001 del 4/3155, más 28,00' clave,
    (select case when not (select hay from f) then 0 else 28.00 + coalesce(sum(l.debit - l.credit), 0) end::numeric(14,2)::text from l where l.code = '55100001' and l.concept like '%(4/3155 de Diez)%') valor
  union all
  select 2, '477 de la liquidación del 3T, menos 9.855,66',
    (select case when not (select hay from f) then 0 else coalesce(sum(q.debit - q.credit), 0) - 9855.66 end::numeric(14,2)::text from q where q.template_code like '477%')
  union all
  select 3, '472 de la liquidación del 3T, menos 13.579,10',
    (select case when not (select hay from f) then 0 else coalesce(sum(q.credit - q.debit), 0) - 13579.10 end::numeric(14,2)::text from q where q.template_code like '472%')
  union all
  select 4, '4700 de la liquidación del 3T, menos 3.723,44',
    (select case when not (select hay from f) then 0 else coalesce(sum(q.debit - q.credit), 0) - 3723.44 end::numeric(14,2)::text from q where q.template_code = '4700')
) x order by o, clave;
