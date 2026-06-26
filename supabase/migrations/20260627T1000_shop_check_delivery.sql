create or replace function public.shop_check_delivery(
  p_slug text,
  p_location_id uuid,
  p_lat double precision,
  p_lng double precision
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account_id uuid;
  v_pt geography;
  v_zone record;
begin
  select id into v_account_id from accounts where slug = p_slug;
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'account');
  end if;

  v_pt := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;

  -- Zona activa del local que cubre el punto (radio por ahora; menor prioridad gana)
  select dz.id, dz.name, dz.delivery_fee, dz.min_order, dz.eta_min,
         st_distance(v_pt, dz.center) as dist_m, dz.radius_m
    into v_zone
  from delivery_zone dz
  where dz.account_id = v_account_id
    and dz.location_id = p_location_id
    and dz.is_active = true
    and dz.method = 'radius'
    and dz.center is not null
    and st_dwithin(v_pt, dz.center, dz.radius_m)
  order by dz.priority nulls last, st_distance(v_pt, dz.center)
  limit 1;

  if v_zone.id is null then
    return jsonb_build_object('ok', false, 'reason', 'out_of_zone');
  end if;

  return jsonb_build_object(
    'ok', true,
    'zone_id', v_zone.id,
    'zone_name', v_zone.name,
    'delivery_fee', v_zone.delivery_fee,
    'min_order', v_zone.min_order,
    'eta_min', v_zone.eta_min,
    'distance_m', round(v_zone.dist_m)
  );
end;
$function$;
