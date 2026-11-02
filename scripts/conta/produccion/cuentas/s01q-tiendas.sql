-- scripts/conta/produccion/cuentas/s01q-tiendas.sql
--
-- S01q · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. Sin nombres de personas.
-- Medido antes (02/11, 11:25Z): 8 · 6 · 31 · 44. Lo que tiene que pasar en Foodint:
-- tiendas de Glovo con el local de su etiqueta, de 8 a 17 (las 2 de «Bardem» van
-- confirmadas a mano: su etiqueta no es de ningún local); sin local, de 6 a 0; sin
-- marca, de 31 a 0; liquidaciones con otro local que su tienda, bajan las de Glovo
-- (las de Uber toman el local de la dirección del cliente, S01j, y se quedan).
select clave, valor from (
  select 1 o, 'Tiendas de Glovo con el local de su etiqueta' clave,
    (select count(*)::text from public.platform_store ps
      -- quieta: las tiendas solo las da de alta una liquidación nueva, y se cuentan las vistas antes del corte
      where ps.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and ps.provider = 'glovo' and ps.created_at < timestamptz '2026-11-02 11:00+00'
        and ps.location_id is not distinct from public._conta_local_de_texto(ps.account_id, array[substring(ps.external_text from '\s-\s[A-Z]{2,4}\s-\s(.*?)\s*\([^()]*\)\s*$')])) valor union all
  select 2, 'Tiendas sin local',
    (select count(*)::text from public.platform_store ps
      where ps.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and ps.location_id is null and ps.created_at < timestamptz '2026-11-02 11:00+00') union all
  select 3, 'Tiendas sin marca',
    (select count(*)::text from public.platform_store ps
      where ps.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and ps.brand_id is null and ps.created_at < timestamptz '2026-11-02 11:00+00') union all
  select 4, 'Liquidaciones con otro local que su tienda',
    (select count(*)::text from public.channel_settlement cs join public.platform_store ps on ps.id = cs.store_id
      where cs.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and cs.location_id is distinct from ps.location_id
        and cs.created_at < timestamptz '2026-11-02 11:00+00')
) q order by o;
