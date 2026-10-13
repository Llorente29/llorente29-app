-- scripts/conta/produccion/cuentas/documentos.sql
--
-- R15 (13/10) · LO QUE CUENTA LA TANDA DEL DOCUMENTO DE CADA ASIENTO, antes y
-- después. Lo declara el manifiesto («cuenta: <este fichero>») y lo comparan
-- deshacer.sh y el ensayo de la vuelta atrás. SOLO LEE.
--
-- Se puede tomar ANTES de la tanda (la tabla aún no existe: se mira con
-- to_regclass y se cuenta por query_to_xml solo si existe) y DESPUÉS de
-- deshacerla: tiene que salir igual que antes.
--
-- TABLA ENTERA, a propósito y dicho (regla 9): todas las cuentas juntas. Es
-- una huella de «esto no se ha movido».
select clave, valor from (
  select 1 o, 'bucket conta-documentos' clave, (select count(*) from storage.buckets where id = 'conta-documentos')::text valor union all
  select 2, 'ficheros en conta-documentos', (select count(*) from storage.objects where bucket_id = 'conta-documentos')::text union all
  select 3, 'políticas de storage.objects de conta-documentos', (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'conta_documentos_%')::text union all
  select 4, 'tabla journal_entry_document', (to_regclass('public.journal_entry_document') is not null)::text union all
  select 5, 'documentos guardados', case when to_regclass('public.journal_entry_document') is null then 'sin tabla'
       else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.journal_entry_document', false, true, '')))[1]::text end union all
  select 6, 'funciones conta_resumen_ventas y conta_documento_guardar', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('conta_resumen_ventas', 'conta_documento_guardar'))::text union all
  select 7, 'columnas document_* de external_send', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'external_send' and column_name like 'document\_%')::text union all
  select 8, 'envíos a Diez (external_send)', (select count(*) from public.external_send)::text union all
  select 9, 'asientos de ventas por estado', (select coalesce(string_agg(status || ' ' || n, ' · ' order by status), '') from (select status, count(*) n from public.journal_entry where source_type = 'sales_day' group by 1) x)
) t order by o;
