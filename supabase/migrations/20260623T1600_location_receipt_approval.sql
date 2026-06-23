-- supabase/migrations/20260623T1600_location_receipt_approval.sql
-- Aplicada: 2026-06-23
--
-- APROBACIÓN DE RECEPCIONES CONFIGURABLE POR LOCAL.
-- Quién confirma una recepción (postea a stock y coste):
--   · 'trabajador' (def): quien recibe confirma — comportamiento actual.
--   · 'oficina':   el trabajador deja la recepción en BORRADOR; la oficina la
--                  revisa y confirma (separación de funciones; quien cuenta no
--                  valida el coste). La oficina ya puede confirmar borradores
--                  desde Folvy Supply → Recepciones.
--
-- Por LOCAL (no por cuenta): en una cadena, un local con encargado fuerte puede
-- confiar en el trabajador y otro no. Sibling de clock_radius_m/clock_geofence_mode.

ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS receipt_approval text NOT NULL DEFAULT 'trabajador'
    CHECK (receipt_approval IN ('trabajador', 'oficina'));
