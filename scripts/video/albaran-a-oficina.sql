-- scripts/video/albaran-a-oficina.sql — V02 · qué datos de cocina trae la cuenta A del carril (solo lectura).
--
--   psql "$DB_URL" -X -v cuenta=<uuid> -v empresa=<uuid> -f scripts/video/albaran-a-oficina.sql
--
-- Solo SELECT, y solo de la cuenta del carril (regla 9). Sin ON_ERROR_STOP: si
-- una tabla no está en staging, lo dice y sigue con las demás.

\pset pager off
\echo '== locales'
select id, name from public.locations where account_id = :'cuenta' order by name;
\echo '== módulos de la cuenta'
select to_jsonb(a) - 'created_at' - 'updated_at' from public.accounts a where a.id = :'cuenta';
\echo '== proveedores con artículos de catálogo (article_supplier)'
select s.name, count(asu.*) as articulos
  from public.supplier s left join public.article_supplier asu on asu.supplier_id = s.id
 where s.account_id = :'cuenta' group by s.name order by 2 desc, 1 limit 25;
\echo '== artículos (recipe_item) por tipo'
select ri.item_type, count(*) from public.recipe_item ri where ri.account_id = :'cuenta' group by 1 order by 1;
\echo '== 15 artículos de compra, de ejemplo'
select ri.id, ri.name, ri.base_unit from public.recipe_item ri where ri.account_id = :'cuenta' and ri.item_type = 'raw' order by ri.name limit 15;
\echo '== formatos de compra (recipe_item_purchase_format)'
select count(*) from public.recipe_item_purchase_format f where f.account_id = :'cuenta';
\echo '== pedidos (purchase_order) por estado'
select po.status, count(*) from public.purchase_order po where po.account_id = :'cuenta' group by 1 order by 1;
\echo '== un pedido de ejemplo, entero'
select to_jsonb(po) from public.purchase_order po where po.account_id = :'cuenta' order by po.created_at desc limit 1;
\echo '== una línea de pedido de ejemplo'
select to_jsonb(l) from public.purchase_order_line l join public.purchase_order po on po.id = l.order_id where po.account_id = :'cuenta' limit 1;
\echo '== recepciones (goods_receipt) por estado'
select gr.status, count(*) from public.goods_receipt gr where gr.account_id = :'cuenta' group by 1 order by 1;
\echo '== una recepción de ejemplo, entera'
select to_jsonb(gr) from public.goods_receipt gr where gr.account_id = :'cuenta' order by gr.created_at desc limit 1;
\echo '== una línea de recepción de ejemplo'
select to_jsonb(l) from public.goods_receipt_line l join public.goods_receipt gr on gr.id = l.goods_receipt_id where gr.account_id = :'cuenta' limit 1;
\echo '== ajustes de compras (supply_settings)'
select to_jsonb(s) from public.supply_settings s where s.account_id = :'cuenta';
\echo '== personas (employees) de la cuenta'
select e.id, e.name, e.role, e.location_id from public.employees e where e.account_id = :'cuenta' limit 10;
