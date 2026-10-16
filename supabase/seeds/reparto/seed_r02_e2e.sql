-- ============================================================================
-- SEMILLAS R02 · Lo que necesitan las pruebas e2e en cada ejecución
-- (SOLO STAGING-CONTA; lo lanza .github/workflows/e2e-staging-conta.yml antes
-- de Playwright, con las mismas guardas).
--
-- Deja el escenario IGUAL en cada ejecución, aunque la anterior haya tocado
-- celdas o respondido a Folvy:
--   · dos pedidos VIVOS de hoy en Norte Centro (el feed solo enseña el día de
--     negocio): E2E01 · Burger Norte · Just Eat, «propio» SIN dirección
--     (etiqueta ámbar, con «Cambiar a “la reparte Just Eat”»); E2E02 · Smash
--     de Prueba · Glovo, lo reparte Glovo (etiqueta gris);
--   · las celdas que tocan las pruebas, como las dejó la migración;
--   · sin respuestas a Folvy en la cuenta A (la sugerencia de Pita del Sur en
--     Uber vuelve a salir);
--   · el 7B000 (Pita del Sur · Uber, sin dirección, de seed_r02_pedidos_vivos)
--     otra vez de hoy y abierto: la prueba de la cocina lo busca como el
--     segundo ámbar del local, y esa semilla se metió UNA vez, con la hora de
--     aquel momento. A las 7 horas el feed ya no lo enseña (e2e 37202533508,
--     04/10: «Uber no la ha mandado» no encontrado, en ordenador y móvil).
-- Inventado, sin datos de cliente. Locales en dispatch_mode 'manual': ningún
-- disparador llama a Catcher.
-- ============================================================================
select set_config('folvy.reparto_tal_cual', 'on', true);

insert into public.sale
  (id, account_id, location_id, brand_id, channel_id, source, sold_at, created_at, total, status, order_status,
   service_type, delivery_address, external_channel_text, platform_order_code, raw_tab)
values
  ('e0200000-0000-4000-8000-0000000053a1', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b1', 'e0200000-0000-4000-8000-00000000a0c3', 'hubrise', now() - interval '6 minutes',
   now() - interval '6 minutes', 19.90, 'open', 'accepted', 'own_delivery', null, 'Just Eat', 'E2E01',
   '{"service_type":"delivery","channel":"Just Eat","status":"accepted"}'),
  ('e0200000-0000-4000-8000-0000000053a2', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b3', 'e0200000-0000-4000-8000-00000000a0c1', 'hubrise', now() - interval '4 minutes',
   now() - interval '4 minutes', 14.00, 'open', 'accepted', 'platform_delivery', null, 'Glovo', 'E2E02',
   '{"service_type":"delivery","channel":"Glovo","status":"accepted"}')
on conflict (id) do update
  set sold_at = excluded.sold_at, created_at = excluded.created_at, status = 'open', order_status = 'accepted',
      service_type = excluded.service_type, delivery_address = null, dispatch_error = null,
      delivery_alarm_at = null, delivery_alarm_kind = null, delivery_alarm_ack_at = null, updated_at = now();

-- El 7B000, de hoy otra vez (no se crea aquí: si no existe, no hace nada).
-- R03: es un Uber sin calle, sin punto y sin cargo de envío: por la regla de
-- las tres señales lo reparte Uber («fuera de zona»). Ya no se le fuerza el
-- «propio»: lo pone la regla, en el bloque del R03 de abajo.
update public.sale
   set sold_at = now() - interval '8 minutes', created_at = now() - interval '8 minutes',
       status = 'open', order_status = 'accepted', updated_at = now()
 where id = 'e0200000-0000-4000-8000-0000000052a1'
   and account_id = 'c01a0000-0000-4000-8000-00000000000a';

select set_config('folvy.reparto_tal_cual', '', true);

-- Las celdas que tocan las pruebas, como las dejó la migración.
insert into public.brand_delivery_policy (account_id, brand_id, channel_slug, delivery_by, source, decided_by_name, note)
values
  ('c01a0000-0000-4000-8000-00000000000a', 'e0200000-0000-4000-8000-00000000a0b1', 'justeat', 'own',      'migrated', 'Migración R02', 'restaurada por seed_r02_e2e'),
  ('c01a0000-0000-4000-8000-00000000000a', 'e0200000-0000-4000-8000-00000000a0b3', 'uber',    'platform', 'migrated', 'Migración R02', 'restaurada por seed_r02_e2e')
