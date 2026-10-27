-- tests/unit/modules/multitenancy/f01/poblacion.sql
--
-- F01 · La población REAL de El Delicioso en Foodint (regla 31), medida en
-- producción en solo lectura el 27/10: sus 19 matrículas con sus nombres, sus
-- precios y sus plataformas tal cual vienen de Last (con el espacio del final
-- en el nombre de la marca y en algunos platos), los 9 platos que ya tenía sin
-- artículo, las bebidas y postres que otras cedidas ya tienen enlazados al
-- almacén (con la Nestea de Ay Mamita y la Marquesa de Dulce de Leche de Dos
-- Coyotes ARCHIVADAS), sus tres tiendas de Last (Plaza Castilla, cerrada) y
-- Van Van, la marca nueva de verdad. Los ids son inventados.
insert into accounts values ('a0000000-0000-4000-8000-000000000001', 'Cuenta de prueba');
insert into locations values
 ('10000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','Foodint Alcalá',true),
 ('10000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001','Foodint Carabanchel',true),
 ('10000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001','Foodint Plaza Castilla',false);
insert into kitchen_unit values ('869711c3-eabd-4e95-92f2-555efaaba6b0', null, 'Unidad', 'unit', true, true, true);
insert into sales_channel (account_id, name, slug) values
 ('a0000000-0000-4000-8000-000000000001','Uber','uber'),('a0000000-0000-4000-8000-000000000001','Glovo','glovo'),('a0000000-0000-4000-8000-000000000001','JustEat','justeat');
insert into external_integration (account_id, source, external_org_id, organization_name, ownership_type, is_active) values
 ('a0000000-0000-4000-8000-000000000001','lastapp','0c000000-0000-4000-8000-000000000001','Cloudtown','licensed',true),
 ('a0000000-0000-4000-8000-000000000001','lastapp','0f000000-0000-4000-8000-000000000001','Foodint','own',false);
insert into external_location_map (account_id, source, external_location_id, location_id, is_active) values
 ('a0000000-0000-4000-8000-000000000001','lastapp','e1000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',true),
 ('a0000000-0000-4000-8000-000000000001','lastapp','e1000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',true),
 ('a0000000-0000-4000-8000-000000000001','lastapp','e1000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003',true);
insert into brand (id, account_id, name, slug, ownership_type, catalog_source) values
 ('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','Ay Mamita Bowls','ay-mamita','licensed','pos'),
 ('b0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001','Big Mike´s Burger Joint','big-mike','licensed','pos'),
 ('b0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000001','Dos Coyotes','dos-coyotes','licensed','pos'),
 ('b0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001','El Delicioso Latin Food','el-delicioso','licensed','folvy');
insert into external_brand_map (account_id, source, external_location_id, external_brand_id, brand_id) values
 ('a0000000-0000-4000-8000-000000000001','lastapp','e1000000-0000-4000-8000-000000000001','am-1','b0000000-0000-4000-8000-000000000001'),
 ('a0000000-0000-4000-8000-000000000001','lastapp','e1000000-0000-4000-8000-000000000001','bm-1','b0000000-0000-4000-8000-000000000002'),
 ('a0000000-0000-4000-8000-000000000001','lastapp','e1000000-0000-4000-8000-000000000001','dc-1','b0000000-0000-4000-8000-000000000005');

-- La carta de Last de El Delicioso (19 matrículas) y lo que comparte.
create temp table carta (n int, nombre text, cents int, canales text[], almacen text);
insert into carta values
 (1,'Agua pet.',200,'{uber,glovo}','Agua Mineral 50 CL'),
 (2,'CACHAPA QUESUDA (DL)',990,'{uber}',null),
 (3,'CACHAPA QUESUDA DL',990,'{glovo}',null),
 (4,'Cheesecake De Nutella',790,'{uber,glovo}','Cheesecake de Nutella'),
 (5,'CHORIPAPA ',690,'{uber,glovo}',null),
 (6,'CHORIPOLLO ',1190,'{uber,glovo}',null),
 (7,'Coca Cola',250,'{uber,glovo}','Coca-Cola Original Lata'),
 (8,'Coca Cola Zero.',250,'{uber,glovo}','Coca-Cola Zero Lata'),
 (9,'DIVINO CHICHARRÓN',1190,'{uber,glovo}',null),
 (10,'Fanta Limón.',250,'{uber,glovo}','Fanta Limón Lata'),
 (11,'Fanta Naranja.',250,'{uber,glovo}','Fanta Naranja Lata'),
 (12,'Marquesa de Choco-Avellanas',690,'{uber,glovo}','MARQUESA CHOCO - AVELLANA'),
 (13,'Marquesa de Dulce de Leche',690,'{uber,glovo}','MARQUESA DULCE DE LECHE'),
 (14,'MECHADA CRIOLLA ',1190,'{uber,glovo}',null),
 (15,'Nestea Limón',290,'{uber,glovo}','Nestea Limón'),
 (16,'PLÁTANO QUESUDO ',490,'{uber,glovo}',null),
 (17,'POLLO SABROSÓN (DL)',1290,'{uber,glovo}',null),
 (18,'TEQUEÑO ED',1190,'{uber,glovo}',null),
 (19,'Tres Leches',790,'{uber,glovo}','Tarta 3 Leches');
