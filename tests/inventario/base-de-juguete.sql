-- tests/inventario/base-de-juguete.sql · Base de juguete para autoconteo-noche.sh: las tablas de conteo con las columnas de producción del 21/10 y stubs de lo que la 0400 no toca.
do $$ declare r text; begin
  foreach r in array array['anon','authenticated','service_role','conta_lectura'] loop
    if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I', r); end if;
  end loop;
end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid $$;

create table public.accounts (id uuid primary key, name text);
create table public.locations (id uuid primary key, account_id uuid, name text);
create table public.platform_admins (user_id uuid, active boolean);
create table public.user_profiles (id uuid default gen_random_uuid(), user_id uuid, employee_id uuid, role text, active boolean default true, display_name text, account_id uuid);
create table public.supply_settings (account_id uuid primary key, tol_a_pct numeric, tol_b_pct numeric, tol_c_pct numeric, require_separate_approval boolean);
create table public.recipe_item (id uuid primary key, account_id uuid, name text);
create table public.inventory_count (
  id uuid primary key default gen_random_uuid(), account_id uuid not null, location_id uuid not null, code text,
  kind text not null check (kind in ('cycle','audit','full')),
  status text not null check (status in ('abierto','contando','en_revision','aprobado','anulado')),
  blind boolean not null default true, notes text, started_at timestamptz, started_by uuid, started_by_name text,
  closed_at timestamptz, approved_at timestamptz, approved_by uuid, approved_by_name text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, created_by_name text, is_opening boolean not null default false, assigned_employee_id uuid,
  assigned_at timestamptz, assigned_by uuid, scope_area_ids uuid[], scheduled_for date, is_opening_manual boolean not null default false);
create table public.inventory_count_line (
  id uuid primary key default gen_random_uuid(), account_id uuid not null, inventory_count_id uuid not null, recipe_item_id uuid not null,
  storage_area_id uuid, position int not null default 0, system_qty numeric, counted_qty numeric, variance_qty numeric,
  variance_pct numeric, variance_value numeric, abc_class text, within_tolerance boolean, reason_code text, recount_of uuid,
  counted_by uuid, counted_by_name text, created_at timestamptz not null default now(), assigned_to uuid, counted_at timestamptz,
  counted_qty_confirmed numeric, counted_qty_confirmed_at timestamptz, needs_review boolean not null default false, reason_note text,
  recount_asked_at timestamptz, recount_requested_at timestamptz, recount_requested_by uuid, recount_assign_to uuid,
  no_reference boolean not null default false, reason_by uuid, reason_by_name text, excluded_at timestamptz, excluded_by uuid,
  excluded_by_name text, excluded_reason text);
create table public.stock_movement (
  id uuid primary key default gen_random_uuid(), account_id uuid, location_id uuid, recipe_item_id uuid, movement_type text,
  qty_base numeric, unit_cost numeric, cost_provisional boolean, source_type text, source_id uuid, occurred_at timestamptz,
  created_by uuid, created_by_name text, notes text);
create table public.recipe_item_location_stock (account_id uuid, location_id uuid, recipe_item_id uuid, qty_on_hand numeric, avg_unit_cost numeric,
  primary key (recipe_item_id, location_id));
create table public.system_alert_queue (id bigserial, kind text, subject text, message text, debounce_kind text, created_at timestamptz default now());

create function public.current_user_is_admin() returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid() and active) $$;
create function public.current_user_account_ids() returns uuid[] language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(account_id), '{}') from public.user_profiles where user_id = auth.uid() and active and account_id is not null $$;
create function public.belongs_to_account(p_account_id uuid) returns boolean language sql stable security definer set search_path to 'public' as $$
  select p_account_id = any(public.current_user_account_ids()) or public.current_user_is_admin() $$;
create function public.current_user_is_admin_or_manager_of(p uuid) returns boolean language sql stable as $$
  select exists (select 1 from public.user_profiles where user_id = auth.uid() and account_id = p and role in ('admin','manager')) $$;
create function public.can_operate_manual_count(p uuid) returns boolean language sql stable as $$ select true $$;
create function public.rebase_count_system_qty(p uuid) returns void language sql as $$ select $$;
create function public.recompute_location_stock(p_item uuid, p_loc uuid) returns void language sql as $$
  update public.recipe_item_location_stock s set qty_on_hand = (select coalesce(sum(qty_base),0) from public.stock_movement m
    where m.recipe_item_id = p_item and m.location_id = p_loc) where s.recipe_item_id = p_item and s.location_id = p_loc $$;
-- Stub: pide motivo lo marcado needs_review o con un 25 % o más de diferencia.
create function public.count_lines_requiring_reason(p_count_id uuid) returns table(line_id uuid, item_name text, reasons text[]) language sql stable as $$
  select l.id, ri.name, array['desviacion'] from public.inventory_count_line l join public.recipe_item ri on ri.id = l.recipe_item_id
   where l.inventory_count_id = p_count_id and l.counted_qty is not null and l.excluded_at is null
     and (l.needs_review or abs(coalesce(l.variance_pct,0)) >= 25) $$;
create function public._queue_system_alert(p_kind text, p_subject text, p_message text, p_debounce_kind text default null, p_debounce_window interval default '20:00:00')
returns void language sql security definer set search_path to 'public' as $$
  insert into public.system_alert_queue (kind, subject, message, debounce_kind) values (p_kind, p_subject, p_message, p_debounce_kind) $$;
