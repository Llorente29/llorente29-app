-- scripts/conta/produccion/cuentas/dl1-facturas-a-su-fecha.sql
--
-- DL1 · las 40 facturas de octubre a su fecha (0905) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0 (sin Foodint, 0 antes y después).
-- La vara de los saldos, la de la DL1·20: validados y anulados con su contraasiento.
--   1. Facturas recibidas de octubre con el asiento fuera de octubre: 40 → 0.
--   2. Facturas recibidas de octubre con su asiento validado, menos 187: 0 → 0.
--   3. El gasto (grupo 6) de octubre, menos 44.760,53: −6.329,96 → 0.
--   4. El IVA del 4T (472 y 477) y los saldos de proveedores (400) y acreedores (410): igual.
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay),
fr as (
  select s.id, e.entry_date, e.status
    from public.supplier_invoice s join public.journal_entry e on e.id = s.journal_entry_id
   where s.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and s.discarded_at is null
     -- corte: facturas de octubre
     and s.invoice_date between date '2026-10-01' and date '2026-10-31'
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
  select 1 o, 'Facturas recibidas de octubre con el asiento fuera de octubre' clave,
    (select count(*) from fr where fr.status = 'validado' and fr.entry_date not between date '2026-10-01' and date '2026-10-31')::text valor
  union all
  select 2, 'Facturas recibidas de octubre con su asiento validado, menos 187',
    (select case when not (select hay from f) then 0 else count(*) - 187 end from fr where fr.status = 'validado')::text
  union all
  select 3, 'Gasto (grupo 6) de octubre, menos 44.760,53',
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) - 44760.53 end::numeric(14,2)::text
       from l where l.code like '6%' and l.entry_date between date '2026-10-01' and date '2026-10-31')
  union all
  select 4, q.k, (select coalesce(sum(l.debit - l.credit), 0)::numeric(14,2)::text from l where l.code like q.c || '%' and l.entry_date between q.d1 and q.d2)
    from (values ('IVA 472 del 4T', '472', date '2026-10-01', date '2026-12-31'), ('IVA 477 del 4T', '477', date '2026-10-01', date '2026-12-31'),
                 ('Proveedores (400)', '400', date '2026-01-01', date '2026-12-31'), ('Acreedores (410)', '410', date '2026-01-01', date '2026-12-31')) q(k, c, d1, d2)
) t order by o, clave;
