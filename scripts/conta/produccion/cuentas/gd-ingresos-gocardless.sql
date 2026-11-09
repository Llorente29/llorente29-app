-- scripts/conta/produccion/cuentas/gd-ingresos-gocardless.sql
--
-- GD · El ingreso de las liquidaciones de GoCardless en el banco de la demo ·
-- LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. La misma vara a los dos
-- lados (regla 31). Solo la cuenta demo (de000000-…-a0).
-- Medido antes el 09/11 a las 16:05 UTC (solo lectura). Lo que tiene que pasar:
--   1. Las dos funciones de la siembra: no / no → sí / sí.
--   2. El cron gd-ingresos-gocardless: no → sí, cada 30 minutos.
--   3. Liquidaciones de la sociedad / movimientos en su banco / extractos de la siembra: 0 / 0 / 0 → 0 / 0 / 0.
-- Y la vuelta atrás deja todo como antes (el ensayo lo mide).
select clave, valor from (
  select 1 o, 'Las funciones demo_gestoria_ingresos_gocardless / _demos' clave,
    concat_ws(' / ', (to_regprocedure('public.demo_gestoria_ingresos_gocardless(uuid)') is not null)::text,
                     (to_regprocedure('public.demo_gestoria_ingresos_gocardless_demos()') is not null)::text) valor union all
  select 2, 'El cron gd-ingresos-gocardless',
    coalesce((select schedule from cron.job where jobname = 'gd-ingresos-gocardless'), 'no') union all
  select 3, 'Liquidaciones de la sociedad / movimientos en su banco / extractos de la siembra',
    -- quieta: solo la cuenta demo, que en el ensayo no toca nadie más
    concat_ws(' / ',
      (select count(*) from public.conta_gc_payout where account_id = 'de000000-0000-4000-8000-0000000000a0' and company_id = 'de000000-0000-4000-8000-0000000000a9'),
      (select count(*) from public.bank_movement where account_id = 'de000000-0000-4000-8000-0000000000a0' and company_id = 'de000000-0000-4000-8000-0000000000a9'),
      (select count(*) from public.bank_statement where account_id = 'de000000-0000-4000-8000-0000000000a0' and file_name like 'gd-gocardless-%'))
) q order by o;
