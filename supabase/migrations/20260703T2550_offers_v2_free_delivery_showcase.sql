-- 20260703T2550_offers_v2_free_delivery_showcase.sql
-- Aplicada: (pendiente)
--
-- FIX G2·C4 — El ENVÍO GRATIS se vende en el escaparate (hub + carta + carrito), no se
-- descubre en el checkout. Requiere 2500/2510/2520/2530/2540. NO toca motor ni checkout.
--
--   _shop_account_free_delivery(account) [NUEVO]: {active, minSubtotal} si hay un cupón
--     kind='free_delivery' AUTO_APPLY activo AHORA (mismas condiciones que
--     _shop_brand_best_offer/_shop_item_offer: ventana + franja Europe/Madrid + canal
--     'shop' + presupuesto no agotado). NULL si no. (Solo hay uno auto por cuenta.)
--   shop_hub_by_slug / shop_brand_menu_by_slug: exponen 'freeDelivery' a nivel tienda.
--
-- No se prueba en la tx que la crea.

begin;

create or replace function public._shop_account_free_delivery(p_account uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select case when count(*) > 0
              then jsonb_build_object('active', true, 'minSubtotal', min(c.min_subtotal))
              else null end
  from coupon c
  where c.account_id = p_account and c.active and c.kind = 'free_delivery'
    and c.auto_apply and c.paused_at is null
    and (c.starts_at is null or c.starts_at <= now())
    and (c.ends_at   is null or c.ends_at   >  now())
    and 'shop' = any(c.channels)
    and (c.weekdays  is null or extract(isodow from (now() at time zone 'Europe/Madrid'))::smallint = any(c.weekdays))
    and (c.time_from is null or (now() at time zone 'Europe/Madrid')::time >= c.time_from)
    and (c.time_to   is null or (now() at time zone 'Europe/Madrid')::time <= c.time_to)
    and (c.budget_max is null or (
          select coalesce(sum(cr.discount_amount), 0) from coupon_redemption cr
          join sale s on s.id = cr.sale_id
          where cr.coupon_id = c.id and coalesce(s.status,'') <> 'cancelled'
        ) < c.budget_max);
$fn$;

grant execute on function public._shop_account_free_delivery(uuid) to anon, authenticated;

-- ── shop_hub_by_slug: + 'freeDelivery' a nivel tienda ───────────────────────
CREATE OR REPLACE FUNCTION public.shop_hub_by_slug(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_account_id uuid;
  v_name text;
  v_hero text;
  v_tagline text;
  v_subtitle text;
  v_logo text;
  v_brands jsonb;
  v_top jsonb;
begin
  select id, name, shop_hero_url, shop_tagline, shop_subtitle, shop_logo_url
    into v_account_id, v_name, v_hero, v_tagline, v_subtitle, v_logo
  from accounts where slug = p_slug;
  if v_account_id is null then
    return null;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'brand_id', b.id,
           'name', b.name,
           'logo_url', b.logo_url,
           'hero_url', st.hero_url,
           'accent_color', st.accent_color,
           'template', st.template,
           'position', st.hub_position,
           'rating', st.seed_rating,
           'rating_count', st.seed_rating_count,
           'cuisine_code', sc.code,
           'cuisine_label', sc.label,
           'cuisine_emoji', sc.emoji,
           'offer', public._shop_brand_best_offer(v_account_id, b.id),
           'is_open', exists (
             select 1
             from brand_location_availability bla
             where bla.brand_id = b.id
               and bla.is_active = true
               and is_brand_open(bla.location_id, b.id)
           )
         ) order by st.hub_position nulls last, b.name), '[]'::jsonb)
  into v_brands
  from brand b
  join shop_theme st on st.brand_id = b.id
  left join shop_cuisine sc on sc.code = b.cuisine_code
  where b.account_id = v_account_id
    and st.hub_visible = true
    and st.is_published = true;
  select coalesce(jsonb_agg(t order by t.units desc), '[]'::jsonb)
  into v_top
  from (
    select mi.id          as menu_item_id,
           mi.name        as name,
           mi.photo_url   as photo_url,
           mi.price       as price,
           b.id           as brand_id,
           b.name         as brand_name,
           sum(coalesce(sl.quantity, 1)) as units
    from sale_line sl
    join sale s        on s.id = sl.sale_id
    join menu_item mi  on mi.id = sl.menu_item_id
    join brand b       on b.id = mi.brand_id
    join shop_theme st on st.brand_id = b.id
                      and st.is_published = true
                      and st.hub_visible = true
    where mi.account_id = v_account_id
      and sl.menu_item_id is not null
      and mi.is_available is not false
      and mi.product_type <> 'combo'
      and s.sold_at >= now() - interval '30 days'
    group by mi.id, mi.name, mi.photo_url, mi.price, b.id, b.name
    order by units desc
    limit 8
  ) t;
  return jsonb_build_object(
    'account_name', v_name,
    'account_logo_url', v_logo,
    'slug', p_slug,
    'hero_url', v_hero,
    'tagline', v_tagline,
    'subtitle', v_subtitle,
    'free_delivery', public._shop_account_free_delivery(v_account_id),
    'brands', v_brands,
    'top_dishes', v_top
  );
