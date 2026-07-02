-- 20260702T1200_crm_customer_consent.sql
-- CRM Pata 2 (Paso 1a) — Identidad + consentimiento del cliente.
--
-- Crea la base del cliente real de Folvy: entidad customer (agnóstica al canal,
-- aislada por cuenta), su estado de consentimiento vigente, y el log inmutable
-- de consentimiento (prueba legal RGPD). Enlaza sale -> customer.
--
-- REGLA DE HIERRO: el cliente CONTACTABLE solo nace del consentimiento. Un
-- customer puede existir sin permiso de marketing (ficha), pero customer_consent
-- marca canal por canal si se puede contactar. Los datos de plataforma
-- (Glovo/Uber) NUNCA rellenan customer (sale.customer_id queda NULL).
--
-- DDL puro: aplicar tal cual, sin BEGIN/COMMIT y sin SELECT de prueba.
-- Multi-tenant: RLS por account_id (patrón calcado del resto de tablas de cuenta).

-- ─────────────────────────────────────────────────────────────────────
-- 1) customer — fuente de verdad del cliente (una ficha por persona/cuenta)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.customer (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  phone             text,
  email             text,
  name              text,
  first_brand_id    uuid,
  first_location_id uuid,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Al menos un identificador de contacto.
  constraint customer_has_contact check (phone is not null or email is not null)
);

-- Dedup: un teléfono / email es único DENTRO de la cuenta (parcial, ignora NULL).
create unique index if not exists customer_account_phone_uq
  on public.customer (account_id, phone) where phone is not null;
create unique index if not exists customer_account_email_uq
  on public.customer (account_id, lower(email)) where email is not null;
create index if not exists customer_account_idx on public.customer (account_id);

-- ─────────────────────────────────────────────────────────────────────
-- 2) customer_consent — estado vigente de permisos (granular por canal)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.customer_consent (
  customer_id         uuid primary key references public.customer(id) on delete cascade,
  account_id          uuid not null references public.accounts(id) on delete cascade,
  marketing_email     boolean not null default false,
  marketing_sms       boolean not null default false,
  marketing_whatsapp  boolean not null default false,
  updated_at          timestamptz not null default now()
);
create index if not exists customer_consent_account_idx on public.customer_consent (account_id);

-- ─────────────────────────────────────────────────────────────────────
-- 3) customer_consent_log — prueba legal INMUTABLE (append-only)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.customer_consent_log (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references public.customer(id) on delete cascade,
  account_id     uuid not null references public.accounts(id) on delete cascade,
  action         text not null check (action in ('granted','revoked')),
  channel        text not null check (channel in ('email','sms','whatsapp','all')),
  source         text not null,           -- shop | qr_bag | web | mesa | wifi
  terms_version  text,                    -- p.ej. 'shop-privacy-v1'
  ts             timestamptz not null default now(),
  ip             text,
  user_agent     text
);
create index if not exists customer_consent_log_customer_idx on public.customer_consent_log (customer_id, ts desc);
create index if not exists customer_consent_log_account_idx on public.customer_consent_log (account_id);

-- ─────────────────────────────────────────────────────────────────────
-- 4) Enlace sale -> customer (NULL para pedidos de plataforma)
-- ─────────────────────────────────────────────────────────────────────
alter table public.sale add column if not exists customer_id uuid references public.customer(id);
create index if not exists sale_customer_idx on public.sale (customer_id) where customer_id is not null;

-- ─────────────────────────────────────────────────────────────────────
-- 5) RLS — solo miembros de la cuenta ven a sus clientes
-- ─────────────────────────────────────────────────────────────────────
alter table public.customer enable row level security;
alter table public.customer_consent enable row level security;
alter table public.customer_consent_log enable row level security;

-- Lectura/gestión por miembros de la cuenta. account_members es la tabla de
-- pertenencia usada por el resto de políticas del proyecto.
drop policy if exists customer_rw on public.customer;
create policy customer_rw on public.customer
  for all to authenticated
  using  (account_id in (select account_id from public.user_profiles where user_id = auth.uid()))
  with check (account_id in (select account_id from public.user_profiles where user_id = auth.uid()));

drop policy if exists customer_consent_rw on public.customer_consent;
create policy customer_consent_rw on public.customer_consent
  for all to authenticated
  using  (account_id in (select account_id from public.user_profiles where user_id = auth.uid()))
  with check (account_id in (select account_id from public.user_profiles where user_id = auth.uid()));

-- El log es solo-lectura para la app (lo escribe place_shop_order vía SECURITY
-- DEFINER). Los miembros pueden LEERLO; nadie lo edita/borra desde la app.
drop policy if exists customer_consent_log_ro on public.customer_consent_log;
create policy customer_consent_log_ro on public.customer_consent_log
  for select to authenticated
  using (account_id in (select account_id from public.user_profiles where user_id = auth.uid()));
