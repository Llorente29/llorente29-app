-- scripts/conta/produccion/cuentas/g05-devuelto-pagar.sql
--
-- G05 · Un recibo devuelto, desde la gestoría (nº 71, punto 2) · LO QUE CUENTA LA
-- TANDA, antes y después. SOLO LEE. La misma vara a los dos lados (regla 31).
-- Medido antes el 09/11 a las 23:52 UTC. Lo que tiene que pasar:
--   1. conta_recibo_devuelto_opciones existe: false → true.
--   2. _conta_recibo_devuelto_hecho existe: false → true.
--   3. _conta_usuario_cobra existe: false → true.
--   4. Eventos de los recibos (todas las cuentas, hasta el corte): quieta.
select clave, valor from (
  select 1 o, 'conta_recibo_devuelto_opciones existe' clave,
    (to_regprocedure('public.conta_recibo_devuelto_opciones(uuid)') is not null)::text valor union all
  select 2, '_conta_recibo_devuelto_hecho existe',
    (to_regprocedure('public._conta_recibo_devuelto_hecho(uuid,text,text,jsonb,text)') is not null)::text union all
  select 3, '_conta_usuario_cobra existe',
    (to_regprocedure('public._conta_usuario_cobra(uuid,uuid)') is not null)::text union all
  select 4, 'Eventos de los recibos (todas las cuentas, hasta el corte)',
    (select count(*)::text from public.conta_recibo_evento where cuando < timestamptz '2026-11-09 23:50:00+00')
) q order by o;
