-- scripts/conta/produccion/cuentas/f01c-recetas-y-codigo.sql
--
-- F01 · PR 3 (28/10) · LO QUE CUENTA LA TANDA DE LAS RECETAS QUE FALTAN Y EL
-- CÓDIGO CAMBIADO, antes y después. SOLO LEE. Todo es de Foodint (regla 9)
-- salvo las dos tablas nuevas y los disparadores de recipe_line, que se cuentan
-- en la base entera y se dice. Las tablas que crea la tanda solo se nombran
-- dentro de cadenas (to_regclass y query_to_xml). Lo que crece con el servicio,
-- con un corte de fecha fijo (W06).
-- Lo que tiene que cambiar: las dos tablas nuevas (no existen → 0 / 0) y los
-- disparadores de recipe_line (+1). Nada de Foodint: aplicar la tanda no
-- coloca ni une nada. Lo hace la pasada de cada hora, y hoy en Foodint no hay
-- ninguna marca de Last sin dar de alta ni receta recién puesta.
select clave, valor from (
  select 1 o, 'tablas nuevas: recetas puestas / marcas reconocidas (base entera)' clave,
    (case when to_regclass('public.f01_receta_puesta') is null then 'no existe'
          else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.f01_receta_puesta', false, true, '')))[1]::text end)
    || ' / ' ||
    (case when to_regclass('public.f01_marca_reconocida') is null then 'no existe'
          else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.f01_marca_reconocida', false, true, '')))[1]::text end) valor union all
  select 2, 'disparadores de recipe_line (base entera)',
    (select count(*) from pg_trigger where tgrelid = 'public.recipe_line'::regclass and not tgisinternal)::text union all
  select 3, 'ventas de Last de Foodint hasta el corte (con marca / sin marca)',
    (select count(*) filter (where brand_id is not null) || ' / ' || count(*) filter (where brand_id is null) from public.sale
      where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and source = 'lastapp' and sold_at < timestamptz '2026-10-28 09:00:00+00') union all
  select 4, 'consumos de ventas de Foodint hasta el corte',
    (select count(*) from public.stock_movement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and source_type = 'sale'
        and movement_type = 'consumo' and created_at < timestamptz '2026-10-28 09:00:00+00')::text union all
  select 5, 'altas de marcas de Last / vínculos de marca de Last de Foodint, hasta el corte',
    (select count(*) from public.external_brand_alta where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-10-28 09:00:00+00')
    || ' / ' || (select count(*) from public.external_brand_map where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and source = 'lastapp'
                    and created_at < timestamptz '2026-10-28 09:00:00+00') union all
  select 6, 'platos de Foodint hasta el corte (con artículo / sin artículo)',
    (select count(*) filter (where recipe_item_id is not null) || ' / ' || count(*) filter (where recipe_item_id is null) from public.menu_item
      where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-10-28 09:00:00+00') union all
  select 7, 'líneas de receta de Foodint hasta el corte',
    (select count(*) from public.recipe_line where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and created_at < timestamptz '2026-10-28 09:00:00+00')::text
) t order by o;