create function pg_temp.m(n int) returns uuid language sql immutable as $$ select ('d0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
insert into recipe_item (account_id, type, name) select distinct 'a0000000-0000-4000-8000-000000000001'::uuid, 'raw', almacen from carta where almacen is not null;
-- El Delicioso en Last: Alcalá, Carabanchel y Plaza Castilla (cerrada), Uber y Glovo.
insert into external_catalog_product (account_id, external_org_id, organization_product_id, external_brand_name, product_name, price_cents, external_channel, external_channels, external_location_id)
select 'a0000000-0000-4000-8000-000000000001','0c000000-0000-4000-8000-000000000001', pg_temp.m(c.n), 'El Delicioso Latin Food ', c.nombre, c.cents, ch, array[ch], ('e1000000-0000-4000-8000-00000000000' || l)::uuid
  from carta c cross join unnest(c.canales) ch cross join unnest(array[1,2,3]) l;
-- Las otras cedidas en Alcalá, con las bebidas y postres compartidos.
insert into external_catalog_product (account_id, external_org_id, organization_product_id, external_brand_name, product_name, price_cents, external_channel, external_channels, external_location_id)
select 'a0000000-0000-4000-8000-000000000001','0c000000-0000-4000-8000-000000000001', pg_temp.m(c.n), b.marca, c.nombre, c.cents, ch, array[ch], 'e1000000-0000-4000-8000-000000000001'
  from carta c cross join unnest(c.canales) ch cross join (values ('Ay Mamita Bowls'), ('Big Mike´s Burger Joint')) b(marca)
 where c.almacen is not null;
-- Van Van: la marca nueva, en Alcalá y en una tienda de Last sin local.
insert into external_catalog_product (account_id, external_org_id, organization_product_id, external_brand_name, product_name, price_cents, external_channel, external_channels, external_location_id)
select 'a0000000-0000-4000-8000-000000000001','0c000000-0000-4000-8000-000000000001', pg_temp.m(100 + x.n), 'Van Van', x.nombre, 950, ch, array[ch], l
  from (values (1, 'Wrap Van'), (2, 'Wrap Van Picante')) x(n, nombre) cross join unnest(array['uber','glovo']) ch
 cross join unnest(array['e1000000-0000-4000-8000-000000000001'::uuid, 'e1000000-0000-4000-8000-0000000000ff'::uuid]) l;
-- Lo que ya estaba en Folvy.
insert into menu_item (account_id, brand_id, recipe_item_id, name, external_id, external_source, archived_at)
select 'a0000000-0000-4000-8000-000000000001', b.id, ri.id, c.nombre, pg_temp.m(c.n)::text, 'lastapp',
       case when (b.name = 'Ay Mamita Bowls' and c.n = 15) then now() else null end
  from carta c join recipe_item ri on ri.name = c.almacen
  cross join brand b where b.name in ('Ay Mamita Bowls', 'Big Mike´s Burger Joint');
insert into menu_item (account_id, brand_id, recipe_item_id, name, external_id, external_source, archived_at)
select 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000005', ri.id, c.nombre, pg_temp.m(c.n)::text, 'lastapp', now()
  from carta c join recipe_item ri on ri.name = c.almacen where c.n = 13;
insert into menu_item (account_id, brand_id, recipe_item_id, name, external_id, external_source, price)
select 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000003', null, c.nombre, pg_temp.m(c.n)::text, 'lastapp', c.cents / 100.0
  from carta c where c.almacen is null;
-- El socio de las otras: las facturas de sus pedidos.
insert into inventory_count (account_id, status, closed_at) values ('a0000000-0000-4000-8000-000000000001','aprobado', now() - interval '2 days');
insert into sale (account_id, location_id, brand_id, source, sold_at, raw_products, raw_tab) values
 ('a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','lastapp',now()-interval '3 hours','[]','{"bills":[{"company":{"name":"CLOUDTOWN BRANDS SL"}}]}'),
 ('a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002','lastapp',now()-interval '4 hours','[]','{"bills":[{"company":{"name":"CLOUDTOWN BRANDS SL"}}]}');
