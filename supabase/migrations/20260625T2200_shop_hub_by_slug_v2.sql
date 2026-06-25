create or replace function shop_hub_by_slug(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_name text;
  v_brands jsonb;
  v_info jsonb;
begin
  select id, name into v_account_id, v_name
  from accounts where slug = p_slug;
  if v_account_id is null then
    return null;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'brand_id', b.id,
           'name', b.name,
           'hero_url', st.hero_url,
           'accent_color', st.accent_color,
           'template', st.template,
           'position', st.hub_position,
           'rating', st.seed_rating,
           'rating_count', st.seed_rating_count
         ) order by st.hub_position nulls last, b.name), '[]'::jsonb)
  into v_brands
  from brand b
  join shop_theme st on st.brand_id = b.id
  where b.account_id = v_account_id
    and st.hub_visible = true
    and st.is_published = true;
  select jsonb_build_object(
           'eta_min', min(eta_min),
           'delivery_fee_min', min(delivery_fee),
           'min_order', min(min_order)
         )
  into v_info
  from delivery_zone
  where account_id = v_account_id and is_active = true;
  return jsonb_build_object(
    'account_name', v_name,
    'slug', p_slug,
    'brands', v_brands,
    'delivery_info', coalesce(v_info, '{}'::jsonb)
  );
end;
$$;
grant execute on function shop_hub_by_slug(text) to anon, authenticated;

-- nota: requiere shop_theme.seed_rating numeric(2,1) y seed_rating_count integer (alter aplicado en SQL editor)
