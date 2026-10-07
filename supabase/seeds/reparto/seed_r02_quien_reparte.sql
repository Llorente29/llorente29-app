-- ============================================================================
-- SEMILLAS R02 · Quién reparte (SOLO STAGING-CONTA)
-- ----------------------------------------------------------------------------
-- Respuesta 1 de Julio, punto 6: marcas, locales, políticas y ventas
-- INVENTADAS (nombres de la maqueta R1Reparto), con la FORMA real de los
-- pedidos de HubRise y de Last pero sin ningún dato de cliente. Nada copiado
-- de producción. Se puede rehacer: ids fijos y ON CONFLICT DO NOTHING.
--
-- Cuenta A (Taberna de Prueba Norte) reproduce los casos de Foodint:
--   · Burger Norte      propia, interruptor sin poner → la repartimos en todo
--   · Pita del Sur      propia, sin poner; en Uber llegan pedidos sin dirección
--                       (3 seguidos: la sugerencia de la IA)
--   · Smash de Prueba   propia, interruptor APAGADO
--   · Lovers de Prueba  propia, interruptor APAGADO
--   · Brasa Prestada   cedida (entra por Last)
--   Herencia: las seis filas de Foodint (propia → own_delivery en Glovo, Uber y
--   Just Eat; cedida → platform_delivery).
--   Dos locales: Norte Centro (ya existe) y Norte Mercado (para «por local»).
-- Cuenta B (Cocina de Prueba Sur) es la otra cuenta (RLS) y otra forma de
--   herencia: Uber propia → platform_delivery y sin fila de Just Eat.
--
-- LOS LOCALES DE PRUEBA VAN EN dispatch_mode = 'manual'. tg_auto_dispatch
-- llama a la URL de catcher-dispatch de PRODUCCIÓN escrita a mano dentro de la
-- función; en staging, un pedido own_delivery aceptado en un local 'auto'
-- haría esa llamada. En manual el disparador no sale. (Apuntado en el PR.)
-- ============================================================================

-- Locales -------------------------------------------------------------------
insert into public.locations (id, account_id, name, dispatch_mode)
values ('e0200000-0000-4000-8000-0000000000a3', 'c01a0000-0000-4000-8000-00000000000a', 'Norte Mercado', 'manual')
on conflict (id) do nothing;

update public.locations set dispatch_mode = 'manual'
 where id in ('c01a0000-0000-4000-8000-0000000000a2',
              'c01b0000-0000-4000-8000-0000000000b2',
              'e0200000-0000-4000-8000-0000000000a3');

-- Canales de reparto ----------------------------------------------------------
insert into public.sales_channel (id, account_id, name, slug, channel_type) values
  ('e0200000-0000-4000-8000-00000000a0c1', 'c01a0000-0000-4000-8000-00000000000a', 'Glovo',     'glovo',   'delivery'),
  ('e0200000-0000-4000-8000-00000000a0c2', 'c01a0000-0000-4000-8000-00000000000a', 'Uber Eats', 'uber',    'delivery'),
  ('e0200000-0000-4000-8000-00000000a0c3', 'c01a0000-0000-4000-8000-00000000000a', 'Just Eat',  'justeat', 'delivery'),
  ('e0200000-0000-4000-8000-00000000b0c1', 'c01b0000-0000-4000-8000-00000000000b', 'Glovo',     'glovo',   'delivery'),
  ('e0200000-0000-4000-8000-00000000b0c2', 'c01b0000-0000-4000-8000-00000000000b', 'Uber Eats', 'uber',    'delivery'),
  ('e0200000-0000-4000-8000-00000000b0c3', 'c01b0000-0000-4000-8000-00000000000b', 'Just Eat',  'justeat', 'delivery')
on conflict (id) do nothing;

-- Marcas ---------------------------------------------------------------------
insert into public.brand (id, account_id, name, slug, ownership_type, own_delivery_enabled) values
  ('e0200000-0000-4000-8000-00000000a0b1', 'c01a0000-0000-4000-8000-00000000000a', 'Burger Norte',     'r02-burger-norte',    'own',      null),
  ('e0200000-0000-4000-8000-00000000a0b2', 'c01a0000-0000-4000-8000-00000000000a', 'Pita del Sur',     'r02-pita-del-sur',    'own',      null),
  ('e0200000-0000-4000-8000-00000000a0b3', 'c01a0000-0000-4000-8000-00000000000a', 'Smash de Prueba',  'r02-smash-de-prueba', 'own',      false),
  ('e0200000-0000-4000-8000-00000000a0b4', 'c01a0000-0000-4000-8000-00000000000a', 'Lovers de Prueba', 'r02-lovers-de-prueba','own',      false),
  ('e0200000-0000-4000-8000-00000000a0b5', 'c01a0000-0000-4000-8000-00000000000a', 'Brasa Prestada',  'r02-brasa-prestada', 'licensed', null),
  ('e0200000-0000-4000-8000-00000000b0b1', 'c01b0000-0000-4000-8000-00000000000b', 'Kebab de Prueba',  'r02-kebab-de-prueba', 'own',      null),
  ('e0200000-0000-4000-8000-00000000b0b2', 'c01b0000-0000-4000-8000-00000000000b', 'Cedida Sur',       'r02-cedida-sur',      'licensed', null)
on conflict (id) do nothing;

