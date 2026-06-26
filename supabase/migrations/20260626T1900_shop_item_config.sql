-- Aux 1: alérgenos de un recipe_item_id -> array [{code,name_es,icon}]
create or replace function _allergens_of_recipe(p_recipe_item_id uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'name_es', a.name_es, 'icon', a.icon) order by a.position), '[]'::jsonb)
  from recipe_item_allergen ria
  join allergen a on a.code = ria.allergen_code
  where ria.recipe_item_id = p_recipe_item_id;
$$;

-- Aux 2: modifier_groups de un menu_item -> array de grupos con sus opciones
create or replace function _modgroups_of_item(p_menu_item_id uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', mg.id,
           'name', mg.name,
           'min', mg.min_selections,
           'max', mg.max_selections,
           'allow_repetition', mg.allow_repetition,
           'options', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'id', mo.id,
                      'name', mo.name,
                      'price_impact', mo.price_impact,
                      'is_default', mo.is_default,
                      'allergens', _allergens_of_recipe(mo.recipe_item_id)
                    ) order by mo.position nulls last, mo.name), '[]'::jsonb)
             from modifier_option mo
             where mo.modifier_group_id = mg.id and mo.is_active
           )
         ) order by mga.position nulls last), '[]'::jsonb)
  from modifier_group_assignment mga
  join modifier_group mg on mg.id = mga.modifier_group_id
  where mga.menu_item_id = p_menu_item_id and mg.is_active;
$$;

-- Principal: árbol de configuración de un plato
create or replace function shop_item_config(p_slug text, p_menu_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_account_id uuid;
  v_item record;
  v_slots jsonb;
begin
  select id into v_account_id from accounts where slug = p_slug;
  if v_account_id is null then return null; end if;

  select mi.id, mi.name, mi.description, mi.photo_url, mi.price, mi.product_type, mi.recipe_item_id, mi.brand_id
    into v_item
  from menu_item mi
  join shop_theme st on st.brand_id = mi.brand_id and st.is_published and st.hub_visible
  where mi.id = p_menu_item_id and mi.account_id = v_account_id
    and mi.is_active is not false and mi.is_available is not false and mi.archived_at is null;
  if v_item.id is null then return null; end if;

  -- Slots del combo (cada opción = un menu_item con price_impact, sus alérgenos y SUS modgroups anidados)
  if v_item.product_type = 'combo' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', cs.id,
             'name', cs.name,
             'min', cs.min_selections,
             'max', cs.max_selections,
             'options', (
               select coalesce(jsonb_agg(jsonb_build_object(
                        'menu_item_id', omi.id,
                        'name', omi.name,
                        'photo_url', omi.photo_url,
                        'price_impact', cso.price_impact,
                        'is_default', cso.is_default,
                        'allergens', _allergens_of_recipe(omi.recipe_item_id),
                        'modifier_groups', _modgroups_of_item(omi.id)
                      ) order by cso.position nulls last, omi.name), '[]'::jsonb)
               from combo_slot_option cso
               join menu_item omi on omi.id = cso.menu_item_id
               where cso.combo_slot_id = cs.id and cso.is_active and omi.is_active is not false
             )
           ) order by cs.position nulls last), '[]'::jsonb)
    into v_slots
    from combo_slot cs
    where cs.combo_item_id = v_item.id and cs.is_active;
  else
    v_slots := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'id', v_item.id,
    'name', v_item.name,
    'description', v_item.description,
    'photo_url', v_item.photo_url,
    'price', v_item.price,
    'product_type', v_item.product_type,
    'allergens', _allergens_of_recipe(v_item.recipe_item_id),
    'modifier_groups', _modgroups_of_item(v_item.id),
    'slots', v_slots
  );
end;
$$;

grant execute on function shop_item_config(text, uuid) to anon, authenticated;
