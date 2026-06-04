-- ============================================================================
-- Folvy Inventario — Capa 1.1: MODELO DE DATOS del motor de conteo
-- ============================================================================
-- 4 tablas nuevas + tolerancias en supply_settings + función de código INV-.
-- Fundación del inventario perpetuo (de aquí cuelgan autoinventario N2 y auditoría N3).
-- DDL sin BEGIN/COMMIT. RLS belongs_to_account en todas.
-- ============================================================================

-- ── storage_area: el "hogar" de los artículos, por local ────────────────────
create table if not exists public.storage_area (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null,
  location_id uuid not null references public.locations(id),
  name        text not null,
  position    integer not null default 100,   -- orden físico de recorrido
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  created_by_name text
);
create index if not exists idx_storage_area_loc on public.storage_area(account_id, location_id, position);
alter table public.storage_area enable row level security;
drop policy if exists storage_area_all on public.storage_area;
create policy storage_area_all on public.storage_area
  for all using (belongs_to_account(account_id)) with check (belongs_to_account(account_id));

-- ── recipe_item_storage_area: asignación artículo↔área (N:M con orden) ───────
create table if not exists public.recipe_item_storage_area (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null,
  recipe_item_id  uuid not null references public.recipe_item(id) on delete cascade,
  storage_area_id uuid not null references public.storage_area(id) on delete cascade,
  position        integer not null default 100,  -- orden dentro del área
  created_at      timestamptz not null default now(),
  unique (recipe_item_id, storage_area_id)
);
create index if not exists idx_risa_area on public.recipe_item_storage_area(account_id, storage_area_id, position);
alter table public.recipe_item_storage_area enable row level security;
drop policy if exists risa_all on public.recipe_item_storage_area;
create policy risa_all on public.recipe_item_storage_area
  for all using (belongs_to_account(account_id)) with check (belongs_to_account(account_id));

-- ── inventory_count: la cabecera del conteo (la "hoja") ──────────────────────
create table if not exists public.inventory_count (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null,
  location_id     uuid not null references public.locations(id),
  code            text,
  kind            text not null default 'cycle'
                    check (kind in ('cycle','audit','full')),
  status          text not null default 'abierto'
                    check (status in ('abierto','contando','en_revision','aprobado','anulado')),
  blind           boolean not null default true,
  notes           text,
  started_at      timestamptz,
  started_by      uuid,
  started_by_name text,
  closed_at       timestamptz,
  approved_at     timestamptz,
  approved_by     uuid,
  approved_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  created_by_name text
);
create index if not exists idx_inv_count_acc on public.inventory_count(account_id, location_id, status);
alter table public.inventory_count enable row level security;
drop policy if exists inventory_count_all on public.inventory_count;
create policy inventory_count_all on public.inventory_count
  for all using (belongs_to_account(account_id)) with check (belongs_to_account(account_id));

-- ── inventory_count_line: una línea por artículo a contar ────────────────────
create table if not exists public.inventory_count_line (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null,
  inventory_count_id uuid not null references public.inventory_count(id) on delete cascade,
  recipe_item_id    uuid not null references public.recipe_item(id),
  storage_area_id   uuid references public.storage_area(id),
  position          integer not null default 100,
  system_qty        numeric,        -- snapshot del saldo al iniciar (blind: no se muestra)
  counted_qty       numeric,        -- nace NULL (blind): lo que cuenta el operario
  variance_qty      numeric,        -- counted − system
  variance_pct      numeric,
  variance_value    numeric,        -- efecto económico en € (variance_qty × avg_unit_cost)
  abc_class         text check (abc_class in ('A','B','C')),
  within_tolerance  boolean,
  reason_code       text check (reason_code in
                      ('merma','caducado','rotura','robo_desconocido',
                       'error_escandallo','error_recepcion','traspaso','otro')),
  recount_of        uuid references public.inventory_count_line(id),
  counted_by        uuid,
  counted_by_name   text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_inv_line_count on public.inventory_count_line(inventory_count_id, position);
alter table public.inventory_count_line enable row level security;
drop policy if exists inventory_count_line_all on public.inventory_count_line;
create policy inventory_count_line_all on public.inventory_count_line
  for all using (belongs_to_account(account_id)) with check (belongs_to_account(account_id));

-- ── Tolerancias por clase ABC en supply_settings ────────────────────────────
alter table public.supply_settings
  add column if not exists tol_a_pct numeric not null default 2,
  add column if not exists tol_b_pct numeric not null default 3,
  add column if not exists tol_c_pct numeric not null default 5;

-- ── Código correlativo INV- (patrón clonado de next_supplier_invoice_code) ──
create or replace function public.next_inventory_count_code(p_account_id uuid)
returns text
language plpgsql
as $$
DECLARE
  v_n integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('inventory_count_code:' || p_account_id::text));
  SELECT COALESCE(MAX((regexp_replace(code, '\D', '', 'g'))::integer), 0) + 1
    INTO v_n
    FROM public.inventory_count
    WHERE account_id = p_account_id
      AND code ~ '^INV-\d+$';
  RETURN 'INV-' || lpad(v_n::text, 5, '0');
END;
$$;

-- ── Trigger que asigna el código al insertar (patrón set_*_code) ─────────────
create or replace function public.set_inventory_count_code()
returns trigger
language plpgsql
as $$
BEGIN
  IF NEW.code IS NULL THEN
    NEW.code := public.next_inventory_count_code(NEW.account_id);
  END IF;
  RETURN NEW;
END;
$$;

drop trigger if exists trg_inventory_count_code on public.inventory_count;
create trigger trg_inventory_count_code
  before insert on public.inventory_count
  for each row execute function public.set_inventory_count_code();
