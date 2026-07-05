-- 20260705T2500_social_agent_cron.sql
-- SISTEMA RRSS · TR1 — cron del agente de contenido (05/07/2026).
-- Diario a las 10:00 UTC (mediodía Madrid, antes del servicio: da tiempo a aprobar y
-- que el post salga en la franja buena de la tarde-noche). Secreto interno del Vault
-- (misma frontera que el resto de agentes). El agente es idempotente por día/red.

begin;

do $$
begin
  perform cron.unschedule('social-agent-daily');
exception when others then
  null;
end $$;

select cron.schedule(
  'social-agent-daily',
  '0 10 * * *',
  $cron$
  select net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/social-agent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-agent-secret', (select decrypted_secret
                           from vault.decrypted_secrets
                          where name = 'offers_agent_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $cron$
);

commit;
