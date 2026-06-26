-- 20260626T1100_shop_hub_by_slug_v4.sql
-- Aplicada: (pendiente — SQL Editor)
-- Hub v4: añade la COCINA por marca (vocabulario curado shop_cuisine) y
-- "lo más pedido" = top 8 platos por unidades vendidas (últimos 30 días),
-- dato REAL agregado de ventas. Quita delivery_info (la economía de reparto
-- depende de la dirección → vuelve en el tramo checkout, no se finge en el hub).

create or replace function shop_hub_by_slug(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_name text;
  v_hero text;
  v_tagline text;
  v_brands jsonb;
  v_top jsonb;
begin
  select id, name, shop_hero_url, shop_tagline
    into v_account_id, v_name, v_hero, v_tagline
  from accounts where slug = p_slug;
  if v_account_id is null then
    return null;
  end if;

  -- Marcas publicadas y visibles en el hub, con su cocina (curada)
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
           'cuisine_emoji', sc.emoji
         ) order by st.hub_position nulls last, b.name), '[]'::jsonb)
  into v_brands
  from brand b
  join shop_theme st on st.brand_id = b.id
  left join shop_cuisine sc on sc.code = b.cuisine_code
  where b.account_id = v_account_id
    and st.hub_visible = true
    and st.is_published = true;

  -- "Lo más pedido": top 8 por unidades vendidas (30 d), marcas publicadas, disponibles
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
    'slug', p_slug,
    'hero_url', v_hero,
    'tagline', v_tagline,
    'brands', v_brands,
    'top_dishes', v_top
  );
end;
$$;

grant execute on function shop_hub_by_slug(text) to anon, authenticated;
