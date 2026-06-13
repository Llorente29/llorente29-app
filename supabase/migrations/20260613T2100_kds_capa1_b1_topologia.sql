-- supabase/migrations/20260613T2100_kds_capa1_b1_topologia.sql
-- ============================================================================
-- CAPA 1 del KDS · BLOQUE 1 — TOPOLOGÍA DE COCINA
-- ============================================================================
-- Estaciones (prep/expo), ruteo por familia de plato (recipe_family) y override
-- por artículo. Cada local nace con 2 estaciones (Elaboración + Pase). Trigger
-- para locales futuros. RLS idéntica al patrón de kitchen_unit:
--   SELECT  -> account_id IS NULL OR belongs_to_account(account_id)
--   IUD     -> current_user_is_admin_or_manager_of(account_id)
--
-- Ruteo: una línea de pedido -> su plato (recipe_item) -> familia (recipe_family)
--   -> estación, vía kitchen_family_route. Override por recipe_item.kds_station_id.
--   Fallback: la estación prep por defecto del local.
-- DDL sin BEGIN/COMMIT (regla SQL Editor). Idempotente.
-- ============================================================================

-- 1) ESTACIONES ---------------------------------------------------------------
create table if not exists kitchen_station (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  location_id   uuid not null references locations(id) on delete cascade,
  name          text not null,
  kind          text not null default 'prep',     -- 'prep' | 'expo'
  display_order int  not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint kitchen_station_kind_valid check (kind in ('prep', 'expo'))
);
create index if not exists kitchen_station_loc_idx on kitchen_station (account_id, location_id, is_active);

alter table kitchen_station enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='kitchen_station' and policyname='kitchen_station_select') then
    create policy kitchen_station_select on kitchen_station for select
      using (belongs_to_account(account_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='kitchen_station' and policyname='kitchen_station_insert') then
    create policy kitchen_station_insert on kitchen_station for insert
      with check (current_user_is_admin_or_manager_of(account_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='kitchen_station' and policyname='kitchen_station_update') then
    create policy kitchen_station_update on kitchen_station for update
      using (current_user_is_admin_or_manager_of(account_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='kitchen_station' and policyname='kitchen_station_delete') then
    create policy kitchen_station_delete on kitchen_station for delete
      using (current_user_is_admin_or_manager_of(account_id));
  end if;
end $$;

-- 2) RUTEO familia -> estación ------------------------------------------------
create table if not exists kitchen_family_route (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  family_id   uuid not null references recipe_family(id) on delete cascade,
  station_id  uuid not null references kitchen_station(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint kitchen_family_route_uniq unique (account_id, family_id)
);
create index if not exists kitchen_family_route_idx on kitchen_family_route (account_id, family_id);

alter table kitchen_family_route enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='kitchen_family_route' and policyname='kitchen_family_route_select') then
    create policy kitchen_family_route_select on kitchen_family_route for select
      using (belongs_to_account(account_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='kitchen_family_route' and policyname='kitchen_family_route_insert') then
    create policy kitchen_family_route_insert on kitchen_family_route for insert
      with check (current_user_is_admin_or_manager_of(account_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='kitchen_family_route' and policyname='kitchen_family_route_update') then
    create policy kitchen_family_route_update on kitchen_family_route for update
      using (current_user_is_admin_or_manager_of(account_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='kitchen_family_route' and policyname='kitchen_family_route_delete') then
    create policy kitchen_family_route_delete on kitchen_family_route for delete
      using (current_user_is_admin_or_manager_of(account_id));
  end if;
end $$;

-- 3) OVERRIDE por artículo ----------------------------------------------------
alter table recipe_item add column if not exists kds_station_id uuid references kitchen_station(id) on delete set null;
create index if not exists recipe_item_kds_station_idx on recipe_item (kds_station_id) where kds_station_id is not null;

-- 4) SEMILLA: 2 estaciones por local existente (Elaboración prep + Pase expo) --
--    Solo para locales que aún no tengan estaciones (idempotente).
insert into kitchen_station (account_id, location_id, name, kind, display_order)
select l.account_id, l.id, 'Elaboración', 'prep', 0
from locations l
where not exists (select 1 from kitchen_station s where s.location_id = l.id);

insert into kitchen_station (account_id, location_id, name, kind, display_order)
select l.account_id, l.id, 'Pase', 'expo', 1
from locations l
where not exists (select 1 from kitchen_station s where s.location_id = l.id and s.kind = 'expo');

-- 5) TRIGGER: locales futuros nacen con sus 2 estaciones ----------------------
create or replace function public.seed_kitchen_stations_for_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into kitchen_station (account_id, location_id, name, kind, display_order)
  values (new.account_id, new.id, 'Elaboración', 'prep', 0),
         (new.account_id, new.id, 'Pase', 'expo', 1);
  return new;
end;
$$;

drop trigger if exists trg_seed_kitchen_stations on locations;
create trigger trg_seed_kitchen_stations
  after insert on locations
  for each row execute function public.seed_kitchen_stations_for_location();
