-- 20260705T1500_ping_cron_vault.sql
-- MONITORIZACIÓN — cron del ping sintético (job 'ingestion-synthetic-ping'), saneado (05/07/2026):
--   (1) el secreto sale del VAULT (nombre 'cron_secret') en vez de ir hardcodeado en el
--       comando del cron (el viejo quedó expuesto y se rota hoy; mismo patrón que el agente);
--   (2) timeout_milliseconds := 10000 — el timeout por defecto de pg_net (5s) se agotaba en
--       CADA corrida (verificado en net._http_response 05/07: filas de error cada 10 min);
--       la Edge hace ping+comprobaciones y a veces tarda >5s.
-- PRERREQUISITO (manual, NO versionable): el secreto en el Vault con nombre 'cron_secret'
-- y su valor = env CRON_SECRET de las Edges ingestion-synthetic-ping y system-alert.
--   select vault.create_secret('<VALOR>', 'cron_secret');

begin;

do $$
begin
  perform cron.unschedule('ingestion-synthetic-ping');
exception when others then
  null;
end $$;

select cron.schedule(
  'ingestion-synthetic-ping',
  '*/10 * * * *',
  $cron$
  select net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/ingestion-synthetic-ping',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret
                          from vault.decrypted_secrets
                         where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $cron$
);

commit;