end;
$function$;

-- ── shop_brand_menu_by_slug: + 'freeDelivery' a nivel tienda ────────────────
CREATE OR REPLACE FUNCTION public.shop_brand_menu_by_slug(p_slug text, p_brand_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_account_id uuid;
  v_brand record;
  v_cats jsonb;
  v_is_open boolean;
  v_location_ids jsonb;
begin
  select id into v_account_id from accounts where slug = p_slug;
  if v_account_id is null then
    return null;
  end if;
  select b.id, b.name, b.logo_url, b.cuisine_code,
         st.accent_color, st.hero_url, st.seed_rating, st.seed_rating_count
    into v_brand
  from brand b
  join shop_theme st on st.brand_id = b.id
  where b.id = p_brand_id
    and b.account_id = v_account_id
    and st.hub_visible = true
    and st.is_published = true;
  if v_brand.id is null then
    return null;
  end if;
  select coalesce(jsonb_agg(distinct bla.location_id), '[]'::jsonb)
    into v_location_ids
  from brand_location_availability bla
  where bla.brand_id = p_brand_id and bla.is_active = true;
  select exists (
    select 1 from brand_location_availability bla
    where bla.brand_id = p_brand_id
      and bla.is_active = true
      and is_brand_open(bla.location_id, p_brand_id)
  ) into v_is_open;
  select coalesce(jsonb_agg(cat order by cat.position nulls last, cat.name), '[]'::jsonb)
  into v_cats
  from (
    select c.id, c.name, c.emoji, c.position,
           coalesce(jsonb_agg(
             jsonb_build_object(
               'id', mi.id,
               'name', mi.name,
               'description', mi.description,
               'photo_url', mi.photo_url,
               'price', mi.price,
               'product_type', mi.product_type,
               'offer', public._shop_item_offer(v_account_id, mi.id, mi.price)
             ) order by mi.position nulls last, mi.name
           ) filter (where mi.id is not null), '[]'::jsonb) as products
    from menu_category c
    join menu_item mi
      on mi.menu_category_id = c.id
     and mi.account_id = v_account_id
     and mi.brand_id = p_brand_id
     and mi.is_active is not false
     and mi.is_available is not false
     and mi.archived_at is null
    where c.account_id = v_account_id
      and c.brand_id = p_brand_id
    group by c.id, c.name, c.emoji, c.position
    having count(mi.id) > 0
  ) cat;
  return jsonb_build_object(
    'brand_id', v_brand.id,
    'name', v_brand.name,
    'logo_url', v_brand.logo_url,
    'accent_color', v_brand.accent_color,
    'hero_url', v_brand.hero_url,
    'cuisine_code', v_brand.cuisine_code,
    'rating', v_brand.seed_rating,
    'rating_count', v_brand.seed_rating_count,
    'is_open', v_is_open,
    'location_ids', v_location_ids,
    'free_delivery', public._shop_account_free_delivery(v_account_id),
    'categories', v_cats
  );
end;
$function$;

commit;
