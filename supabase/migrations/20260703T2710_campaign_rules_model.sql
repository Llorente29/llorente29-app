-- 20260703T2710_campaign_rules_model.sql
-- Aplicada: (pendiente)
--
-- G2d sub-lote 1 — MODELO + AUDITORÍA del motor de reglas ("la campaña se enciende
-- sola, con límites; el humano ve y puede parar"). Solo tablas + RLS; el evaluador
-- (pg_cron), los disparadores y la UI llegan en sub-lotes posteriores.
--
--   campaign_rule          la regla: disparador + condición + PLANTILLA de campaña +
--                          límites (presupuesto OBLIGATORIO, cooldown, máx activas).
--   campaign_rule_firing   auditoría/VISIBILIDAD: cada vez que dispara, con el "por
--                          qué" (snapshot de la condición) + la campaña encendida +
--                          si el humano lo ha visto.
--
-- Decisión aprobada aplicada: la regla NACE la campaña (origin='rule'), de ahí
-- action_template. Cadencia/umbrales/tope global = sub-lote 2 (evaluador).
-- trigger_type extensible a v2 (weather/event) sin cambio de esquema.
--
-- RLS: miembros de la cuenta (account_id = any(current_user_account_ids())).

begin;

create table if not exists public.campaign_rule (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  name             text not null,
  trigger_type     text not null check (trigger_type in ('hourly_valley','weak_brand','stalled_dish')),
  condition        jsonb not null default '{}'::jsonb,     -- umbrales/params del disparador
  action_template  jsonb not null,                          -- {kind, value, scope, weekdays, timeFrom/To, name}
  -- Alcance opcional del disparador (según el tipo). NULL = cuenta entera / se resuelve en el evaluador.
  brand_id         uuid references public.brand(id)      on delete cascade,
  location_id      uuid references public.locations(id)  on delete set null,
  menu_item_id     uuid references public.menu_item(id)  on delete set null,
  active           boolean not null default true,
  budget_max       numeric not null check (budget_max > 0),          -- OBLIGATORIO (límite del kill switch)
  cooldown_minutes integer not null default 1440 check (cooldown_minutes >= 0),
  max_active       integer not null default 1    check (max_active >= 1),
  duration_minutes integer not null default 240  check (duration_minutes > 0),
  last_fired_at    timestamptz,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists campaign_rule_account_idx on public.campaign_rule (account_id, active);

create table if not exists public.campaign_rule_firing (
  id               uuid primary key default gen_random_uuid(),
  rule_id          uuid not null references public.campaign_rule(id) on delete cascade,
  account_id       uuid not null references public.accounts(id)      on delete cascade,
  coupon_id        uuid references public.coupon(id) on delete set null,   -- la campaña encendida (origin='rule')
  fired_at         timestamptz not null default now(),
  reason           jsonb not null default '{}'::jsonb,   -- "por qué": {media, actual, caidaPct, ...}
  acknowledged_at  timestamptz,                          -- visibilidad: el humano lo vio
  acknowledged_by  uuid
);

create index if not exists campaign_rule_firing_account_idx on public.campaign_rule_firing (account_id, fired_at desc);
create index if not exists campaign_rule_firing_rule_idx    on public.campaign_rule_firing (rule_id, fired_at desc);

alter table public.campaign_rule        enable row level security;
alter table public.campaign_rule_firing enable row level security;

drop policy if exists campaign_rule_member on public.campaign_rule;
create policy campaign_rule_member on public.campaign_rule
  using (account_id = any(current_user_account_ids()))
  with check (account_id = any(current_user_account_ids()));

drop policy if exists campaign_rule_firing_member on public.campaign_rule_firing;
create policy campaign_rule_firing_member on public.campaign_rule_firing
  using (account_id = any(current_user_account_ids()))
  with check (account_id = any(current_user_account_ids()));

commit;
