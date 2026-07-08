-- 20260708T1500_seed_shop_targets.sql
--
-- Frente 2 (08/07): objetivos de venta por canal en SHOP, para que el agente de
-- ofertas trate el Shop con el mismo rigor que plataforma (y no caiga en el
-- "sin objetivo -> mantenimiento 10% plano"). Dos seeds idempotentes:
--
--   (1) PROPIAS  -> copia de sus objetivos de Glovo al canal Shop (mismo target_daily).
--   (2) CEDIDAS  -> objetivo de crecimiento en Shop a 5 ped/dia (las cedidas solo
--       operan en Shop; no tienen objetivo en ningun otro canal que copiar).
--
-- Emparejado con el fix del cerebro (offers-agent: "canal a cero sin objetivo =
-- crecimiento agresivo", commit ba6c95d). En Shop cedidas = propias.
--
-- IDs de la cuenta laboratorio (Llorente29 Food / foodint) y del canal Shop.
-- La migracion es idempotente (ON CONFLICT sobre la clave unica) y segura de
-- reejecutar. Ejecutada originalmente como SQL directo el 08/07; se versiona
-- aqui para eliminar drift (BBDD <-> repo).

begin;

-- (1) PROPIAS: Glovo -> Shop (mismo objetivo por marca x local).
insert into brand_channel_target (account_id, brand_id, channel_id, location_id, target_daily, updated_at)
select
  bct.account_id,
  bct.brand_id,
  '7849ce3d-e055-484b-95a4-3744a3e5d6f4'::uuid as channel_id,   -- Shop
  bct.location_id,
  bct.target_daily,
  now()
from brand_channel_target bct
where bct.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
  and bct.channel_id = 'f98fcf5b-7ee3-4995-9a29-e755d2bd29f3'    -- Glovo
on conflict (account_id, brand_id, channel_id, location_id)
do update set target_daily = excluded.target_daily, updated_at = now();

-- (2) CEDIDAS: objetivo de crecimiento en Shop = 5 ped/dia, solo donde operan y estan activas.
insert into brand_channel_target (account_id, brand_id, channel_id, location_id, target_daily, updated_at)
select
  bla.account_id,
  bla.brand_id,
  '7849ce3d-e055-484b-95a4-3744a3e5d6f4'::uuid as channel_id,   -- Shop
  bla.location_id,
  5,
  now()
from brand_location_availability bla
join brand b on b.id = bla.brand_id
where bla.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
  and bla.is_active = true
  and b.ownership_type = 'licensed'
on conflict (account_id, brand_id, channel_id, location_id)
do update set target_daily = excluded.target_daily, updated_at = now();

commit;
