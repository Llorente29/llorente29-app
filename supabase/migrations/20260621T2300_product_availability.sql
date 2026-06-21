-- 20260621T2300_product_availability.sql
-- ============================================================================
-- DISPONIBILIDAD (86) POR LOCAL — paso 1: la tabla.
-- Una fila por (PRODUCTO FÍSICO × local) que esté AGOTADO. Sin fila = disponible
-- (defecto sano). El producto físico se identifica por matrícula (external_id)
-- y/o escandallo (recipe_item_id); la cascada cross-brand se deriva al leer/empujar.
--
-- Disponibilidad efectiva en un local =
--   menu_item.is_available (base de marca / Last)  AND  no hay fila agotada aquí.
--
-- 3 estados (de Otter): disponible (sin fila) · agotado hoy (available_until=fin de
-- día, pg_cron reactiva) · agotado indefinido (available_until=null).
--
-- Escrituras SOLO vía RPC set_product_availability (SECURITY DEFINER, paso 2);
-- por eso la RLS aquí es de solo LECTURA para managers/admins.
--
-- DDL pura, sin función DEFINER -> segura en el SQL Editor de una vez.
-- Aplicada: 2026-06-21
-- ============================================================================

create table if not exists public.product_availability (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null,

  -- identidad del PRODUCTO FÍSICO (no menu_item por marca):
  external_id     text,          -- matrícula (organizationProductId); bebidas/reventa compartida
  recipe_item_id  uuid,          -- escandallo compartido; platos sin matrícula uniforme

  location_id     uuid,          -- NULL = todos los locales (caso "descatalogar")

  -- estado (la fila SOLO existe si está agotado):
  is_available    boolean not null default false,
  reason          text not null default 'manual'
                  check (reason in ('manual','stock_out','schedule')),
  available_until timestamptz,   -- timer: "agotado hasta" (3 estados)

  -- rastro (seguridad / operativo):
  set_by          uuid,          -- user_profiles.id de quien lo agotó (sin FK dura, desacoplado)
  set_at          timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- una fila debe identificar el producto por al menos un eje
  constraint product_availability_identity_chk
    check (external_id is not null or recipe_item_id is not null)
);

-- Unicidad: una sola fila activa por (producto físico × local), por cada eje de identidad.
-- coalesce del local a ZERO_UUID para que NULL (=todos) cuente como una clave concreta.
create unique index if not exists uq_prod_avail_ext
  on public.product_availability
     (account_id, external_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where external_id is not null;

create unique index if not exists uq_prod_avail_rec
  on public.product_availability
     (account_id, recipe_item_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where recipe_item_id is not null;

-- Lectura del panel (Carta) filtra por cuenta + local.
create index if not exists ix_prod_avail_account_location
  on public.product_availability (account_id, location_id);

alter table public.product_availability enable row level security;

-- Solo LECTURA para managers/admins de la cuenta (las escrituras van por la RPC DEFINER).
drop policy if exists product_availability_read on public.product_availability;
create policy product_availability_read on public.product_availability
  for select using (
    public.current_user_is_admin()
    or public.current_user_is_admin_or_manager_of(account_id)
  );
