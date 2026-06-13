-- supabase/migrations/20260613T2800_kds_board_ticket_completo.sql
-- ============================================================================
-- CAPA 1 del KDS · TICKET COMPLETO (Nivel 1a): combos desglosados, modificadores
-- y notas de cliente en el tablero.
-- ============================================================================
-- HASTA HOY: kds_board solo traía las líneas product (coalesce(line_type,'product')
-- ='product') y DESCARTABA las hijas (combo_item, modifier). Un combo se veía
-- como una sola línea opaca; los modificadores y las notas del cliente, invisibles.
--
-- AHORA (solo se AÑADE, no se quita nada):
--   (1) children: cada línea PADRE (parent_sale_line_id is null) trae un array
--       `children` con sus líneas hijas (parent_sale_line_id = id del padre):
--       combo_item (componentes del menú) y modifier (+queso, sin cebolla). Cada
--       hija: line_id, name (product_name), qty (quantity), line_type, customer_note.
--       Las líneas sin padre que NO sean product (raras) salen como producto suelto.
--   (2) customer_note: nota del cliente por plato. Se extrae de sale.raw_tab
--       (text → jsonb) en raw_tab->'products' (fallback raw_tab->'bills'->0->'products')
--       y se casa a la línea por sale_line.external_product_id =
--       producto->>'organizationProductId' (RECON: casa exacto). string|null.
--
-- SE PRESERVA TODO lo demás: canal por COALESCE, ventana 2 h, exclusión de
-- tickets con expo done, menu_item_id, allergens, marked, stations, is_default,
-- default_station_id, expo_station_id, fallback de ruteo y derivación por token.
--
-- CREATE OR REPLACE de kds_board. Idempotente. NO toca kds_recipe. No llama
-- funciones con guard de usuario.
-- ============================================================================

