-- scripts/conta/produccion/cuentas/s01m-direcciones.sql
--
-- S01m · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. Sin nombres.
-- Lo que tiene que pasar: la tabla y la función, de false a true; y ningún
-- enlace de factura con liquidación cambia al aplicar (nadie ha escrito aún
-- ninguna otra dirección).
select clave, valor from (
  select 1 o, 'existe location_address_alias' clave, (to_regclass('public.location_address_alias') is not null)::text valor union all
  select 2, 'existe conta_local_direcciones_guardar', (to_regprocedure('public.conta_local_direcciones_guardar(uuid,text[],text)') is not null)::text union all
  select 3, 'facturas de Foodint ligadas a una liquidación',
    (select count(*)::text from public.channel_settlement_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-11-01 09:45+00')
) q order by o;
