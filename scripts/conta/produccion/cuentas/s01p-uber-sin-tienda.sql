-- scripts/conta/produccion/cuentas/s01p-uber-sin-tienda.sql
--
-- S01p·18 · punto 6 · Las liquidaciones sin tienda (1136) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
--   1. Las liquidaciones de Foodint sin local o marca, con su huella: iguales antes y después (las 8 de Uber las
--      arregla D en su DL1_24; la tanda no asigna ninguna).
select clave, valor from (
  -- quieta: la tanda no asigna ninguna liquidación
  select 1 o, 'Foodint · liquidaciones sin local o marca (n · huella)' clave,
    (select count(*) || ' · ' || md5(coalesce(string_agg(cs.id::text || ':' || coalesce(cs.brand_id::text, '-') || ':' || coalesce(cs.location_id::text, '-'), '|' order by cs.id), ''))
       from public.channel_settlement cs
      where cs.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and (cs.brand_id is null or cs.location_id is null)) valor
) t order by o;
