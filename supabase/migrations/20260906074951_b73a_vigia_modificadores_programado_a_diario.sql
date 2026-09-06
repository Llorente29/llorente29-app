-- B73a · pieza 4 (06/09/2026) — El vigia, programado. Sin esto la funcion existe
-- y no corre, que es la forma mas silenciosa de no tener vigia.
--
-- `cron.timezone` es GMT en este proyecto (comprobado, no supuesto), asi que
-- `40 5 * * *` son las **07:40 de Madrid en horario de verano** y las 06:40 en
-- invierno. Se deja escrito para que nadie lo lea como «07:40 todo el año».
-- Va antes del barrido de las 04:50 del dia siguiente y despues del recalculo de
-- cocina de las 04:00, asi que mide sobre costes ya asentados.

select cron.schedule(
  'modifier-zero-cost-watchdog',
  '40 5 * * *',
  $$select public.modifier_zero_cost_watchdog()$$
);
