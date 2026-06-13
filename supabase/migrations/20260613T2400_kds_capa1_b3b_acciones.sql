-- supabase/migrations/20260613T2400_kds_capa1_b3b_acciones.sql
-- ============================================================================
-- CAPA 1 del KDS · BLOQUE 3b — ACCIONES + COOK MODE
-- ============================================================================
--   kds_authorize(location_id, token)  helper: doble puerta (token | sesión) -> account_id
--   kds_bump(sale_id, station_id, token?)        marca estación 'done' (expo done = servido)
--   kds_unbump(sale_id, station_id, token?)      revierte (recall)
--   kds_mark_line(sale_line_id, token?)          toggle marcado por plato (reversible)
--   kds_recipe(menu_item_id, qty, token?)        Cook Mode: ingredientes base+escalado,
--                                                pasos ligados, alérgenos, foto
--
-- Todas SECURITY DEFINER con guard propio (la frontera es la RPC). auth.uid() es
-- null en el SQL Editor -> la rama de SESIÓN no se prueba ahí; la de TOKEN sí.
-- DDL sin BEGIN/COMMIT. Idempotente.
-- ============================================================================

-- Helper de autorización: token de dispositivo del local, o sesión con acceso.
-- Devuelve el account_id autorizado, o lanza excepción. No es de "motor abierto":
-- valida quién pregunta (la llama el front).
create or replace function public.kds_authorize(p_location_id uuid, p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device  kds_device;
  v_account uuid;
begin
  if p_token is not null then
    v_device := public.kds_resolve_device(p_token);
    if v_device.id is null then
      raise exception 'kds: token de dispositivo no válido';
    end if;
    if v_device.location_id <> p_location_id then
      raise exception 'kds: el token no corresponde a esta ubicación';
    end if;
    update kds_device set last_seen_at = now() where id = v_device.id;
    return v_device.account_id;
  end if;
  select account_id into v_account from locations where id = p_location_id;
  if v_account is null then raise exception 'kds: ubicación inexistente'; end if;
  if not belongs_to_account(v_account) then
    raise exception 'kds: sin acceso a esta ubicación';
  end if;
  return v_account;
end;
$$;

-- BUMP: marca (pedido × estación) como 'done'. Upsert idempotente. -------------
create or replace function public.kds_bump(p_sale_id uuid, p_station_id uuid, p_token text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
  v_loc     uuid;
begin
  select location_id into v_loc from sale where id = p_sale_id;
  if v_loc is null then raise exception 'kds_bump: venta inexistente'; end if;
  v_account := public.kds_authorize(v_loc, p_token);
  -- la estación debe ser de la misma cuenta/local
  if not exists (select 1 from kitchen_station k
                 where k.id = p_station_id and k.account_id = v_account and k.location_id = v_loc) then
    raise exception 'kds_bump: estación no válida para esta ubicación';
  end if;
  insert into kds_ticket_station_state (account_id, sale_id, station_id, status, updated_at)
  values (v_account, p_sale_id, p_station_id, 'done', now())
  on conflict (sale_id, station_id)
  do update set status = 'done', updated_at = now();
end;
$$;

-- UNBUMP (recall): devuelve la estación a 'pending'. --------------------------
create or replace function public.kds_unbump(p_sale_id uuid, p_station_id uuid, p_token text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loc uuid;
begin
  select location_id into v_loc from sale where id = p_sale_id;
  if v_loc is null then raise exception 'kds_unbump: venta inexistente'; end if;
  perform public.kds_authorize(v_loc, p_token);
  update kds_ticket_station_state
  set status = 'pending', updated_at = now()
  where sale_id = p_sale_id and station_id = p_station_id;
end;
$$;

-- MARK LINE: toggle del marcado por plato (sombreado/tachado), reversible. -----
-- Devuelve el nuevo estado (true=marcado). Upsert por sale_line.
create or replace function public.kds_mark_line(p_sale_line_id uuid, p_token text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
  v_loc     uuid;
  v_new     boolean;
begin
  select s.location_id, s.account_id into v_loc, v_account
  from sale_line sl join sale s on s.id = sl.sale_id
  where sl.id = p_sale_line_id;
  if v_loc is null then raise exception 'kds_mark_line: línea inexistente'; end if;
  perform public.kds_authorize(v_loc, p_token);

  insert into kds_line_state (account_id, sale_line_id, marked, marked_at, updated_at)
  values (v_account, p_sale_line_id, true, now(), now())
  on conflict (sale_line_id)
  do update set marked = not kds_line_state.marked,
                marked_at = case when not kds_line_state.marked then now() else null end,
                updated_at = now()
  returning marked into v_new;
  return v_new;
end;
$$;

-- COOK MODE: receta unificada para el KDS. ------------------------------------
-- Ingredientes (base + escalado × qty) + pasos (con ingredientes ligados) +
-- alérgenos + foto del plato. Solo lectura. p_qty = cantidad del pedido (>=1).
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
  v_result  jsonb;
begin
  -- Autorización: si viene location+token (kiosco) validamos; si no, por sesión
  -- (belongs_to_account de la cuenta del menu_item).
  select mi.recipe_item_id, mi.account_id into v_ri, v_account
  from menu_item mi where mi.id = p_menu_item_id;
  if v_ri is null then
    return jsonb_build_object('found', false);
  end if;

  if p_token is not null and p_location_id is not null then
    perform public.kds_authorize(p_location_id, p_token);
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
        'position', st.position,
        'text', st.text,
        'kind', st.kind,
        'duration_min', st.duration_min,
        'temperature_c', st.temperature_c,
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
