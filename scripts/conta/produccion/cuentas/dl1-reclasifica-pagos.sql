-- scripts/conta/produccion/cuentas/dl1-reclasifica-pagos.sql
--
-- DL1 · reclasificación de tres pagos de octubre (0915) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0 (sin Foodint, 0 antes y después).
-- La vara de los saldos, la de la DL1·20: validados y anulados con su contraasiento.
--   1. Reclasificaciones validadas por Julio, menos 3: −3 → 0.
--   2. El gasto de los tres pagos con su reclasificación: 419,89 → 0.
--   3. 41000023 (Iberdrola) a 31/10, más 330,12: −389,90 → 0.
--   4. 41000011 (Xfera) a 31/10, más 29,99: −29,99 → 0.
--   5. Las 572 a 31/10 y el IVA del 4T: igual.
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay),
r as (
  select e.id, e.status, e.validated_by from public.journal_entry e
   where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     -- corte: asientos de octubre
     and e.entry_date between date '2026-10-01' and date '2026-10-31'
     and (e.concept like 'Reclasifica el pago 4/3398:%' or e.concept like 'Reclasifica el pago 4/3406:%' or e.concept like 'Reclasifica el pago 4/3409:%')
),
l as (
  select a.code, e.entry_date, e.id, l.debit, l.credit
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     and e.status in ('validado', 'anulado') and (e.voided_at is null or e.voided_by_entry_id is not null)
     -- corte: asientos de 2026
     and e.entry_date between date '2026-01-01' and date '2026-12-31'
)
select clave, valor from (
  select 1 o, 'Reclasificaciones validadas por Julio, menos 3' clave,
    (select case when not (select hay from f) then 0 else count(*) - 3 end from r where r.status = 'validado' and r.validated_by = '673fca49-f6b5-40ed-a8f7-558390acce10')::text valor
  union all
  select 2, 'Gasto de los tres pagos con su reclasificación',
    (select coalesce(sum(l.debit - l.credit), 0)::numeric(14,2)::text from l where l.code in ('62800000', '62900000')
        and (l.id in ('6d16fe46-a115-4e87-b92d-c832a74e48c4', '04a5db15-abee-45d3-b45f-15931ff98bbe', '0969d6c2-51ac-40e0-8826-0c6d4dfa57bd') or l.id in (select id from r)))
  union all
  select 3, q.k, (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) + q.mas end::numeric(14,2)::text
                    from l where l.code = q.c and l.entry_date <= date '2026-10-31')
    from (values ('41000023 a 31/10, más 330,12', '41000023', 330.12), ('41000011 a 31/10, más 29,99', '41000011', 29.99)) q(k, c, mas)
  union all
  select 4, q.k, (select coalesce(sum(l.debit - l.credit), 0)::numeric(14,2)::text from l where l.code like q.c || '%' and l.entry_date between q.d1 and q.d2)
    from (values ('572 a 31/10', '572', date '2026-01-01', date '2026-10-31'), ('IVA 472 del 4T', '472', date '2026-10-01', date '2026-12-31'),
                 ('IVA 477 del 4T', '477', date '2026-10-01', date '2026-12-31')) q(k, c, d1, d2)
) t order by o, clave;
