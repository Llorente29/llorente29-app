-- scripts/conta/produccion/cuentas/v01b-cuotas.sql
--
-- V01b (25/10) · LO QUE CUENTA LA TANDA DE LAS CUOTAS, antes y después. SOLO
-- LEE. TABLA ENTERA, a propósito y dicho (regla 9): las facturas de venta
-- emitidas de todas las cuentas (el 25/10, solo Foodint tiene).
--
-- Medido el 25/10: emitidas 1.286 (líneas 1.286); sin PDF 108; con el IVA
-- recalculado distinto del suyo 1 + las 108 de las traídas (y 35 cierres y 3
-- resúmenes, que ya tienen su PDF de siempre). Después: líneas emitidas sin
-- cuota 0; facturas cuyo IVA no es la suma de sus cuotas 0; asientos,
-- anotaciones del libro y su total, iguales.
select clave, valor from (
  select 1 o, 'asientos' clave, (select count(*) from public.journal_entry)::text valor union all
  select 2, 'anotaciones de expedidas', (select count(*) from public.vat_book_entry where book = 'issued')::text union all
  select 3, 'IVA de expedidas', (select coalesce(sum(tax_amount), 0) from public.vat_book_entry where book = 'issued')::text union all
  select 4, 'facturas emitidas', (select count(*) from public.customer_invoice where status <> 'borrador')::text union all
  select 5, 'IVA de las emitidas', (select coalesce(sum(tax), 0) from public.customer_invoice where status <> 'borrador')::text union all
  select 6, 'emitidas sin PDF', (select count(*) from public.customer_invoice where status <> 'borrador' and pdf_path is null)::text union all
  select 7, 'líneas de emitidas sin cuota',
         (select count(*) from public.customer_invoice_line l join public.customer_invoice ci on ci.id = l.invoice_id where ci.status <> 'borrador'
             and (to_jsonb(l) ->> 'tax_amount') is null)::text union all
  select 8, 'emitidas cuyo IVA no es la suma de sus cuotas',
         (select count(*) from (select ci.id from public.customer_invoice ci join public.customer_invoice_line l on l.invoice_id = ci.id
           where ci.status <> 'borrador' and ci.doc_type = 'factura' group by ci.id, ci.tax
          having coalesce(sum((to_jsonb(l) ->> 'tax_amount')::numeric), -1) <> ci.tax) x)::text
) t order by o;