-- Herencia («Si no dices nada») ---------------------------------------------
insert into public.channel_delivery_policy (account_id, channel_slug, ownership_type, service_type, notes)
select v.* from (values
  ('c01a0000-0000-4000-8000-00000000000a'::uuid, 'glovo',   'own',      'own_delivery',      'R02 semilla'),
  ('c01a0000-0000-4000-8000-00000000000a'::uuid, 'glovo',   'licensed', 'platform_delivery', 'R02 semilla'),
  ('c01a0000-0000-4000-8000-00000000000a'::uuid, 'justeat', 'own',      'own_delivery',      'R02 semilla'),
  ('c01a0000-0000-4000-8000-00000000000a'::uuid, 'justeat', 'licensed', 'platform_delivery', 'R02 semilla'),
  ('c01a0000-0000-4000-8000-00000000000a'::uuid, 'uber',    'own',      'own_delivery',      'R02 semilla'),
  ('c01a0000-0000-4000-8000-00000000000a'::uuid, 'uber',    'licensed', 'platform_delivery', 'R02 semilla'),
  ('c01b0000-0000-4000-8000-00000000000b'::uuid, 'glovo',   'own',      'own_delivery',      'R02 semilla'),
  ('c01b0000-0000-4000-8000-00000000000b'::uuid, 'glovo',   'licensed', 'platform_delivery', 'R02 semilla'),
  ('c01b0000-0000-4000-8000-00000000000b'::uuid, 'uber',    'own',      'platform_delivery', 'R02 semilla'),
  ('c01b0000-0000-4000-8000-00000000000b'::uuid, 'uber',    'licensed', 'platform_delivery', 'R02 semilla')
) v(account_id, channel_slug, ownership_type, service_type, notes)
where not exists (
  select 1 from public.channel_delivery_policy p
   where p.account_id = v.account_id and p.channel_slug = v.channel_slug
     and p.ownership_type = v.ownership_type and p.location_id is null);

-- Ventas, con la forma de los pedidos reales y sin datos de cliente ----------
-- Todas cerradas y entregadas: no disparan ningún despacho. Las «sin
-- dirección» de Pita del Sur en Uber son tres seguidas (la IA).
insert into public.sale
  (id, account_id, location_id, brand_id, channel_id, source, sold_at, total, status, order_status,
   service_type, delivery_address, external_channel_text, platform_order_code, raw_tab)
select v.id::uuid, v.account_id::uuid, v.location_id::uuid, v.brand_id::uuid, v.channel_id::uuid, v.source,
       now() - (v.hace || ' minutes')::interval, v.total, 'closed', 'completed',
       v.service_type, v.dir, v.canal, v.codigo, v.raw_tab
from (values
  -- Pita del Sur · Uber · propio sin dirección ×3 (lo que la IA detecta)
  ('e0200000-0000-4000-8000-0000000051a1', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b2', 'e0200000-0000-4000-8000-00000000a0c2', 'hubrise', 180, 21.40, 'own_delivery', null::text,
   'Uber Eats', '7A1F0', '{"service_type":"delivery","channel":"Uber Eats","status":"completed"}'),
  ('e0200000-0000-4000-8000-0000000051a2', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b2', 'e0200000-0000-4000-8000-00000000a0c2', 'hubrise', 120, 18.90, 'own_delivery', null,
   'Uber Eats', '7A1F1', '{"service_type":"delivery","channel":"Uber Eats","status":"completed"}'),
  ('e0200000-0000-4000-8000-0000000051a3', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b2', 'e0200000-0000-4000-8000-00000000a0c2', 'hubrise', 60, 25.10, 'own_delivery', null,
   'Uber Eats', '7A1F2', '{"service_type":"delivery","channel":"Uber Eats","status":"completed"}'),
  -- Pita del Sur · Glovo · propio con dirección (Glovo la manda cuando la tienda es «reparto propio»)
  ('e0200000-0000-4000-8000-0000000051a4', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b2', 'e0200000-0000-4000-8000-00000000a0c1', 'hubrise', 90, 19.50, 'own_delivery',
   'Calle de Prueba 1, 28000 Madrid', 'Glovo', '118',
   '{"service_type":"delivery","channel":"Glovo","status":"completed","delivery":{"latitude":"40.40","longitude":"-3.70"}}'),
  -- Smash de Prueba · Glovo · la reparte Glovo, sin dirección
  ('e0200000-0000-4000-8000-0000000051a5', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b3', 'e0200000-0000-4000-8000-00000000a0c1', 'hubrise', 75, 14.00, 'platform_delivery', null,
   'Glovo', '705', '{"service_type":"delivery","channel":"Glovo","status":"completed"}'),
  -- Brasa Prestada · Glovo · por Last
  ('e0200000-0000-4000-8000-0000000051a6', 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2',
   'e0200000-0000-4000-8000-00000000a0b5', 'e0200000-0000-4000-8000-00000000a0c1', 'lastapp', 45, 16.30, 'platform_delivery', null,
   'Glovo', '101700000001', '{"pickupType":"delivery","source":"glovo"}'),
  -- Kebab de Prueba (cuenta B) · Glovo · propio con dirección
  ('e0200000-0000-4000-8000-0000000051b1', 'c01b0000-0000-4000-8000-00000000000b', 'c01b0000-0000-4000-8000-0000000000b2',
   'e0200000-0000-4000-8000-00000000b0b1', 'e0200000-0000-4000-8000-00000000b0c1', 'hubrise', 30, 12.80, 'own_delivery',
   'Avenida de Prueba 2, 46000 Valencia', 'Glovo', '201', '{"service_type":"delivery","channel":"Glovo","status":"completed"}')
) v(id, account_id, location_id, brand_id, channel_id, source, hace, total, service_type, dir, canal, codigo, raw_tab)
on conflict (id) do nothing;
