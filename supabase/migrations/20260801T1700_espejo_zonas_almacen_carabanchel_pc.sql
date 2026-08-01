-- 20260801T1700_espejo_zonas_almacen_carabanchel_pc.sql
-- Aplicada: 2026-08-01 (a mano por SQL Editor; movimiento de DATOS, no de esquema).
-- REGISTRO / reproducible. Idempotente (WHERE NOT EXISTS + ON CONFLICT).
--
-- Copia las 8 zonas de almacén CON artículos de Foodint Alcalá a Foodint
-- Carabanchel y Foodint Plaza Castilla, y replica la asignación artículo->zona
-- por ESPEJO LITERAL (opción A: casa la zona destino por NOMBRE dentro de cada
-- local). Excluye la zona 'Congelador Principal' (vacía en Alcalá).
--
-- NO TOCA STOCK: solo escribe en storage_area y recipe_item_storage_area.
-- recipe_item_location_stock / stock_movement no se rozan (0 triggers en ambas
-- tablas; verificado). Filas de stock previas (Carabanchel 143, PC 119) intactas.
--
-- Cuenta:  51ad1792-6629-4ef7-833a-b57b09a86710 (Foodint / Llorente29)
-- Origen:  38158159-cd71-4056-950b-53425afac1ce (Alcalá)
-- Destino: 92d7656e-082e-452a-8ebc-236b2d6ebf5f (Carabanchel)
--          629f9154-b888-48ed-9b8c-ffae77620615 (Plaza Castilla)
-- Resultado verificado: 8 zonas y 195 asignaciones en cada local destino.

-- 1) Zonas (primer nivel; parent_id null en las 8 de Alcalá).
insert into storage_area (id, account_id, location_id, name, position, active, parent_id)
select gen_random_uuid(), src.account_id, tgt.location_id, src.name, src.position, src.active, null
from storage_area src
cross join (values
  ('92d7656e-082e-452a-8ebc-236b2d6ebf5f'::uuid),
  ('629f9154-b888-48ed-9b8c-ffae77620615'::uuid)
) as tgt(location_id)
where src.location_id = '38158159-cd71-4056-950b-53425afac1ce'
  and src.account_id  = '51ad1792-6629-4ef7-833a-b57b09a86710'
  and src.name <> 'Congelador Principal'
  and not exists (
    select 1 from storage_area x
    where x.location_id = tgt.location_id
      and x.account_id  = src.account_id
      and x.name = src.name
  );

-- 2) Asignación artículo->zona por espejo (casa por nombre de zona).
insert into recipe_item_storage_area (id, account_id, recipe_item_id, storage_area_id, position)
select gen_random_uuid(), risa.account_id, risa.recipe_item_id, tgt.id, risa.position
from recipe_item_storage_area risa
join storage_area src
  on src.id = risa.storage_area_id
 and src.location_id = '38158159-cd71-4056-950b-53425afac1ce'
 and src.account_id  = '51ad1792-6629-4ef7-833a-b57b09a86710'
 and src.name <> 'Congelador Principal'
join storage_area tgt
  on tgt.account_id = src.account_id
 and tgt.name = src.name
 and tgt.location_id in (
   '92d7656e-082e-452a-8ebc-236b2d6ebf5f',
   '629f9154-b888-48ed-9b8c-ffae77620615')
on conflict (recipe_item_id, storage_area_id) do nothing;
