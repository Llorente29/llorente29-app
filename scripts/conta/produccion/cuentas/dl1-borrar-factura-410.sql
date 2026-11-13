-- scripts/conta/produccion/cuentas/dl1-borrar-factura-410.sql
--
-- DL1 · borrar la FAC-00410 subida por error (0950) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
--   1. Filas con su id (factura, hijas, bandeja, actividad, lectura de la IA): 10 → 0.
--   2. Facturas de Foodint en revisión, menos 5: 1 → 0.
--   3. El PDF en el almacén: igual (SQL no puede borrarlo; lo borra Julio desde el almacén).
-- quieta: todo por su id
with f as (select exists (select 1 from public.company where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') hay)
select clave, valor from (
  select 1 o, 'Filas con el id de la FAC-00410, su bandeja o su lectura' clave,
    ((select count(*) from public.supplier_invoice where id = '62dbf6d8-2a9a-4a3d-b0ff-2f7a091fb402')
   + (select count(*) from public.supplier_invoice_line where supplier_invoice_id = '62dbf6d8-2a9a-4a3d-b0ff-2f7a091fb402')
   + (select count(*) from public.supplier_invoice_tax where supplier_invoice_id = '62dbf6d8-2a9a-4a3d-b0ff-2f7a091fb402')
   + (select count(*) from public.supplier_invoice_auto where invoice_id = '62dbf6d8-2a9a-4a3d-b0ff-2f7a091fb402')
   + (select count(*) from public.document_inbox where id = '4854c7b0-188a-4283-9b17-ef21591a62b3' or supplier_invoice_id = '62dbf6d8-2a9a-4a3d-b0ff-2f7a091fb402')
   + (select count(*) from public.document_activity where supplier_invoice_id = '62dbf6d8-2a9a-4a3d-b0ff-2f7a091fb402' or inbox_id = '4854c7b0-188a-4283-9b17-ef21591a62b3')
   + (select count(*) from public.goods_receipt_ai_session where id = '5ea71419-1a88-4913-b552-ffba5f7226ee'))::text valor
  union all
  -- quieta: las facturas de una empresa en revisión, sin descartar
  select 2, 'Facturas de Foodint en revisión, menos 5',
    (select case when not (select hay from f) then 0 else count(*) - 5 end from public.supplier_invoice
      where company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and status = 'en_revision' and discarded_at is null)::text
  union all
  -- quieta: un fichero por su nombre
  select 3, 'El PDF de la FAC-00410 en el almacén',
    (select count(*) from storage.objects where bucket_id = 'receipt-uploads'
        and name = '51ad1792-6629-4ef7-833a-b57b09a86710/6a08de08-8e98-42a9-8898-a820bd9c1694/00-DescargarPDF.pdf')::text
) t order by o;
