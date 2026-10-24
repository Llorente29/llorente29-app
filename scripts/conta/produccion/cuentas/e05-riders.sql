-- scripts/conta/produccion/cuentas/e05-riders.sql
--
-- E05 · LO QUE CUENTA LA TANDA DE LA 0410 (la ficha genérica de RIDERS y el
-- libro de IVA con el emisor de las facturas de lote), antes y después.
-- SOLO LEE. Recuentos y huellas de Foodint (regla 9), salvo las funciones,
-- que son de la base entera y van etiquetadas así.
--
-- Lo que tiene que pasar: las dos funciones cambian de cuerpo (una firma cada
-- una, la misma); el libro de IVA de Foodint, sus facturas de lote y la ficha
-- RIDERS, IGUAL antes y después (la tanda no toca datos: ninguna de las 82
-- tiene asiento todavía).
select clave, valor from (
  select 1 o, 'funciones de la 0410, base entera (firma:md5 del cuerpo)' clave,
    (select string_agg(oid::regprocedure::text || ':' || md5(prosrc), ' · ' order by proname)
       from pg_proc where pronamespace = 'public'::regnamespace
        and proname in ('compras_ficha_le_falta', 'conta_vat_book_desde_asiento')) valor union all
  select 2, 'Foodint · libro de IVA (filas · md5)',
    (select count(*) || ' · ' || md5(coalesce(string_agg(b.id::text || coalesce(b.counterpart_tax_id, '') || coalesce(b.counterpart_name, '') || b.tax_amount::text, '|' order by b.id), ''))
       from public.vat_book_entry b where b.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') union all
  select 3, 'Foodint · facturas de lote (n · con asiento · md5)',
    (select count(*) || ' · ' || count(i.journal_entry_id) || ' · ' || md5(coalesce(string_agg(i.id::text || i.status || coalesce(i.issuer_tax_id, '') || i.grand_total::text, '|' order by i.id), ''))
       from public.supplier_invoice i where i.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and i.source = 'lote') union all
  select 4, 'Foodint · la ficha RIDERS (NIF · tipo de gasto · forma de facturar)',
    (select coalesce(tax_id, '—') || ' · ' || coalesce(expense_category_id::text, '—') || ' · ' || coalesce(invoicing_mode, '—')
       from public.supplier where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and id = 'cbe3ddb1-5d3a-4aa7-a907-38f362e922b1')
) x order by o;
