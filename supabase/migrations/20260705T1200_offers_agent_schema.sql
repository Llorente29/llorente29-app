-- 20260705T1200_offers_agent_schema.sql
-- MOTOR DE OFERTAS — esquema del agente (versionado a posteriori, 05/07/2026).
-- Copia EXACTA de la BD viva (RECON 05/07 contra information_schema/pg_constraint/pg_policies).
-- Las tablas YA EXISTEN en producción: esta migración es idempotente (no-op al aplicarla allí);
-- su valor es que un entorno nuevo nazca idéntico.
-- NOTA: los GRANTs anchos de tabla (anon/authenticated/service_role ALL) son los defaults
-- de Supabase para el esquema public; no se re-declaran. La protección real es la RLS.

begin;

-- ── 1. offers_agent_config — configuración del agente por cuenta
create table if not exists public.offers_agent_config (
  account_id          uuid        not null primary key references public.accounts(id),
  enabled             boolean     not null default false,
  aggressiveness      text        not null default 'medium'
                        constraint offers_agent_config_aggressiveness_check
                        check (aggressiveness = any (array['low'::text,'medium'::text,'high'::text,'max'::text])),
  margin_floor_pct    numeric     not null default 45,
  max_campaign_days   integer     not null default 7,
  shop_mode           text        not null default 'auto'
                        constraint offers_agent_config_shop_mode_check
                        check (shop_mode = any (array['auto'::text,'propose'::text,'off'::text])),
  platform_mode       text        not null default 'propose'
                        constraint offers_agent_config_platform_mode_check
                        check (platform_mode = any (array['auto'::text,'propose'::text,'off'::text])),
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  growth_mode         boolean     not null default true,
  recovery_target_pct numeric     not null default 80,
  push_agent_secret   text
);

-- ── 2. local_event — calendario de eventos con efecto en la demanda
create table if not exists public.local_event (
  id            uuid        not null primary key default gen_random_uuid(),
  account_id    uuid        not null references public.accounts(id),
  name          text        not null,
  event_type    text        not null default 'other'
                  constraint local_event_event_type_check
                  check (event_type = any (array['sports'::text,'holiday'::text,'concert'::text,'weather_alert'::text,'other'::text])),
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  demand_effect text        not null default 'up'
                  constraint local_event_demand_effect_check
                  check (demand_effect = any (array['up'::text,'down'::text])),
  notes         text,
  created_at    timestamptz not null default now()
);

-- ── 3. agent_run_log — auditoría de cada corrida del agente (qué vio, qué decidió)
create table if not exists public.agent_run_log (
  id                uuid        not null primary key default gen_random_uuid(),
  account_id        uuid        not null references public.accounts(id),
  ran_at            timestamptz not null default now(),
  signals           jsonb       not null,
  decisions         jsonb       not null,
  campaigns_created integer     not null default 0
);

-- ── 4. RLS (mismas políticas y nombres que la BD viva)
alter table public.offers_agent_config enable row level security;
alter table public.local_event         enable row level security;
alter table public.agent_run_log       enable row level security;

drop policy if exists oac_account on public.offers_agent_config;
create policy oac_account on public.offers_agent_config
  for all
  using (belongs_to_account(account_id))
  with check (belongs_to_account(account_id));

drop policy if exists le_account on public.local_event;
create policy le_account on public.local_event
  for all
  using (belongs_to_account(account_id))
  with check (belongs_to_account(account_id));

drop policy if exists arl_account on public.agent_run_log;
create policy arl_account on public.agent_run_log
  for all
  using (belongs_to_account(account_id))
  with check (belongs_to_account(account_id));

commit;
