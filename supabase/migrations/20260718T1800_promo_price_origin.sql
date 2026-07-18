-- 20260718T1800_promo_price_origin.sql
-- OFERTAS 2x1 · Registro de precios cambiados por una promo + fecha de reversión.
-- Fuente de verdad para las alarmas de "devolver el precio al terminar el 2x1".
-- NOTA: las FILAS de datos (las promos concretas registradas) se insertan operativamente,
-- no en esta migración. Aquí solo va el esquema (tabla + RLS + índice).

create table if not exists public.promo_price_origin (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts(id) on delete cascade,
  brand_id      uuid references public.brand(id),
  brand_name    text,
  location_id   uuid references public.locations(id),
  location_name text,
  menu_item_id  uuid not null references public.menu_item(id) on delete cascade,
  item_name     text,
  origin_price  numeric not null,      -- precio a DEVOLVER al terminar la promo
  promo_price   numeric not null,      -- precio del 2x1 (el que se sube a Last)
  promo_start   date,
  promo_end     date,                  -- último día del 2x1
  revert_due    date,                  -- día en que hay que devolver el precio
  reverted_at   timestamptz,
  status        text not null default 'active',  -- active | reverted | cancelled
  note          text,
  created_at    timestamptz not null default now()
);

alter table public.promo_price_origin enable row level security;

drop policy if exists promo_price_origin_belongs on public.promo_price_origin;
create policy promo_price_origin_belongs on public.promo_price_origin
  for all
  using      (account_id = any(public.current_user_account_ids()))
  with check (account_id = any(public.current_user_account_ids()));

create index if not exists idx_ppo_status_due on public.promo_price_origin(status, revert_due);
