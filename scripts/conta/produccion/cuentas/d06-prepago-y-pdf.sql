-- scripts/conta/produccion/cuentas/d06-prepago-y-pdf.sql
--
-- D06 · LO QUE CUENTA LA TANDA «SALDO PREPAGO Y EL PDF BUENO» (0800 y 0810),
-- antes y después. SOLO LEE. Antes (medido el 23/10): conta_factura_desde_lectura
-- con su md5 de producción (c7e7811e…); los dos CHECK sin «prepaid»; RIDERS de
-- Foodint sin forma de pago; 0 proveedores y 0 recibidas con «prepaid».
-- Después: la función con su md5 nuevo; los dos CHECK con «prepaid»; RIDERS
-- con «prepaid»; 1 proveedor (RIDERS) y 0 recibidas.
-- Y que no se mueve nada más: los proveedores de Foodint con forma de pago, sus
-- recibidas, cuántas tienen documento y su historial (la tanda no toca filas
-- salvo RIDERS). Lo de Foodint, con su cuenta (regla 9); los «prepaid» y los
-- CHECK, de todas las cuentas, dicho.
select clave, valor from (
  select 1 o, 'md5 conta_factura_desde_lectura' clave,
         (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid = to_regprocedure('public.conta_factura_desde_lectura(uuid,uuid)')) valor union all
  select 2, 'CHECK supplier_payment_method_check admite prepaid',
         (select (pg_get_constraintdef(c.oid) like '%prepaid%')::text from pg_constraint c where c.conrelid = 'public.supplier'::regclass and c.conname = 'supplier_payment_method_check') union all
  select 3, 'CHECK supplier_invoice_payment_method_check admite prepaid',
         (select (pg_get_constraintdef(c.oid) like '%prepaid%')::text from pg_constraint c where c.conrelid = 'public.supplier_invoice'::regclass and c.conname = 'supplier_invoice_payment_method_check') union all
  select 4, 'forma de pago de RIDERS (Foodint)',
         (select coalesce(payment_method, 'ninguna') from public.supplier where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and id = 'cbe3ddb1-5d3a-4aa7-a907-38f362e922b1') union all
  select 5, 'proveedores con prepaid (todas las cuentas)', (select count(*) from public.supplier where payment_method = 'prepaid')::text union all
  select 6, 'recibidas con prepaid (todas las cuentas)', (select count(*) from public.supplier_invoice where payment_method = 'prepaid')::text union all
  select 7, 'proveedores de Foodint con forma de pago',
         (select count(*) from public.supplier where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and payment_method is not null)::text union all
  select 8, 'recibidas de Foodint', (select count(*) from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text union all
  select 9, 'recibidas de Foodint con documento',
         (select count(*) from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and raw_document_url is not null)::text union all
  select 10, 'recibidas de RIDERS (Foodint)',
         (select count(*) from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and supplier_id = 'cbe3ddb1-5d3a-4aa7-a907-38f362e922b1')::text union all
  select 11, 'filas de supplier_invoice_change de Foodint',
         (select count(*) from public.supplier_invoice_change where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text
) t order by o;
