-- scripts/conta/produccion/cuentas/d02-recibida-pdf.sql
--
-- D02 · LO QUE CUENTA LA TANDA «EL PDF DE LAS RECIBIDAS» (0470), antes y
-- después. SOLO LEE. Antes: sin tabla ni cron, y la función de guardar el
-- documento con su md5 de producción (dbc3443e…). Después: con la tabla vacía
-- (la tanda no toca filas), el cron y la función con su md5 nuevo. Y que no se
-- pierde ni se mueve ninguna recibida, ningún documento de asiento ni ningún
-- envío a Diez de Foodint.
-- Las recibidas, los documentos y los envíos, de Foodint (regla 9: con su cuenta).
select clave, valor from (
  select 1 o, 'tabla conta_recibida_pdf' clave, (to_regclass('public.conta_recibida_pdf') is not null)::text valor union all
  select 2, 'filas de conta_recibida_pdf',
         case when to_regclass('public.conta_recibida_pdf') is not null
              then (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.conta_recibida_pdf', false, true, '')))[1]::text
              else 'sin tabla' end union all
  select 3, 'cron conta-recibida-pdf-despertar', exists (select 1 from cron.job where jobname = 'conta-recibida-pdf-despertar')::text union all
  select 4, 'md5 conta_documento_factura_guardar',
         (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid = to_regprocedure('public.conta_documento_factura_guardar(uuid,text,text,text,integer,text)')) union all
  select 5, 'recibidas de Foodint', (select count(*) from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text union all
  select 6, 'documentos de recibida de Foodint',
         (select count(*) from public.journal_entry_document where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and kind = 'factura_recibida')::text union all
  select 7, 'envíos a Diez de Foodint', (select count(*) from public.external_send where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text
) t order by o;
