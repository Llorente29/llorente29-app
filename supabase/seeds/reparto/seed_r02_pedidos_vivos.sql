-- ============================================================================
-- SEMILLAS R02 · Dos pedidos VIVOS para probar el saneado del despliegue
-- (SOLO STAGING-CONTA). Inventados, con la forma de los de HubRise.
--   · 7B000 · Pita del Sur · Uber · «propio» SIN dirección, con la alarma roja
--     «no_despachado» que escribía el vigía (el caso de los 13 de Uber).
--   · 7B001 · Smash de Prueba · Glovo · own_delivery CON dirección y parado por
--     el interruptor (el caso 970 de Smash): lo que el R02 pinta «la reparte
--     Glovo». Se mete con la modalidad vieja tal cual (folvy.reparto_tal_cual).
-- Locales en dispatch_mode 'manual' (ver seed_r02_quien_reparte.sql): ningún
-- disparador llama a Catcher.
-- ============================================================================
select set_config('folvy.reparto_tal_cual', 'on', true);

insert into public.sale
  (id, account_id, location_id, brand_id, channel_id, source, sold_at, total, status, order_status,
   service_type, delivery_address, external_channel_text, platform_order_code, raw_tab,
   dispatch_error, delivery_alarm_at, delivery_alarm_kind)
values
  ('e0200000-0000-4000-8000-0000000052a1', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b2', 'e0200000-0000-4000-8000-00000000a0c2', 'hubrise', now() - interval '20 minutes', 22.50,
   'open', 'accepted', 'own_delivery', null, 'Uber Eats', '7B000',
   '{"service_type":"delivery","channel":"Uber Eats","status":"accepted"}',
   'No se despachó: sin dirección de entrega: la plataforma no la ha enviado', now() - interval '10 minutes', 'no_despachado'),
  ('e0200000-0000-4000-8000-0000000052a2', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b3', 'e0200000-0000-4000-8000-00000000a0c1', 'hubrise', now() - interval '15 minutes', 17.00,
   'open', 'in_preparation', 'own_delivery', 'Calle de Prueba 9, 28000 Madrid', 'Glovo', '7B001',
   '{"service_type":"delivery","channel":"Glovo","status":"accepted"}',
   'No se despachó: el reparto propio de esta marca esta apagado', now() - interval '5 minutes', 'no_despachado')
on conflict (id) do nothing;

select set_config('folvy.reparto_tal_cual', '', true);
