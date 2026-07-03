-- 20260703T2610_bogo_escaparate.sql
-- Aplicada: (pendiente)
--
-- G2c sub-lote A3 (ampliado) — ESCAPARATE BOGO unificado en el 'offer'.
--
-- El feed emite UN solo 'offer' por plato, con discriminador 'kind':
--   * bogo gana        -> {kind:'bogo', campaignId, pct}
--   * si no, item_pct  -> {kind:'item_percent', campaignId, pct, discountedPrice, wasPrice}
-- Así carta, modal y carrito leen la MISMA forma y el badge 2x1 se ve/cuenta en
-- todas las pantallas (el checkout ya cobra vía _shop_reprice_line, A2).
--
--   (1) _shop_item_promo(cuenta, plato, precio): unifica bogo/item_percent (bogo
--       gana, coherente con _shop_reprice_line).
--   (2) shop_brand_menu_by_slug: 'offer' = _shop_item_promo(...) (reproducción fiel
--       del texto vivo + esa línea). Misma firma (CREATE OR REPLACE, sin DROP).
--
-- Requiere 2600 (_shop_item_bogo). No se prueba en la tx que la crea.

begin;

-- (1) Promo unificada del plato (bogo gana sobre item_percent).
create or replace function public._shop_item_promo(p_account uuid, p_menu_item_id uuid, p_price numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_b jsonb;
  v_o jsonb;
begin
  v_b := public._shop_item_bogo(p_account, p_menu_item_id);
  if v_b is not null then
    return jsonb_build_object('kind', 'bogo', 'campaignId', v_b->>'campaignId', 'pct', (v_b->>'pct')::numeric);
  end if;
  v_o := public._shop_item_offer(p_account, p_menu_item_id, p_price);
  if v_o is not null then
    return v_o || jsonb_build_object('kind', 'item_percent');
  end if;
  return null;
end;
$function$;

grant execute on function public._shop_item_promo(uuid, uuid, numeric) to authenticated;

-- (2) Feed de carta: 'offer' unificado.
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
               'offer', public._shop_item_promo(v_account_id, mi.id, mi.price)
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
