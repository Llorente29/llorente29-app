-- Motor de ofertas de plataforma · Tramo 1: contrato de trabajos de push
-- Patrón print_job: el cerebro encola; QUIÉN empuja (worker de panel / API oficial) es intercambiable.
-- Aplicada en producción el 04/07/2026 (SQL Editor). Este fichero la versiona.

create table if not exists promo_push_job (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id),
  coupon_id uuid not null references coupon(id),
  platform text not null check (platform in ('glovo','ubereats')),
  brand_id uuid not null references brand(id),
  location_id uuid references locations(id),
  action text not null check (action in ('create','pause','resume','end')),
  status text not null default 'pending' check (status in ('pending','sent','done','error')),
  attempts int not null default 0,
  last_error text,
  external_ref text,          -- id de la campana en la plataforma cuando exista
  payload jsonb not null,     -- INMUTABLE: la orden completa que el ejecutor debe aplicar
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_promo_push_job_pending
  on promo_push_job (platform, status) where status in ('pending','error');

alter table promo_push_job enable row level security;

drop policy if exists promo_push_job_account on promo_push_job;
create policy promo_push_job_account on promo_push_job
  for all using (belongs_to_account(account_id))
  with check (belongs_to_account(account_id));
