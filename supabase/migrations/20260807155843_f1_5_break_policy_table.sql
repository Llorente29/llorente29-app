-- F1.5 (capa 1) · Política de descansos por CUENTA, anulable por LOCAL.
-- El descanso lo fija el convenio PROVINCIAL: Madrid 15 min retribuidos; Valencia 30 min de los que solo
-- 15 computan; estatal restauración 15 min como tiempo efectivo. Una cadena multiprovincia necesita
-- reglas distintas dentro de la misma cuenta -> location_id NULL = regla de cuenta, con valor = anulación.
create table if not exists public.break_policy (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  -- 'fichado' = el trabajador marca inicio/fin (verdad, defendible en Inspección)
  -- 'automatico' = se descuenta por tramo (cómodo, pero estimado)
  mode text not null default 'fichado' check (mode in ('fichado','automatico')),
  -- tramos del convenio, ordenados por umbral. paid_minutes = cuánto de ese descanso computa como trabajo.
  -- ej Valencia: [{"min_shift_minutes":360,"break_minutes":30,"paid_minutes":15,"label":"Comida"}]
  -- ej Madrid:   [{"min_shift_minutes":360,"break_minutes":15,"paid_minutes":15,"label":"Descanso"}]
  rules jsonb not null default '[]'::jsonb,
  -- topes de convenio (capa 2 los usará para avisos; se guardan ya para no migrar dos veces)
  max_continuous_minutes int,              -- Madrid: 300 (5 h seguidas sin pausa)
  split_min_gap_minutes int,               -- partida: mínimo entre tramos (Madrid 90, Valencia 60/120)
  split_max_gap_minutes int,               -- partida: máximo entre tramos (Valencia 240)
  min_rest_between_shifts_minutes int default 720,  -- 12 h entre jornadas (ET 34.3)
  max_daily_minutes int default 540,       -- 9 h ordinarias/día (ET)
  convenio_label text,                     -- p.ej. 'Hostelería Madrid 2023-2025'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- una sola política por cuenta y una por local
  constraint break_policy_unique_scope unique nulls not distinct (account_id, location_id)
);

comment on table public.break_policy is
  'F1.5 Politica de descansos. location_id NULL = regla general de la cuenta; con valor = anulacion de ese local (convenios provinciales distintos en la misma cadena).';
comment on column public.break_policy.rules is
  'Tramos [{min_shift_minutes, break_minutes, paid_minutes, label}]. paid_minutes = parte que computa como trabajo efectivo.';

create index if not exists idx_break_policy_account on public.break_policy(account_id);
create index if not exists idx_break_policy_location on public.break_policy(location_id) where location_id is not null;

alter table public.break_policy enable row level security;