-- scripts/conta/produccion/cuentas/s01j2-correo.sql
--
-- S01j·2 · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. Sin nombres.
-- Lo que tiene que pasar: la ficha y el disparador, de false a true; las
-- liquidaciones de Glovo de Foodint sin local, de 29 a 0; las que tienen local,
-- de 75 a 104; y ninguna liquidación nueva ni borrada.
select clave, valor from (
  select 1 o, 'existe conta_liquidacion_ficha' clave, (to_regprocedure('public.conta_liquidacion_ficha(uuid)') is not null)::text valor union all
  select 2, 'existe el disparador del local',
    -- quieta: es si existe un disparador; solo lo cambia una migración.
    (exists (select 1 from pg_trigger where tgname = 's01j2_liquidacion_pon_local'))::text union all
  select 3, 'liquidaciones del Excel de Glovo de Foodint sin local (ni en su tienda)',
    (select count(*)::text from public.channel_settlement cs left join public.platform_store ps on ps.id = cs.store_id
      where cs.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and cs.source = 'excel_glovo' and cs.location_id is null and ps.location_id is null
        and cs.created_at < timestamptz '2026-11-01 13:12+00') union all
  select 4, 'liquidaciones del Excel de Glovo de Foodint con local',
    (select count(*)::text from public.channel_settlement cs left join public.platform_store ps on ps.id = cs.store_id
      where cs.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and cs.source = 'excel_glovo' and coalesce(cs.location_id, ps.location_id) is not null
        and cs.created_at < timestamptz '2026-11-01 13:12+00') union all
  select 5, 'liquidaciones de Foodint',
    (select count(*)::text from public.channel_settlement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-11-01 13:12+00')
) q order by o;
