-- 20260608T1100_add_reliability_min_pct.sql
-- Aplicada: 2026-06-08
--
-- Umbral CONFIGURABLE de fiabilidad del casado por cuenta. Por debajo de este %
-- (casado por importe / total por importe) la señal se marca como poco fiable.
-- Mismo patrón que kitchen_settings.version_alert_pct (umbral en %, con defecto).
-- Defecto 90: por encima = verde; tu 92,1% real queda en verde por poco (honesto).
--
-- Idempotente (IF NOT EXISTS). DDL puro, sin test dentro.

BEGIN;

ALTER TABLE public.kitchen_settings
  ADD COLUMN IF NOT EXISTS reliability_min_pct numeric NOT NULL DEFAULT 90;

COMMENT ON COLUMN public.kitchen_settings.reliability_min_pct IS
  'Umbral mínimo de fiabilidad del casado (% casado por importe sobre total). '
  'Por debajo, la señal sales_mapping_reliability se pinta ámbar/rojo. Defecto 90.';

COMMIT;
