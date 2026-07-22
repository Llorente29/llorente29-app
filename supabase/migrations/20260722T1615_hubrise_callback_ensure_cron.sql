-- 20260722T1615_hubrise_callback_ensure_cron.sql
-- Aplicada: 2026-07-22 (en vivo por MCP; esta migración la deja versionada; cron.schedule es idempotente)
-- Programa hubrise-callback-ensure cada 5 min para garantizar la recepción de
-- pedidos de HubRise (HubRise borra el callback tras 6 entregas fallidas).
-- Reversible: select cron.unschedule('hubrise-callback-ensure');

select cron.schedule(
  'hubrise-callback-ensure',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/hubrise-callback-ensure',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);