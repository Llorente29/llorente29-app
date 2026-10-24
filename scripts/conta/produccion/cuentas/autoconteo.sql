-- scripts/conta/produccion/cuentas/autoconteo.sql
--
-- AUTOCONTEO · LO QUE CUENTA LA TANDA DE LA 0390 Y LA 0400, antes y después.
-- SOLO LEE. Por cuenta (regla 9): Foodint y la plantilla, cada una con su id.
-- Sin nombres de producto ni de local (el informe se ve en el repositorio).
--
-- Lo que tiene que pasar:
--   · los 23 conteos de la 0390 pasan de su estado (16 en revisión, 7
--     contando) a anulados; ningún otro conteo cambia de estado;
--   · el STOCK NO SE MUEVE: movimientos de stock de conteos de Foodint, mismo
--     número y misma suma antes y después (anular no toca el libro, y la 0400
--     no aplica nada al aplicarse: lo aplica la noche o la tablet);
--   · las cuatro funciones cambian de huella, las seis nuevas existen, las tres
--     columnas existen, y el trabajo del cron pasa a «call …».
select clave, valor from (
  select 1 o, 'los 23 de la 0390 (estado:cuántos)' clave,
    (select coalesce(string_agg(status || ':' || n, ' · ' order by status), 'ninguno')
       from (select status, count(*) n from public.inventory_count
              where account_id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')
                and id in ('5d44e40b-df7c-46a6-a4fc-cf2244d39d7d','f2142c14-57e1-4067-97d3-2dc4ebbb3a6e','02f2e90c-6f15-4c41-b1c9-3e26be0094df',
                           'b10fc456-3810-4565-8f85-128eccde572d','1b63a315-90ce-48e1-a74f-fb0a1b3dcb24','ce600de1-8b77-4825-ad87-3014a13f09f3',
                           '5f3f5c46-5bab-4865-8a29-3fa310c90b72','db9130b3-e4c2-42cd-957a-cd9b569fe20f','771648e1-2a1a-4cfd-8c64-2299a4f7e426',
                           '30da7a7a-893d-4b32-b484-e7a7b5b005ca','1b9386cb-1fe1-4579-b2d2-ded3023c3e37','fbf5fa18-ad9d-4ef2-a413-15a47d156f3d',
                           '2fa2ff32-8acc-4a48-b5ef-15ff24025397','60baf78e-517a-402d-97ff-67a98f7deecf','93936208-57d6-4cd1-9c30-a4831a359cc8',
                           '66d74b67-f9eb-4d96-b002-10ae0f106be0','e2261ee2-0b45-415f-a34b-d24c23a975d3','f7c06b85-a295-4f66-9f71-1e25df9beda2',
                           'c4c4af0c-e3ac-4a5d-a27c-948257c3806f','5aad9a30-9fd4-48aa-ae75-08dea65164c4','781721e2-68f2-4826-a196-5f07545eca3e',
                           '26427604-11fc-40a6-8901-b49ec1e232c8','19ca0731-c4c8-430e-82b0-501341de8ec6')
              group by 1) x) valor union all
  select 2, 'autoconteos de Foodint (estado:cuántos)',
    (select coalesce(string_agg(status || ':' || n, ' · ' order by status), 'ninguno')
       from (select status, count(*) n from public.inventory_count
              where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and kind = 'cycle' group by 1) x) union all
  select 3, 'autoconteos de la plantilla (estado:cuántos)',
    (select coalesce(string_agg(status || ':' || n, ' · ' order by status), 'ninguno')
       from (select status, count(*) n from public.inventory_count
              where account_id = '00000000-0000-0000-0000-000000000001' and kind = 'cycle' group by 1) x) union all
  select 4, 'inventarios manuales y de seguridad de Foodint (md5 de id·estado)',
    (select md5(coalesce(string_agg(id::text || status, '|' order by id), ''))
       from public.inventory_count where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and kind <> 'cycle') union all
  select 5, 'movimientos de stock de conteos de Foodint (cuántos · suma)',
    (select count(*) || ' · ' || coalesce(round(sum(qty_base), 4)::text, '0')
       from public.stock_movement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and source_type = 'inventory_count') union all
  select 6, 'funciones del conteo (nombre=md5 de su definición)',
    (select string_agg(proname || '=' || left(md5(pg_get_functiondef(oid)), 12), ' · ' order by proname)
       from pg_proc where pronamespace = 'public'::regnamespace
        and proname in ('apply_inventory_count', 'close_inventory_count', 'autoclose_daily_count', 'cron_autoclose_daily_counts')) union all
  select 7, 'lo que añade la 0400 (nombre:cuántos)',
    (select coalesce(string_agg(proname || ':' || n, ' · ' order by proname), 'nada')
       from (select proname, count(*) n from pg_proc where pronamespace = 'public'::regnamespace
              and proname in ('_close_inventory_count_core', '_apply_inventory_count_core', '_autoconteo_aplicar',
                              'autoconteo_cierre_nocturno', 'autoconteos_sin_aplicar', 'autoconteo_vigia') group by 1) x) union all
  select 8, 'columnas nuevas de inventory_count',
    (select coalesce(string_agg(column_name, ' · ' order by column_name), 'ninguna') from information_schema.columns
      where table_schema = 'public' and table_name = 'inventory_count' and column_name like 'auto_appl%') union all
  select 9, 'orden del cron de las 03:10 UTC',
    (select coalesce(string_agg(schedule || ' ' || command, ' · '), 'no hay trabajo') from cron.job where jobname = 'autoinventory-autoclose') union all
  select 10, 'copia de la 0390 (filas)',
    (select case when to_regclass('public.autoconteo_anulacion_20261021') is null then 'no existe'
                 else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.autoconteo_anulacion_20261021', false, true, '')))[1]::text end)
) x order by o;
