-- 20260712T1200_channel_settlement.sql
-- Módulo Ventas · Inteligencia Gerencial — Capa B (liquidaciones/payout por canal).
-- Absorbe Glovo/Uber/JustEat con columnas tipadas + extra jsonb. RLS calcada de brand_channel_rate.

create table if not exists public.channel_settlement (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  channel_id         uuid references public.sales_channel(id),
  brand_id           uuid references public.brand(id),
  location_id        uuid references public.locations(id),

  -- textos crudos de la liquidación (para casar marca/local y auditar)
  external_brand_text     text,
  external_location_text  text,

  -- identificación del cierre
  settlement_ref     text,
  period_from        date,
  period_to          date,
  settlement_date    date,
  period_grain       text,
  currency           text not null default ''EUR'',

  -- volumen
  orders_count       integer,

  -- venta
  gross_sales        numeric,
  base_amount        numeric,
  vat_amount         numeric,

  -- costes por concepto (signo natural del origen: negativo = coste que pagas)
  commission         numeric default 0,
  delivery_transport numeric default 0,
  promo_product      numeric default 0,
  promo_flash        numeric default 0,
  offer_flash_credit numeric default 0,
  access_fee         numeric default 0,
  prime_fee          numeric default 0,
  recurring_fee      numeric default 0,
  incidents_cost     numeric default 0,
  incidents_refund   numeric default 0,
  min_order_fee      numeric default 0,
  other_cost         numeric default 0,

  -- resultado
  net_payout         numeric,
  accumulated_debt   numeric,

  -- procedencia + idempotencia
  source             text not null default ''import_csv'',
  import_key         text,
  raw                jsonb,
  needs_review       boolean not null default false,
  review_note        text,

  -- auditoría
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  created_by_name    text
);

create unique index if not exists ux_channel_settlement_import
  on public.channel_settlement (account_id, import_key)
  where import_key is not null;

create index if not exists ix_channel_settlement_scope
  on public.channel_settlement (account_id, channel_id, brand_id, location_id, period_from);

alter table public.channel_settlement enable row level security;

create policy cs_read on public.channel_settlement
  for select using (account_id = any (current_user_account_ids()));

create policy cs_write on public.channel_settlement
  for all using (current_user_is_admin_of(account_id))
  with check (current_user_is_admin_of(account_id));
