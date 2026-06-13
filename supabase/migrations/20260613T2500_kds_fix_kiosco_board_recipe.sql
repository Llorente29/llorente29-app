-- supabase/migrations/20260613T2500_kds_fix_kiosco_board_recipe.sql
-- ============================================================================
-- CAPA 1 del KDS · FIX para el KIOSCO (3 puntos que detectó Claude Code)
-- ============================================================================
-- (1) kds_board: cada línea ahora incluye `menu_item_id` (lo necesita el Cook
--     Mode para llamar a kds_recipe). Faltaba en el objeto JSON.
-- (2) kds_board: añade bloque `stations` (id, name, kind) de la ubicación, para
--     que el KIOSCO (sin sesión) pinte los nombres de estación sin consultar
--     kitchen_station por RLS.
-- (3) kds_board y kds_recipe: si p_location_id es NULL pero hay token, el LOCAL
--     se DERIVA del token. El kiosco no conoce su location_id; solo el token.
--
-- CREATE OR REPLACE. Mantiene canal por COALESCE y ventana de 2 h. Idempotente.
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

  with vivos as (
    select s.id, s.external_ref, s.external_tab_ref, s.status,
           s.brand_id, s.channel_id, s.external_channel_text,
           s.opened_at, s.closed_at, s.sold_at,
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
  lineas as (
    select sl.sale_id, sl.id as line_id, sl.product_name, sl.quantity,
           sl.line_type, sl.menu_item_id,
           coalesce(
             ri.kds_station_id,
             (select fr.station_id from kitchen_family_route fr
               where fr.account_id = v_account_id and fr.family_id = ri.family_id limit 1)
           ) as station_id,
           coalesce(ls.marked, false) as marked,
           array(select allergen_code from recipe_item_allergen a
                  where a.recipe_item_id = ri.id and a.state = 'contains') as allergens
    from sale_line sl
    left join menu_item mi on mi.id = sl.menu_item_id
    left join recipe_item ri on ri.id = mi.recipe_item_id
    left join kds_line_state ls on ls.sale_line_id = sl.id
    where sl.sale_id in (select id from vivos)
      and coalesce(sl.line_type,'product') = 'product'
  ),
  tickets as (
    select v.id as sale_id, v.external_ref, v.external_tab_ref, v.status,
           b.name as brand, coalesce(ch.name, v.external_channel_text) as channel, v.entro_at,
           round(extract(epoch from (now() - v.entro_at)) / 60.0)::int as minutos,
           (select jsonb_agg(jsonb_build_object(
                'line_id', l.line_id, 'name', l.product_name, 'qty', l.quantity,
                'menu_item_id', l.menu_item_id,
                'station_id', l.station_id, 'marked', l.marked, 'allergens', l.allergens,
                'has_recipe', (l.menu_item_id is not null)
            ) order by l.product_name)
            from lineas l where l.sale_id = v.id) as lineas,
           (select jsonb_object_agg(st.station_id, st.status)
            from kds_ticket_station_state st where st.sale_id = v.id) as estaciones
    from vivos v
    left join brand b on b.id = v.brand_id
    left join sales_channel ch on ch.id = v.channel_id
  )
  select jsonb_build_object(
    'location_id', v_location_id,
    'station_filter', to_jsonb(v_station_filter),
    'stations', (
      select coalesce(jsonb_agg(jsonb_build_object(
                'id', k.id, 'name', k.name, 'kind', k.kind, 'display_order', k.display_order
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

create or replace function public.kds_recipe(
  p_menu_item_id uuid,
  p_qty numeric default 1,
  p_token text default null,
  p_location_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ri      uuid;
  v_account uuid;
  v_qty     numeric := greatest(coalesce(p_qty, 1), 1);
  v_loc     uuid := p_location_id;
  v_device  kds_device;
  v_result  jsonb;
begin
  select mi.recipe_item_id, mi.account_id into v_ri, v_account
  from menu_item mi where mi.id = p_menu_item_id;
  if v_ri is null then
    return jsonb_build_object('found', false);
  end if;

  if p_token is not null then
    v_device := public.kds_resolve_device(p_token);
    if v_device.id is null then raise exception 'kds_recipe: token no válido'; end if;
    if v_loc is null then v_loc := v_device.location_id; end if;
    if v_device.account_id <> v_account then
      raise exception 'kds_recipe: el plato no pertenece a la cuenta del dispositivo';
    end if;
    update kds_device set last_seen_at = now() where id = v_device.id;
  else
    if not belongs_to_account(v_account) then
      raise exception 'kds_recipe: sin acceso';
    end if;
  end if;

  select jsonb_build_object(
    'found', true,
    'qty', v_qty,
    'photo_url', coalesce(
      (select kitchen_photo_url from recipe_item where id = v_ri),
      (select photo_url from menu_item where id = p_menu_item_id)
    ),
    'allergens', (
      select coalesce(jsonb_agg(jsonb_build_object('code', allergen_code, 'state', state)
                                order by allergen_code), '[]'::jsonb)
      from recipe_item_allergen where recipe_item_id = v_ri and state in ('contains','may_contain')
    ),
    'ingredients', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', child.name,
        'unit', u.abbreviation,
        'qty_base', rl.quantity_gross,
        'qty_total', round(rl.quantity_gross * v_qty, 3),
        'cut', ct.name
      ) order by rl.position), '[]'::jsonb)
      from recipe_line rl
      join recipe_item child on child.id = rl.child_item_id
      left join kitchen_unit u on u.id = rl.unit_id
      left join kitchen_cut_type ct on ct.id = rl.cut_type_id
      where rl.parent_item_id = v_ri
    ),
    'steps', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'position', st.position, 'text', st.text, 'kind', st.kind,
        'duration_min', st.duration_min, 'temperature_c', st.temperature_c,
        'photo_url', st.photo_url,
        'ingredients', (
          select coalesce(jsonb_agg(ci.name order by ci.name), '[]'::jsonb)
          from recipe_item_step_line sln
          join recipe_line rl2 on rl2.id = sln.line_id
          join recipe_item ci on ci.id = rl2.child_item_id
          where sln.step_id = st.id
        )
      ) order by st.position), '[]'::jsonb)
      from recipe_item_step st where st.recipe_item_id = v_ri
    )
  ) into v_result;

  return v_result;
end;
$$;
