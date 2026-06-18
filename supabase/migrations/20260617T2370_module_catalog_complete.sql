-- ============================================================================
-- 20260617T2370_module_catalog_complete.sql
-- Cierra el catálogo de módulos: crea los submódulos de los 4 módulos huérfanos
-- (delivery, pos, bookings, loyalty) y actualiza included_submodules de los 3
-- planes. Sin esto, un "cliente completo" tendría módulos vacíos = deuda.
--
-- PATRÓN (verificado): submodules.type 'tier'(tier_level 1=essential/2=pro/3=multi)
--   | 'addon'. sort_order en saltos de 10 (essential 10, pro 20, multi 30, addon 50+).
--   status CHECK: active|beta|coming_soon|deprecated.
-- ESTADO HONESTO: active = capacidad construida; coming_soon = roadmap (NO se vende
--   como vivo, NO entra en planes todavía).
-- billing_plans.included_submodules = uuid[] -> se reconstruye resolviendo por code.
--
-- Idempotente: ON CONFLICT (code) en submodules; planes reescritos por code->id.
-- DDL/DML sin BEGIN/COMMIT (SQL Editor). Tras correr: regen database.ts.
-- ============================================================================

-- ── 0) Invariante: submodules.code ÚNICO (lo asume todo el sistema) ──────────
-- Sin esta constraint el ON CONFLICT(code) no es posible y el code no es fiable
-- como clave estable. Idempotente: solo se crea si no existe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.submodules'::regclass AND contype = 'u'
      AND conname = 'submodules_code_key'
  ) THEN
    ALTER TABLE public.submodules ADD CONSTRAINT submodules_code_key UNIQUE (code);
  END IF;
END $$;

-- ── 1) Submódulos nuevos ─────────────────────────────────────────────────────
-- module_id se resuelve por code del módulo. ON CONFLICT(code) actualiza forma.
INSERT INTO public.submodules (module_id, code, name, type, tier_level, sort_order, status)
SELECT m.id, x.code, x.name, x.type, x.tier_level, x.sort_order, x.status
FROM (VALUES
  -- DELIVERY (HubRise/Last ingesta canónica = BUILT)
  ('delivery','delivery_essential','Delivery Esencial',   'tier',  1,  10, 'active'),
  ('delivery','delivery_pro',      'Delivery Pro',         'tier',  2,  20, 'active'),
  ('delivery','delivery_multi',    'Delivery Multi-local', 'tier',  3,  30, 'active'),
  ('delivery','delivery_shop',     'Add-on Tienda propia (Folvy Shop)', 'addon', NULL, 50, 'coming_soon'),
  ('delivery','delivery_offers',   'Add-on Motor de ofertas',           'addon', NULL, 51, 'coming_soon'),
  -- POS / TPV (adaptador Last vivo = BUILT; publicación bidireccional = roadmap)
  ('pos','pos_essential','TPV Esencial',     'tier',  1,  10, 'active'),
  ('pos','pos_pro',      'TPV Pro',          'tier',  2,  20, 'coming_soon'),
  ('pos','pos_multi',    'TPV Multi-local',  'tier',  3,  30, 'active'),
  ('pos','pos_kds',      'Add-on KDS / Cocina', 'addon', NULL, 50, 'active'),
  -- BOOKINGS / Reservas (roadmap)
  ('bookings','bookings_essential','Reservas Esencial',    'tier', 1, 10, 'coming_soon'),
  ('bookings','bookings_pro',      'Reservas Pro',         'tier', 2, 20, 'coming_soon'),
  ('bookings','bookings_multi',    'Reservas Multi-local', 'tier', 3, 30, 'coming_soon'),
  -- LOYALTY / Fidelización (roadmap)
  ('loyalty','loyalty_essential','Fidelización Esencial',    'tier', 1, 10, 'coming_soon'),
  ('loyalty','loyalty_pro',      'Fidelización Pro',         'tier', 2, 20, 'coming_soon'),
  ('loyalty','loyalty_multi',    'Fidelización Multi-local', 'tier', 3, 30, 'coming_soon')
) AS x(module_code, code, name, type, tier_level, sort_order, status)
JOIN public.modules m ON m.code = x.module_code
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name, type = EXCLUDED.type, tier_level = EXCLUDED.tier_level,
      sort_order = EXCLUDED.sort_order, status = EXCLUDED.status,
      module_id = EXCLUDED.module_id, updated_at = now();

