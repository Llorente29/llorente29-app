-- supabase/staging/sql/20261118_r03_uber_auto_despacho_prueba.sql
--
-- SOLO STAGING. ¿Un Uber de reparto nuestro sale solo a Catcher en un local
-- automático? (Julio, 17/10: en las capturas R03U sale «Nosotros · aún sin
-- rider» y R03D/R03E salen «en Catcher».)
--
-- Lo de las capturas es de la SEMILLA: seed_r02_e2e.sql mete los pedidos con
-- los locales en manual (tg_auto_dispatch lleva la dirección de producción) y
-- a R03D/R03E les pone a mano un pedido de Catcher inventado; a R03U, no. En
-- producción, en 14 días, 116 de 117 Uber de reparto propio con calle están en
-- Catcher (el que no, de una marca con el reparto propio apagado, 03/10).
--
-- Aquí, por el camino de verdad: un Uber nuevo con calle, punto del mapa y
-- cargo de envío, «aceptado», en Norte Centro en automático y SIN «tal cual»
-- (pasa por la regla de Uber y por «Quién reparte»). Tiene que quedar de
-- reparto propio y tg_auto_dispatch tiene que encolar la llamada a
-- catcher-dispatch con ese pedido. pg_net solo envía lo encolado cuando la
-- transacción se confirma, y esto acaba en ROLLBACK: no sale ninguna llamada.
-- Datos inventados.
-- sin usuario: el pedido entra como lo mete el webhook de HubRise (postgres), y así se prueba aquí.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA R03 Uber automático: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;

-- El local en automático, como en producción (dentro de la transacción).
update public.locations set dispatch_mode = 'auto'
 where id = 'c01a0000-0000-4000-8000-0000000000a2' and account_id = 'c01a0000-0000-4000-8000-00000000000a';
delete from public.sale where id = 'e0399000-0000-4000-8000-0000000000f9';

insert into public.sale
  (id, account_id, location_id, brand_id, channel_id, source, sold_at, created_at, total, status, order_status,
   service_type, delivery_address, external_channel_text, pos_short_code, platform_order_code, raw_tab, customer_phone)
values
  ('e0399000-0000-4000-8000-0000000000f9', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b1', 'e0200000-0000-4000-8000-00000000a0c2', 'hubrise', now(), now(),
   26.00, 'open', 'accepted', 'own_delivery', 'Calle Inventada de Prueba 8, 28000 Madrid, Spain, Unit: 2B', 'Uber Eats', 'R03X', 'R03X',
   '{"channel":"Uber Eats","service_type":"delivery","charges":[{"type":"delivery","price":"2.99 EUR"}],"customer":{"address_1":"Calle Inventada de Prueba 8, 28000 Madrid, Spain","address_2":"Unit: 2B","phone":"+34900000009","phone_access_code":"11112222","latitude":"40.4190","longitude":"-3.6890"}}',
   '+34900000009');

do $$
declare r record; n int;
begin
  select service_type, delivery_by_reason, carrier_order_id into r from public.sale where id = 'e0399000-0000-4000-8000-0000000000f9';
  if r.service_type is distinct from 'own_delivery' then
    raise exception 'R03 Uber automático 1: con calle, punto y cargo no ha quedado de reparto propio: %', r;
  end if;
  select carrier into r from public.resolve_dispatch('e0399000-0000-4000-8000-0000000000f9');
  if r.carrier is distinct from 'catcher' then
    raise exception 'R03 Uber automático 2: el resolutor no lo manda a Catcher (%).', r.carrier;
  end if;
  select count(*) into n from net.http_request_queue q
   where q.url like '%/functions/v1/catcher-dispatch'
     and convert_from(q.body, 'UTF8')::jsonb ->> 'sale_id' = 'e0399000-0000-4000-8000-0000000000f9';
  if n <> 1 then
    raise exception 'R03 Uber automático 3: tg_auto_dispatch no ha encolado la llamada a catcher-dispatch (% en la cola).', n;
  end if;
  raise notice 'R03 Uber automático: de reparto propio, el resolutor dice Catcher y tg_auto_dispatch encola catcher-dispatch con el pedido. Lo de R03U en las capturas es la semilla.';
end $$;

\echo '>>> Un Uber de reparto nuestro sale solo a Catcher en un local automático. ROLLBACK: no se envía nada.'
rollback;
