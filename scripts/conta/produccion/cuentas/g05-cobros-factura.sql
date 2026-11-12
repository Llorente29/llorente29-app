-- scripts/conta/produccion/cuentas/g05-cobros-factura.sql
--
-- G05 · La factura de cada cobro en la ficha (nº 84) · LO QUE CUENTA LA TANDA,
-- antes y después. SOLO LEE. La misma vara a los dos lados (regla 31). Medido
-- antes el 10/11 a las 13:33 UTC. Lo que tiene que pasar:
--   1. conta_ficha_facturas existe: false → true.
--   2. conta_pantalla_ficha sigue (la de antes, sin tocar): true → true.
--   3. Recibos con cobro de GoCardless (todas las cuentas, preparados hasta el corte): quieta (25).
select clave, valor from (
  select 1 o, 'conta_ficha_facturas existe' clave,
    (to_regprocedure('public.conta_ficha_facturas(uuid,uuid)') is not null)::text valor union all
  select 2, 'conta_pantalla_ficha existe',
    (to_regprocedure('public.conta_pantalla_ficha(uuid,uuid)') is not null)::text union all
  select 3, 'Recibos con cobro de GoCardless (todas las cuentas, hasta el corte)',
    (select count(*)::text from public.conta_recibo where gc_cobro_id is not null and preparado_at < timestamptz '2026-11-10 13:30:00+00')
) q order by o;
