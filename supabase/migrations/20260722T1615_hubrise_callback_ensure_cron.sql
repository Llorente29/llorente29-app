-- 20260722T1615_hubrise_callback_ensure_cron.sql
-- Aplicada: 2026-07-22 (a mano en prod; esta migracion la VERSIONA para cerrar el drift).
-- Verificado 2026-07-23 contra cron.job: jobid 21, schedule '*/5 * * * *', active, ejecuciones 'succeeded'.
--
-- QUE HACE: cada 5 min invoca la Edge Function `hubrise-callback-ensure`, que comprueba
-- y re-registra el callback de HubRise si desaparecio (HubRise borra el callback tras 6
-- entregas fallidas -> dejariamos de recibir pedidos EN SILENCIO). Es el auto-sanador que
-- garantiza el zero-order-loss.
--
-- IDEMPOTENTE: cron.schedule(job_name, ...) hace upsert por nombre; re-ejecutar esta
-- migracion reescribe schedule/command del job existente sin duplicarlo. No altera prod
-- porque el contenido coincide con lo que ya corre.
--
-- REQUISITOS: extensiones pg_cron y pg_net (ya instaladas). El Edge esta desplegado
-- con verify_jwt=false (por eso el POST no lleva Authorization).

select cron.schedule(
  'hubrise-callback-ensure',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/hubrise-callback-ensure',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb
  );
  $cron$
);
