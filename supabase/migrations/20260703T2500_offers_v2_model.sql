-- 20260703T2500_offers_v2_model.sql
-- Aplicada: (pendiente)
--
-- G2a+ Motor de Ofertas v2 — LOTE 1, SECCIÓN 1 (MODELO). 100% ADITIVO: nuevas
-- columnas (nullable/defaulted), tablas, triggers y RPCs. NO toca place_shop_order,
-- _shop_reprice_line, customer_coupons, list_campaigns ni save_campaign (eso va en
-- la sección 2 del lote, migración aparte). Seguro de aplicar solo.
--
-- Contenido:
--   a) coupon += weekdays/time_from/time_to (franjas) + budget_max (€ tope de
--      descuento) + channels (costura F8, default '{shop}'); kind CHECK ampliado a
--      ('standard','frequency','item_percent','free_delivery').
--   b) campaign_scope (alcance de una campaña: exactamente uno de marca/categoría/
--      plato). RLS calcada de coupon (vía el account de su coupon padre).
--   c) menu_item_price_history + triggers de snapshot + backfill + omnibus_ref_price
--      (mínimo de los últimos 30 días, base del tachado legal Ómnibus).
--   d) menu_item += mirror_of_item_id + create_mirror_item / swap_mirror (artículo
--      espejo: vende a precio agresivo SIN tachado porque nace con historial limpio).
--
-- NOTA ÓMNIBUS (honesta): el backfill sella HOY el precio actual de cada plato, así
-- que la ventana real de "precio más bajo 30 días" empieza a contar desde la fecha
-- de aplicación de esta migración. Antes de eso no hay historial que reclamar.
--
-- No se prueba en la tx que la crea (verificación desde la app / SQL Editor aparte).

begin;

-- ── a) coupon: franjas, presupuesto, canales, kinds nuevos ──────────────────
alter table public.coupon add column if not exists weekdays   smallint[];       -- 1=lun..7=dom; NULL=todos
alter table public.coupon add column if not exists time_from  time;             -- inicio de franja (NULL=todo el día)
alter table public.coupon add column if not exists time_to    time;             -- fin de franja
alter table public.coupon add column if not exists budget_max numeric;          -- € de descuento máx (NULL=sin tope)
alter table public.coupon add column if not exists channels   text[] not null default '{shop}';  -- costura F8

alter table public.coupon drop constraint if exists coupon_kind_check;
alter table public.coupon add constraint coupon_kind_check
  check (kind in ('standard','frequency','item_percent','free_delivery'));

-- ── b) campaign_scope: alcance (exactamente uno de los tres) ─────────────────
create table if not exists public.campaign_scope (
  id               uuid primary key default gen_random_uuid(),
  coupon_id        uuid not null references public.coupon(id)        on delete cascade,
  brand_id         uuid references public.brand(id)                  on delete cascade,
  menu_category_id uuid references public.menu_category(id)          on delete cascade,
  menu_item_id     uuid references public.menu_item(id)              on delete cascade,
  created_at       timestamptz not null default now(),
  constraint campaign_scope_one_target check (
    (brand_id is not null)::int + (menu_category_id is not null)::int + (menu_item_id is not null)::int = 1
  )
);
create index if not exists campaign_scope_coupon_idx on public.campaign_scope (coupon_id);
create index if not exists campaign_scope_item_idx   on public.campaign_scope (menu_item_id);
create index if not exists campaign_scope_cat_idx    on public.campaign_scope (menu_category_id);
create index if not exists campaign_scope_brand_idx  on public.campaign_scope (brand_id);

alter table public.campaign_scope enable row level security;
drop policy if exists campaign_scope_member_all on public.campaign_scope;
create policy campaign_scope_member_all on public.campaign_scope
  for all
  using (coupon_id in (
    select id from public.coupon
    where account_id in (select account_id from public.user_profiles where user_id = auth.uid())
  ))
  with check (coupon_id in (
    select id from public.coupon
    where account_id in (select account_id from public.user_profiles where user_id = auth.uid())
  ));

-- ── c) Historial de precios (Ómnibus) ───────────────────────────────────────
create table if not exists public.menu_item_price_history (
  id           uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_item(id) on delete cascade,
  account_id   uuid not null references public.accounts(id)  on delete cascade,
  price        numeric not null,
  captured_at  timestamptz not null default now()
);
create index if not exists menu_item_price_history_item_idx
  on public.menu_item_price_history (menu_item_id, captured_at desc);

alter table public.menu_item_price_history enable row level security;
drop policy if exists menu_item_price_history_read on public.menu_item_price_history;
create policy menu_item_price_history_read on public.menu_item_price_history
  for select
  using (account_id in (select account_id from public.user_profiles where user_id = auth.uid()));

