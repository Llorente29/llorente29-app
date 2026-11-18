-- scripts/conta/produccion/cuentas/dl1-glovo-facturas-1t2t.sql
--
-- DL1·26, punto 2 · Glovo, las facturas del 1T y el 2T que faltan (1210) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0 (sin Foodint, 0 antes y después).
-- La vara de los saldos, la de la DL1·20: validados y anulados con su contraasiento.
--   1. De las 39 facturas y notas de crédito, las que no están en Sumied: 39 → 0.
--   2. 62300001 de sus asientos a 01/10, menos 2.707,29: −2.707,29 → 0.
--   3. 47200021 de sus asientos a 01/10, menos 568,58 (IVA soportado al 4T): −568,58 → 0.
--   4. 43000001 de sus compensaciones a 01/10, más 3.275,87: +3.275,87 → 0.
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay),
l as (
  select a.code, e.entry_date, e.concept, l.debit, l.credit
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     and e.status in ('validado', 'anulado') and (e.voided_at is null or e.voided_by_entry_id is not null)
     -- corte: asientos del 01/10/2026
     and e.entry_date = date '2026-10-01'
)
select clave, valor from (
  select 1 o, 'de las 39 facturas de Glovo del 1T y el 2T, las que faltan' clave,
    (select case when not (select hay from f) then 0 else 39 - count(distinct s.invoice_number) end::text from public.supplier_invoice s
      -- quieta: esas 39 solo las crea esta tanda; ninguna está en Sumied y no llegan por correo (son de marzo a junio)
      where s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and s.status not in ('anulada', 'descartada')
        and s.invoice_number in ('200022764059','200172745966','200212774810','200520988958','200520989047','I170326000067714','I170326000082245','I170326000117056','I170326000121190','I170326000143776','I170326000145733','I170326000153232','I170326000159928','I170326000179687','I170326000182979','I170326000201893','I170326000210590','I170326000222474','I170326000226180','C170326100002853','C170326100004265','C170326100015712','C170326100017723','I170326000235906','I170326000236646','I170326000237846','I170326000238033','I170326000238173','I170326000239801','I170326000240862','I170326000242509','I170326000243469','I170326000245703','I170326000245934','I170326000248661','I170326000250366','I170326000250861','I170326000253888','I170326000264293')) valor
  union all
  select 2, '62300001 de sus asientos a 01/10, menos 2.707,29',
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) - 2707.29 end::numeric(14,2)::text from l where l.code = '62300001' and l.concept like 'Factura GLOVOAPP SPAIN PLATFORM · %')
  union all
  select 3, '47200021 de sus asientos a 01/10, menos 568,58',
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) - 568.58 end::numeric(14,2)::text from l where l.code = '47200021' and l.concept like 'Factura GLOVOAPP SPAIN PLATFORM · %')
  union all
  select 4, '43000001 de sus compensaciones a 01/10, más 3.275,87',
    (select case when not (select hay from f) then 0 else coalesce(sum(l.debit - l.credit), 0) + 3275.87 end::numeric(14,2)::text from l where l.code = '43000001' and l.concept like 'Glovo · % compensada con lo que Glovo debe')
) x order by o, clave;
