-- ============================================================================
-- FOLVY · Motor de envío · Capa 1: zonas de entrega por LOCAL.
--   Modelo Uber Eats Manager: radio + polígono + CP CONVIVEN; coste/mínimo/ETA
--   por zona. Resolución por PostGIS (ST_DWithin / ST_Contains). Solapamiento
--   se resuelve en el motor = tarifa más baja (no en esquema).
-- Aditivo, idempotente. RLS patrón cuenta. Requiere PostGIS (3.3.7).
-- Aplicada: 2026-06-25
-- ============================================================================

create table if not exists public.delivery_zone (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id)  on delete cascade,
  location_id   uuid not null references public.locations(id) on delete cascade,
  name          text not null,

  method        text not null check (method in ('radius','polygon','postal')),

  radius_m      integer,
  center        geography(Point, 4326),
  area          geography(Polygon, 4326),
  postal_codes  text[],

  delivery_fee  numeric not null default 0 check (delivery_fee >= 0),
  min_order     numeric check (min_order is null or min_order >= 0),
  eta_min       integer check (eta_min is null or eta_min >= 0),

  priority      integer not null default 0,
  is_active     boolean not null default true,
  fee_source    text not null default 'manual'
                  check (fee_source in ('manual','distance','broker','dynamic')),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint delivery_zone_geometry_chk check (
    (method = 'radius'  and radius_m is not null and radius_m > 0 and center is not null
                        and area is null and postal_codes is null)
    or
    (method = 'polygon' and area is not null
                        and radius_m is null and center is null and postal_codes is null)
    or
    (method = 'postal'  and postal_codes is not null and array_length(postal_codes, 1) > 0
                        and radius_m is null and center is null and area is null)
  )
);

comment on table public.delivery_zone is
  'Zonas de entrega por local (Capa 1 del motor de envío). Métodos radio/polígono/CP conviven; coste/mínimo/ETA por zona. Solapamiento lo resuelve el motor (tarifa más baja).';
comment on column public.delivery_zone.fee_source is
  'Origen de la tarifa: manual (hoy) | distance | broker (Capa 2) | dynamic (Capa 3).';

create index if not exists idx_delivery_zone_location
  on public.delivery_zone(location_id) where is_active;
create index if not exists idx_delivery_zone_center_gix
  on public.delivery_zone using gist (center) where method = 'radius';
create index if not exists idx_delivery_zone_area_gix
  on public.delivery_zone using gist (area) where method = 'polygon';

drop trigger if exists trg_delivery_zone_updated_at on public.delivery_zone;
create trigger trg_delivery_zone_updated_at
  before update on public.delivery_zone
  for each row execute function public.set_updated_at();

alter table public.delivery_zone enable row level security;

drop policy if exists delivery_zone_read on public.delivery_zone;
create policy delivery_zone_read on public.delivery_zone
  for select to authenticated
  using (account_id = any (public.current_user_account_ids()));

drop policy if exists delivery_zone_write on public.delivery_zone;
create policy delivery_zone_write on public.delivery_zone
  for all to authenticated
  using      (public.current_user_is_admin_of(account_id))
  with check (public.current_user_is_admin_of(account_id));
