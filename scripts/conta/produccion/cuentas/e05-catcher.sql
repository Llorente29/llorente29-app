-- scripts/conta/produccion/cuentas/e05-catcher.sql
--
-- E05 · LO QUE CUENTA LA TANDA DE LA 0420 (la ficha de Catcher Marketplace),
-- antes y después. SOLO LEE. Todo de Foodint (regla 9).
--
-- Lo que tiene que pasar: las fichas de Foodint pasan de 64 a 65 (la de
-- Catcher, con su tercero); la 41000042 y la 62300004 pasan de no existir a
-- existir; la factura de Catcher de la quincena pasa de «sin proveedor» a la
-- ficha nueva; el resto de facturas de Foodint, IGUAL (md5).
select clave, valor from (
  select 1 o, 'Foodint · fichas de proveedor (n · con tercero)' clave,
    (select count(*) || ' · ' || count(*) filter (where exists (select 1 from public.party_role r where r.supplier_id = s.id))
       from public.supplier s where s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') valor union all
  select 2, 'Foodint · 41000042 y 62300004 (las que hay)',
    (select coalesce(string_agg(code || ' ' || name, ' · ' order by code), 'ninguna') from public.company_account
      where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and code in ('41000042', '62300004')) union all
  select 3, 'Foodint · la factura de Catcher de la quincena (su proveedor)',
    (select coalesce(s.name, 'sin proveedor') from public.supplier_invoice i left join public.supplier s on s.id = i.supplier_id and s.account_id = i.account_id
      where i.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and i.id = '98416803-9f78-411f-a95d-59c334533f05') union all
  select 4, 'Foodint · las demás facturas (n · md5 de id y proveedor)',
    (select count(*) || ' · ' || md5(coalesce(string_agg(id::text || coalesce(supplier_id::text, ''), '|' order by id), ''))
       from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and id <> '98416803-9f78-411f-a95d-59c334533f05')
) x order by o;
