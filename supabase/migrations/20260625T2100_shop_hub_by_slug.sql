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
           'position', st.hub_position
         ) order by st.hub_position nulls last, b.name), '[]'::jsonb)
  into v_brands
  from brand b
  join shop_theme st on st.brand_id = b.id
  where b.account_id = v_account_id
    and st.hub_visible = true
    and st.is_published = true;
  return jsonb_build_object('account_name', v_name, 'slug', p_slug, 'brands', v_brands);
end;
$$;
grant execute on function shop_hub_by_slug(text) to anon, authenticated;
