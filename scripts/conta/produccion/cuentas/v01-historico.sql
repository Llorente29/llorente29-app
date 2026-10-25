-- scripts/conta/produccion/cuentas/v01-historico.sql
--
-- V01 (24/10) · LO QUE CUENTA LA TANDA DEL HISTÓRICO, antes y después. SOLO
-- LEE. TABLA ENTERA, a propósito y dicho (regla 9): los dos grupos se buscan
-- por su regla en todas las cuentas (el 24/10, solo Foodint los tiene).
--
-- Antes: facturas de venta 0 (o las que haya); cierres sin factura 85;
-- traídos sin factura 1.196. Después: facturas + 1.281; los dos grupos a 0;
-- asientos, anotaciones del libro y su total, iguales; el libro de expedidas
-- con número, + 85.
select clave, valor from (
  select 1 o, 'asientos' clave, (select count(*) from public.journal_entry)::text valor union all
  select 2, 'anotaciones de expedidas', (select count(*) from public.vat_book_entry where book = 'issued')::text union all
  select 3, 'total de expedidas', (select coalesce(sum(total), 0) from public.vat_book_entry where book = 'issued')::text union all
  select 4, 'expedidas con número', (select count(*) from public.vat_book_entry where book = 'issued' and number is not null)::text union all
  select 5, 'facturas de venta', (select count(*) from public.customer_invoice)::text union all
  select 6, 'cierres validados sin factura y en Diez',
         (select count(*) from public.journal_entry e join public.sales_day_summary s on s.entry_id = e.id and s.unit_key is not null and s.channel_id is not null
           where e.source_type = 'sales_day' and e.status = 'validado' and not exists (select 1 from public.customer_invoice ci where ci.entry_id = e.id)
             and exists (select 1 from public.external_send x where x.entry_id = e.id and x.status in ('enviado', 'enlazado') and x.ext_invoice_number is not null))::text union all
  select 7, 'traídos sin NIF y sin factura',
         (select count(*) from public.journal_entry e join public.vat_book_entry v on v.entry_id = e.id and v.book = 'issued'
           where e.source_type = 'migrated' and e.status = 'validado' and v.counterpart_tax_id is null and v.number is not null
             and not exists (select 1 from public.customer_invoice ci where ci.entry_id = e.id))::text
) t order by o;
