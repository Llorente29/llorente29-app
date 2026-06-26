-- 20260626T1400_business_hours.sql
-- Aplicada: 2026-06-26 (SQL Editor)
-- HORARIO COMERCIAL transversal (Shop + HubRise + alarma disponibilidad).
-- Por (local, marca) con DEFECTO general del local (brand_id NULL = aplica a
-- todas las marcas del local sin horario propio). Tramos partidos (varias filas
-- por dia). Excepciones (festivos) pisan el habitual.

create table if not exists business_hours (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  brand_id uuid references brand(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  open_time time not null,
  close_time time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ix_business_hours_loc on business_hours(account_id, location_id, brand_id, weekday);

create table if not exists business_hours_exception (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  brand_id uuid references brand(id) on delete cascade,
  exception_date date not null,
  is_closed boolean not null default false,
  open_time time,
  close_time time,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists ix_business_hours_exc on business_hours_exception(account_id, location_id, brand_id, exception_date);

alter table business_hours enable row level security;
alter table business_hours_exception enable row level security;

drop policy if exists bh_read on business_hours;
create policy bh_read on business_hours for select using (true);

drop policy if exists bh_write on business_hours;
create policy bh_write on business_hours for all
  using (current_user_is_admin_or_manager_of(account_id))
  with check (current_user_is_admin_or_manager_of(account_id));

drop policy if exists bhe_read on business_hours_exception;
create policy bhe_read on business_hours_exception for select using (true);

drop policy if exists bhe_write on business_hours_exception;
create policy bhe_write on business_hours_exception for all
  using (current_user_is_admin_or_manager_of(account_id))
  with check (current_user_is_admin_or_manager_of(account_id));
