-- 20260815T1910_hubrise_connection_health_cron.sql
-- ENCARGO CODE — módulo de conexión HubRise, FASE 1.3.
-- Aplicada por MCP (verificada 2026-08-15: cron.job jobid=48, schedule
-- '*/30 * * * *', active=true, comando idéntico al de este fichero).
--
-- QUE HACE: cada 30 min invoca hubrise-connection-health, que pinguea
-- (GET /callback, solo lectura) cada conexión activa de external_integration
-- y actualiza token_status/token_checked_at. Alarma agregada vía system-alert
-- cuando una conexión pasa a 'invalid'. Deploy con verify_jwt=false
-- (confirmado en list_edge_functions), por eso el POST no lleva Authorization.
--
-- IDEMPOTENTE: cron.schedule(job_name, ...) hace upsert por nombre; re-ejecutar
-- esta migración reescribe schedule/command del job existente sin duplicarlo.

select cron.schedule(
  'hubrise-connection-health',
  '*/30 * * * *',
  $cron$
  select net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/hubrise-connection-health',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb
  );
  $cron$
);
