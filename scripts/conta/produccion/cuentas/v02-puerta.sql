-- scripts/conta/produccion/cuentas/v02-puerta.sql
--
-- V02 · Entrega 1 (25/10) · LO QUE CUENTA LA TANDA DE LA PUERTA, antes y
-- después. SOLO LEE. Recuentos de Foodint (regla 9); ningún nombre, dirección
-- ni importe. El almacén y las funciones son de la base entera, y se dice.
-- Lo que tiene que cambiar: el almacén conta-entrada y conta_puerta, de «no» a
-- «sí»; las huellas de conta_documentos_recibidos, conta_direccion_entrada y
-- conta_entrada_remitente. Lo demás, igual: la tanda no toca datos (ninguna
-- dirección, fuente, remitente ni llegada nueva; las llegadas siguen sin «qué es»).
-- Medido en producción el 25/10 a las 13:15 UTC, antes: 1 / 1 / 0 · 0 · 1 · 83 ·
-- no existe · no · no · 15e5295e · ec74e866 · 0477e37d. Después: lo mismo, salvo
-- «qué es» 0, el almacén «sí», conta_puerta «sí» y las tres huellas nuevas.
select clave, valor from (
  select 1 o, 'direcciones de Foodint (facturas, liquidaciones, documentos)' clave,
    (select count(*) filter (where kind = 'facturas') || ' / ' || count(*) filter (where kind = 'liquidaciones') || ' / ' || count(*) filter (where kind not in ('facturas', 'liquidaciones'))
       from public.company_inbound_address where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') valor union all
  select 2, 'fuentes esperadas de Foodint',
    (select count(*) from public.supplier_expected_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text union all
  select 3, 'remitentes aprendidos de Foodint',
    (select count(*) from public.company_inbound_sender where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text union all
  select 4, 'llegadas en la bandeja de Foodint',
    (select count(*) from public.document_inbox where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text union all
  select 5, 'llegadas de Foodint con «qué es»',
    case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'document_inbox' and column_name = 'doc_kind') then 'no existe'
         else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.document_inbox where account_id = ''51ad1792-6629-4ef7-833a-b57b09a86710'' and doc_kind is not null', false, true, '')))[1]::text end union all
  select 6, 'el almacén conta-entrada (base entera)',
    case when exists (select 1 from storage.buckets where id = 'conta-entrada') then 'sí' else 'no' end union all
  select 7, 'conta_puerta (base entera)',
    case when to_regprocedure('public.conta_puerta(uuid,integer)') is null then 'no' else 'sí' end union all
  select 8, 'huella de conta_documentos_recibidos',
    (select left(md5(p.prosrc), 8) from pg_proc p where p.oid = 'public.conta_documentos_recibidos'::regproc) union all
  select 9, 'huella de conta_direccion_entrada',
    (select left(md5(p.prosrc), 8) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'conta_direccion_entrada') union all
  select 10, 'huella de conta_entrada_remitente',
    (select left(md5(p.prosrc), 8) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'conta_entrada_remitente')
) t order by o;
