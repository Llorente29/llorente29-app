-- scripts/conta/produccion/cuentas/v01-facturas-venta.sql
--
-- V01 (24/10) · LO QUE CUENTA LA TANDA DE LAS FACTURAS DE VENTA, antes y
-- después. SOLO LEE. TABLA ENTERA, a propósito y dicho (regla 9): la tanda no
-- toca datos de ninguna cuenta; se mide que el libro sigue igual.
--
-- Después del real: los asientos y el libro de expedidas, igual que antes; los
-- asientos con origen customer_invoice, cero (nadie ha emitido aún); y el CHECK
-- de los orígenes admite customer_invoice.
select clave, valor from (
  select 1 o, 'asientos' clave, (select count(*) from public.journal_entry)::text valor union all
  select 2, 'asientos de facturas de venta', (select count(*) from public.journal_entry where source_type = 'customer_invoice')::text union all
  select 3, 'anotaciones de expedidas', (select count(*) from public.vat_book_entry where book = 'issued')::text union all
  select 4, 'el CHECK admite customer_invoice',
         (select (pg_get_constraintdef(oid) ~ 'customer_invoice')::text from pg_constraint
           where conname = 'journal_entry_source_type_check' and conrelid = 'public.journal_entry'::regclass) union all
  select 5, 'facturas de venta', (case when to_regclass('public.customer_invoice') is null then 'sin tabla'
                                   else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.customer_invoice', false, true, '')))[1]::text end)
) t order by o;
