-- 20260602T0300_connector_glovo_seed.sql
-- Seed del conector Glovo en el catálogo `connector` (módulo de Integraciones).
-- Aplicada: 2026-06-02 en Supabase (proyecto xzmpnchlguibclvxyynt) vía SQL Editor.
--
-- Glovo = primer conector de PLATAFORMA DIRECTA (decisión estratégica 02/06: Folvy
-- integrador directo, sin intermediarios). connection_type=credentials (token único +
-- store_id por local, hallazgos H2/H4 del doc de diseño), direction=bidirectional
-- (recibe pedidos + publica catálogo/precios/disponibilidad + ciclo de vida).
-- config_schema: shared_token (Vault), store_ids por local, auto_accept (D3), verify_signature (D5).
--
-- NOTA: registro del seed YA APLICADO. NO re-ejecutar (la fila ya existe).
-- Ref: docs/folvy_conector_glovo_diseno.md

BEGIN;

INSERT INTO public.connector
  (code, name, category, connection_type, managed_by, direction,
   description, config_schema, is_available, sort_order)
VALUES
  ('glovo', 'Glovo', 'delivery_platform', 'credentials', 'either', 'bidirectional',
   'Integración directa con Glovo (POS Client). Recibe pedidos con tipo de reparto, fees y descuentos desglosados; publica catálogo, precios y disponibilidad; gestiona el ciclo de vida del pedido. Token único por integración; store_id (external_id) por local.',
   '{"fields":[{"key":"shared_token","label":"Shared token (Glovo)","type":"secret","required":true},{"key":"store_ids","label":"Store IDs por local (external_id)","type":"text","required":true},{"key":"auto_accept","label":"Aceptar pedidos automáticamente","type":"boolean","required":false},{"key":"verify_signature","label":"Verificar firma Glovo-Signature","type":"boolean","required":false}]}'::jsonb,
   true, 5);

COMMIT;
