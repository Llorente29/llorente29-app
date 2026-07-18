-- 20260718T2100_reparto_track_by_token.sql
-- T4 · Tracking al cliente — RPC pública por token.
-- Contrato ALINEADO a la página ya existente src/modules/seguimiento/SeguimientoRoute.tsx,
-- que llama `track_by_token` y consume una forma PLANA con `stage`:
--   { found, stage, brand, customer_name, delivery_address,
--     rider_name, rider_phone, rider_transport, rider_lat, rider_lng, rider_seen_at, eta_delivery,
--     dest_lat, dest_lng, pickup_name, pickup_lat, pickup_lng }
-- El public_token ES la credencial (patrón by-token). SECURITY DEFINER + GRANT anon.
-- Solo expone campos seguros (nada de coste/margen/otros clientes).
--
-- stage: entregado (delivered/completed) · incidencia (failed) · en_camino (picked_up/in_delivery)
--        · preparando (resto). Deriva de delivery_assignment.state + sale.order_status.
-- dest_lat/lng: v1 = null (la venta solo guarda dirección de texto). La página centra en la
--   moto; el pin de destino llega en v2 (capturar coords al pedir o geocodificar en ingesta).

create or replace function public.track_by_token(p_token text)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select coalesce((
    select jsonb_build_object(
      'found', true,
      'stage', case
        when da.state = 'delivered' or s.order_status in ('completed','delivered') then 'entregado'
        when da.state = 'failed' then 'incidencia'
        when da.state in ('picked_up','in_delivery') then 'en_camino'
        else 'preparando' end,
      'brand',            b.name,
      'customer_name',    s.customer_name,
      'delivery_address', s.delivery_address,
      'rider_name',       s.rider_name,
      'rider_phone',      s.rider_phone,   -- botón "Llamar" en la página
      'rider_transport',  s.rider_transport_type,
      'rider_lat',        s.rider_lat,
      'rider_lng',        s.rider_lng,
      'rider_seen_at',    s.rider_seen_at,
      'eta_delivery',     s.eta_delivery,
      'dest_lat',         null,   -- v1: sin coords de destino (solo dirección texto)
      'dest_lng',         null,
      'pickup_name',      l.name,
      'pickup_lat',       l.lat,
      'pickup_lng',       l.lng
    )
    from sale s
    left join brand b     on b.id = s.brand_id
    left join locations l on l.id = s.location_id
    left join lateral (
      select da2.*
      from delivery_assignment da2
      where da2.sale_id = s.id and da2.state <> 'canceled'
      order by da2.created_at desc
      limit 1
    ) da on true
    where s.public_token = p_token
    limit 1
  ), jsonb_build_object('found', false));
$function$;

grant execute on function public.track_by_token(text) to anon;

-- Retira la versión previa con nombre/forma que NO casa con la página.
drop function if exists public.track_order_by_token(text);
