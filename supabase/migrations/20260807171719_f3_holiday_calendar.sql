-- F3 · Calendario laboral de festivos. En Espana hay 3 niveles: nacional, autonomico y local (municipio).
-- El festivo aplica a un local segun su municipio/CCAA. Por eso scope + un ambito opcional (ccaa/municipio),
-- y ademas festivos propios de un local (cierre de empresa). El balance/nomina valoran el festivo trabajado.
create table if not exists public.holiday_calendar (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,  -- NULL = festivo oficial compartido
  location_id uuid references public.locations(id) on delete cascade, -- con valor = festivo propio de un local
  holiday_date date not null,
  name text not null,
  scope text not null default 'nacional' check (scope in ('nacional','autonomico','local','empresa')),
  region_code text,           -- p.ej. 'MAD' (CCAA) o codigo INE de municipio, segun scope
  is_paid boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.holiday_calendar is
  'F3 Festivos. account_id NULL = catalogo oficial compartido; con account/location = festivo propio (empresa).';
comment on column public.holiday_calendar.scope is
  'nacional | autonomico | local (municipio) | empresa (cierre propio del local).';

create index if not exists idx_holiday_date on public.holiday_calendar(holiday_date);
create index if not exists idx_holiday_account on public.holiday_calendar(account_id) where account_id is not null;
create unique index if not exists uq_holiday_official
  on public.holiday_calendar(holiday_date, scope, coalesce(region_code,''))
  where account_id is null;

alter table public.holiday_calendar enable row level security;

-- Lectura: los oficiales (account NULL) los ve cualquiera autenticado; los propios, solo su cuenta.
drop policy if exists holiday_select on public.holiday_calendar;
create policy holiday_select on public.holiday_calendar
  for select to authenticated
  using (account_id is null or account_id = any(current_user_account_ids()));
-- Escritura de festivos PROPIOS: solo admin de la cuenta. Los oficiales se siembran por migracion/service_role.
drop policy if exists holiday_write on public.holiday_calendar;
create policy holiday_write on public.holiday_calendar
  for all to authenticated
  using (account_id is not null and current_user_is_admin_of(account_id))
  with check (account_id is not null and current_user_is_admin_of(account_id));

revoke all on public.holiday_calendar from anon, public;
grant select, insert, update, delete on public.holiday_calendar to authenticated;
grant all on public.holiday_calendar to service_role;