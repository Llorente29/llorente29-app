-- scripts/conta/produccion/cuentas/d03-recibida-pdf.sql
--
-- D03 · LO QUE CUENTA LA TANDA «LA RECIBIDA SIN RECEPCIÓN NACE CON SU
-- DOCUMENTO» (0770 y 0780), antes y después. SOLO LEE. Antes (medido el 23/10):
-- _compras_factura_desde_papel con su md5 de producción (e0d04afd…); 2
-- recibidas «ocr» sin documento con fichero en su lectura, en todas las
-- cuentas, las dos de Foodint; FAC-00098 y FAC-00101 «sin documento».
-- Después: la función con su md5 nuevo; 0 y 0; las dos con «el de su lectura».
-- Y que no se mueve nada más: las recibidas de Foodint, cuántas tienen
-- documento, sus asientos y lo que ha hecho el D02 con ellas.
-- Lo de Foodint, con su cuenta (regla 9); la 2, de todas las cuentas, dicho.
-- Ni rutas ni nombres de fichero: solo si el documento es el de su lectura.
select clave, valor from (
  select 1 o, 'md5 _compras_factura_desde_papel' clave,
         (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid = to_regprocedure('public._compras_factura_desde_papel(uuid,uuid,uuid,uuid,uuid,uuid,text)')) valor union all
  select 2, 'recibidas ocr sin documento con fichero en su lectura (todas las cuentas)',
         (select count(*) from public.supplier_invoice i join public.goods_receipt_ai_session a on a.id = i.ai_session_id and a.account_id = i.account_id
           where i.source = 'ocr' and i.raw_document_url is null and jsonb_typeof(a.input_files) = 'array'
             and nullif(btrim(a.input_files -> 0 ->> 'path'), '') is not null)::text union all
  select 3, 'de ellas, de Foodint',
         (select count(*) from public.supplier_invoice i join public.goods_receipt_ai_session a on a.id = i.ai_session_id and a.account_id = i.account_id
           where i.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and i.source = 'ocr' and i.raw_document_url is null
             and jsonb_typeof(a.input_files) = 'array' and nullif(btrim(a.input_files -> 0 ->> 'path'), '') is not null)::text union all
  select 4, 'documento de FAC-00098 (S11/0177416578)',
         (select case when i.raw_document_url is null then 'sin documento' when i.raw_document_url = a.input_files -> 0 ->> 'path' then 'el de su lectura' else 'otro' end
            from public.supplier_invoice i left join public.goods_receipt_ai_session a on a.id = i.ai_session_id and a.account_id = i.account_id
           where i.id = '9a87fa22-fbc7-471b-bf1d-a88c856259ea' and i.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') union all
  select 5, 'documento de FAC-00101 (COHELDI P26 4.980)',
         (select case when i.raw_document_url is null then 'sin documento' when i.raw_document_url = a.input_files -> 0 ->> 'path' then 'el de su lectura' else 'otro' end
            from public.supplier_invoice i left join public.goods_receipt_ai_session a on a.id = i.ai_session_id and a.account_id = i.account_id
           where i.id = 'd6913598-9f52-4d43-8860-eddff2a6d436' and i.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') union all
  select 6, 'recibidas de Foodint', (select count(*) from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text union all
  select 7, 'recibidas de Foodint con documento',
         (select count(*) from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and raw_document_url is not null)::text union all
  select 8, 'asientos de FAC-00098 y FAC-00101',
         (select count(*) from public.journal_entry where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and source_type = 'supplier_invoice'
             and source_id in ('9a87fa22-fbc7-471b-bf1d-a88c856259ea', 'd6913598-9f52-4d43-8860-eddff2a6d436'))::text union all
  select 9, 'filas del D02 de FAC-00098 y FAC-00101',
         (select count(*) from public.conta_recibida_pdf where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
             and invoice_id in ('9a87fa22-fbc7-471b-bf1d-a88c856259ea', 'd6913598-9f52-4d43-8860-eddff2a6d436'))::text
) t order by o;
