-- Aplicada 2026-08-07 por MCP. Verificado: RLS on, 2 politicas, anon sin acceso.
-- F1.5 · Politica de descansos por CUENTA, anulable por LOCAL.
-- El descanso lo fija el convenio PROVINCIAL: Madrid 15 min retribuidos; Valencia 30 min de los que solo
-- 15 computan; estatal restauracion 15 min como tiempo efectivo. Una cadena multiprovincia necesita
-- reglas distintas dentro de la misma cuenta -> location_id NULL = regla de cuenta, con valor = anulacion.
create table if not exists public.break_policy (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  mode text not null default 'fichado' check (mode in ('fichado','automatico')),
  rules jsonb not null default '[]'::jsonb,
  max_continuous_minutes int,
  split_min_gap_minutes int,
  split_max_gap_minutes int,
  min_rest_between_shifts_minutes int default 720,
  max_daily_minutes int default 540,
  convenio_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint break_policy_unique_scope unique nulls not distinct (account_id, location_id)
);
comment on table public.break_policy is
  'F1.5 Politica de descansos. location_id NULL = regla general de la cuenta; con valor = anulacion de ese local.';
comment on column public.break_policy.rules is
  'Tramos [{min_shift_minutes, break_minutes, paid_minutes, label}]. paid_minutes = parte que computa como trabajo efectivo.';
create index if not exists idx_break_policy_account on public.break_policy(account_id);
create index if not exists idx_break_policy_location on public.break_policy(location_id) where location_id is not null;
alter table public.break_policy enable row level security;