on conflict (account_id, brand_id, channel_slug, location_id) do update
  set delivery_by = excluded.delivery_by, source = excluded.source, decided_by = null,
      decided_by_name = excluded.decided_by_name, decided_at = now(), note = excluded.note;
delete from public.brand_delivery_policy
 where account_id = 'c01a0000-0000-4000-8000-00000000000a'
   and location_id <> '00000000-0000-0000-0000-000000000000';
delete from public.delivery_policy_suggestion where account_id = 'c01a0000-0000-4000-8000-00000000000a';

-- ============================================================================
-- R03 · La dirección que no llega (16/10). Los tres casos del encargo, en Norte
-- Centro, y dos tablets (Norte Centro y Norte Mercado) para el permiso por
-- local. Inventado, sin datos de cliente. Solo si las migraciones del R03 están
-- en staging (las columnas nuevas): sin ella, esta parte no hace nada y el resto
-- de la semilla sigue igual.
--   R03A · con dirección              → ticket con el bloque ENTREGA
--   R03N · con dirección, indicaciones y nota → ticket con el recuadro de notas
--   R03B · sin calle, con punto       → línea «Sin dirección completa»; la completa el ordenador
--   R03C · sin calle ni punto         → no ha podido salir: aviso rojo con el motivo
--   R03D · sin calle, con punto       → la tablet: solo la línea informativa, sin botón
--   R03E · sin calle, con punto       → en la lista de Despacho, sin completar
-- (Locales de staging en «manual»: no sale nada a Catcher de verdad. El motivo
-- del R03C es el de resolve_dispatch en un local automático.)
--   R03V · Uber sin calle, sin punto, sin cargo → la reparte Uber, fuera de
--          zona: ni aviso ni Catcher; ticket como el de la plataforma
--   R03T · Uber con las tres, marca con Uber en «Plataforma» → propio (la regla
--          por pedido manda sobre la tabla)
--   R03M · Uber mezclado → aviso «Decide quién reparte»; no sale a Catcher
--   R03U · Uber con dirección y código de acceso → no sale en el aviso; el
--          ticket y la tarjeta llevan «Tel. … · código …»
-- Teléfonos y códigos inventados (900 000 000, 600 000 000, 12345678).
-- ============================================================================
do $r03$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'sale' and column_name = 'customer_phone_code') then
    raise notice 'R03: las migraciones 0300 y 0310 no están en staging; escenario del R03 sin sembrar.';
    return;
  end if;

  -- El 7B000 por la regla de Uber (sin «tal cual»): sin ninguna de las tres
  -- señales → la reparte Uber · fuera de zona.
  update public.sale set delivery_by_reason = null, updated_at = now()
   where id = 'e0200000-0000-4000-8000-0000000052a1' and account_id = 'c01a0000-0000-4000-8000-00000000000a';

  perform set_config('folvy.reparto_tal_cual', 'on', true);

  insert into public.kds_device (id, account_id, location_id, label, token) values
    ('e0300000-0000-4000-8000-0000000000e1', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', 'R03 e2e Norte Centro', 'r03-e2e-norte-centro'),
    ('e0300000-0000-4000-8000-0000000000e2', 'c01a0000-0000-4000-8000-00000000000a', 'e0200000-0000-4000-8000-0000000000a3', 'R03 e2e Norte Mercado', 'r03-e2e-norte-mercado')
  on conflict (id) do update set is_active = true, location_id = excluded.location_id, token = excluded.token;

  insert into public.sale
    (id, account_id, location_id, brand_id, channel_id, source, sold_at, created_at, total, status, order_status,
     service_type, delivery_address, external_channel_text, pos_short_code, platform_order_code, platform_order_ref, raw_tab, customer_phone)
  values
    ('e0300000-0000-4000-8000-0000000000a1', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
     'e0200000-0000-4000-8000-00000000a0b1', 'e0200000-0000-4000-8000-00000000a0c1', 'hubrise', now() - interval '5 minutes', now() - interval '5 minutes',
     21.00, 'open', 'accepted', 'own_delivery', 'Calle Inventada de Prueba, 1, Floor: 4, Door: A, 28000', 'Glovo', 'R03A', 'R03A', '100000000031',
     '{"channel":"Glovo","service_type":"delivery","customer":{"address_1":"Calle Inventada de Prueba, 1","address_2":"Floor: 4, Door: A","latitude":"40.4300","longitude":"-3.6800"}}', '+34600000001'),
    -- R03N · con dirección, indicaciones de entrega y nota del cliente.
    ('e0300000-0000-4000-8000-0000000000b1', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
     'e0200000-0000-4000-8000-00000000a0b1', 'e0200000-0000-4000-8000-00000000a0c1', 'hubrise', now() - interval '5 minutes', now() - interval '5 minutes',
     20.50, 'open', 'accepted', 'own_delivery', 'Calle Inventada de Prueba, 9, Floor: 2, Door: C, 28000', 'Glovo', 'R03N', 'R03N', '100000000036',
     '{"channel":"Glovo","service_type":"delivery","customer_notes":"Sin pepinillos, por favor","customer":{"address_1":"Calle Inventada de Prueba, 9","address_2":"Floor: 2, Door: C","delivery_notes":"Portal azul, timbre 2C","latitude":"40.4310","longitude":"-3.6810"}}', '+34600000006'),
    ('e0300000-0000-4000-8000-0000000000a2', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
     'e0200000-0000-4000-8000-00000000a0b1', 'e0200000-0000-4000-8000-00000000a0c1', 'hubrise', now() - interval '4 minutes', now() - interval '4 minutes',
     22.00, 'open', 'accepted', 'own_delivery', null, 'Glovo', 'R03B', 'R03B', '100000000032',
     '{"channel":"Glovo","service_type":"delivery","customer":{"address_1":null,"latitude":"40.4100","longitude":"-3.7000"}}', '+34600000002'),
    ('e0300000-0000-4000-8000-0000000000a3', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
     'e0200000-0000-4000-8000-00000000a0b1', 'e0200000-0000-4000-8000-00000000a0c1', 'hubrise', now() - interval '3 minutes', now() - interval '3 minutes',
     23.00, 'open', 'accepted', 'own_delivery', null, 'Glovo', 'R03C', 'R03C', '100000000033',
     '{"channel":"Glovo","service_type":"delivery","customer":{}}', '+34600000003'),
    ('e0300000-0000-4000-8000-0000000000a4', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
     'e0200000-0000-4000-8000-00000000a0b1', 'e0200000-0000-4000-8000-00000000a0c1', 'hubrise', now() - interval '2 minutes', now() - interval '2 minutes',
     24.00, 'open', 'accepted', 'own_delivery', null, 'Glovo', 'R03D', 'R03D', '100000000034',
     '{"channel":"Glovo","service_type":"delivery","customer":{"address_1":null,"latitude":"40.4150","longitude":"-3.6950"}}', '+34600000004'),
    ('e0300000-0000-4000-8000-0000000000a5', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
     'e0200000-0000-4000-8000-00000000a0b1', 'e0200000-0000-4000-8000-00000000a0c1', 'hubrise', now() - interval '1 minutes', now() - interval '1 minutes',
     25.00, 'open', 'accepted', 'own_delivery', null, 'Glovo', 'R03E', 'R03E', '100000000035',
     '{"channel":"Glovo","service_type":"delivery","customer":{"address_1":null,"latitude":"40.4120","longitude":"-3.6980"}}', '+34600000005'),
    ('e0300000-0000-4000-8000-0000000000a6', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
     'e0200000-0000-4000-8000-00000000a0b1', 'e0200000-0000-4000-8000-00000000a0c2', 'hubrise', now() - interval '6 minutes', now() - interval '6 minutes',
     26.00, 'open', 'accepted', 'own_delivery', 'Calle Inventada de Prueba 5, 28000 Madrid, Spain, Unit: 3C', 'Uber Eats', 'R03U', 'R03U', null,
     '{"channel":"Uber Eats","service_type":"delivery","customer_notes":"Sin cebolla","charges":[{"type":"delivery","price":"2.99 EUR"}],"customer":{"address_1":"Calle Inventada de Prueba 5, 28000 Madrid, Spain","address_2":"Unit: 3C","phone":"+34900000000","phone_access_code":"12345678","delivery_notes":"Timbre 3C","latitude":"40.4180","longitude":"-3.6900"}}', '+34900000000')
  on conflict (id) do update
    set sold_at = excluded.sold_at, created_at = excluded.created_at, status = 'open', order_status = 'accepted',
        service_type = 'own_delivery', delivery_address = excluded.delivery_address, raw_tab = excluded.raw_tab,
        brand_id = excluded.brand_id, channel_id = excluded.channel_id, carrier_code = null, carrier_order_id = null, delivery_state = null, dispatch_error = null,
        delivery_address_fixed = null, delivery_address_fixed_at = null, delivery_address_fixed_by = null,
        delivery_address_origin = null, customer_phone = excluded.customer_phone, updated_at = now();

  update public.sale
     set dispatch_error = 'No se despachó: la dirección no ha llegado y tampoco el punto del mapa: no se puede despachar'
   where id = 'e0300000-0000-4000-8000-0000000000a3' and account_id = 'c01a0000-0000-4000-8000-00000000000a';

  perform set_config('folvy.reparto_tal_cual', '', true);

  -- R03V · Uber sin calle de una marca en «Nosotros» (Pita del Sur): entra SIN
  -- «tal cual» para que pase por «Quién reparte» y por la regla de fuera de
  -- zona, y sale como «la reparte Uber». Se borra y se crea de nuevo: así no
  -- hereda el tipo de reparto de la ejecución anterior.
  delete from public.sale where id in ('e0300000-0000-4000-8000-0000000000a7', 'e0300000-0000-4000-8000-0000000000a8',
                                        'e0300000-0000-4000-8000-0000000000a9')
     and account_id = 'c01a0000-0000-4000-8000-00000000000a';
  insert into public.sale
    (id, account_id, location_id, brand_id, channel_id, source, sold_at, created_at, total, status, order_status,
     service_type, delivery_address, external_channel_text, pos_short_code, platform_order_code, raw_tab, customer_phone)
  values
    ('e0300000-0000-4000-8000-0000000000a7', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
     'e0200000-0000-4000-8000-00000000a0b2', 'e0200000-0000-4000-8000-00000000a0c2', 'hubrise', now() - interval '1 minutes', now() - interval '1 minutes',
     27.00, 'open', 'accepted', 'own_delivery', null, 'Uber Eats', 'R03V', 'R03V',
     '{"channel":"Uber Eats","service_type":"delivery","customer":{"address_1":null,"phone":"+34900000001","phone_access_code":"87654321"}}', '+34900000001'),
    -- R03T · Uber con calle, punto y cargo de envío, de una marca con Uber en
    -- «Plataforma» (Smash): la regla por pedido manda → lo repartimos nosotros.
    ('e0300000-0000-4000-8000-0000000000a8', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
     'e0200000-0000-4000-8000-00000000a0b3', 'e0200000-0000-4000-8000-00000000a0c2', 'hubrise', now() - interval '1 minutes', now() - interval '1 minutes',
     28.00, 'open', 'accepted', 'platform_delivery', 'Calle Inventada de Prueba 6, Unit: 1A', 'Uber Eats', 'R03T', 'R03T',
     '{"channel":"Uber Eats","service_type":"delivery","charges":[{"type":"delivery","price":"2.99 EUR"}],"customer":{"address_1":"Calle Inventada de Prueba 6","address_2":"Unit: 1A","latitude":"40.4170","longitude":"-3.6910"}}', '+34900000002'),
    -- R03M · Uber mezclado (calle y punto, sin cargo de envío): lo decide una persona.
    ('e0300000-0000-4000-8000-0000000000a9', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
     'e0200000-0000-4000-8000-00000000a0b1', 'e0200000-0000-4000-8000-00000000a0c2', 'hubrise', now() - interval '1 minutes', now() - interval '1 minutes',
     29.00, 'open', 'accepted', 'own_delivery', 'Calle Inventada de Prueba 7', 'Uber Eats', 'R03M', 'R03M',
     '{"channel":"Uber Eats","service_type":"delivery","customer":{"address_1":"Calle Inventada de Prueba 7","latitude":"40.4160","longitude":"-3.6920"}}', '+34900000003');

  -- El modo de despacho del pedido, el de su local, como en producción (allí
  -- coinciden siempre: 135 de 135 propios de Foodint en 7 días). La tarjeta lo
  -- lee del pedido y la lista del local: en staging, si no, dirían cosas distintas.
  update public.sale s set dispatch_mode = coalesce(l.dispatch_mode, 'auto')
    from public.locations l
   where l.id = s.location_id and s.account_id = 'c01a0000-0000-4000-8000-00000000000a'
     and s.id::text like 'e0300000-0000-4000-8000-0000000000%'
     and s.dispatch_mode is distinct from coalesce(l.dispatch_mode, 'auto');
end
$r03$;
