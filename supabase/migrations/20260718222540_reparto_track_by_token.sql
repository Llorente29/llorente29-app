create or replace function public.track_order_by_token(p_token text)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select coalesce((
    select jsonb_build_object(
      'found',            true,
      'order_status',     s.order_status,
      'assignment_state', da.state,
      'service_type',     s.service_type,
      'customer_name',    s.customer_name,
      'delivery_address', s.delivery_address,
      'eta_delivery',     s.eta_delivery,
      'rider', jsonb_build_object(
        'name', s.rider_name, 'transport', s.rider_transport_type,
        'lat', s.rider_lat, 'lng', s.rider_lng, 'seen_at', s.rider_seen_at, 'phone', s.rider_phone),
      'pickup', jsonb_build_object('name', l.name, 'address', l.address, 'lat', l.lat, 'lng', l.lng),
      'timestamps', jsonb_build_object(
        'created_at', s.created_at, 'accepted_at', da.accepted_at, 'picked_up_at', da.picked_up_at,
        'in_delivery_at', da.in_delivery_at, 'delivered_at', da.delivered_at),
      'proof', case when da.state='delivered' and da.proof_url is not null
        then jsonb_build_object('type', da.proof_type, 'url', da.proof_url) else null end
    )
    from sale s
    left join locations l on l.id = s.location_id
    left join lateral (
      select da2.* from delivery_assignment da2
      where da2.sale_id = s.id and da2.state <> 'canceled'
      order by da2.created_at desc limit 1
    ) da on true
    where s.public_token = p_token
    limit 1
  ), jsonb_build_object('found', false));
$function$;

grant execute on function public.track_order_by_token(text) to anon;