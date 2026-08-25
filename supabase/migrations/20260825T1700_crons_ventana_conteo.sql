-- 20260825T1700_crons_ventana_conteo.sql
-- APLICADA en producción el 25-08-2026.
--
-- Medido: el asiento de consumo llega con p50 123 min, p90 129 min y peor caso
-- 912 min respecto a la hora de la venta (el trigger salta cuando el pedido
-- alcanza 'completed'). El autocierre corría a los 10 min de cada hora entre
-- las 14 y las 3 UTC, así que podía cerrar a las 22:10 un día cuyas ventas de
-- las 21:30 no se asientan hasta las 23:30 → merma inventada.
--
--   autoinventory-autoclose : '10 14-23,0-3 * * *'  →  '10 3 * * *'
--                             (03:10 UTC = 05:10 Madrid en horario de verano)
--   sales-consumption-reprocess : NUEVO '30 1 * * *'
--                             (01:30 UTC: después del asiento, antes del cierre)
--
-- Contrapartida aceptada: un conteo terminado por la mañana ya no se autocierra
-- esa misma tarde, espera al 03:10 siguiente. La alternativa (exigir ≥3 h desde
-- la última venta del local dentro de cron_autoclose_daily_counts) queda
-- propuesta, no hecha.

select cron.alter_job(46, schedule => '10 3 * * *');   -- autoinventory-autoclose

select cron.schedule(
  'sales-consumption-reprocess',
  '30 1 * * *',
  'select public.cron_recompute_missing_sale_consumption(7)'
);

-- Verificación
--   select jobid, jobname, schedule, active from cron.job
--    where jobname in ('autoinventory-autoclose','sales-consumption-reprocess');
