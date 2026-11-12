-- scripts/conta/produccion/cuentas/dl1-glovo-compensaciones.sql
--
-- DL1 · las compensaciones de Glovo del 01–15/10 (1958) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0 (sin Foodint, 0 antes y después).
--   1. Compensaciones de Glovo del 16/10 validadas por Julio, menos 10: −10 → 0.
--   2. Lo que suman, menos 612,74: −612,74 → 0.
--   3. Asientos propuestos de octubre, menos 15 (las 3 del céntimo y las 12 ventas del día): 10 → 0.
--   4. El IVA de Foodint del 1T al 3T (472 y 477, por fecha): igual.
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay),
c as (
  select e.id, e.status, e.validated_by, (select sum(l.debit) from public.journal_line l where l.entry_id = e.id) importe
    from public.journal_entry e
   where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     and e.source_type = 'channel_settlement'
     -- corte: asientos del 16/10
     and e.entry_date between date '2026-10-16' and date '2026-10-16'
     and e.id in ('106fdbeb-4f44-4cc8-bd54-986dc92ac998', 'ff418538-0873-4118-bc4a-0d87d859d0e3', '5fdaed3b-94bc-49a8-9a26-ef5956a45fbe',
                  '8891cbd3-b6d1-4218-a455-a1cefd584d79', '79215592-7bd2-45a6-b627-4b3685d39b74', '99051fa6-9c68-484b-aa9e-421e1052af26',
                  'c9bf98c9-0c87-4d95-a60c-5a3ae49e1aab', 'e09eaa1a-64f0-4fae-9156-1f8e88579159', '19f0e54e-d45b-4d08-a98f-94296e02b8a0',
                  'c9cc6381-a261-41e7-8d28-e1402e245326')
)
select clave, valor from (
  select 1 o, 'Compensaciones de Glovo del 16/10 validadas por Julio, menos 10' clave,
    (select case when not (select hay from f) then 0 else count(*) - 10 end from c
      where c.status = 'validado' and c.validated_by = '673fca49-f6b5-40ed-a8f7-558390acce10')::text valor
  union all
  select 2, 'Lo que suman, menos 612,74',
    (select case when not (select hay from f) then 0 else coalesce(sum(c.importe), 0) - 612.74 end from c where c.status = 'validado')::numeric(14,2)::text
  union all
  -- corte: asientos de octubre
  select 3, 'Asientos propuestos de octubre, menos 15',
    (select case when not (select hay from f) then 0 else count(*) - 15 end from public.journal_entry e
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and e.status = 'propuesto' and e.entry_date between date '2026-10-01' and date '2026-10-31')::text
  union all
  select 4, 'IVA de Foodint ' || q.c || ' del 1T al 3T de 2026',
    (select coalesce(sum(case when q.c = '472' then l.debit - l.credit else l.credit - l.debit end), 0)::numeric(14,2)::text
       from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
      where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and a.code like q.c || '%' and e.status = 'validado' and e.entry_date between date '2026-01-01' and date '2026-09-30')
    from (values ('472'), ('477')) q(c)
) t order by o, clave;
