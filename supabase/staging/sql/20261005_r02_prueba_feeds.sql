-- ============================================================================
-- SOLO STAGING-CONTA · R02 · EL FEED DE LA COCINA SIGUE FUNCIONANDO
-- ----------------------------------------------------------------------------
-- La 0200 borra marca_reparte_propio, a la que llamaban orders_feed y
-- orders_feed_by_token. La 0120 les cambia esa expresión por el service_type
-- del pedido. Aquí se comprueba, como admin de la cuenta A, que orders_feed
-- responde (sin la función borrada) y que brand_own_delivery es la modalidad de
-- cada pedido: 7B000 (Pita del Sur · Uber, «propio») sí; 7B001 (Smash · Glovo,
-- saneado a «la reparte Glovo») no. Solo lee.
-- ============================================================================
do $$
declare t text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select string_agg(platform_order_code || '=' || coalesce(service_type, '∅') || '/' || coalesce(brand_own_delivery::text, '∅'), ', ' order by platform_order_code)
    into t
    from public.orders_feed('c01a0000-0000-4000-8000-00000000000a')
   where platform_order_code in ('7B000', '7B001');
  raise notice 'R02 · orders_feed: %', t;
  if t is distinct from '7B000=own_delivery/true, 7B001=platform_delivery/false' then
    raise exception 'R02: orders_feed no da lo esperado: %', t;
  end if;
  perform set_config('role', 'none', true);
end $$;