-- Snapshot del precio. SECURITY DEFINER para poder insertar aunque quien edite el
-- plato sea un usuario con RLS (la escritura del historial queda cerrada al trigger).
create or replace function public._menu_item_price_snapshot()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  insert into menu_item_price_history (menu_item_id, account_id, price, captured_at)
  values (new.id, new.account_id, new.price, now());
  return new;
end;
$fn$;

drop trigger if exists menu_item_price_snapshot_ins on public.menu_item;
create trigger menu_item_price_snapshot_ins
  after insert on public.menu_item
  for each row execute function public._menu_item_price_snapshot();

drop trigger if exists menu_item_price_snapshot_upd on public.menu_item;
create trigger menu_item_price_snapshot_upd
  after update of price on public.menu_item
  for each row when (old.price is distinct from new.price)
  execute function public._menu_item_price_snapshot();

-- BACKFILL: sella HOY el precio vigente de cada plato vivo (ver NOTA ÓMNIBUS).
insert into public.menu_item_price_history (menu_item_id, account_id, price, captured_at)
select id, account_id, price, now()
from public.menu_item
where archived_at is null;

-- Precio de referencia Ómnibus: mínimo de los últimos 30 días (incluye el vigente).
create or replace function public.omnibus_ref_price(p_menu_item_id uuid)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select min(price)
  from menu_item_price_history
  where menu_item_id = p_menu_item_id
    and captured_at >= now() - interval '30 days';
$fn$;

grant execute on function public.omnibus_ref_price(uuid) to authenticated;

-- ── d) Artículo espejo ──────────────────────────────────────────────────────
alter table public.menu_item add column if not exists mirror_of_item_id uuid
  references public.menu_item(id) on delete set null;

-- Duplica un plato como ESPEJO (nace oculto, is_available=false, external_id NULL,
-- con su propio historial de precios limpio via el trigger AFTER INSERT). No duplica
-- modificadores ni slots de combo (lote 1: pensado para promos de plato simple).
create or replace function public.create_mirror_item(p_account uuid, p_item uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_src menu_item%rowtype;
  v_id  uuid;
begin
  if not (p_account = any(current_user_account_ids())) then raise exception 'forbidden'; end if;

  select * into v_src from menu_item where id = p_item and account_id = p_account;
  if v_src.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_src.mirror_of_item_id is not null then return jsonb_build_object('ok', false, 'reason', 'is_mirror'); end if;
  if exists (select 1 from menu_item where mirror_of_item_id = p_item and account_id = p_account) then
    return jsonb_build_object('ok', false, 'reason', 'already_mirrored');
  end if;

  insert into menu_item (
    account_id, brand_id, channel_id, recipe_item_id, name, description, category,
    photo_url, position, price, vat_rate, is_active, is_available, product_type,
    menu_category_id, packaging_cost, packaging_description, source, mirror_of_item_id, created_by)
  values (
    v_src.account_id, v_src.brand_id, v_src.channel_id, v_src.recipe_item_id, v_src.name,
    v_src.description, v_src.category, v_src.photo_url, v_src.position, v_src.price,
    v_src.vat_rate, v_src.is_active, false, v_src.product_type, v_src.menu_category_id,
    v_src.packaging_cost, v_src.packaging_description, v_src.source, v_src.id, auth.uid())
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$fn$;

grant execute on function public.create_mirror_item(uuid, uuid) to authenticated;

-- Alterna la visibilidad entre el ORIGINAL (p_item) y su espejo. NUNCA a la vez.
create or replace function public.swap_mirror(p_account uuid, p_item uuid, p_use_mirror boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_src    menu_item%rowtype;
  v_mirror uuid;
begin
  if not (p_account = any(current_user_account_ids())) then raise exception 'forbidden'; end if;

  select * into v_src from menu_item where id = p_item and account_id = p_account;
  if v_src.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  select id into v_mirror from menu_item
  where mirror_of_item_id = p_item and account_id = p_account limit 1;
  if v_mirror is null then return jsonb_build_object('ok', false, 'reason', 'no_mirror'); end if;

  if coalesce(p_use_mirror, false) then
    update menu_item set is_available = false, updated_at = now() where id = p_item;
    update menu_item set is_available = true,  updated_at = now() where id = v_mirror;
  else
    update menu_item set is_available = true,  updated_at = now() where id = p_item;
    update menu_item set is_available = false, updated_at = now() where id = v_mirror;
  end if;

  return jsonb_build_object('ok', true, 'usingMirror', coalesce(p_use_mirror, false));
end;
$fn$;

grant execute on function public.swap_mirror(uuid, uuid, boolean) to authenticated;

commit;
