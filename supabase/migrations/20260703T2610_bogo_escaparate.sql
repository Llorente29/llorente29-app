-- 20260703T2610_bogo_escaparate.sql
-- Aplicada: (pendiente)
--
-- G2c sub-lote A3 — ESCAPARATE BOGO (servidor). shop_brand_menu_by_slug emite,
-- por plato, 'bogo' = _shop_item_bogo(cuenta, plato) (o NULL), junto al 'offer'
-- item_percent ya existente. La carta/tarjeta de plato pinta el badge "2x1" /
-- "2ª al -X%" leyendo ese campo. El descuento real lo aplica el motor (A2) en el
-- checkout; esto es solo el gancho visual.
--
-- Reproducción FIEL del texto vivo + una línea. Misma firma (CREATE OR REPLACE,
-- sin DROP; permisos conservados). No se prueba en la tx que la crea.

begin;

create or replace function public.shop_brand_menu_by_slug(p_slug text, p_brand_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
               'offer', public._shop_item_offer(v_account_id, mi.id, mi.price),
               'bogo', public._shop_item_bogo(v_account_id, mi.id)
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
