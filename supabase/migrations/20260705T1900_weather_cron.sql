-- 20260705T1900_weather_cron.sql
-- MOTOR DE OFERTAS v2.1 · T2 — cron del meteorólogo (05/07/2026).
-- Llama a la Edge weather-events UNA vez al día a las 05:15 UTC (antes del servicio y de
-- las corridas del agente del día), con el secreto interno desde el Vault y timeout de
-- 15s (la Edge consulta Open-Meteo por cada local). La Edge es idempotente: si el cron
-- corriera dos veces, no duplica el evento del día.

begin;

do $$
begin
  perform cron.unschedule('weather-events-daily');
exception when others then
  null;
end $$;

select cron.schedule(
  'weather-events-daily',
  '15 5 * * *',
  $cron$
  select net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/weather-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-agent-secret', (select decrypted_secret
                           from vault.decrypted_secrets
                          where name = 'offers_agent_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  $cron$
);

commit;
