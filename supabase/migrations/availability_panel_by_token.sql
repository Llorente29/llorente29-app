-- ============================================================================
-- 86 POR TOKEN — lectura para la Estación de Tablet
-- ----------------------------------------------------------------------------
-- Dos RPC de lectura que validan el token de dispositivo y operan en el local
-- del dispositivo (sin sesión). Espejo de lo que el panel de oficina hace con
-- availability_panel + búsqueda directa en menu_item (que van por RLS de sesión).
--
--   · availability_panel_by_token(token)         -> lista de agotados del local
--   · search_products_by_token(token, query)     -> buscar productos de la carta
--
-- Ambas derivan cuenta + local del dispositivo vía kds_resolve_device.
-- ============================================================================

-- Lista de agotados del local del dispositivo (delega en availability_panel,
-- que ya agrupa por producto físico y une Folvy + Last).
create or replace function public.availability_panel_by_token(p_device_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_device kds_device;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'availability_panel_by_token: token no válido';
  end if;
  update kds_device set last_seen_at = now() where id = v_device.id;

  -- availability_panel es SECURITY DEFINER y filtra por cuenta+local; le pasamos
  -- los del dispositivo. Devuelve setof; lo empaquetamos en jsonb array.
  return coalesce(
    (select jsonb_agg(to_jsonb(p))
     from public.availability_panel(v_device.account_id, v_device.location_id) p),
    '[]'::jsonb
  );
end;
$function$;


-- Búsqueda de productos de la carta para el flujo "Agotar producto", agrupados
-- por producto físico (como searchProducts del servicio de oficina).
create or replace function public.search_products_by_token(
  p_device_token text,
  p_query        text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_device kds_device;
  v_term   text := btrim(coalesce(p_query, ''));
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'search_products_by_token: token no válido';
  end if;
  if length(v_term) < 2 then
    return '[]'::jsonb;
  end if;

  return coalesce((
    with rows as (
      select mi.id, mi.external_id, mi.recipe_item_id, mi.brand_id, mi.name,
             coalesce(mi.recipe_item_id::text, mi.external_id, mi.id::text) as pkey
      from menu_item mi
      where mi.account_id = v_device.account_id
        and mi.product_type = 'item'
        and mi.name ilike '%' || v_term || '%'
      limit 200
    ),
    grouped as (
      select pkey,
             (array_agg(id order by id))[1]                as menu_item_id,
             (array_agg(name order by id))[1]              as name,
             (array_agg(external_id order by id))[1]       as external_id,
             (array_agg(recipe_item_id order by id))[1]    as recipe_item_id,
             count(distinct brand_id)                      as brands
      from rows
      group by pkey
    )
    select jsonb_agg(jsonb_build_object(
             'menuItemId',   menu_item_id,
             'name',         name,
             'externalId',   external_id,
             'recipeItemId', recipe_item_id,
             'brands',       brands
           ) order by name)
    from grouped
  ), '[]'::jsonb);
end;
$function$;


-- Previsualización del alcance (marcas · canales) al agotar, por token, en el
-- local del dispositivo. Espejo de previewScope del servicio de oficina.
create or replace function public.preview_scope_by_token(
  p_device_token text,
  p_menu_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_device      kds_device;
  v_recipe_item uuid;
  v_external_id text;
  v_matriculas  text[];
  v_brands      int;
  v_ext_locs    text[];
  v_channels    int;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'preview_scope_by_token: token no válido';
  end if;

  select mi.recipe_item_id, mi.external_id
    into v_recipe_item, v_external_id
  from menu_item mi
  where mi.id = p_menu_item_id and mi.account_id = v_device.account_id;

  select array_agg(distinct mi.external_id) filter (where mi.external_id is not null),
         count(distinct mi.brand_id)
    into v_matriculas, v_brands
  from menu_item mi
  where mi.account_id = v_device.account_id
    and (
      (v_recipe_item is not null and mi.recipe_item_id = v_recipe_item)
      or (v_external_id is not null and mi.external_id = v_external_id)
      or mi.id = p_menu_item_id
    );

  select array_agg(distinct elm.external_location_id)
    into v_ext_locs
  from external_location_map elm
  where elm.account_id = v_device.account_id and elm.source = 'lastapp'
    and elm.is_active and elm.location_id = v_device.location_id;

  if v_matriculas is not null and array_length(v_matriculas,1) > 0 then
    select count(distinct ecp.external_channel)
      into v_channels
    from external_catalog_product ecp
    where ecp.account_id = v_device.account_id
      and ecp.organization_product_id::text = any(v_matriculas)
      and (v_ext_locs is null or ecp.external_location_id::text = any(v_ext_locs));
  end if;

  return jsonb_build_object('brands', coalesce(v_brands,0), 'channels', coalesce(v_channels,0));
end;
$function$;
