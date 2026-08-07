-- Aplicada 2026-08-07. Verificado: RLS on, anon sin acceso.
-- F3 · Calendario laboral de festivos. 3 niveles ES: nacional, autonomico, local (municipio) + empresa
-- (cierre propio del local). account_id NULL = catalogo oficial compartido; con account/location = propio.
create table if not exists public.holiday_calendar (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  holiday_date date not null,
  name text not null,
  scope text not null default 'nacional' check (scope in ('nacional','autonomico','local','empresa')),
  region_code text,
  is_paid boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.holiday_calendar is
  'F3 Festivos. account_id NULL = catalogo oficial compartido; con account/location = festivo propio (empresa).';
create index if not exists idx_holiday_date on public.holiday_calendar(holiday_date);
create index if not exists idx_holiday_account on public.holiday_calendar(account_id) where account_id is not null;
create unique index if not exists uq_holiday_official
  on public.holiday_calendar(holiday_date, scope, coalesce(region_code,'')) where account_id is null;
alter table public.holiday_calendar enable row level security;
drop policy if exists holiday_select on public.holiday_calendar;
create policy holiday_select on public.holiday_calendar
  for select to authenticated
  using (account_id is null or account_id = any(current_user_account_ids()));
drop policy if exists holiday_write on public.holiday_calendar;
create policy holiday_write on public.holiday_calendar
  for all to authenticated
  using (account_id is not null and current_user_is_admin_of(account_id))
  with check (account_id is not null and current_user_is_admin_of(account_id));
revoke all on public.holiday_calendar from anon, public;
grant select, insert, update, delete on public.holiday_calendar to authenticated;
grant all on public.holiday_calendar to service_role;
