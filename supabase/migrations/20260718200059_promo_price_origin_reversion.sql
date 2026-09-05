-- Registro de precios cambiados por un 2x1 + fecha de reversión. Fuente de verdad para las alarmas.
create table if not exists public.promo_price_origin (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  brand_id uuid references public.brand(id),
  brand_name text,
  location_id uuid references public.locations(id),
  location_name text,
  menu_item_id uuid not null references public.menu_item(id) on delete cascade,
  item_name text,
  origin_price numeric not null,      -- precio a DEVOLVER al terminar la promo
  promo_price numeric not null,       -- precio del 2x1 (el que sube a Last)
  promo_start date,
  promo_end date,                     -- último día del 2x1
  revert_due date,                    -- día en que hay que devolver el precio
  reverted_at timestamptz,
  status text not null default 'active',   -- active | reverted | cancelled
  note text,
  created_at timestamptz not null default now()
);
alter table public.promo_price_origin enable row level security;
drop policy if exists promo_price_origin_belongs on public.promo_price_origin;
create policy promo_price_origin_belongs on public.promo_price_origin
  for all using (account_id = any(public.current_user_account_ids()))
  with check (account_id = any(public.current_user_account_ids()));
create index if not exists idx_ppo_status_due on public.promo_price_origin(status, revert_due);

insert into public.promo_price_origin
  (account_id, brand_id, brand_name, location_id, location_name, menu_item_id, item_name,
   origin_price, promo_price, promo_start, promo_end, revert_due, note)
values
  ('51ad1792-6629-4ef7-833a-b57b09a86710','cc89c6eb-afb8-4308-884e-9aac83986b22','Meraki Pita',
   '38158159-cd71-4056-950b-53425afac1ce','Foodint Alcalá','2db2d752-3f8f-466e-a1ed-0aa2e31fa819',
   'The Mixed Master: Pita Mixta Gyros','13.90','15.90','2026-07-18','2026-08-17','2026-08-18','2x1'),
  ('51ad1792-6629-4ef7-833a-b57b09a86710','cc89c6eb-afb8-4308-884e-9aac83986b22','Meraki Pita',
   '38158159-cd71-4056-950b-53425afac1ce','Foodint Alcalá','1ebcb029-cfc1-469f-bf47-068ea06563a0',
   'Crispy Falafel & Greek Dip (3 uds)','6.50','7.20','2026-07-18','2026-08-17','2026-08-18','2x1'),
  ('51ad1792-6629-4ef7-833a-b57b09a86710','cc89c6eb-afb8-4308-884e-9aac83986b22','Meraki Pita',
   '38158159-cd71-4056-950b-53425afac1ce','Foodint Alcalá','31344c26-3474-4289-891a-8856991e9345',
   'Pita BOWL Mixto: La Experiencia Completa','14.80','16.30','2026-07-18','2026-08-17','2026-08-18','2x1');