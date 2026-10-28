-- scripts/conta/produccion/cuentas/f01b-cambios-carta.sql
--
-- F01 · PR 2 (27/10) · LO QUE CUENTA LA TANDA DE LOS CAMBIOS DE CARTA, antes y
-- después. SOLO LEE. Todo es de Foodint (regla 9) salvo las dos tablas nuevas,
-- que se cuentan en la base entera y se dice. Las tablas que crea la tanda solo
-- se nombran dentro de cadenas (to_regclass y query_to_xml). Lo demás, con un
-- corte de fecha fijo (W06): solo se cuentan filas, no precios ni estados, que
-- se pueden tocar a mano a mitad del ensayo.
-- Lo que tiene que cambiar: nada. La 1910 solo añade dos tablas vacías y
-- funciones; los extras los llena last-catalog-sync cuando se despliegue, y los
-- precios cambian solo al pulsar «Poner los de Last».
select clave, valor from (
  select 1 o, 'tablas nuevas: extras del espejo / cambios apuntados (base entera)' clave,
    (case when to_regclass('public.external_catalog_modifier') is null then 'no existe'
          else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.external_catalog_modifier', false, true, '')))[1]::text end)
    || ' / ' ||
    (case when to_regclass('public.external_catalog_change') is null then 'no existe'
          else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.external_catalog_change', false, true, '')))[1]::text end) valor union all
  select 2, 'platos de Foodint hasta el corte',
    (select count(*) from public.menu_item where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and created_at < timestamptz '2026-10-27 19:00:00+00')::text union all
  select 3, 'precios por plataforma de Foodint hasta el corte',
    (select count(*) from public.menu_item_override where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and created_at < timestamptz '2026-10-27 19:00:00+00')::text union all
  select 4, 'grupos de extras de Foodint hasta el corte',
    (select count(*) from public.modifier_group where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and created_at < timestamptz '2026-10-27 19:00:00+00')::text union all
  select 5, 'opciones de extras de Foodint hasta el corte',
    (select count(*) from public.modifier_option where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and created_at < timestamptz '2026-10-27 19:00:00+00')::text union all
  select 6, 'impactos de extras de Foodint hasta el corte',
    (select count(*) from public.modifier_recipe_impact where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and created_at < timestamptz '2026-10-27 19:00:00+00')::text
) t order by o;
