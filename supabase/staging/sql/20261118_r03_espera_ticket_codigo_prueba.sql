-- supabase/staging/sql/20261118_r03_espera_ticket_codigo_prueba.sql
--
-- SOLO STAGING. Prueba de 20261118T0310_r03_espera_ticket_codigo (y de la 0320,
-- el relleno de los abiertos). Aplica la 0300, la 0310 y la 0320 con \i dentro
-- de su transacción y acaba en ROLLBACK: staging no cambia. Datos inventados.
--
--   1. El disparador lee de raw_tab el código del teléfono, las indicaciones
--      y la nota del cliente (HubRise y Last). Espacios y saltos de línea
--      solos = null. Un raw_tab roto NO tumba el pedido.
--   2. La espera: despachar_sin_calle_vencidos() solo pide los de reparto
--      propio sin calle con punto del mapa, en local automático, con 5
--      minutos cumplidos; los marca para no pedirlos dos veces; los recientes,
--      con dirección o pegada, no. (pg_net no envía nada: la transacción se
--      revierte.)
--   3. El aviso dice a qué hora sale solo (sale_solo_at) y el modo del local.
--   4. Pedidos por token y el ticket devuelven el código, las dos notas y la
--      dirección pegada.
--   0. Uber, por pedido: las tres señales → propio (aunque la tabla diga
--      «Plataforma»); ninguna → la reparte Uber, fuera de zona; mezcladas →
--      lo decide una persona y no sale a Catcher.
--   7. Decidir quién reparte, desde la tablet, y que lo decidido se quede.
--   5. La 0320 rellena los abiertos que lo traían, pasa los Uber sin calle
--      abiertos a «la reparte Uber», y nada más.

begin;

do $$
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA R03 0310: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;

\i supabase/migrations/20261118T0300_r03_direccion_incompleta.sql
\i supabase/migrations/20261118T0310_r03_espera_ticket_codigo.sql

select set_config('folvy.reparto_tal_cual', 'on', true);

