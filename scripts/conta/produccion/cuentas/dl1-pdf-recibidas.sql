-- scripts/conta/produccion/cuentas/dl1-pdf-recibidas.sql
--
-- DL1 · los PDF de 44 facturas recibidas (1805) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Cada medida es lo que FALTA para el objetivo: después, todo a 0 (sin Foodint, 0 antes y después).
--   1. De las 44, las que no tienen su PDF de dl1-glovo-39: 44 → 0.
--   2. El Debe de sus asientos validados: como antes (la tanda no toca asientos ni importes).
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay),
s as (
  select s.id, s.invoice_number, s.raw_document_url, s.journal_entry_id from public.supplier_invoice s
   -- quieta: el documento de esas 44 solo lo pone esta tanda (ninguna lo tenía, y con asiento validado ya no se cambia)
   where s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and s.status not in ('anulada', 'descartada')
     and s.invoice_number in ('200022764059','200172745966','200212774810','200520988958','200520989047','4126341','4126364','4126424','C170326100002853','C170326100004265','C170326100015712','C170326100017723','FV-02927','FV-02931','I170326000067714','I170326000082245','I170326000117056','I170326000121190','I170326000143776','I170326000145733','I170326000153232','I170326000159928','I170326000179687','I170326000182979','I170326000201893','I170326000210590','I170326000222474','I170326000226180','I170326000235906','I170326000236646','I170326000237846','I170326000238033','I170326000238173','I170326000239801','I170326000240862','I170326000242509','I170326000243469','I170326000245703','I170326000245934','I170326000248661','I170326000250366','I170326000250861','I170326000253888','I170326000264293')
)
select clave, valor from (
  select 1 o, 'de las 44, las que no tienen su PDF' clave,
    (select case when not (select hay from f) then 0 else 44 - count(*) filter (where s.raw_document_url = '51ad1792-6629-4ef7-833a-b57b09a86710/dl1-glovo-39/' || s.invoice_number || '.pdf') end::text from s) valor
  union all
  select 2, 'Debe de sus asientos validados',
    -- quieta: asientos validados; nadie los cambia (se anulan con contraasiento, y la vara no los cuenta distinto)
    (select coalesce(sum(l.debit), 0)::numeric(14,2)::text from s join public.journal_entry e on e.id = s.journal_entry_id and e.status = 'validado' join public.journal_line l on l.entry_id = e.id)
) x order by o, clave;
