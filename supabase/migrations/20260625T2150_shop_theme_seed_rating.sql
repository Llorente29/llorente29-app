alter table public.shop_theme add column if not exists seed_rating numeric(2,1);
alter table public.shop_theme add column if not exists seed_rating_count integer;