-- ── 2) features (jsonb array 'modulo.clave') de cada submódulo nuevo ─────────
UPDATE public.submodules SET features = f.features::jsonb, updated_at = now()
FROM (VALUES
  ('delivery_essential', '["delivery.integrations","delivery.order_ingestion","delivery.channel_mapping","delivery.brand_mapping"]'),
  ('delivery_pro',       '["delivery.economics","delivery.margin_real","delivery.availability_alerts"]'),
  ('delivery_multi',     '["delivery.multi_location","delivery.multi_brand"]'),
  ('delivery_shop',      '["delivery.own_shop"]'),
  ('delivery_offers',    '["delivery.offers_engine"]'),
  ('pos_essential',      '["pos.integration","pos.sales_sync","pos.catalog_read","pos.product_mapping"]'),
  ('pos_pro',            '["pos.catalog_publish","pos.bidirectional","pos.modifiers_sync"]'),
  ('pos_multi',          '["pos.multi_location","pos.multi_adapter"]'),
  ('pos_kds',            '["pos.kds","pos.cook_mode"]'),
  ('bookings_essential', '["bookings.tables","bookings.calendar","bookings.confirmations"]'),
  ('bookings_pro',       '["bookings.online_widget","bookings.deposits","bookings.waitlist"]'),
  ('bookings_multi',     '["bookings.multi_location"]'),
  ('loyalty_essential',  '["loyalty.customers","loyalty.points"]'),
  ('loyalty_pro',        '["loyalty.campaigns","loyalty.rewards","loyalty.segments"]'),
  ('loyalty_multi',      '["loyalty.multi_location"]')
) AS f(code, features)
WHERE public.submodules.code = f.code;

-- ── 3) Reescribir included_submodules de los 3 planes (resolviendo code->id) ──
-- Solo submódulos ACTIVE entran en planes. coming_soon queda en catálogo, fuera de plan.
--
-- STARTER (1 local): APPCC + Personal esencial + TPV esencial.
UPDATE public.billing_plans bp
SET included_submodules = (
  SELECT array_agg(sm.id)
  FROM public.submodules sm
  WHERE sm.code IN ('appcc_essential','personal_essential','pos_essential')
), updated_at = now()
WHERE bp.code = 'starter';

-- PROFESSIONAL (5 locales): + Ventas/Stock esencial, APPCC pro, Delivery esencial, TPV esencial+KDS.
UPDATE public.billing_plans bp
SET included_submodules = (
  SELECT array_agg(sm.id)
  FROM public.submodules sm
  WHERE sm.code IN (
    'appcc_essential','appcc_pro',
    'personal_essential','personal_pro',
    'sales_essential',
    'stock_essential',
    'delivery_essential',
    'pos_essential','pos_kds'
  )
), updated_at = now()
WHERE bp.code = 'professional';

-- ENTERPRISE (∞): todos los tiers ACTIVE de los 6 módulos construidos (appcc/personal/sales/stock/delivery/pos).
UPDATE public.billing_plans bp
SET included_submodules = (
  SELECT array_agg(sm.id)
  FROM public.submodules sm
  WHERE sm.code IN (
    'appcc_essential','appcc_pro','appcc_multi',
    'personal_essential','personal_pro','personal_multi',
    'sales_essential','sales_pro','sales_multi',
    'stock_essential','stock_pro','stock_multi',
    'delivery_essential','delivery_pro','delivery_multi',
    'pos_essential','pos_multi','pos_kds'
  )
), updated_at = now()
WHERE bp.code = 'enterprise';
