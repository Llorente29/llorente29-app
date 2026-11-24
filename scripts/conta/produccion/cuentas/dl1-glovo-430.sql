-- scripts/conta/produccion/cuentas/dl1-glovo-430.sql
--
-- DL1 · la 43000001 conciliada con el zip de Glovo (0916) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0 (sin Foodint, 0 antes y después).
-- La vara de los saldos, la de la DL1·20: validados y anulados con su contraasiento.
--   1. 43000001 de la tanda (A1 + A2 + A3), menos 13.364,58: −13.364,58 → 0.
--   2. 70000000 de A1, menos 16.076,36 (al Haber): −16.076,36 → 0.
--   3. 47700010 de A1, menos 1.607,63 (al Haber, al 4T): −1.607,63 → 0.
--   4. 47200021 de A2 y de las facturas de A3, menos 532,45 (al Debe, al 4T): −532,45 → 0.
--   5. 41000002 de A3, menos 1.251,64 (1.516,29 compensado − 264,65 de las 4 facturas): −1.251,64 → 0.
--   6. De las 4 facturas del 16–30/06 que no estaban, las que faltan: 4 → 0.
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay),
l as (
  select a.code, e.concept, l.debit, l.credit
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     and e.status in ('validado', 'anulado') and (e.voided_at is null or e.voided_by_entry_id is not null)
     -- corte: asientos del 01/10/2026
     -- quieta: solo los asientos del 01/10/2026 con los conceptos que escribe esta tanda (A1, A2 y A3); nadie más escribe asientos con esos conceptos ni con esa fecha (el 1T y el 2T están presentados).
     and e.entry_date = date '2026-10-01'
     and (e.concept like 'Ventas Glovo % · regularización de la 43000001%' or e.concept like 'Glovo % · factura y compensación al revés%'
          or e.concept like 'Compensación Glovo que faltaba · %' or e.concept like 'Factura Glovo que faltaba · %')
)
select clave, valor from (
  select 1 o, '43000001 de la tanda, menos 13.364,58' clave,
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) - 13364.58 end::numeric(14,2)::text from l where l.code = '43000001') valor
  union all
  select 2, '70000000 de A1, menos 16.076,36',
    (select case when not (select hay from f) then 0 else coalesce(sum(l.credit - l.debit), 0) - 16076.36 end::numeric(14,2)::text from l where l.code = '70000000')
  union all
  select 3, '47700010 de A1, menos 1.607,63',
    (select case when not (select hay from f) then 0 else coalesce(sum(l.credit - l.debit), 0) - 1607.63 end::numeric(14,2)::text from l where l.code = '47700010')
  union all
  select 4, '47200021 de A2 y A3, menos 532,45',
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) - 532.45 end::numeric(14,2)::text from l where l.code = '47200021')
  union all
  select 5, '41000002 de A3, menos 1.251,64',
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) - 1251.64 end::numeric(14,2)::text from l where l.code = '41000002')
  union all
  select 6, 'de las 4 facturas del 16–30/06, las que faltan',
    (select case when not (select hay from f) then 0 else 4 - count(*) end::text from public.supplier_invoice s
      -- quieta: esas 4 solo las crea esta tanda (no están en Sumied y no llegan por correo: son de junio)
      where s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and s.status not in ('anulada', 'descartada')
        and s.invoice_number in ('I170326000269215', 'I170326000269904', 'I170326000292850', 'I170326000295313'))
) x order by o, clave;
