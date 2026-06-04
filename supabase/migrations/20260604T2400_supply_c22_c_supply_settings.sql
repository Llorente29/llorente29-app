-- ============================================================================
-- Folvy Supply C2.2.c — ajustes de Supply por cuenta (avisos copiloto)
-- ============================================================================
-- supply_settings: UNA fila por cuenta (clon del patrón kitchen_settings).
-- Pensada para crecer: hoy umbral de salto de precio (%) y días de aviso de
-- caducidad; mañana caben más ajustes de Supply sin nueva tabla.
--   · price_alert_pct   default 15  — avisar si |Δ coste vs last_price| > este %.
--   · expiry_alert_days default 3   — avisar si caduca en <= estos días.
-- Los valores son DEFAULT de fábrica: funciona sin configurar nada; el cliente
-- los afina. (Umbral por familia/artículo = frente futuro.)
--
-- DDL idempotente, sin BEGIN/COMMIT. RLS clonada (belongs_to_account) en
-- select/insert/update. No ejecuta funciones SECURITY DEFINER.
-- ============================================================================

create table if not exists public.supply_settings (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null unique,
  price_alert_pct   numeric not null default 15,
  expiry_alert_days integer not null default 3,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid,
  created_by_name   text
);

create index if not exists idx_supply_settings_account on public.supply_settings(account_id);

alter table public.supply_settings enable row level security;

drop policy if exists supply_settings_select on public.supply_settings;
create policy supply_settings_select on public.supply_settings
  for select using (belongs_to_account(account_id));

drop policy if exists supply_settings_insert on public.supply_settings;
create policy supply_settings_insert on public.supply_settings
  for insert with check (belongs_to_account(account_id));

drop policy if exists supply_settings_update on public.supply_settings;
create policy supply_settings_update on public.supply_settings
  for update using (belongs_to_account(account_id));
