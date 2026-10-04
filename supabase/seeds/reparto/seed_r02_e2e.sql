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
-- Sigue siendo el más nuevo de Pita del Sur en Uber, como espera
-- 20261005_r02_prueba_sugerencia.sql.
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
