-- scripts/conta/produccion/cuentas/recibidas.sql
--
-- D01 · T7 (14/10) · LO QUE CUENTA LA TANDA DE FACTURAS RECIBIDAS (0200–0290),
-- antes y después. Lo declara el manifiesto («cuenta: <este fichero>») y lo
-- comparan deshacer.sh y el ensayo de la vuelta atrás. SOLO LEE.
--
-- Se puede tomar ANTES de la tanda (las tablas nuevas aún no existen: se miran
-- con to_regclass y se cuentan por query_to_xml solo si existen) y DESPUÉS de
-- deshacerla: tiene que salir igual que antes.
--
-- TABLA ENTERA, a propósito y dicho (regla 9): todas las cuentas juntas. Es
-- una huella de «esto no se ha movido». Solo recuentos: ningún nombre, NIF,
-- importe ni número de factura (regla de salida de D01 R2).
with nuevas(o, t) as (values
  (1, 'company_purchase_setting'), (2, 'company_inbound_address'), (3, 'document_inbox'),
  (4, 'supplier_invoice_tax'), (5, 'supplier_expected_invoice'), (6, 'supplier_invoice_request'),
  (7, 'document_activity'), (8, 'inbound_email_log')
)
select clave, valor from (
  select o, 'filas de ' || t clave,
         case when to_regclass('public.' || t) is null then 'sin tabla'
              else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.' || t, false, true, '')))[1]::text end valor
    from nuevas
  union all
  select 20, 'facturas recibidas (supplier_invoice) por estado',
         (select coalesce(string_agg(status || ' ' || n, ' · ' order by status), '') from (select status, count(*) n from public.supplier_invoice group by 1) x)
  union all
  select 21, 'líneas de factura (supplier_invoice_line)', (select count(*) from public.supplier_invoice_line)::text
  union all
  select 22, 'columnas nuevas de supplier_invoice', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'supplier_invoice'
         and column_name in ('arrival_channel', 'number_key', 'reading_confidence', 'reading', 'surcharge_total', 'inbox_id'))::text
  union all
  select 23, 'proveedores (supplier) · columna created_from',
         (select count(*) from public.supplier)::text || ' · ' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'supplier' and column_name = 'created_from')::text
  union all
  select 24, 'contactos de proveedor por papel',
         (select coalesce(string_agg(role || ' ' || n, ' · ' order by role), '') from (select role, count(*) n from public.supplier_contact group by 1) x)
  union all
  select 25, 'cuentas de empresa (company_account_link) por origen',
         (select coalesce(string_agg(source || ' ' || n, ' · ' order by source), '') from (select source, count(*) n from public.company_account_link group by 1) x)
  union all
  select 26, 'documentos de asiento (journal_entry_document) por tipo',
         case when to_regclass('public.journal_entry_document') is null then 'sin tabla'
              else coalesce((xpath('/row/c/text()', query_to_xml('select string_agg(kind || '' '' || n, '' · '' order by kind) as c from (select kind, count(*) n from public.journal_entry_document group by 1) x', false, true, '')))[1]::text, '') end
  union all
  select 27, 'CHECK ampliados (huella de su definición)',
         (select md5(string_agg(conname || '=' || pg_get_constraintdef(oid), '|' order by conname)) from pg_constraint
           where conname in ('supplier_contact_role_check', 'company_account_link_source_check', 'journal_entry_document_kind_check'))
  union all
  select 28, 'disparador trg_supplier_invoice_no_repetida', (select count(*) from pg_trigger where tgname = 'trg_supplier_invoice_no_repetida' and not tgisinternal)::text
  union all
  select 29, 'funciones de la tanda', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (
         'banco_facturas_recibidas_pendientes', 'conta_ajustes_compras_guardar', 'conta_clave_numero', 'conta_direccion_facturas', 'conta_documento_factura_guardar',
         'conta_documentos_recibidos', 'conta_entrada_correo', 'conta_entrada_destino', 'conta_entrada_llegada', 'conta_esperadas_aprender', 'conta_esperadas_no_llegadas',
         'conta_factura_desde_lectura', 'conta_factura_para_revisar', 'conta_factura_pedir', 'conta_gasto_aprendido', 'conta_proveedor_desde_factura', 'conta_recibe_mercancia',
         'conta_recibida_envio', 'conta_subida_registrar', 'supplier_invoice_repetida', 'supplier_invoice_repetidas_que_hay', 'tg_supplier_invoice_no_repetida'))::text
  union all
  select 30, 'asientos de facturas recibidas por estado',
         (select coalesce(string_agg(status || ' ' || n, ' · ' order by status), '') from (select status, count(*) n from public.journal_entry where source_type = 'supplier_invoice' group by 1) x)
  union all
  select 31, 'envíos a Diez (external_send)', (select count(*) from public.external_send)::text
) t order by o;
