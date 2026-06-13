-- supabase/migrations/20260613T2200_kds_capa1_b2_estado.sql
-- ============================================================================
-- CAPA 1 del KDS · BLOQUE 2 — ESTADO OPERATIVO
-- ============================================================================
--   kds_ticket_station_state : bump por estación (pedido × estación)
--   kds_line_state           : marcado por plato (sombreado/tachado), reversible
--   kds_device               : tablet/pantalla (token revocable, local + estaciones)
--
-- RLS: SELECT por sesión (belongs_to_account); IUD por admin/manager. El acceso
-- SIN login del kiosco NO se abre en RLS: lo valida la RPC kds_board (Bloque 3,
-- SECURITY DEFINER) contra el token del dispositivo. Autorización en la frontera.
--
-- DDL sin BEGIN/COMMIT. Idempotente. (Las verificaciones del KDS SIEMPRE filtran
-- por account_id: Llorente29 y Folvy Interno comparten nombres de local.)
-- ============================================================================

-- 1) ESTADO POR ESTACIÓN (bump) -----------------------------------------------
-- Estable ante el re-sync de líneas (no depende de sale_line.id). El "pedido" es
-- la venta canónica (sale). status: pending -> done. Único por (sale, estación).
create table if not exists kds_ticket_station_state (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id) on delete cascade,
  sale_id     uuid not null references sale(id) on delete cascade,
  station_id  uuid not null references kitchen_station(id) on delete cascade,
  status      text not null default 'pending',     -- 'pending' | 'done'
  updated_at  timestamptz not null default now(),
  constraint kds_tss_status_valid check (status in ('pending', 'done')),
  constraint kds_tss_uniq unique (sale_id, station_id)
);
create index if not exists kds_tss_sale_idx on kds_ticket_station_state (sale_id);
create index if not exists kds_tss_station_idx on kds_ticket_station_state (account_id, station_id, status);

alter table kds_ticket_station_state enable row level security;

-- 2) MARCADO POR PLATO (reversible) -------------------------------------------
-- Sombreado/tachado por línea de pedido. Por sale_line (estable en delivery; ver
-- nota de sala en el diseño). marked + marked_at; reversible (toggle).
create table if not exists kds_line_state (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  sale_line_id  uuid not null references sale_line(id) on delete cascade,
  marked        boolean not null default false,
  marked_at     timestamptz,
  updated_at    timestamptz not null default now(),
  constraint kds_line_state_uniq unique (sale_line_id)
);
create index if not exists kds_line_state_idx on kds_line_state (account_id, sale_line_id);

alter table kds_line_state enable row level security;

-- 3) DISPOSITIVO / TABLET -----------------------------------------------------
-- Cada tablet = un dispositivo ligado a UN local + las estaciones que muestra.
-- token: secreto largo, revocable (is_active=false), para el modo kiosco.
-- station_ids: estaciones que esta pantalla enseña (NULL = todas las del local).
create table if not exists kds_device (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references accounts(id) on delete cascade,
  location_id  uuid not null references locations(id) on delete cascade,
  label        text not null,
  token        text not null unique,
  station_ids  uuid[],                                -- NULL = todas las del local
  is_active    boolean not null default true,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists kds_device_loc_idx on kds_device (account_id, location_id, is_active);
create index if not exists kds_device_token_idx on kds_device (token) where is_active;

alter table kds_device enable row level security;

-- 4) RLS (patrón confirmado en kitchen_unit) ----------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['kds_ticket_station_state','kds_line_state','kds_device']
  loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_select') then
      execute format('create policy %I on %I for select using (belongs_to_account(account_id))', t||'_select', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_insert') then
      execute format('create policy %I on %I for insert with check (current_user_is_admin_or_manager_of(account_id))', t||'_insert', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_update') then
      execute format('create policy %I on %I for update using (current_user_is_admin_or_manager_of(account_id))', t||'_update', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_delete') then
      execute format('create policy %I on %I for delete using (current_user_is_admin_or_manager_of(account_id))', t||'_delete', t);
    end if;
  end loop;
end $$;
