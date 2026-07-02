-- 20260702T1900_crm_coupons.sql
-- CRM F3 (sub-paso 1) — Motor de ofertas: schema de cupones del Shop.
--
-- Dos tablas nuevas + una columna de config por cuenta. Multi-tenant por
-- account_id. Pensado para durar (no solo bienvenida) y con seams para Ómnibus
-- (omnibus_ref_note en coupon, reference_subtotal en el log) sin lógica todavía.
--
-- NADA de esto aplica descuentos aún: eso lo hará place_shop_order en sub-pasos
-- siguientes. Este paso solo crea el modelo de datos.
--
-- DDL: aplicar tal cual en SQL Editor, sin BEGIN/COMMIT ni SELECT de prueba.

-- ─────────────────────────────────────────────────────────────────────
-- 1) coupon — definición de la oferta
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.coupon (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  code               text,                        -- NULL = automático sin código (bienvenida)
  name               text not null,               -- etiqueta interna ("Bienvenida 10%")
  discount_type      text not null check (discount_type in ('percent','fixed')),
  value              numeric not null check (value > 0),
  applies_to         text not null default 'subtotal'
                       check (applies_to in ('subtotal')),   -- hoy solo subtotal; lista para ampliar
  -- Condiciones
  min_subtotal       numeric check (min_subtotal is null or min_subtotal >= 0),
  first_order_only   boolean not null default false,
  auto_apply         boolean not null default false,         -- se aplica sin código si el pedido califica
  starts_at          timestamptz,
  ends_at            timestamptz,
  max_redemptions    integer check (max_redemptions is null or max_redemptions > 0),  -- tope total (NULL = ilimitado)
  max_per_customer   integer not null default 1 check (max_per_customer >= 1),         -- tope por cliente
  -- Estado
  active             boolean not null default true,
  -- Seam Ómnibus (futuro, sin lógica aún)
  omnibus_ref_note   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id),
  constraint coupon_percent_max        check (discount_type <> 'percent' or value <= 100),
  constraint coupon_auto_needs_no_code check (not auto_apply or code is null),
  constraint coupon_window             check (ends_at is null or starts_at is null or ends_at > starts_at)
);

-- Un código no se repite dentro de la cuenta (case-insensitive)
create unique index if not exists coupon_account_code_uq
  on public.coupon (account_id, lower(code)) where code is not null;
-- Un solo cupón AUTO activo por cuenta (la "bienvenida" es única)
create unique index if not exists coupon_account_one_auto
  on public.coupon (account_id) where auto_apply and active;
create index if not exists coupon_account_active_idx
  on public.coupon (account_id) where active;

-- ─────────────────────────────────────────────────────────────────────
-- 2) coupon_redemption — log de canje (límites + auditoría + seam Ómnibus)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.coupon_redemption (
  id                 uuid primary key default gen_random_uuid(),
  coupon_id          uuid not null references public.coupon(id) on delete cascade,
  account_id         uuid not null references public.accounts(id) on delete cascade,
  sale_id            uuid not null references public.sale(id) on delete cascade,
  customer_id        uuid references public.customer(id),
  customer_email     text,                                    -- snapshot para tope por cliente anónimo
  customer_phone     text,
  discount_amount    numeric not null,                        -- lo realmente aplicado
  reference_subtotal numeric not null,                        -- subtotal antes del descuento (Ómnibus/audit)
  margin_after       numeric,                                 -- margen del pedido tras cupón (NULL si coste incompleto)
  ts                 timestamptz not null default now()
);
create index if not exists coupon_redemption_coupon_idx   on public.coupon_redemption (coupon_id);
create index if not exists coupon_redemption_customer_idx on public.coupon_redemption (coupon_id, customer_id);
create index if not exists coupon_redemption_email_idx    on public.coupon_redemption (coupon_id, lower(customer_email));
-- Cierra la carrera de la bienvenida (max_per_customer=1): un cliente identificado
-- no puede canjear el mismo cupón dos veces. El 2º canje falla -> se degrada a
-- pedido sin descuento (lo maneja place_shop_order).
create unique index if not exists coupon_redemption_once_per_customer
  on public.coupon_redemption (coupon_id, customer_id) where customer_id is not null;

-- ─────────────────────────────────────────────────────────────────────
-- 3) Suelo de margen configurable por cuenta (NULL = sin suelo)
-- ─────────────────────────────────────────────────────────────────────
alter table public.accounts
  add column if not exists shop_coupon_margin_floor_pct numeric;

-- ─────────────────────────────────────────────────────────────────────
-- 4) RLS
--    coupon: miembros de la cuenta leen y gestionan.
--    coupon_redemption: miembros de la cuenta LEEN; la escritura la hace
--    place_shop_order (SECURITY DEFINER, bypassa RLS) -> sin policy de INSERT
--    para roles normales.
-- ─────────────────────────────────────────────────────────────────────
alter table public.coupon             enable row level security;
alter table public.coupon_redemption  enable row level security;

drop policy if exists coupon_member_all on public.coupon;
create policy coupon_member_all on public.coupon
  for all
  using (account_id in (select account_id from user_profiles where user_id = auth.uid()))
  with check (account_id in (select account_id from user_profiles where user_id = auth.uid()));

drop policy if exists coupon_redemption_member_read on public.coupon_redemption;
create policy coupon_redemption_member_read on public.coupon_redemption
  for select
  using (account_id in (select account_id from user_profiles where user_id = auth.uid()));
