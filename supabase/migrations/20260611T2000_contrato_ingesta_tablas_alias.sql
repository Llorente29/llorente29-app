-- ============================================================
-- Migración: 20260611T2000_contrato_ingesta_tablas_alias
-- Contrato único de ingesta de ventas multi-fuente — Paso 1 (§12)
-- Crea las dos tablas de alias del casado:
--   external_product_map : (source, external_product_id) -> menu_item  [casado de artículo por id estable]
--   external_brand_map   : (source, external_location_id, external_brand_id) -> brand  [atadura de marca por configuración]
-- RLS: réplica exacta del patrón de menu_item
--   lectura  = account_id = any(current_user_account_ids())
--   escritura = current_user_is_admin_of(account_id)
-- Diseño: docs/folvy_contrato_ingesta_diseno.md (11/06/2026)
-- Aplicada: 2026-06-11 (Folvy Interno, SQL Editor, Success)
-- ============================================================

-- 1) ALIAS DE PRODUCTO: (source, external_product_id) -> menu_item
create table public.external_product_map (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  source              text not null,                  -- 'lastapp' | 'otter' | 'glovo' | ...
  external_product_id text not null,                  -- id estable del producto en esa fuente
  external_brand_id   text,                           -- marca en esa fuente (validación, opcional)
  menu_item_id        uuid not null references public.menu_item(id) on delete cascade,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- clave de casado universal: una matrícula apunta a un solo plato por cuenta+fuente
  constraint external_product_map_uq unique (account_id, source, external_product_id)
);

create index external_product_map_menu_item_idx on public.external_product_map (menu_item_id);
create index external_product_map_account_source_idx on public.external_product_map (account_id, source);

alter table public.external_product_map enable row level security;

-- 2) ATADURA DE MARCA: (source, external_location_id, external_brand_id) -> brand
create table public.external_brand_map (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references public.accounts(id) on delete cascade,
  source               text not null,                 -- 'lastapp' | 'otter' | ...
  external_location_id text not null,                 -- location en esa fuente (la cocina física)
  external_brand_id    text not null,                 -- marca en esa fuente (el 'LAST BRAND')
  brand_id             uuid not null references public.brand(id) on delete cascade,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- una (location, marca) de una fuente resuelve a una sola marca de Folvy
  constraint external_brand_map_uq unique (account_id, source, external_location_id, external_brand_id)
);

create index external_brand_map_brand_idx on public.external_brand_map (brand_id);
create index external_brand_map_account_source_idx on public.external_brand_map (account_id, source);

alter table public.external_brand_map enable row level security;

-- 3) RLS — patrón menu_item
create policy external_product_map_read
  on public.external_product_map
  for select
  using (account_id = any (current_user_account_ids()));

create policy external_product_map_write
  on public.external_product_map
  for all
  using (current_user_is_admin_of(account_id))
  with check (current_user_is_admin_of(account_id));

create policy external_brand_map_read
  on public.external_brand_map
  for select
  using (account_id = any (current_user_account_ids()));

create policy external_brand_map_write
  on public.external_brand_map
  for all
  using (current_user_is_admin_of(account_id))
  with check (current_user_is_admin_of(account_id));
