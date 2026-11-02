-- scripts/conta/produccion/cuentas/s01j-correo.sql
--
-- S01j · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. Sin nombres.
-- Sin comas en los valores. Todo de Foodint y de antes del 01/11 08:45 UTC.
--
-- Lo que tiene que pasar: las dos funciones y el disparador, de false a true;
-- y ninguna fila cambia al aplicar (la tanda no lee ningún correo).
select clave, valor from (
  select 1 o, 'existe conta_comision_del_correo' clave, (to_regprocedure('public.conta_comision_del_correo(uuid,jsonb)') is not null)::text valor union all
  select 2, 'existe conta_correo_releer_lista', (to_regprocedure('public.conta_correo_releer_lista(uuid,text[],text)') is not null)::text union all
  select 3, 'existe el disparador s01j_liquidacion_sustituye', exists (select 1 from pg_trigger where tgname = 's01j_liquidacion_sustituye')::text union all
  select 4, 'liquidaciones de Foodint sin periodo',
    (select count(*)::text from public.channel_settlement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and period_from is null and created_at < timestamptz '2026-11-01 08:45+00') union all
  select 5, 'liquidaciones de Foodint',
    (select count(*)::text from public.channel_settlement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-11-01 08:45+00') union all
  select 6, 'recibidas de Foodint',
    (select count(*)::text from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-11-01 08:45+00')
) q order by o;
