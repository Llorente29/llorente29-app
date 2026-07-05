-- 20260705T1400_uber_arm.sql
-- BRAZO UBER (promos) — infraestructura (05/07/2026). Construido EN SECO:
-- los scopes eats.store.promotion.* están en verificación de Partner Engineering
-- (bloqueo confirmado empíricamente: invalid_scope incluso para eats.store).
-- El brazo despierta solo cuando Uber apruebe + se rellene uber_store_map.

begin;

-- ── 1. Mapeo Folvy -> tiendas de Uber (una fila por marca×tienda; se puebla con
--       GET /v1/eats/stores cuando haya token, o a mano desde el panel de Uber).
create table if not exists public.uber_store_map (
  id          uuid        not null primary key default gen_random_uuid(),
  account_id  uuid        not null references public.accounts(id),
  brand_id    uuid        not null references public.brand(id),
  location_id uuid        references public.locations(id),
  store_id    text        not null,
  store_name  text,
  created_at  timestamptz not null default now(),
  unique (account_id, brand_id, store_id)
);
alter table public.uber_store_map enable row level security;
drop policy if exists usm_account on public.uber_store_map;
create policy usm_account on public.uber_store_map
  for all using (belongs_to_account(account_id)) with check (belongs_to_account(account_id));

-- ── 2. Caché del token OAuth de plataforma (TTL 30d; límite Uber: 100 tokens/hora
--       y cada token nuevo invalida el más antiguo -> JAMÁS token por llamada).
--       RLS sin políticas = invisible para anon/authenticated; solo service_role.
create table if not exists public.platform_api_token (
  platform     text        not null primary key,
  access_token text        not null,
  expires_at   timestamptz not null,
  updated_at   timestamptz not null default now()
);
alter table public.platform_api_token enable row level security;

-- ── 3. Claim para la Edge (service_role): mismas semánticas que claim_promo_push_jobs
--       pero SIN secreto por cuenta (la frontera es que SOLO service_role puede ejecutarla).
create or replace function public.claim_promo_push_jobs_srv(p_platform text, p_limit integer default 3)
returns setof promo_push_job
language plpgsql
security invoker
set search_path to 'public'
as $function$
begin
  return query
    update promo_push_job j
       set status='sent', attempts=attempts+1, updated_at=now()
     where j.id in (
       select id from promo_push_job
        where platform=p_platform and status in ('pending','error')
          and attempts < 5
        order by created_at
        for update skip locked
        limit p_limit)
    returning j.*;
end $function$;

revoke all on function public.claim_promo_push_jobs_srv(text, integer) from public, anon, authenticated;
grant execute on function public.claim_promo_push_jobs_srv(text, integer) to service_role;

-- ── 4. Cron del brazo: cada 10 min al minuto 7 (evita chocar con el ping de :10 y el agente de :05).
--       Secreto desde el Vault (mismo 'offers_agent_secret': frontera interna de plataforma).
do $$
begin
  perform cron.unschedule('uber-promo-push-10min');
exception when others then
  null;
end $$;

select cron.schedule(
  'uber-promo-push-10min',
  '7,17,27,37,47,57 * * * *',
  $cron$
  select net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/uber-promo-push',
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
