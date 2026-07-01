-- 20260701T0900_brand_menu_hero.sql
--
-- Cabecera propia por marca: el feed de la carta ya trae accent_color de
-- shop_theme; añadimos su hero_url (la portada configurada por marca en Diseño)
-- para pintar la cabecera de la marca con su foto. Cambio MÍNIMO: +1 lectura y
-- +1 campo en el JSON. Resto idéntico a producción.

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
               'product_type', mi.product_type
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
    'categories', v_cats
  );
end;
$function$;
