-- scripts/conta/produccion/cuentas/dl1-uber-octubre.sql
--
-- DL1 · Uber de octubre (1225) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0 (sin Foodint, 0 antes y después).
-- La vara de los saldos, la de la DL1·20: validados y anulados con su contraasiento.
--   1. Liquidaciones de Uber con fecha de octubre y su asiento validado, menos 23: −17 → 0.
--   2. 41000003 (Portier) a 31/10, más 0,45 (los céntimos de redondeo): −4.543,15 → 0.
--   3. 43000002 (Uber) a 31/10, menos 2.832,76: +4.543,15 → 0.
--   4. 41000003 en 2026, más 0,45: −34,71 → 0.
--   5. 43000002 en 2026, menos 3.259,06: +34,71 → 0.
--   6. El IVA del 4T: igual.
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
  select 1 o, 'Liquidaciones de Uber de octubre con asiento validado, menos 23' clave,
    (select case when not (select hay from f) then 0 else count(*) - 23 end
       from public.channel_settlement c join public.sales_channel ch on ch.id = c.channel_id
      where c.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and ch.name = 'Uber'
        and c.settlement_date between date '2026-10-01' and date '2026-10-31'
        and exists (select 1 from public.journal_entry e where e.source_type = 'channel_settlement' and e.source_id = c.id and e.status = 'validado'))::text valor
  union all
  select 2, q.k, (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) + q.mas end::numeric(14,2)::text
                    from l where l.code = q.c and l.entry_date <= q.hasta)
    from (values ('41000003 a 31/10, más 0,45', '41000003', 0.45, date '2026-10-31'),
                 ('43000002 a 31/10, menos 2.832,76', '43000002', -2832.76, date '2026-10-31'),
                 ('41000003 en 2026, más 0,45', '41000003', 0.45, date '2026-12-31'),
                 ('43000002 en 2026, menos 3.259,06', '43000002', -3259.06, date '2026-12-31')) q(k, c, mas, hasta)
  union all
  select 3, 'IVA ' || y.c || ' del 4T', (select coalesce(sum(l.debit - l.credit), 0)::numeric(14,2)::text from l where l.code like y.c || '%' and l.entry_date between date '2026-10-01' and date '2026-12-31')
    from (values ('472'), ('477')) y(c)
) t order by o, clave;
