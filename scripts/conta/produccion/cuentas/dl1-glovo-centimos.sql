-- scripts/conta/produccion/cuentas/dl1-glovo-centimos.sql
--
-- DL1 · las tres compensaciones de Glovo del céntimo (0045) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0 (sin Foodint, 0 antes y después).
-- La vara de los saldos, la de la DL1·20: validados y anulados con su contraasiento.
--   1. Las tres validadas por Julio, menos 3: −3 → 0.
--   2. Lo que suman, menos 872,27: −872,27 → 0.
--   3. Liquidaciones de Glovo de octubre en «Propuesto»: 3 → 0.
--   4. La 40000007 (Coheldi) y el IVA de Foodint del 1T al 3T: igual.
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay),
c as (
  select e.id, e.status, e.validated_by, (select sum(l.debit) from public.journal_line l where l.entry_id = e.id) importe
    from public.journal_entry e
   where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     -- corte: asientos del 16/10
     and e.entry_date between date '2026-10-16' and date '2026-10-16'
     and e.id in ('f6198b69-5d00-4c0d-a5f9-01efe4e5ef34', '5f1033e2-fc29-48bb-8706-9fdd94f80c0a', '6c08951f-efd7-4952-93ac-de3d69b586c9')
),
l as (
  select a.code, e.entry_date, l.debit, l.credit
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     and e.status in ('validado', 'anulado') and (e.voided_at is null or e.voided_by_entry_id is not null)
     -- corte: asientos de 2026
     and e.entry_date between date '2026-01-01' and date '2026-12-31'
)
select clave, valor from (
  select 1 o, 'Las tres compensaciones del céntimo validadas por Julio, menos 3' clave,
    (select case when not (select hay from f) then 0 else count(*) - 3 end from c
      where c.status = 'validado' and c.validated_by = '673fca49-f6b5-40ed-a8f7-558390acce10')::text valor
  union all
  select 2, 'Lo que suman, menos 872,27',
    (select case when not (select hay from f) then 0 else coalesce(sum(c.importe), 0) - 872.27 end from c where c.status = 'validado')::numeric(14,2)::text
  union all
  -- corte: asientos de octubre
  select 3, 'Liquidaciones de octubre en «Propuesto»',
    (select count(*) from public.journal_entry e
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and e.status = 'propuesto' and e.source_type = 'channel_settlement' and e.entry_date between date '2026-10-01' and date '2026-10-31')::text
  union all
  select 4, '40000007 (Coheldi)', (select coalesce(sum(l.debit - l.credit), 0)::numeric(14,2)::text from l where l.code = '40000007')
  union all
  select 5, 'IVA de Foodint ' || q.c || ' del 1T al 3T de 2026',
    (select coalesce(sum(case when q.c = '472' then l.debit - l.credit else l.credit - l.debit end), 0)::numeric(14,2)::text
       from l where l.code like q.c || '%' and l.entry_date between date '2026-01-01' and date '2026-09-30')
    from (values ('472'), ('477')) q(c)
) t order by o, clave;