create or replace function public.kds_board(
  p_location_id uuid default null,
  p_device_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_location_id uuid := p_location_id;
  v_device     kds_device;
  v_station_filter uuid[] := null;
  v_default_station uuid;
  v_result     jsonb;
begin
  if p_device_token is not null then
    v_device := public.kds_resolve_device(p_device_token);
    if v_device.id is null then
      raise exception 'kds_board: token de dispositivo no válido';
    end if;
    if v_location_id is null then
      v_location_id := v_device.location_id;
    elsif v_device.location_id <> v_location_id then
      raise exception 'kds_board: el token no corresponde a esta ubicación';
    end if;
    v_account_id := v_device.account_id;
    v_station_filter := v_device.station_ids;
    update kds_device set last_seen_at = now() where id = v_device.id;
  else
    if v_location_id is null then
      raise exception 'kds_board: falta location o token';
    end if;
    select account_id into v_account_id from locations where id = v_location_id;
    if v_account_id is null then
      raise exception 'kds_board: ubicación inexistente';
    end if;
    if not belongs_to_account(v_account_id) then
      raise exception 'kds_board: sin acceso a esta ubicación';
    end if;
  end if;

  -- estación por defecto del local (fallback de ruteo)
  select id into v_default_station from kitchen_station
   where location_id = v_location_id and is_default and is_active limit 1;

  with vivos as (
    select s.id, s.external_ref, s.external_tab_ref, s.status,
           s.brand_id, s.channel_id, s.external_channel_text,
           s.opened_at, s.closed_at, s.sold_at, s.raw_tab,
           coalesce(s.opened_at, s.sold_at, s.created_at) as entro_at
    from sale s
    where s.location_id = v_location_id
      and s.account_id = v_account_id
      and s.status <> 'cancelled'
      and not exists (
        select 1 from kds_ticket_station_state st
        join kitchen_station k on k.id = st.station_id
        where st.sale_id = s.id and k.kind = 'expo' and st.status = 'done'
      )
      and (s.status <> 'closed' or coalesce(s.closed_at, s.sold_at) >= now() - interval '2 hours')
  ),
  -- Notas de cliente extraídas del crudo del TPV. raw_tab es text; se castea a
  -- jsonb con safe_jsonb (devuelve null si el raw es inválido/vacío, NO lanza:
  -- un pedido con raw_tab sucio no muestra nota, pero el tablero del local sigue
  -- vivo) y con guarda de que `products` sea array. Casado por
  -- organizationProductId (= sale_line.external_product_id).
  notas as (
    select v.id as sale_id,
           (prod->>'organizationProductId') as ext_pid,
           nullif(btrim(prod->>'comments'), '') as note
    from vivos v
    cross join lateral (
      select safe_jsonb(v.raw_tab) as tab
    ) rt
    cross join lateral (
      select coalesce(rt.tab -> 'products', rt.tab -> 'bills' -> 0 -> 'products') as products
    ) p
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(p.products) = 'array' then p.products else '[]'::jsonb end
    ) as prod
    where nullif(btrim(prod->>'comments'), '') is not null
      and (prod->>'organizationProductId') is not null
  ),
  -- Líneas PADRE (visibles en la tarjeta): producto o, en raro, top-level no-product.
  padres as (
    select sl.sale_id, sl.id as line_id, sl.product_name, sl.quantity,
           sl.line_type, sl.menu_item_id, sl.external_product_id,
           coalesce(
             ri.kds_station_id,
             (select fr.station_id from kitchen_family_route fr
               where fr.account_id = v_account_id and fr.family_id = ri.family_id limit 1),
             v_default_station                                   -- fallback estación por defecto
           ) as station_id,
           coalesce(ls.marked, false) as marked,
           array(select allergen_code from recipe_item_allergen a
                  where a.recipe_item_id = ri.id and a.state = 'contains') as allergens
    from sale_line sl
    left join menu_item mi on mi.id = sl.menu_item_id
    left join recipe_item ri on ri.id = mi.recipe_item_id
    left join kds_line_state ls on ls.sale_line_id = sl.id
    where sl.sale_id in (select id from vivos)
      and sl.parent_sale_line_id is null
  ),
  -- Líneas HIJAS (combo_item, modifier): cuelgan de su padre por parent_sale_line_id.
  hijas as (
    select sl.parent_sale_line_id, sl.sale_id, sl.id as line_id,
           sl.product_name, sl.quantity, sl.line_type, sl.external_product_id
    from sale_line sl
    where sl.sale_id in (select id from vivos)
      and sl.parent_sale_line_id is not null
  ),
  tickets as (
    select v.id as sale_id, v.external_ref, v.external_tab_ref, v.status,
           b.name as brand, coalesce(ch.name, v.external_channel_text) as channel, v.entro_at,
           round(extract(epoch from (now() - v.entro_at)) / 60.0)::int as minutos,
           (select jsonb_agg(jsonb_build_object(
                'line_id', l.line_id, 'name', l.product_name, 'qty', l.quantity,
                'menu_item_id', l.menu_item_id,
                'station_id', l.station_id, 'marked', l.marked, 'allergens', l.allergens,
                'has_recipe', (l.menu_item_id is not null),
                'customer_note', (
                  select n.note from notas n
                   where n.sale_id = l.sale_id and n.ext_pid = l.external_product_id limit 1
                ),
                'children', coalesce((
                  select jsonb_agg(jsonb_build_object(
                           'line_id', h.line_id, 'name', h.product_name, 'qty', h.quantity,
                           'line_type', h.line_type,
                           'customer_note', (
                             select n2.note from notas n2
                              where n2.sale_id = h.sale_id and n2.ext_pid = h.external_product_id limit 1
                           )
                         ) order by h.line_id)
                  from hijas h where h.parent_sale_line_id = l.line_id
                ), '[]'::jsonb)
            ) order by l.product_name)
            from padres l where l.sale_id = v.id) as lineas,
           (select jsonb_object_agg(st.station_id, st.status)
            from kds_ticket_station_state st where st.sale_id = v.id) as estaciones
    from vivos v
    left join brand b on b.id = v.brand_id
    left join sales_channel ch on ch.id = v.channel_id
  )
  select jsonb_build_object(
    'location_id', v_location_id,
    'station_filter', to_jsonb(v_station_filter),
    'default_station_id', v_default_station,
    'expo_station_id', (select id from kitchen_station
                         where location_id = v_location_id and kind='expo' and is_active
                         order by display_order limit 1),
    'stations', (
      select coalesce(jsonb_agg(jsonb_build_object(
                'id', k.id, 'name', k.name, 'kind', k.kind,
                'display_order', k.display_order, 'is_default', k.is_default
              ) order by k.display_order), '[]'::jsonb)
      from kitchen_station k
      where k.account_id = v_account_id and k.location_id = v_location_id and k.is_active
    ),
    'now', now(),
    'tickets', coalesce(jsonb_agg(to_jsonb(t) order by t.entro_at) filter (where t.sale_id is not null), '[]'::jsonb)
  ) into v_result
  from tickets t;

  return v_result;
end;
$$;
