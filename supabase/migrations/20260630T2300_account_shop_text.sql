-- 20260630T2300_account_shop_text.sql
--
-- Slogans configurables del hub. El TITULAR ya era configurable (accounts.shop_tagline,
-- el héroe lo parte por el primer punto: parte A normal + parte B resaltada en ámbar).
-- Faltaba el SUBTÍTULO, que estaba hardcodeado. Añadimos accounts.shop_subtitle,
-- lo devolvemos en el feed (shop_hub_by_slug → subtitle) y damos una RPC acotada
-- para que un usuario de la cuenta pueda editar titular+subtítulo (la RLS de accounts
-- solo deja escribir a admins, igual que con el logo).

alter table accounts add column if not exists shop_subtitle text;

-- Feed del hub: +subtitle. Resto idéntico a producción.
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

-- RPC acotada: editar titular + subtítulo de la cuenta del usuario (esquiva RLS de accounts)
create or replace function public.set_account_shop_text(p_account_id uuid, p_tagline text, p_subtitle text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not belongs_to_account(p_account_id) then
    raise exception 'set_account_shop_text: sin acceso a esta cuenta';
  end if;
  update accounts
     set shop_tagline  = nullif(btrim(p_tagline), ''),
         shop_subtitle = nullif(btrim(p_subtitle), '')
   where id = p_account_id;
end;
$$;

grant execute on function public.set_account_shop_text(uuid, text, text) to authenticated;
