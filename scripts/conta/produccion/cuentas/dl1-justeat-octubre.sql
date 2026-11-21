-- scripts/conta/produccion/cuentas/dl1-justeat-octubre.sql
--
-- DL1 · Just Eat del 01–15/10 (1615) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0 (sin Foodint, 0 antes y después).
-- La vara de los saldos, la de la DL1·20: validados y anulados con su contraasiento.
--   1. Las 4 liquidaciones del 01–15/10 con su asiento validado, menos 4: −4 → 0.
--   2. Las 3 facturas nuevas con su asiento validado, menos 3: −3 → 0.
--   3. 43000003 (Just Eat) a 31/10, menos 404,52 (323,92 que pagó en noviembre + 80,60 de antes de octubre): +66,97 → 0.
--   4. 41000004 (Just Eat, comisiones) a 31/10: +5,98 → 0.
--   5. El IVA soportado de las 3 facturas, menos 2,80: −2,80 → 0.
--   6. El IVA repercutido del 4T: igual.
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
  select 1 o, 'Las 4 liquidaciones del 01–15/10 con asiento validado, menos 4' clave,
    (select case when not (select hay from f) then 0 else count(*) - 4 end
       from public.channel_settlement c
      where c.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and c.settlement_ref in ('4126424', '4126364', '4126341', '4126387')
        and exists (select 1 from public.journal_entry e where e.source_type = 'channel_settlement' and e.source_id = c.id and e.status = 'validado'))::text valor
  union all
  select 2, 'Las 3 facturas nuevas con asiento validado, menos 3',
    -- quieta: tres facturas por su número, que solo crea esta tanda
    (select case when not (select hay from f) then 0 else count(*) - 3 end
       from public.supplier_invoice s join public.journal_entry e on e.id = s.journal_entry_id
      where s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and s.invoice_number in ('4126424', '4126364', '4126341') and e.status = 'validado')::text
  union all
  select 3, '43000003 a 31/10, menos 404,52',
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) - 404.52 end::numeric(14,2)::text from l where l.code = '43000003' and l.entry_date <= date '2026-10-31')
  union all
  select 4, '41000004 a 31/10',
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) end::numeric(14,2)::text from l where l.code = '41000004' and l.entry_date <= date '2026-10-31')
  union all
  select 5, 'IVA soportado de las 3 facturas, menos 2,80',
    -- quieta: solo las líneas de los asientos de estas 3 facturas, que no escribe nadie más
    (select case when not (select hay from f) then 0 else coalesce(sum(jl.debit - jl.credit), 0) - 2.80 end::numeric(14,2)::text
       from public.supplier_invoice s join public.journal_line jl on jl.entry_id = s.journal_entry_id join public.company_account a on a.id = jl.company_account_id
      where s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and s.invoice_number in ('4126424', '4126364', '4126341') and a.code like '472%')
  union all
  select 6, 'IVA 477 del 4T', (select coalesce(sum(l.debit - l.credit), 0)::numeric(14,2)::text from l where l.code like '477%' and l.entry_date between date '2026-10-01' and date '2026-12-31')
) t order by o, clave;
