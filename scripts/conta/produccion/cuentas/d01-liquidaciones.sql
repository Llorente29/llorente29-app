-- scripts/conta/produccion/cuentas/d01-liquidaciones.sql
--
-- D01 · LO QUE CUENTA LA TANDA DE LAS LIQUIDACIONES POR CORREO (0100), antes y
-- después. SOLO LEE. Recuentos de Foodint (regla 9); ningún nombre, NIF,
-- dirección ni importe.
-- platform_store la crea la propia tanda y ANTES no existe: Postgres resuelve
-- todas las tablas de la consulta al analizarla (ensayo #89 de E05), así que se
-- cuenta con query_to_xml, que solo analiza su texto si se llega a llamar.
select clave, valor from (
  select 1 o, 'el mapa de tiendas (platform_store)' clave, (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'platform_store')::text valor union all
  select 2, 'columnas nuevas (channel_settlement 9, supplier_invoice 1, supplier_invoice_line 1, party_role 2)',
    (select count(*) from information_schema.columns where table_schema = 'public' and (
       (table_name = 'channel_settlement' and column_name in ('other_earnings', 'promo_charges', 'ads_spend', 'item_promotions', 'chargebacks', 'adjustments', 'store_id', 'inbound_email_id', 'commission_invoice_id'))
       or (table_name = 'supplier_invoice' and column_name = 'brand_id') or (table_name = 'supplier_invoice_line' and column_name = 'expense_account_code')
       or (table_name = 'party_role' and column_name in ('commission_account_code', 'ads_account_code'))))::text union all
  select 3, 'funciones nuevas (direccion_entrada, liquidacion_registrar, liquidacion_factura_proponer, tienda_plataforma_asignar, _solape, _marcar, _cuenta_aprendida)',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
      and p.proname in ('conta_direccion_entrada', 'conta_liquidacion_registrar', 'conta_liquidacion_factura_proponer', 'conta_tienda_plataforma_asignar', '_conta_liquidacion_solape', '_conta_liquidacion_marcar', '_conta_cuenta_aprendida'))::text union all
  select 4, 'la clase «liquidaciones» en el CHECK de las direcciones',
    (select count(*) from pg_constraint where conname = 'company_inbound_address_kind_check' and pg_get_constraintdef(oid) like '%liquidaciones%')::text union all
  select 5, 'direcciones de entrada de Foodint (todas / encendidas)',
    (select count(*) || ' / ' || count(*) filter (where active) from public.company_inbound_address where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') union all
  select 6, 'liquidaciones de plataforma de Foodint', (select count(*) from public.channel_settlement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text union all
  select 7, 'de ellas, leídas de un correo', (select count(*) from public.channel_settlement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and source like 'correo\_%')::text union all
  select 8, 'facturas recibidas de Foodint', (select count(*) from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text union all
  select 9, 'tiendas de plataformas de Foodint', case when to_regclass('public.platform_store') is null then 'sin tabla'
    else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.platform_store where account_id = ''51ad1792-6629-4ef7-833a-b57b09a86710''', false, true, '')))[1]::text end
) t order by o;
