-- 20260812T1510_cron_autoclose_schedule.sql
-- Aplicada: 2026-08-12 por MCP (verificada: cron.job jobid 46, active=true)
--
-- Programa el autocierre de autoinventarios.
--
-- Cada hora entre las 14:00 y las 03:00 UTC (16:00-05:00 Madrid): cubre el
-- servicio y la madrugada. El margen de 2h dentro de la funcion evita tocar
-- conteos que se esten haciendo en ese momento.
--
-- Sin esto, un conteo con el trabajo hecho se queda parado indefinidamente
-- (INV-00154 llevaba >20h) y su ajuste no existe en el stock: se hacen pedidos
-- con datos no asentados.
--
-- NO reejecutar: cron.schedule con el mismo nombre reemplaza, pero conviene
-- comprobar antes con: select * from cron.job where jobname='autoinventory-autoclose';

select cron.schedule(
  'autoinventory-autoclose',
  '10 14-23,0-3 * * *',
  $$select public.cron_autoclose_daily_counts();$$
);
