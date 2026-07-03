-- 20260703T2520_offers_v2_hub_badge.sql
-- Aplicada: (pendiente)
--
-- G2·B2 (escaparate) — La oferta se ve desde el HUB. Requiere 20260703T2500/2510.
-- NO toca motor ni checkout: solo el helper de "mejor oferta por marca" y el feed
-- del hub (shop_hub_by_slug).
--
--   _shop_brand_best_offer(account, brand) [NUEVO]: {pct, multi} de las campañas
--     item_percent ACTIVAS AHORA cuyo scope toca la marca (directo, o vía una
--     categoría/plato de esa marca). pct = max(value); multi = hay más de una. NULL
--     si ninguna. Reutiliza las MISMAS condiciones de _shop_item_offer (ventana +
--     franja Europe/Madrid + canal 'shop' + presupuesto no agotado).
--   shop_hub_by_slug: añade 'offer' por marca (para el badge de la tarjeta de marca).
--
-- No se prueba en la tx que la crea.

begin;

create or replace function public._shop_brand_best_offer(p_account uuid, p_brand uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select case when count(*) > 0
              then jsonb_build_object('pct', max(c.value), 'multi', count(*) > 1)
              else null end
  from coupon c
  where c.account_id = p_account and c.active and c.kind = 'item_percent' and c.paused_at is null
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
        ) < c.budget_max)
    and exists (
      select 1 from campaign_scope sc
      where sc.coupon_id = c.id
        and (
          sc.brand_id = p_brand
          or sc.menu_category_id in (select mc.id from menu_category mc where mc.brand_id = p_brand and mc.account_id = p_account)
          or sc.menu_item_id     in (select mi.id from menu_item     mi where mi.brand_id = p_brand and mi.account_id = p_account)
        )
    );
$fn$;

grant execute on function public._shop_brand_best_offer(uuid, uuid) to anon, authenticated;

-- ── shop_hub_by_slug: + 'offer' por marca ───────────────────────────────────
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
    'brands', v_brands,
    'top_dishes', v_top
  );
end;
$function$;

commit;
