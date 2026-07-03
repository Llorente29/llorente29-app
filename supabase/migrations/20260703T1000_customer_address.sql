-- 20260703T1000_customer_address.sql
-- Aplicada: (pendiente)
--
-- F4·T1 — "Mi cuenta" del Folvy Shop (núcleo). Direcciones guardadas del comensal.
--
-- El comensal registrado (customer, NO auth.users) puede guardar varias direcciones
-- de entrega y marcar una por defecto. La tabla vive por cuenta (como customer) y
-- se lee/escribe SOLO por el propio comensal vía RPCs SECURITY DEFINER que validan
-- su token de sesión (patrón customer_session_me). Los miembros de la cuenta (CRM)
-- pueden LEERLA por RLS; la escritura es exclusiva de las RPCs (sin policy de
-- escritura → solo SECURITY DEFINER puede insertar/actualizar/borrar).
--
-- Índice único parcial: un solo is_default=true por customer.
--
-- Sin dependencias de pgcrypto/extensions: search_path 'public' basta en las RPCs
-- (migración siguiente). Esta migración solo crea tabla + índices + RLS de lectura.

begin;

create table if not exists public.customer_address (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customer(id)  on delete cascade,
  account_id  uuid not null references public.accounts(id)  on delete cascade,
  label       text,
  address     text not null,
  detail      text,
  lat         numeric,
  lng         numeric,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Búsquedas por cliente (lista de "Mis datos") y por cuenta (CRM).
create index if not exists customer_address_customer_idx on public.customer_address (customer_id);
create index if not exists customer_address_account_idx  on public.customer_address (account_id);

-- Un solo predeterminado por cliente.
create unique index if not exists customer_address_one_default
  on public.customer_address (customer_id)
  where is_default;

-- RLS calcada de customer: los MIEMBROS de la cuenta pueden LEER. La escritura NO
-- tiene policy → queda reservada a las RPCs SECURITY DEFINER (que la saltan).
alter table public.customer_address enable row level security;

drop policy if exists customer_address_read on public.customer_address;
create policy customer_address_read on public.customer_address
  for select
  using (
    account_id in (
      select user_profiles.account_id
      from public.user_profiles
      where user_profiles.user_id = auth.uid()
    )
  );

commit;
