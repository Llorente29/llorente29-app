-- scripts/conta/produccion/cuentas/e05-catcher.sql
--
-- E05 · LO QUE CUENTA LA TANDA DE CATCHER (0100–0140), antes y después. SOLO
-- LEE. Recuentos de Foodint (regla 9); ningún nombre, NIF ni importe.
select clave, valor from (
  select 1 o, 'tablas del lote (supplier_batch, _order, _store, _issue, supplier_rate, supplier_balance_check)' clave,
    (select count(*) from information_schema.tables where table_schema = 'public'
      and table_name in ('supplier_batch', 'supplier_batch_order', 'supplier_batch_store', 'supplier_batch_issue', 'supplier_rate', 'supplier_balance_check'))::text valor union all
  select 2, 'columnas del emisor en supplier_invoice',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'supplier_invoice' and column_name in ('issuer_name', 'issuer_tax_id', 'issuer_address', 'batch_id'))::text union all
  select 3, 'facturas recibidas de Foodint', (select count(*) from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text union all
  select 4, 'la 40700001 de Foodint', (select count(*) from public.company_account where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and code = '40700001')::text union all
  select 5, 'gasto del proveedor de la 41000100',
    (select count(*) from public.company_account_link l join public.company_account ca on ca.id = l.company_account_id
      where l.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and l.role = 'gasto' and ca.code = '62400001')::text union all
  select 6, 'tiendas de Catcher con local', case when to_regclass('public.supplier_batch_store') is null then 'sin tabla'
    else (select count(*) from public.supplier_batch_store where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text end union all
  select 7, 'tarifas de Catcher', case when to_regclass('public.supplier_rate') is null then 'sin tabla'
    else (select count(*) from public.supplier_rate where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text end
) t order by o;