insert into public.kds_device (id, account_id, location_id, label, token) values
  ('e0310000-0000-4000-8000-0000000000d1', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', 'R03 0310 Norte Centro', 'r03-0310-prueba-norte-centro');

-- U1: Uber por HubRise con código, indicaciones y nota. L1: Last con nota e
-- indicaciones. B1: raw_tab roto (como reparto de la plataforma: en uno propio
-- lo rompería también resolve_dispatch, que convierte raw_tab sin protegerse;
-- eso ya era así y no se toca aquí). V1/V2/V3: sin calle con punto (vencido,
-- reciente, vencido pero con dirección pegada).
insert into public.sale
  (id, account_id, location_id, brand_id, channel_id, source, sold_at, created_at, accepted_at, total, status, order_status,
   service_type, delivery_address, delivery_address_fixed, external_channel_text, pos_short_code, customer_phone, raw_tab)
values
  ('e0310000-0000-4000-8000-0000000000f1', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b1', 'e0200000-0000-4000-8000-00000000a0c2', 'hubrise', now() - interval '2 minutes', now() - interval '2 minutes', now() - interval '2 minutes',
   20.00, 'open', 'accepted', 'own_delivery', 'Calle Inventada de Prueba 1, Unit: 2B', null, 'Uber Eats', 'U0310A', '+34900000000',
   '{"channel":"Uber Eats","service_type":"delivery","customer_notes":"Sin cebolla","customer":{"phone_access_code":"12345678","delivery_notes":"Timbre 2B","address_1":"Calle Inventada de Prueba 1","latitude":"40.4100","longitude":"-3.7000"}}'),
  ('e0310000-0000-4000-8000-0000000000f2', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b1', 'e0200000-0000-4000-8000-00000000a0c1', 'lastapp', now() - interval '2 minutes', now() - interval '2 minutes', now() - interval '2 minutes',
   20.00, 'open', 'accepted', 'own_delivery', 'Calle Inventada de Prueba 2', null, 'glovo', 'G0310B', null,
   E'{"customerNote":" \\n ","delivery":{"details":"Portal B"}}'),
  ('e0310000-0000-4000-8000-0000000000f3', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b1', 'e0200000-0000-4000-8000-00000000a0c1', 'hubrise', now(), now(), now(),
   20.00, 'open', 'accepted', 'platform_delivery', null, null, 'Glovo', 'G0310C', null,
   '{"customer": roto'),
  ('e0310000-0000-4000-8000-0000000000e1', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b1', 'e0200000-0000-4000-8000-00000000a0c1', 'hubrise', now() - interval '7 minutes', now() - interval '7 minutes', now() - interval '6 minutes',
   20.00, 'open', 'accepted', 'own_delivery', null, null, 'Glovo', 'G0310V1', null,
   '{"customer":{"latitude":"40.4100","longitude":"-3.7000"}}'),
  ('e0310000-0000-4000-8000-0000000000e2', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b1', 'e0200000-0000-4000-8000-00000000a0c1', 'hubrise', now() - interval '2 minutes', now() - interval '2 minutes', now() - interval '2 minutes',
   20.00, 'open', 'accepted', 'own_delivery', null, null, 'Glovo', 'G0310V2', null,
   '{"customer":{"latitude":"40.4100","longitude":"-3.7000"}}'),
  ('e0310000-0000-4000-8000-0000000000e3', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b1', 'e0200000-0000-4000-8000-00000000a0c1', 'hubrise', now() - interval '7 minutes', now() - interval '7 minutes', now() - interval '6 minutes',
   20.00, 'open', 'accepted', 'own_delivery', null, 'Calle Pegada de Prueba, 3', 'Glovo', 'G0310V3', null,
   '{"customer":{"latitude":"40.4100","longitude":"-3.7000"}}');

select set_config('folvy.reparto_tal_cual', '', true);

-- Uber, quién reparte por pedido (por encima de la tabla). Sin «tal cual»: así
-- pasan por «Quién reparte» y por la regla de Uber.
--   UT · las tres señales, marca con Uber en «Plataforma» (Smash) → propio
--   UZ · ninguna, marca en «Nosotros» (Pita del Sur)              → la reparte Uber
--   UM · mezcladas (calle y punto, sin cargo)                      → lo decide una persona
--   UN · mezcladas, para decidir «nosotros»
insert into public.sale
  (id, account_id, location_id, brand_id, channel_id, source, sold_at, created_at, accepted_at, total, status, order_status,
   service_type, delivery_address, external_channel_text, pos_short_code, raw_tab)
values
  ('e0310000-0000-4000-8000-0000000000c4', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b3', 'e0200000-0000-4000-8000-00000000a0c2', 'hubrise', now(), now(), now(),
   20.00, 'open', 'accepted', 'platform_delivery', 'Calle Inventada de Prueba 8', 'Uber Eats', 'U0310T',
   '{"service_type":"delivery","charges":[{"type":"delivery","price":"2.99 EUR"}],"customer":{"address_1":"Calle Inventada de Prueba 8","latitude":"40.4100","longitude":"-3.7000"}}'),
  ('e0310000-0000-4000-8000-0000000000c1', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b2', 'e0200000-0000-4000-8000-00000000a0c2', 'hubrise', now(), now(), now(),
   20.00, 'open', 'accepted', 'own_delivery', null, 'Uber Eats', 'U0310Z',
   '{"service_type":"delivery","charges":[{"type":"delivery","price":"0.00 EUR"}],"customer":{"address_1":null}}'),
  ('e0310000-0000-4000-8000-0000000000c2', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b2', 'e0200000-0000-4000-8000-00000000a0c2', 'hubrise', now(), now(), now(),
   20.00, 'open', 'accepted', 'own_delivery', 'Calle Inventada de Prueba 9', 'Uber Eats', 'U0310M',
   '{"service_type":"delivery","customer":{"address_1":"Calle Inventada de Prueba 9","latitude":"40.4100","longitude":"-3.7000"}}'),
  ('e0310000-0000-4000-8000-0000000000c5', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b2', 'e0200000-0000-4000-8000-00000000a0c2', 'hubrise', now(), now(), now(),
   20.00, 'open', 'accepted', 'own_delivery', 'Calle Inventada de Prueba 10', 'Uber Eats', 'U0310N',
   '{"service_type":"delivery","customer":{"address_1":"Calle Inventada de Prueba 10","latitude":"40.4100","longitude":"-3.7000"}}');

do $$
declare r record; j jsonb;
begin
  select service_type, delivery_by_reason into r from public.sale where id = 'e0310000-0000-4000-8000-0000000000c4';
  if r.service_type is distinct from 'own_delivery' or r.delivery_by_reason is not null then
    raise exception 'R03 0310 0a: Uber con las tres señales (y la tabla en «Plataforma») no ha quedado propio: %', r;
  end if;
  select service_type, delivery_by_reason into r from public.sale where id = 'e0310000-0000-4000-8000-0000000000c1';
  if r.service_type is distinct from 'platform_delivery' or r.delivery_by_reason is distinct from 'fuera_de_zona' then
    raise exception 'R03 0310 0b: Uber sin ninguna señal no ha pasado a «la reparte Uber · fuera de zona»: %', r;
  end if;
  select service_type, delivery_by_reason into r from public.sale where id = 'e0310000-0000-4000-8000-0000000000c2';
  if r.service_type is distinct from 'own_delivery' or r.delivery_by_reason is distinct from 'uber_decidir' then
    raise exception 'R03 0310 0c: Uber mezclado no ha quedado para decidir: %', r;
  end if;
  select * into r from public.resolve_dispatch('e0310000-0000-4000-8000-0000000000c2');
  if r.carrier is not null then raise exception 'R03 0310 0d: el mezclado sale a Catcher sin decidir (%).', r.carrier; end if;
  -- Un aviso posterior de Uber no lo cambia.
  update public.sale set raw_tab = raw_tab, order_status = 'in_preparation' where id = 'e0310000-0000-4000-8000-0000000000c1';
  if (select service_type || '/' || delivery_by_reason from public.sale where id = 'e0310000-0000-4000-8000-0000000000c1')
     is distinct from 'platform_delivery/fuera_de_zona' then
    raise exception 'R03 0310 0e: tras un aviso posterior ha cambiado.';
  end if;
  -- Un raw_tab ilegible es «no lo sé», no «ninguna señal»: ni falla ni manda a Uber.
  select * into r from public.uber_senales_de_reparto('{"customer": roto');
  if r.calle is not null or r.coordenadas is not null or r.cargo_envio is not null then
    raise exception 'R03 0310 0f: un raw_tab roto da señales (%/%/%).', r.calle, r.coordenadas, r.cargo_envio;
  end if;
  select * into r from public.sale_entrega_desde_raw('hubrise', '{"customer": roto');
  if r.customer_phone_code is not null or r.delivery_instructions is not null or r.order_customer_note is not null then
    raise exception 'R03 0310 0g: un raw_tab roto da datos de entrega.';
  end if;
  raise notice 'R03 0310 0: Uber · las tres → propio (aunque la tabla diga «Plataforma») · ninguna → la reparte Uber, fuera de zona (también tras otro aviso) · mezcladas → para decidir, sin Catcher («%»).', r.reason;
end $$;

do $$
declare r record;
begin
  -- 1. El disparador.
  select customer_phone_code, delivery_instructions, order_customer_note into r from public.sale where id = 'e0310000-0000-4000-8000-0000000000f1';
  if r.customer_phone_code is distinct from '12345678' or r.delivery_instructions is distinct from 'Timbre 2B' or r.order_customer_note is distinct from 'Sin cebolla' then
    raise exception 'R03 0310 1a: HubRise mal leído: %', r;
  end if;
  select customer_phone_code, delivery_instructions, order_customer_note into r from public.sale where id = 'e0310000-0000-4000-8000-0000000000f2';
  if r.delivery_instructions is distinct from 'Portal B' or r.order_customer_note is not null then
    raise exception 'R03 0310 1b: Last mal leído (la nota de espacios y saltos de línea tiene que quedar a null): %', r;
  end if;
  if not exists (select 1 from public.sale where id = 'e0310000-0000-4000-8000-0000000000f3') then
    raise exception 'R03 0310 1c: el raw_tab roto ha tumbado el pedido.';
  end if;
  raise notice 'R03 0310 1: disparador · HubRise código, indicaciones y nota · Last indicaciones y nota en blanco = null · raw_tab roto, el pedido entra.';
end $$;

-- 2. La espera, con Norte Centro en automático (solo dentro de esta transacción).
update public.locations set dispatch_mode = 'auto' where id = 'c01a0000-0000-4000-8000-0000000000a2';

do $$
declare n int; v_ids text;
begin
  n := public.despachar_sin_calle_vencidos();
  select string_agg(pos_short_code, ',' order by pos_short_code) into v_ids
    from public.sale where id::text like 'e0310000-%' and delivery_wait_sent_at is not null;
  if v_ids is distinct from 'G0310V1' then
    raise exception 'R03 0310 2a: ha pedido % (esperaba solo G0310V1: vencido, sin calle, con punto).', v_ids;
  end if;
  n := public.despachar_sin_calle_vencidos();  -- segunda pasada: no lo vuelve a pedir
  select count(*) into n from net.http_request_queue q where convert_from(q.body, 'UTF8') like '%e0310000-0000-4000-8000-0000000000e1%';
  if n <> 1 then raise exception 'R03 0310 2b: pedido a Catcher % veces (esperaba 1, también tras la segunda pasada).', n; end if;
  if not exists (select 1 from net.http_request_queue q where convert_from(q.body, 'UTF8') like '%e0310000-0000-4000-8000-0000000000e1%' and convert_from(q.body, 'UTF8') like '%tras_espera%') then
    raise exception 'R03 0310 2c: la petición no lleva tras_espera.';
  end if;
  raise notice 'R03 0310 2: la espera · sale G0310V1 (vencido) · no salen el reciente ni el de dirección pegada · una sola petición, con tras_espera.';
end $$;

update public.locations set dispatch_mode = 'manual' where id = 'c01a0000-0000-4000-8000-0000000000a2';

-- 3 y 4, como la tablet (anon).
set local role anon;

do $$
declare j jsonb; p jsonb; o jsonb;
begin
  j := public.pedidos_sin_direccion(null, 'r03-0310-prueba-norte-centro');
  select x into p from jsonb_array_elements(j->'pedidos') x where x->>'code' = 'G0310V2';
  if p is null or p->>'sale_solo_at' is null or p->>'dispatch_mode' is distinct from 'manual' then
    raise exception 'R03 0310 3: el aviso no dice cuándo sale ni el modo: %', p;
  end if;

  j := public.orders_feed_by_token('r03-0310-prueba-norte-centro');
  select x into o from jsonb_array_elements(j->'orders') x where x->>'sale_id' = 'e0310000-0000-4000-8000-0000000000f1';
  if o is null then raise exception 'R03 0310 4a: el pedido U0310A no sale en Pedidos de la tablet.'; end if;
  if o->>'customer_phone_code' is distinct from '12345678' or o->>'delivery_instructions' is distinct from 'Timbre 2B'
     or o->>'order_customer_note' is distinct from 'Sin cebolla' or not (o ? 'delivery_address_fixed') then
    raise exception 'R03 0310 4b: Pedidos de la tablet no trae lo nuevo: %', o - 'lineas';
  end if;

  o := public.order_for_print('r03-0310-prueba-norte-centro', 'e0310000-0000-4000-8000-0000000000f1');
  if o::text not like '%"customer_phone_code": "12345678"%' or o::text not like '%"delivery_instructions": "Timbre 2B"%' then
    raise exception 'R03 0310 4c: el ticket no trae el código ni las indicaciones.';
  end if;
  raise notice 'R03 0310 3 y 4: aviso con sale_solo_at y modo · Pedidos de la tablet y ticket con código, indicaciones, nota y dirección pegada.';

  -- El mezclado sale en el aviso para decidir; el de las tres y el de ninguna, no.
  j := public.pedidos_sin_direccion(null, 'r03-0310-prueba-norte-centro');
  if not exists (select 1 from jsonb_array_elements(j->'pedidos') x where x->>'code' = 'U0310M' and (x->>'decidir')::boolean) then
    raise exception 'R03 0310 7a: el Uber mezclado no sale en el aviso para decidir.';
  end if;
  if exists (select 1 from jsonb_array_elements(j->'pedidos') x where x->>'code' in ('U0310T', 'U0310Z')) then
    raise exception 'R03 0310 7b: sale en el aviso un Uber que no hay que decidir.';
  end if;
  -- Decidir: «uber» → la reparte Uber; «nosotros» → propio y ya puede salir.
  j := public.decidir_quien_reparte('e0310000-0000-4000-8000-0000000000c2', 'uber', 'r03-0310-prueba-norte-centro');
  j := public.decidir_quien_reparte('e0310000-0000-4000-8000-0000000000c5', 'nosotros', 'r03-0310-prueba-norte-centro');
  if j->>'carrier' is null then raise exception 'R03 0310 7c: decidido «nosotros» y el resolutor no lo deja salir: %', j; end if;
  raise notice 'R03 0310 7: el mezclado sale en el aviso para decidir · «uber» y «nosotros» desde la tablet.';
end $$;

reset role;

-- 5. El relleno de los abiertos: se borra lo que puso el disparador en U1 y se
-- rellena; y un Uber sin calle que entró antes de la regla (tal cual) pasa a
-- «la reparte Uber · fuera de zona».
select set_config('folvy.reparto_tal_cual', 'on', true);
insert into public.sale
  (id, account_id, location_id, brand_id, channel_id, source, sold_at, created_at, total, status, order_status,
   service_type, delivery_address, external_channel_text, pos_short_code, raw_tab)
values
  ('e0310000-0000-4000-8000-0000000000c3', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b2', 'e0200000-0000-4000-8000-00000000a0c2', 'hubrise', now(), now(),
   20.00, 'open', 'accepted', 'own_delivery', null, 'Uber Eats', 'U0310V', '{"customer":{"address_1":null}}');
select set_config('folvy.reparto_tal_cual', '', true);
update public.sale set customer_phone_code = null, delivery_instructions = null, order_customer_note = null
 where id = 'e0310000-0000-4000-8000-0000000000f1';
\i supabase/migrations/20261118T0320_r03_entrega_datos.sql

do $$
begin
  if not exists (select 1 from public.r03_entrega_relleno where sale_id = 'e0310000-0000-4000-8000-0000000000f1') then
    raise exception 'R03 0310 5a: la 0320 no ha rellenado U0310A.';
  end if;
  if exists (select 1 from public.r03_entrega_relleno where sale_id = 'e0310000-0000-4000-8000-0000000000f3') then
    raise exception 'R03 0310 5b: la 0320 ha tocado el de raw_tab roto.';
  end if;
  if (select customer_phone_code from public.sale where id = 'e0310000-0000-4000-8000-0000000000f1') is distinct from '12345678' then
    raise exception 'R03 0310 5c: el relleno no ha puesto el código.';
  end if;
  if (select service_type || '/' || coalesce(delivery_by_reason, '-') from public.sale where id = 'e0310000-0000-4000-8000-0000000000c3')
     is distinct from 'platform_delivery/fuera_de_zona' then
    raise exception 'R03 0310 5d: la 0320 no ha pasado el Uber sin calle abierto a «la reparte Uber».';
  end if;
  raise notice 'R03 0310 5: el relleno de los abiertos pone lo que traían, pasa el Uber sin calle a «la reparte Uber» y no toca lo demás.';
end $$;

do $$
declare r record;
begin
  select service_type, delivery_by_reason into r from public.sale where id = 'e0310000-0000-4000-8000-0000000000c2';
  if r.service_type is distinct from 'platform_delivery' or r.delivery_by_reason is distinct from 'decidido_uber' then
    raise exception 'R03 0310 7d: decidido «uber» y queda %', r;
  end if;
  update public.sale set raw_tab = raw_tab, order_status = 'in_preparation' where id = 'e0310000-0000-4000-8000-0000000000c5';
  select service_type, delivery_by_reason into r from public.sale where id = 'e0310000-0000-4000-8000-0000000000c5';
  if r.service_type is distinct from 'own_delivery' or r.delivery_by_reason is distinct from 'decidido_propio' then
    raise exception 'R03 0310 7e: lo decidido «nosotros» no se mantiene tras otro aviso: %', r;
  end if;
  raise notice 'R03 0310 7: lo decidido se queda (también tras otro aviso).';
end $$;

-- Como usuario de A (el ordenador): Pedidos de sesión trae lo nuevo.
set local role authenticated;
do $$
declare j jsonb; o jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
  j := public.orders_feed('c01a0000-0000-4000-8000-0000000000a2');
  select x into o from jsonb_array_elements(j->'orders') x where x->>'sale_id' = 'e0310000-0000-4000-8000-0000000000f1';
  if o is null or o->>'customer_phone_code' is distinct from '12345678' then
    raise exception 'R03 0310 6: Pedidos del ordenador no trae el código: %', o - 'lineas';
  end if;
  raise notice 'R03 0310 6: Pedidos del ordenador, como usuario de A, con el código.';
end $$;
reset role;

rollback;
