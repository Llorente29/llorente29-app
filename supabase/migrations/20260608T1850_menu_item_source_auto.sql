-- 20260608T1850_menu_item_source_auto.sql
-- Aplicada: 2026-06-08
--
-- La auto-propagación multi-marca del recast (capa 2, ver
-- 20260608T1900_recast_autopropagacion_multimarca.sql) crea menu_item con
-- source='auto' para distinguirlos de los manuales/importados (trazabilidad: saber
-- qué puso el sistema solo). El check de source no lo admitía; lo ampliamos.
--
-- Nota de orden: esta migración (T1850) debe aplicarse ANTES que la del recast
-- (T1900); el sufijo temporal lo garantiza.

BEGIN;

ALTER TABLE public.menu_item DROP CONSTRAINT menu_item_source_valid;
ALTER TABLE public.menu_item ADD CONSTRAINT menu_item_source_valid
  CHECK (source = ANY (ARRAY['manual'::text, 'ai_suggested'::text, 'import'::text, 'auto'::text]));

COMMIT;
