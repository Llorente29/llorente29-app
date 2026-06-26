-- 20260626T1000_shop_cuisine.sql
-- Aplicada: (pendiente — SQL Editor)
-- Vocabulario CURADO de tipos de cocina para Folvy Shop (hostelería general).
-- Global (sin account_id), como ingredient_template: lo comparten todas las cuentas.
-- El CLIENTE de Folvy elige UNA cocina por marca (brand.cuisine_code); Folvy NO la
-- adivina. Alimenta los chips del Hub y la etiqueta de cada tarjeta de marca.

-- 1) Tabla de referencia (vocabulario controlado)
create table if not exists public.shop_cuisine (
  code        text primary key,
  label       text not null,
  emoji       text,
  position    integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.shop_cuisine is
  'Vocabulario curado de tipos de cocina del Shop (hostelería general). Global, gestionado por migración/admin. El cliente elige uno por marca.';

-- 2) Semilla curada (idempotente). Hostelería general, no específica de dark kitchen.
insert into public.shop_cuisine (code, label, emoji, position) values
  ('burgers',       'Burgers',              '🍔',  10),
  ('pizza',         'Pizza',                '🍕',  20),
  ('italiano',      'Italiano',             '🍝',  30),
  ('mexicano',      'Mexicano',             '🌮',  40),
  ('kebab_pita',    'Kebab y pita',         '🥙',  50),
  ('asiatico',      'Asiático',             '🥢',  60),
  ('sushi',         'Sushi y japonés',      '🍣',  70),
  ('chino',         'Chino',                '🥡',  80),
  ('indio',         'Indio',                '🍛',  90),
  ('pollo',         'Pollo y alitas',       '🍗', 100),
  ('bocadillos',    'Bocadillos',           '🥪', 110),
  ('saludable',     'Saludable y bowls',    '🥗', 120),
  ('mediterraneo',  'Mediterráneo',         '🫒', 130),
  ('tapas',         'Tapas y raciones',     '🍤', 140),
  ('parrilla',      'Parrilla y asador',    '🍖', 150),
  ('pescado',       'Pescado y marisco',    '🐟', 160),
  ('vegetariano',   'Vegetariano y vegano', '🌱', 170),
  ('desayunos',     'Desayunos y brunch',   '🥐', 180),
  ('cafeteria',     'Cafetería',            '☕', 190),
  ('postres',       'Postres y dulces',     '🍰', 200),
  ('helados',       'Heladería',            '🍦', 210),
  ('panaderia',     'Panadería',            '🥖', 220),
  ('latino',        'Latinoamericano',      '🫓', 230),
  ('peruano',       'Peruano',              '🌶️', 240),
  ('arabe',         'Árabe',                '🧆', 250),
  ('comida_casera', 'Comida casera',        '🍲', 260),
  ('fusion',        'Fusión',               '🍽️', 270)
on conflict (code) do nothing;

-- 3) Columna en brand (FK al vocabulario; la rellena el cliente en la ficha de marca)
alter table public.brand
  add column if not exists cuisine_code text
    references public.shop_cuisine(code) on update cascade on delete set null;

create index if not exists idx_brand_cuisine_code on public.brand(cuisine_code);

-- 4) RLS: lectura pública (ficha + Hub leen etiquetas); escritura solo por migración/admin.
alter table public.shop_cuisine enable row level security;

drop policy if exists shop_cuisine_read on public.shop_cuisine;
create policy shop_cuisine_read on public.shop_cuisine
  for select to anon, authenticated using (true);

grant select on public.shop_cuisine to anon, authenticated;
