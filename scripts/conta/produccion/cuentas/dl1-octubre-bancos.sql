-- scripts/conta/produccion/cuentas/dl1-octubre-bancos.sql
--
-- DL1 · octubre de Llorente29 (1842) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después de la tanda, todo a 0. Así lo esperado vale
-- igual en producción y en staging (sin Foodint, todo da 0 antes y después).
--   1. Movimientos de octubre sin casar: 33 → 0.
--   2. Casados por Julio con su asiento validado, menos 33: −33 → 0.
--   3. La 9/2 y la 9/3 anuladas, menos 2: −2 → 0.
--   4. 472, 477 y 470 de sus contraasientos, menos lo que deshacen: → 0.
--   5. A 01/01: 570 (3.998,88 → 0), 57200002 menos 1.607,10 (290 → 0), 113 más 824,34
--      (−4.288,88 → 0), 43000001 menos 546,59 (884,74 → 0); 43000101 en 2026 (−884,74 → 0).
--   6. Lo que falta por pagar de las facturas 24056932 y 24093211 de Europastry: 397,20 → 0.
--   7. Cada 572 a 31/10 menos su extracto (la ···4525, más 4,00: lo que no explica la tanda).
--   8. El IVA de Foodint del 1T al 3T (472 y 477, por fecha): igual.
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay),
l as (
  select a.code, e.entry_date, e.status, e.series, e.number, e.reverses_entry_id, l.debit, l.credit
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     -- corte: asientos de 2026
     and e.entry_date between date '2026-01-01' and date '2026-12-31'
)
select clave, valor from (
  -- corte: movimientos de octubre
  select 1 o, 'Movimientos de octubre sin casar' clave,
    (select count(*) from public.bank_movement m where m.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
        and m.op_date between date '2026-10-01' and date '2026-10-31' and m.status in ('por_aclarar', 'propuesto'))::text valor
  union all
  -- corte: casados entre el 12/11 y el 31/12
  select 2, 'Casados de octubre por Julio con su asiento validado, menos 33',
    (select case when not (select hay from f) then 0 else count(*) - 33 end
       from public.bank_match b join public.bank_movement m on m.id = b.movement_id join public.journal_entry e on e.id = b.journal_entry_id
      where b.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and b.status = 'vivo' and e.status = 'validado'
        and b.created_by = '673fca49-f6b5-40ed-a8f7-558390acce10' and m.op_date between date '2026-10-01' and date '2026-10-31'
        and b.created_at between timestamptz '2026-11-12 00:00+00' and timestamptz '2026-12-31 00:00+00')::text
  union all
  -- quieta: dos asientos por su id
  select 3, 'La 9/2 y la 9/3 anuladas, menos 2',
    (select case when not (select hay from f) then 0 else count(*) - 2 end from public.journal_entry
      where id in ('a560e7d1-2b0e-40a6-b891-ab308aaf6122', '02436d5d-c0e2-4295-8029-651e4f2919c1') and status = 'anulado')::text
  union all
  select 4, q.c || ' de los contraasientos de la 9/2 y la 9/3, menos lo que deshacen',
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) - q.v end::numeric(14,2)::text
       from l where l.code like q.c || '%' and l.status = 'validado'
        and l.reverses_entry_id in ('a560e7d1-2b0e-40a6-b891-ab308aaf6122', '02436d5d-c0e2-4295-8029-651e4f2919c1'))
    from (values ('472', 34659.31), ('477', -33172.41), ('470', -1486.90)) q(c, v)
  union all
  select 5, q.k, (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) + q.mas end::numeric(14,2)::text
                    from l where l.code = q.c and l.status = 'validado' and l.entry_date between q.d1 and q.d2)
    from (values ('57000000 a 01/01', '57000000', 0.00, date '2026-01-01', date '2026-01-01'),
                 ('57200002 a 01/01, menos 1.607,10', '57200002', -1607.10, date '2026-01-01', date '2026-01-01'),
                 ('11300000 a 01/01, más 824,34', '11300000', 824.34, date '2026-01-01', date '2026-01-01'),
                 ('43000001 a 01/01, menos 546,59', '43000001', -546.59, date '2026-01-01', date '2026-01-01'),
                 ('43000101 en 2026', '43000101', 0.00, date '2026-01-01', date '2026-12-31')) q(k, c, mas, d1, d2)
  union all
  -- quieta: dos facturas por su id
  select 6, 'Lo que falta por pagar de las 24056932 y 24093211 de Europastry',
    (select case when not (select hay from f) then 0 else coalesce(sum(s.grand_total), 0) - coalesce((select sum(i.amount) from public.bank_match_item i join public.bank_match b on b.id = i.match_id
              where b.status = 'vivo' and i.supplier_invoice_id in ('70be91a4-44e4-4944-9fcf-a91a1ca051bc', '524d1208-4f77-4035-aa7a-a001d2461b9d')), 0) end::numeric(14,2)::text
       from public.supplier_invoice s where s.id in ('70be91a4-44e4-4944-9fcf-a91a1ca051bc', '524d1208-4f77-4035-aa7a-a001d2461b9d'))
  union all
  select 7, q.c || ' a 31/10 menos su extracto' || q.nota,
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) - q.extracto + q.mas end::numeric(14,2)::text
       from l where l.code = q.c and l.status = 'validado' and l.entry_date <= date '2026-10-31')
    from (values ('57200001', 75.55, 0.00, ''), ('57200002', 98.57, 4.00, ', más 4,00'), ('57200003', 324.61, 0.00, '')) q(c, extracto, mas, nota)
  union all
  select 8, 'IVA de Foodint ' || q.c || ' del 1T al 3T de 2026',
    (select coalesce(sum(case when q.c = '472' then l.debit - l.credit else l.credit - l.debit end), 0)::numeric(14,2)::text
       from l where l.code like q.c || '%' and l.status = 'validado' and l.entry_date between date '2026-01-01' and date '2026-09-30')
    from (values ('472'), ('477')) q(c)
) t order by o, clave;
