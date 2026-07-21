-- 20260721T1100_track_by_token_pickup_phone.sql
-- Añade el teléfono del LOCAL (locations.phone) al contrato de track_by_token,
-- para que la página /seguir pueda ofrecer "Llamar al restaurante" (secundario en
-- normal, primario en incidencia). Solo se pinta en el front si viene poblado.
-- Sin otros cambios: mismo cuerpo que la versión previa + 'pickup_phone'.

CREATE OR REPLACE FUNCTION public.track_by_token(p_token text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select jsonb_build_object(
      'found', true,
      'stage', case
        when da.state = 'delivered' or s.delivery_state = 'delivered'
             or s.order_status in ('completed','delivered') then 'entregado'
        when da.state = 'failed' or s.delivery_state = 'failed' then 'incidencia'
        when da.state in ('picked_up','in_delivery')
             or s.delivery_state = 'in_delivery' then 'en_camino'
        else 'preparando' end,
      'brand', b.name, 'brand_id', b.id, 'brand_logo', b.logo_url,
      'customer_name', s.customer_name, 'delivery_address', s.delivery_address,
      'rider_name', s.rider_name, 'rider_phone', s.rider_phone, 'rider_transport', s.rider_transport_type,
      'rider_lat', s.rider_lat, 'rider_lng', s.rider_lng, 'rider_seen_at', s.rider_seen_at,
      'eta_delivery', s.eta_delivery,
      'dest_lat', null, 'dest_lng', null,
      'pickup_name', l.name, 'pickup_lat', l.lat, 'pickup_lng', l.lng,
      'pickup_phone', l.phone,
      'shop_slug', a.slug, 'shop_logo', a.shop_logo_url,
      'offer', (
        select jsonb_build_object('code', c.code, 'pct', c.value, 'min_subtotal', c.min_subtotal)
        from public.coupon c
        where c.account_id = s.account_id and c.active and 'shop' = any(c.channels)
          and c.discount_type = 'percent' and c.code is not null
          and coalesce(c.origin,'') <> 'agent'
          and (c.starts_at is null or c.starts_at <= now())
          and (c.ends_at   is null or c.ends_at   >= now())
        order by c.value desc limit 1
      )
    )
    from sale s
    left join brand b on b.id = s.brand_id
    left join locations l on l.id = s.location_id
    left join accounts a on a.id = s.account_id
    left join lateral (
      select da2.* from delivery_assignment da2
      where da2.sale_id = s.id and da2.state <> 'canceled'
      order by da2.created_at desc limit 1
    ) da on true
    where s.public_token = p_token limit 1
  ), jsonb_build_object('found', false));
$function$;
