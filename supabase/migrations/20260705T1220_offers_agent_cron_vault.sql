-- 20260705T1220_offers_agent_cron_vault.sql
-- MOTOR DE OFERTAS — cron horario del agente, leyendo el secreto del VAULT (05/07/2026).
--
-- ARREGLA UN BUG REAL: el job original (id 9) llevaba el secreto entre ángulos
-- ("x-agent-secret":"<fv_agent_...>") -> la Edge devolvía 403 en CADA corrida horaria
-- en silencio. agent_run_log lo confirma: solo hay filas de disparos manuales.
-- El agente nunca corrió solo hasta esta migración.
--
-- SIN SECRETO EN EL FICHERO: el header se construye en el momento de la llamada
-- leyendo vault.decrypted_secrets (mismo patrón que los secretos de Catcher).
-- PRERREQUISITO (manual, NO versionable): el secreto debe existir en el Vault
-- con nombre 'offers_agent_secret' y su valor debe coincidir con el env
-- OFFERS_AGENT_SECRET de la Edge Function offers-agent.
--   select vault.create_secret('<VALOR>', 'offers_agent_secret');
-- Rotación futura = actualizar Vault + secret de la Edge; el cron no se toca.

begin;

-- Retirar el job roto (idempotente: no falla si ya no existe)
do $$
begin
  perform cron.unschedule('offers-agent-hourly');
exception when others then
  null;
end $$;

-- Programar el job correcto: cada hora al minuto 5, secreto desde Vault, sin ángulos
select cron.schedule(
  'offers-agent-hourly',
  '5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/offers-agent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-agent-secret', (select decrypted_secret
                           from vault.decrypted_secrets
                          where name = 'offers_agent_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);

commit;
