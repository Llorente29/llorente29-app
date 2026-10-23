-- scripts/conta/produccion/cuentas/c08-lovers-catalogo.sql
--
-- C08 · LO QUE CUENTA LA TANDA «LOVERS BURGERS DE CARABANCHEL, AL CATÁLOGO QUE
-- EXISTE» (0840), antes y después. SOLO LEE. Antes: la fila con q3v47. Después:
-- con 2qjdb. Y que no se mueve nada más: las filas de brand_hubrise_catalog de
-- Foodint con su catálogo (huella), y cuántas hay en toda la tabla (dicho: de
-- todas las cuentas).
select clave, valor from (
  select 1 o, 'catálogo de Lovers Burgers · Carabanchel' clave,
         (select external_catalog_id from public.brand_hubrise_catalog
           where id = '84c5951d-461d-454a-9fad-7b3bafd7e85b' and account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') valor union all
  select 2, 'huella de las demás filas de Foodint',
         (select md5(coalesce(string_agg(id::text || ':' || external_catalog_id, ',' order by id), '')) from public.brand_hubrise_catalog
           where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and id <> '84c5951d-461d-454a-9fad-7b3bafd7e85b') union all
  select 3, 'filas de brand_hubrise_catalog (todas las cuentas)', (select count(*) from public.brand_hubrise_catalog)::text
) x order by o;
