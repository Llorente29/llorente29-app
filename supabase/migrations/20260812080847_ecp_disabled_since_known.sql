alter table public.external_catalog_product
  add column if not exists disabled_since_known boolean not null default true;