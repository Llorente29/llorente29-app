create or replace function public._delivery_zone_account_of_location(p_location_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select account_id from public.locations where id = p_location_id;
$$;

create or replace function public.upsert_delivery_zone_radius(
  p_id          uuid,
  p_location_id uuid,
  p_name        text,
  p_radius_m    integer,
  p_lat         double precision,
  p_lng         double precision,
  p_delivery_fee numeric,
  p_min_order   numeric default null,
  p_eta_min     integer default null,
  p_priority    integer default 0
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_account uuid; v_id uuid;
begin
  v_account := public._delivery_zone_account_of_location(p_location_id);
  if v_account is null then raise exception 'Local no encontrado'; end if;
  if not public.current_user_is_admin_of(v_account) then raise exception 'Sin permiso'; end if;

  if p_id is null then
    insert into public.delivery_zone
      (account_id, location_id, name, method, radius_m, center, delivery_fee, min_order, eta_min, priority)
    values
      (v_account, p_location_id, p_name, 'radius', p_radius_m,
       ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
       p_delivery_fee, p_min_order, p_eta_min, p_priority)
    returning id into v_id;
  else
    update public.delivery_zone set
      name = p_name, radius_m = p_radius_m,
      center = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
      delivery_fee = p_delivery_fee, min_order = p_min_order, eta_min = p_eta_min, priority = p_priority
    where id = p_id and account_id = v_account
    returning id into v_id;
    if v_id is null then raise exception 'Zona no encontrada'; end if;
  end if;
  return v_id;
end; $$;

create or replace function public.upsert_delivery_zone_polygon(
  p_id          uuid,
  p_location_id uuid,
  p_name        text,
  p_geojson     jsonb,
  p_delivery_fee numeric,
  p_min_order   numeric default null,
  p_eta_min     integer default null,
  p_priority    integer default 0
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_account uuid; v_id uuid; v_geog geography;
begin
  v_account := public._delivery_zone_account_of_location(p_location_id);
  if v_account is null then raise exception 'Local no encontrado'; end if;
  if not public.current_user_is_admin_of(v_account) then raise exception 'Sin permiso'; end if;

  v_geog := ST_SetSRID(ST_GeomFromGeoJSON(p_geojson::text), 4326)::geography;

  if p_id is null then
    insert into public.delivery_zone
      (account_id, location_id, name, method, area, delivery_fee, min_order, eta_min, priority)
    values
      (v_account, p_location_id, p_name, 'polygon', v_geog, p_delivery_fee, p_min_order, p_eta_min, p_priority)
    returning id into v_id;
  else
    update public.delivery_zone set
      name = p_name, area = v_geog,
      delivery_fee = p_delivery_fee, min_order = p_min_order, eta_min = p_eta_min, priority = p_priority
    where id = p_id and account_id = v_account
    returning id into v_id;
    if v_id is null then raise exception 'Zona no encontrada'; end if;
  end if;
  return v_id;
end; $$;

create or replace function public.upsert_delivery_zone_postal(
  p_id          uuid,
  p_location_id uuid,
  p_name        text,
  p_postal_codes text[],
  p_delivery_fee numeric,
  p_min_order   numeric default null,
  p_eta_min     integer default null,
  p_priority    integer default 0
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_account uuid; v_id uuid;
begin
  v_account := public._delivery_zone_account_of_location(p_location_id);
  if v_account is null then raise exception 'Local no encontrado'; end if;
  if not public.current_user_is_admin_of(v_account) then raise exception 'Sin permiso'; end if;

  if p_id is null then
    insert into public.delivery_zone
      (account_id, location_id, name, method, postal_codes, delivery_fee, min_order, eta_min, priority)
    values
      (v_account, p_location_id, p_name, 'postal', p_postal_codes, p_delivery_fee, p_min_order, p_eta_min, p_priority)
    returning id into v_id;
  else
    update public.delivery_zone set
      name = p_name, postal_codes = p_postal_codes,
      delivery_fee = p_delivery_fee, min_order = p_min_order, eta_min = p_eta_min, priority = p_priority
    where id = p_id and account_id = v_account
    returning id into v_id;
    if v_id is null then raise exception 'Zona no encontrada'; end if;
  end if;
  return v_id;
end; $$;

create or replace function public.list_delivery_zones(p_location_id uuid)
returns table (
  id uuid, name text, method text, delivery_fee numeric, min_order numeric,
  eta_min integer, radius_m integer, priority integer, is_active boolean,
  center_lat double precision, center_lng double precision,
  area_geojson jsonb, postal_codes text[]
) language sql stable security definer set search_path = public as $$
  select z.id, z.name, z.method, z.delivery_fee, z.min_order, z.eta_min,
         z.radius_m, z.priority, z.is_active,
         ST_Y(z.center::geometry), ST_X(z.center::geometry),
         case when z.area is not null then ST_AsGeoJSON(z.area)::jsonb else null end,
         z.postal_codes
  from public.delivery_zone z
  join public.locations l on l.id = z.location_id
  where z.location_id = p_location_id
    and l.account_id = any (public.current_user_account_ids())
  order by z.delivery_fee asc, z.priority desc;
$$;

create or replace function public.delete_delivery_zone(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_account uuid;
begin
  select account_id into v_account from public.delivery_zone where id = p_id;
  if v_account is null then return; end if;
  if not public.current_user_is_admin_of(v_account) then raise exception 'Sin permiso'; end if;
  delete from public.delivery_zone where id = p_id;
end; $$;

grant execute on function public.upsert_delivery_zone_radius(uuid,uuid,text,integer,double precision,double precision,numeric,numeric,integer,integer) to authenticated;
grant execute on function public.upsert_delivery_zone_polygon(uuid,uuid,text,jsonb,numeric,numeric,integer,integer) to authenticated;
grant execute on function public.upsert_delivery_zone_postal(uuid,uuid,text,text[],numeric,numeric,integer,integer) to authenticated;
grant execute on function public.list_delivery_zones(uuid) to authenticated;
grant execute on function public.delete_delivery_zone(uuid) to authenticated;
