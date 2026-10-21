-- scripts/conta/produccion/cuentas/anula-auditorias.sql
--
-- INVENTARIO · LO QUE CUENTA LA TANDA DE LA 0440, antes y después.
-- SOLO LEE. Por cuenta (regla 9): Foodint, con su id. Sin nombres.
--
-- Lo que tiene que pasar:
--   · los 3 de la 0440 pasan de «en_revision» a «anulado»; ningún otro
--     inventario cambia de estado;
--   · el STOCK NO SE MUEVE: los movimientos de stock de conteos de Foodint,
--     mismo número y misma suma antes y después;
--   · la copia de la 0440 existe después, con 3 filas.
select clave, valor from (
  select 1 o, 'los 3 de la 0440 (estado:cuántos)' clave,
    (select coalesce(string_agg(status || ':' || n, ' · ' order by status), 'ninguno')
       from (select status, count(*) n from public.inventory_count
              where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
                and id in ('a9d1ba49-9d5e-47a3-b4e4-d451218d4d26', '3959507e-184d-4a02-bb62-c4a00f7b69bf', 'b6b1a5de-2176-47fa-b378-60b2ed685744')
              group by 1) x) valor union all
  select 2, 'inventarios de Foodint por tipo y estado (tipo/estado:cuántos)',
    (select coalesce(string_agg(kind || '/' || status || ':' || n, ' · ' order by kind, status), 'ninguno')
       from (select kind, status, count(*) n from public.inventory_count
              where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by 1, 2) x) union all
  select 3, 'movimientos de stock de conteos de Foodint (cuántos · suma)',
    (select count(*) || ' · ' || coalesce(round(sum(qty_base), 4)::text, '0')
       from public.stock_movement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and source_type = 'inventory_count') union all
  select 4, 'movimientos de stock de los 3 de la 0440',
    (select count(*)::text from public.stock_movement where source_type = 'inventory_count'
        and source_id in ('a9d1ba49-9d5e-47a3-b4e4-d451218d4d26', '3959507e-184d-4a02-bb62-c4a00f7b69bf', 'b6b1a5de-2176-47fa-b378-60b2ed685744')) union all
  select 5, 'copia de la 0440 (filas)',
    (select case when to_regclass('public.inventario_anulacion_20261021') is null then 'no existe'
                 else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.inventario_anulacion_20261021', false, true, '')))[1]::text end)
) x order by o;
