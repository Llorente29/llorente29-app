-- Valoraciones / comentarios de cliente por canal
create table if not exists public.channel_review (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  channel_id uuid,
  brand_id uuid,
  location_id uuid,
  external_brand_text text,
  order_code text,
  review_date date,
  stars numeric,
  tags text,
  comment text,
  item_name text,
  source text,
  import_key text not null,
  raw jsonb,
  created_at timestamptz default now()
);
create unique index if not exists channel_review_import_key on public.channel_review (account_id, import_key);
create index if not exists channel_review_brand on public.channel_review (account_id, brand_id);
alter table public.channel_review enable row level security;
drop policy if exists cr_read on public.channel_review;
drop policy if exists cr_write on public.channel_review;
create policy cr_read on public.channel_review for select using (account_id = any(current_user_account_ids()));
create policy cr_write on public.channel_review for all using (current_user_is_admin_of(account_id)) with check (current_user_is_admin_of(account_id));

-- Incidencias / errores de pedido por canal
create table if not exists public.channel_incident (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  channel_id uuid,
  brand_id uuid,
  location_id uuid,
  external_brand_text text,
  order_code text,
  incident_date date,
  incident_type text,
  detail text,
  item_name text,
  refund_total numeric,
  refund_own numeric,
  comment text,
  source text,
  import_key text not null,
  raw jsonb,
  created_at timestamptz default now()
);
create unique index if not exists channel_incident_import_key on public.channel_incident (account_id, import_key);
create index if not exists channel_incident_brand on public.channel_incident (account_id, brand_id);
alter table public.channel_incident enable row level security;
drop policy if exists ci_read on public.channel_incident;
drop policy if exists ci_write on public.channel_incident;
create policy ci_read on public.channel_incident for select using (account_id = any(current_user_account_ids()));
create policy ci_write on public.channel_incident for all using (current_user_is_admin_of(account_id)) with check (current_user_is_admin_of(account_id));

comment on table public.channel_review is 'Valoraciones y comentarios de cliente por canal (Uber/Glovo). Alimenta el area de Calidad.';
comment on table public.channel_incident is 'Incidencias/errores de pedido por canal (falta producto, frio, etc.) + reembolsos. Alimenta Calidad.';