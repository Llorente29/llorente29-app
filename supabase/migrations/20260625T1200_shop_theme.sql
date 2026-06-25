-- ============================================================================
-- FOLVY SHOP · T1 Capa de diseño (theming + visibilidad de publicación).
--   shop_theme: la "piel" del escaparate, híbrida (tokens núcleo tipados +
--   extra jsonb). Una fila por MARCA (brand_id not null) y una de CUENTA
--   (brand_id null) = shell del hub multimarca.
--   Identidad (logo/color/slug/shop_url) NO se duplica: vive en brand.
--   El catálogo se pinta de menu_category/menu_item/override (sin tocar).
-- Aditivo, idempotente. RLS patrón cuenta (escritura solo admin, como brand).
-- Aplicada: 2026-06-25
-- ============================================================================

create table if not exists public.shop_theme (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts(id) on delete cascade,
  brand_id       uuid          references public.brand(id)    on delete cascade,

  template       text not null default 'clasica'
                   check (template in ('clasica','escaparate','minimal')),
  accent_color   text,
  font           text not null default 'fraunces'
                   check (font in ('fraunces','grotesk','editorial')),
  mode           text not null default 'auto'
                   check (mode in ('light','dark','auto')),
  photo_density  text not null default 'comoda'
                   check (photo_density in ('compacta','comoda')),
  hero_url       text,

  is_published   boolean not null default false,
  hub_visible    boolean not null default true,
  hub_position   integer not null default 0,

  extra          jsonb   not null default '{}'::jsonb,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint shop_theme_accent_hex_chk
    check (accent_color is null or accent_color ~* '^#([0-9a-f]{3}|[0-9a-f]{6})$')
);

comment on table public.shop_theme is
  'Capa de diseño de la Folvy Shop. Una fila por marca + una de cuenta (brand_id null = hub). Identidad (logo/color/slug) vive en brand; aquí solo la piel y la publicación.';
comment on column public.shop_theme.brand_id is
  'null = tema del HUB de la cuenta (shell multimarca). Con valor = tema de esa marca.';
comment on column public.shop_theme.accent_color is
  'Override del acento. Si null, el front usa brand.color.';

create unique index if not exists uq_shop_theme_brand
  on public.shop_theme(brand_id) where brand_id is not null;
create unique index if not exists uq_shop_theme_account_hub
  on public.shop_theme(account_id) where brand_id is null;
create index if not exists idx_shop_theme_account
  on public.shop_theme(account_id);

drop trigger if exists trg_shop_theme_updated_at on public.shop_theme;
create trigger trg_shop_theme_updated_at
  before update on public.shop_theme
  for each row execute function public.set_updated_at();

alter table public.shop_theme enable row level security;

drop policy if exists shop_theme_read on public.shop_theme;
create policy shop_theme_read on public.shop_theme
  for select to authenticated
  using (account_id = any (public.current_user_account_ids()));

drop policy if exists shop_theme_write on public.shop_theme;
create policy shop_theme_write on public.shop_theme
  for all to authenticated
  using      (public.current_user_is_admin_of(account_id))
  with check (public.current_user_is_admin_of(account_id));
