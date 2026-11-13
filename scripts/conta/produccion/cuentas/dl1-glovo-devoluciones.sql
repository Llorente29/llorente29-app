-- scripts/conta/produccion/cuentas/dl1-glovo-devoluciones.sql
--
-- DL1 · devoluciones falsas de Glovo de octubre (0205) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0 (sin Foodint, 0 antes y después).
-- La vara de los saldos, la de la DL1·20: validados y anulados con su contraasiento.
--   1. Devoluciones de octubre en «Propuesto»: 20 → 0.
--   2. La 1/2010 anulada, menos 1: −1 → 0.
--   3. «Se cobró por otro lado» de los 21 pedidos, menos 21: −21 → 0.
--   4. La 477 de la 1/2010 con su contraasiento: 1,85 → 0.
--   5. El IVA de Foodint del 1T al 3T: igual.
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay),
v as (select unnest(array['56072c28-32ae-4065-a7bb-4282067a13a0', '662ec0d9-e44e-4845-baa4-f04d8fe2b52e', '384de9da-674b-4bb5-835c-5c12bdc36ead',
  '3c36e6af-c350-487f-9bf9-64b13d05ae9e', '0d7a5869-c837-4d8e-811e-eafa16db3099', 'a86c4856-cace-4244-b883-d9a9fdf3c7c1', '2b3efa39-9bc3-4b27-9f55-e339fdb37d07',
  '6fca1bf8-5953-4082-88ea-73ef04237dc2', 'b8fdca8e-2282-40ab-9e48-81492ebdb899', 'b5a1c95a-30e7-42be-a181-197a875b4438', 'e0cbda61-17aa-454c-b0c7-3702f0e20a4a',
  'c5190a76-45b9-493d-9b28-83479704d825', '477fd6ce-c49b-4915-bfcf-f14ffe8bd63f', 'ac3d179d-795c-481c-be35-16f15ade8260', '0d7e0ab2-8597-49da-89d1-8e19fd3c0dd2',
  '55cc530e-f651-4130-99c2-dc3314a1b7e8', 'e43a74a2-2b42-40e6-947e-89a8b219617e', '32b35dca-bc27-4588-bcaa-9c31e7a6ce30', 'a9ccb705-b4da-4868-a2eb-2d20e4f046c9',
  '8d0f3abb-729a-48bd-983f-e640b60ea6fe', '07b0190e-7672-428f-9115-415f3e636944']) k),
l as (
  select a.code, e.entry_date, e.id, e.reverses_entry_id, l.debit, l.credit
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     and e.status in ('validado', 'anulado') and (e.voided_at is null or e.voided_by_entry_id is not null)
     -- corte: asientos de 2026
     and e.entry_date between date '2026-01-01' and date '2026-12-31'
)
select clave, valor from (
  -- corte: asientos de octubre
  select 1 o, 'Devoluciones de octubre en «Propuesto»' clave,
    (select count(*) from public.journal_entry e where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and e.status = 'propuesto' and e.source_type = 'sales_adjustment' and e.entry_date between date '2026-10-01' and date '2026-10-31')::text valor
  union all
  -- quieta: un asiento por su id
  select 2, 'La 1/2010 anulada, menos 1',
    (select case when not (select hay from f) then 0 else count(*) - 1 end from public.journal_entry
      where id = 'be914472-6625-4dde-92a7-df68152f106d' and status = 'anulado')::text
  union all
  -- quieta: 21 pedidos por su id
  select 3, '«Se cobró por otro lado» de los 21 pedidos, menos 21',
    (select case when not (select hay from f) then 0 else count(*) - 21 end from public.journal_dismissal d join v on v.k = d.source_key
      where d.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and d.source_type = 'sales_adjustment')::text
  union all
  select 4, 'La 477 de la 1/2010 con su contraasiento',
    (select coalesce(sum(l.debit - l.credit), 0)::numeric(14,2)::text from l
      where l.code like '477%' and (l.id = 'be914472-6625-4dde-92a7-df68152f106d' or l.reverses_entry_id = 'be914472-6625-4dde-92a7-df68152f106d'))
  union all
  select 5, 'IVA de Foodint ' || q.c || ' del 1T al 3T de 2026',
    (select coalesce(sum(case when q.c = '472' then l.debit - l.credit else l.credit - l.debit end), 0)::numeric(14,2)::text
       from l where l.code like q.c || '%' and l.entry_date between date '2026-01-01' and date '2026-09-30')
    from (values ('472'), ('477')) q(c)
) t order by o, clave;
