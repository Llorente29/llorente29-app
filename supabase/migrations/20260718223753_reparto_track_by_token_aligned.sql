create or replace function public.track_by_token(p_token text)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select coalesce((
    select jsonb_build_object(
      'found', true,
      'stage', case
        when da.state = 'delivered' or s.order_status in ('completed','delivered') then 'entregado'
        when da.state = 'failed' then 'incidencia'
        when da.state in ('picked_up','in_delivery') then 'en_camino'
        else 'preparando' end,
      'brand', b.name, 'customer_name', s.customer_name, 'delivery_address', s.delivery_address,
      'rider_name', s.rider_name, 'rider_transport', s.rider_transport_type,
      'rider_lat', s.rider_lat, 'rider_lng', s.rider_lng, 'rider_seen_at', s.rider_seen_at,
      'eta_delivery', s.eta_delivery,
      'dest_lat', null, 'dest_lng', null,
      'pickup_name', l.name, 'pickup_lat', l.lat, 'pickup_lng', l.lng
    )
    from sale s
    left join brand b on b.id = s.brand_id
    left join locations l on l.id = s.location_id
    left join lateral (
      select da2.* from delivery_assignment da2
      where da2.sale_id = s.id and da2.state <> 'canceled'
      order by da2.created_at desc limit 1
    ) da on true
    where s.public_token = p_token limit 1
  ), jsonb_build_object('found', false));
$function$;
grant execute on function public.track_by_token(text) to anon;
drop function if exists public.track_order_by_token(text);