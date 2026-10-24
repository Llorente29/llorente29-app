-- scripts/conta/produccion/cuentas/v01-cierres.sql
--
-- V01 (24/10) · LO QUE CUENTA LA TANDA DE LOS CIERRES DEL DÍA, antes y
-- después. SOLO LEE. TABLA ENTERA, a propósito y dicho (regla 9): la tanda no
-- toca datos de ninguna cuenta; se mide que el libro, los cierres y los pedidos
-- siguen igual.
--
-- Después del real: lo mismo que antes en asientos, cierres, libro de
-- expedidas y facturas; cero cambios de pedidos en sus cierres (nadie ha
-- guardado aún); y la columna de la serie del canal, puesta.
select clave, valor from (
  select 1 o, 'asientos' clave, (select count(*) from public.journal_entry)::text valor union all
  select 2, 'cierres del día', (select count(*) from public.sales_day_summary)::text union all
  select 3, 'anotaciones de expedidas', (select count(*) from public.vat_book_entry where book = 'issued')::text union all
  select 4, 'facturas de venta', (select count(*) from public.customer_invoice)::text union all
  select 5, 'cobros de facturas', (select count(*) from public.customer_invoice_payment)::text union all
  select 6, 'documentos de asientos', (select count(*) from public.journal_entry_document)::text union all
  select 7, 'cambios de pedidos en su cierre', (case when to_regclass('public.conta_cierre_ajuste') is null then 'sin tabla'
                                   else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_cierre_ajuste', false, true, '')))[1]::text end) union all
  select 8, 'la serie lleva su canal', (select (count(*) > 0)::text from information_schema.columns
                                         where table_schema = 'public' and table_name = 'invoice_series' and column_name = 'channel_id')
) t order by o;
