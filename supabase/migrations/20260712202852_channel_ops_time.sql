create table if not exists public.channel_ops_time (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  channel_id uuid,
  brand_id uuid,
  location_id uuid,
  period_month text,
  n_orders int,
  prep_avg numeric,
  delivery_avg numeric,
  total_avg numeric,
  wait_rest_avg numeric,
  wait_avoidable_avg numeric,
  wait_avoidable_total_min numeric,
  completion_pct numeric,
  source text,
  import_key text not null,
  created_at timestamptz default now()
);
create unique index if not exists channel_ops_time_import_key on public.channel_ops_time (account_id, import_key);
alter table public.channel_ops_time enable row level security;
drop policy if exists cot_read on public.channel_ops_time;
drop policy if exists cot_write on public.channel_ops_time;
create policy cot_read on public.channel_ops_time for select using (account_id = any(current_user_account_ids()));
create policy cot_write on public.channel_ops_time for all using (current_user_is_admin_of(account_id)) with check (current_user_is_admin_of(account_id));
comment on table public.channel_ops_time is 'Tiempos operativos por canal/marca/mes (prep, entrega, espera evitable del rider). Alimenta Calidad.';