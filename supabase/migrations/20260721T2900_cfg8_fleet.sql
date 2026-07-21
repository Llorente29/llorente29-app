-- 20260721T2900_cfg8_fleet.sql
-- CFG-8: MAPA DE FLOTA. RPC de solo lectura con los repartidores en turno, su
-- última posición GPS (ya se emite) y su estado actual (libre / con pedido).

CREATE OR REPLACE FUNCTION public.reparto_fleet()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'name', c.name, 'transport_type', c.transport_type,
    'lat', c.last_lat, 'lng', c.last_lng, 'seen_at', c.last_seen_at,
    'status', case when da.id is not null then da.state else 'free' end,
    'order_code', coalesce(s.platform_order_code, s.external_ref, left(s.id::text,8)),
    'pickup_lat', l.lat, 'pickup_lng', l.lng
  ) order by c.name), '[]'::jsonb)
  from courier c
  left join lateral (
    select da2.* from delivery_assignment da2
    where da2.courier_id = c.id and da2.state in ('accepted','picked_up','in_delivery')
    order by da2.accepted_at desc limit 1
  ) da on true
  left join sale s on s.id = da.sale_id
  left join locations l on l.id = da.location_id
  where c.account_id = any(current_user_account_ids())
    and belongs_to_account(c.account_id)
    and c.active and c.on_shift;
$function$;
