-- TPV · Sala · S1 · parte A — zonas, mesas, umbral y motivos de anulación.
--
-- ENCARGO: «TPV · Sala», 08/10/2026. Separada de la parte B (20261009T0040…s1b…)
-- para poder montar la sala desde oficina HOY, sin esperar a la noche.
--
-- POR QUÉ PUEDE IR EN BANDA (las tres, medidas el 08/10 a las 13:06 Madrid):
--   1. No está en el camino del pedido: son cuatro tablas NUEVAS. Ninguna
--      función, cron ni disparador las nombra (no existían). Lo único que hace
--      con lo vivo es apuntar claves ajenas a `accounts` y `locations`.
--   2. No toma cierre exclusivo sobre una tabla del pedido. Crear una clave
--      ajena toma SHARE ROW EXCLUSIVE sobre `accounts` y `locations`: no
--      bloquea lecturas, solo escrituras. Medido: 0 funciones escriben en
--      `locations`, 0 crons la nombran. NO toca `sale` ni `sale_line`.
--   3. Dicho antes de aplicar, con la medida delante (este bloque).
--
-- Lo que toca `sale`, `sale_line`, `order_for_print` y el disparador de
-- impresión va en la parte B, fuera de banda.

-- ══ 1. Tablas ═══════════════════════════════════════════════════════════

create table if not exists public.dining_zone (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  kind        text not null default 'sala'
              check (kind in ('sala', 'terraza', 'barra', 'reservado')),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists dining_zone_location_name_uq
  on public.dining_zone (location_id, lower(btrim(name))) where is_active;
create index if not exists dining_zone_location_idx on public.dining_zone (location_id, sort_order);

create table if not exists public.dining_table (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  zone_id     uuid not null references public.dining_zone(id) on delete restrict,
  name        text not null check (btrim(name) <> ''),
  seats       integer not null default 4 check (seats between 1 and 99),
  -- Rejilla ordenada, no plano dibujado: posición = orden; ancho = cuántas
  -- columnas ocupa (una mesa larga de 8 ocupa 2).
  sort_order  integer not null default 0,
  grid_width  integer not null default 1 check (grid_width between 1 and 4),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- El nombre de una mesa es único en el LOCAL, no en la zona: «la 4» tiene que
-- ser una sola cuando un camarero la nombra.
create unique index if not exists dining_table_location_name_uq
  on public.dining_table (location_id, lower(btrim(name))) where is_active;
create index if not exists dining_table_zone_idx on public.dining_table (zone_id, sort_order);

create table if not exists public.dining_config (
  location_id        uuid primary key references public.locations(id) on delete cascade,
  account_id         uuid not null references public.accounts(id) on delete cascade,
  -- A partir de cuántos minutos abierta el tiempo de la mesa pasa a ámbar.
  table_warn_minutes integer not null default 90 check (table_warn_minutes between 5 and 600),
  updated_at         timestamptz not null default now()
);

create table if not exists public.void_reason (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  label      text not null check (btrim(label) <> ''),
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists void_reason_account_label_uq
  on public.void_reason (account_id, lower(btrim(label))) where is_active;

-- ══ 2. RLS ═══════════════════════════════════════════════════════════════
-- Lectura: cualquiera de la cuenta. Escritura: admin o encargado.

alter table public.dining_zone    enable row level security;
alter table public.dining_table   enable row level security;
alter table public.dining_config  enable row level security;
alter table public.void_reason    enable row level security;

drop policy if exists dining_zone_select on public.dining_zone;
create policy dining_zone_select on public.dining_zone for select using (belongs_to_account(account_id));
drop policy if exists dining_zone_write on public.dining_zone;
create policy dining_zone_write on public.dining_zone for all
  using (current_user_is_admin_or_manager_of(account_id))
  with check (current_user_is_admin_or_manager_of(account_id));

drop policy if exists dining_table_select on public.dining_table;
create policy dining_table_select on public.dining_table for select using (belongs_to_account(account_id));
drop policy if exists dining_table_write on public.dining_table;
create policy dining_table_write on public.dining_table for all
  using (current_user_is_admin_or_manager_of(account_id))
  with check (current_user_is_admin_or_manager_of(account_id));

drop policy if exists dining_config_select on public.dining_config;
create policy dining_config_select on public.dining_config for select using (belongs_to_account(account_id));
drop policy if exists dining_config_write on public.dining_config;
create policy dining_config_write on public.dining_config for all
  using (current_user_is_admin_or_manager_of(account_id))
  with check (current_user_is_admin_or_manager_of(account_id));

drop policy if exists void_reason_select on public.void_reason;
create policy void_reason_select on public.void_reason for select using (belongs_to_account(account_id));
drop policy if exists void_reason_write on public.void_reason;
create policy void_reason_write on public.void_reason for all
  using (current_user_is_admin_or_manager_of(account_id))
  with check (current_user_is_admin_or_manager_of(account_id));

-- La guarda de mesas: la zona y la mesa son del mismo local y cuenta.
create or replace function public.tg_dining_table_same_location()
returns trigger language plpgsql set search_path = public as $$
declare v_z dining_zone;
begin
  select * into v_z from dining_zone where id = new.zone_id;
  if v_z.id is null or v_z.location_id <> new.location_id or v_z.account_id <> new.account_id then
    raise exception 'La zona no es de este local.';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_dining_table_same_location on public.dining_table;
create trigger trg_dining_table_same_location before insert or update on public.dining_table
  for each row execute function public.tg_dining_table_same_location();

drop trigger if exists set_dining_zone_updated_at on public.dining_zone;
create trigger set_dining_zone_updated_at before update on public.dining_zone
  for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
