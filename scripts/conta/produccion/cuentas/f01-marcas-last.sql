-- scripts/conta/produccion/cuentas/f01-marcas-last.sql
--
-- F01 · PR 1 (27/10) · LO QUE CUENTA LA TANDA DE LAS MARCAS DE LAST, antes y
-- después. SOLO LEE. Todo es de Foodint (regla 9) salvo las fichas de socio,
-- que se cuentan en la base entera y se dice. Las ventas, con un corte fijo (W06).
-- Las tablas y columnas que crea la tanda solo se nombran dentro de cadenas.
-- Lo que tiene que cambiar: los platos de El Delicioso (9 → 19, todos con
-- artículo), sus locales y plataformas (0 → 2 y 2), los artículos de Foodint
-- (+8 platos sin receta: 9 de antes sin artículo, una Cachapa compartida), los
-- platos de Foodint (+10) y las fichas de socio (0 → 9). Lo demás, igual: los
-- platos archivados, los vínculos de Last, las ventas y sus líneas hasta el corte.
select clave, valor from (
  select 1 o, 'platos de Foodint (vivos / archivados)' clave,
    (select count(*) filter (where archived_at is null) || ' / ' || count(*) filter (where archived_at is not null)
       from public.menu_item where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') valor union all
  select 2, 'platos de Last de Foodint (vivos, con artículo / sin artículo)',
    (select count(*) filter (where recipe_item_id is not null) || ' / ' || count(*) filter (where recipe_item_id is null)
       from public.menu_item where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and external_source = 'lastapp' and archived_at is null) union all
  select 3, 'platos de El Delicioso (vivos, con artículo / sin artículo)',
    (select count(*) filter (where mi.recipe_item_id is not null) || ' / ' || count(*) filter (where mi.recipe_item_id is null)
       from public.menu_item mi join public.brand b on b.id = mi.brand_id and b.account_id = mi.account_id
      where mi.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and b.name = 'El Delicioso Latin Food' and mi.archived_at is null) union all
  select 4, 'artículos de Foodint (almacén / platos / elaboraciones)',
    (select count(*) filter (where type = 'raw') || ' / ' || count(*) filter (where type = 'dish') || ' / ' || count(*) filter (where type not in ('raw', 'dish'))
       from public.recipe_item where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') union all
  select 5, 'precios por plataforma de Foodint',
    (select count(*) from public.menu_item_override where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text union all
  select 6, 'vínculos de marcas de Last de Foodint (a marca / ignorados)',
    (select count(*) filter (where not is_ignored) || ' / ' || count(*) filter (where is_ignored)
       from public.external_brand_map where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and source = 'lastapp') union all
  select 7, 'El Delicioso: locales / plataformas',
    (select (select count(*) from public.brand_location_availability x where x.brand_id = b.id and x.account_id = b.account_id and x.is_active)
            || ' / ' || (select count(*) from public.brand_channel x where x.brand_id = b.id and x.account_id = b.account_id and x.is_active)
       from public.brand b where b.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and b.name = 'El Delicioso Latin Food') union all
  select 8, 'fichas de socio (Foodint / base entera)',
    (select count(*) filter (where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') || ' / ' || count(*) from public.brand_licensing_agreement) union all
  select 9, 'cedidas activas de Foodint con socio en su ficha',
    (select count(*) from public.brand b where b.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and b.ownership_type = 'licensed' and b.is_active
        and exists (select 1 from public.brand_licensing_agreement a where a.brand_id = b.id))::text union all
  select 10, 'ventas de Last de Foodint hasta el corte (con marca / sin marca)',
    (select count(*) filter (where brand_id is not null) || ' / ' || count(*) filter (where brand_id is null)
       from public.sale where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and source = 'lastapp' and sold_at < timestamptz '2026-10-27 12:00:00+00') union all
  select 11, 'líneas de Last de Foodint hasta el corte (colocadas / sin colocar)',
    (select count(*) filter (where sl.menu_item_id is not null) || ' / ' || count(*) filter (where sl.menu_item_id is null)
       from public.sale_line sl join public.sale s on s.id = sl.sale_id and s.account_id = sl.account_id
      where sl.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and s.source = 'lastapp' and s.sold_at < timestamptz '2026-10-27 12:00:00+00'
        and coalesce(sl.line_type, 'product') = 'product') union all
  select 12, 'huellas de seed_catalog_canonical y ticket_invoice_ajustes',
    (select string_agg(p.proname || ' ' || left(md5(pg_get_functiondef(p.oid)), 8), ', ' order by p.proname) from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname in ('seed_catalog_canonical', 'ticket_invoice_ajustes'))
) t order by o;
