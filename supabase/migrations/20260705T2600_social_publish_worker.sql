-- 20260705T2600_social_publish_worker.sql
-- SISTEMA RRSS · TR2 — brazo de Instagram (05/07/2026).
-- (1) social_secret_read(name): lee un secreto del Vault por nombre (patrón de la casa:
--     connector_secret_read del Catcher). SOLO service_role — ni anon ni authenticated
--     pueden tocarlo; el token de publicación jamás sale del backend.
-- (2) Cron 'social-publish-worker' cada 15 min: despierta a la Edge social-publish, que
--     publica los social_post APROBADOS (la aprobación humana es la puerta del modo b;
--     desde ahí la publicación es máquina). La Edge es idempotente (claim por estado).
-- REGLA de la casa: SECURITY DEFINER se crea solo, se verifica aparte.

begin;

create or replace function public.social_secret_read(p_name text)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v text;
begin
  select decrypted_secret into v
    from vault.decrypted_secrets
   where name = p_name;
  return v;
end $function$;

revoke all on function public.social_secret_read(text) from public, anon, authenticated;
grant execute on function public.social_secret_read(text) to service_role;

do $$
begin
  perform cron.unschedule('social-publish-worker');
exception when others then
  null;
end $$;

select cron.schedule(
  'social-publish-worker',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/social-publish',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-agent-secret', (select decrypted_secret
                           from vault.decrypted_secrets
                          where name = 'offers_agent_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $cron$
);

commit;
