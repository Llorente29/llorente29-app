-- scripts/conta/produccion/cuentas/dl1-justeat-restos.sql
--
-- DL1·29 · Just Eat, lo de antes de octubre con documento (1905) · LO QUE CUENTA LA TANDA. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0 (sin Foodint, 0 antes y después).
-- La vara de los saldos, la de la DL1·20: validados y anulados con su contraasiento.
--   1. Las 8 facturas de junio a agosto todavía en «en revisión»: 8 → 0.
--   2. 43000003 a 31/10, menos 256,66 (404,52 − 14,05 + 5,98 − 139,79): +147,86 → 0.
--   3. 41000004 a 31/10, menos 8,07 (las 3 compensadas a 01/10; sus facturas están a 01/11): −8,07 → 0.
--   4. El IVA del 4T: igual.
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
  select 1 o, 'Las 8 facturas de junio a agosto en en_revision' clave,
    -- quieta: ocho facturas por su id, que solo mueve esta tanda
    (select count(*) from public.supplier_invoice s
      where s.id in ('55eb23c1-c4d4-4b8d-9623-366ebf708042', 'fd9b4099-7123-4666-9732-8c121f02dadd', '3785d9ed-87e4-4402-a860-9d66fc0f3628',
                     '4b99c770-fec7-4d80-891e-9664a0c20a45', '277f737d-4b21-4c23-8b00-99e68d938d9c', 'e1a1205c-74b2-4e0d-bcea-543f6d85292a',
                     'e7aac1aa-ed7f-4dca-9547-de9e590fc8fd', '0b04ff45-c0aa-4716-b8e7-fda0e2093e1b') and s.status = 'en_revision')::text valor
  union all
  select 2, '43000003 a 31/10, menos 256,66',
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) - 256.66 end::numeric(14,2)::text from l where l.code = '43000003' and l.entry_date <= date '2026-10-31')
  union all
  select 3, '41000004 a 31/10, menos 8,07',
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) - 8.07 end::numeric(14,2)::text from l where l.code = '41000004' and l.entry_date <= date '2026-10-31')
  union all
  select 4, 'IVA ' || y.c || ' del 4T', (select coalesce(sum(l.debit - l.credit), 0)::numeric(14,2)::text from l where l.code like y.c || '%' and l.entry_date between date '2026-10-01' and date '2026-12-31')
    from (values ('472'), ('477')) y(c)
) t order by o, clave;
