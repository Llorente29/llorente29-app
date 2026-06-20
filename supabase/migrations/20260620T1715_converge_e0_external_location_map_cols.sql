-- supabase/migrations/20260620T1715_converge_e0_external_location_map_cols.sql
-- ============================================================================
-- CONVERGENCIA DE INGESTA — Bloque E.0: enriquecer external_location_map.
-- ============================================================================
-- external_location_map nació como resolver agnóstico mínimo (source,
-- external_location_id → location_id). El panel de onboarding
-- (lastappIntegrationService) necesita además, por vínculo:
--   · external_location_name : nombre legible de la tienda externa (pista humana).
--   · needs_review           : marca de revisión del vínculo.
-- Se añaden como columnas NEUTRAS (cualquier fuente las puede usar) para que el
-- servicio pueda converger a esta tabla y se pueda jubilar lastapp_location_map.
--
-- Idempotente (ADD COLUMN IF NOT EXISTS). Sin BEGIN/COMMIT. Va ANTES de E.1
-- (la migración de datos copia estos campos desde lastapp_location_map).
-- ============================================================================

ALTER TABLE public.external_location_map
  ADD COLUMN IF NOT EXISTS external_location_name text,
  ADD COLUMN IF NOT EXISTS needs_review           boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.external_location_map.external_location_name IS
  'Nombre legible de la tienda en el proveedor (pista para el onboarding). Neutro multi-fuente.';
COMMENT ON COLUMN public.external_location_map.needs_review IS
  'El vínculo tienda externa → local Folvy necesita revisión humana. Neutro multi-fuente.';
