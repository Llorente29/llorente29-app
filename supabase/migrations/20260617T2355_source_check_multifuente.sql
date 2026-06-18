-- ============================================================================
-- 20260617T2355_source_check_multifuente.sql
-- Amplía los CHECK de fuente para la ingesta multi-fuente (HubRise + Otter).
--
-- Aplicado en vivo el 17/06 (verificación en frío de H1+H2 de HubRise); este
-- fichero solo VERSIONA lo ya corrido para que el repo refleje la BBDD.
-- Idempotente (DROP IF EXISTS + ADD). Sin BEGIN/COMMIT (SQL Editor).
--
--   sale.source       : + 'hubrise', 'otter'   (la venta entra por su adaptador)
--   menu_item.source  : + 'hubrise', 'otter'   (procedencia de la ficha al sembrar catálogo)
--   sale_line.map_source NO se toca (ya incluye 'pos'/'unmapped'/'manual').
-- ============================================================================

ALTER TABLE public.sale DROP CONSTRAINT IF EXISTS sale_source_valid;
ALTER TABLE public.sale ADD CONSTRAINT sale_source_valid
  CHECK (source = ANY (ARRAY['manual','lastapp','import','hubrise','otter']::text[]));

ALTER TABLE public.menu_item DROP CONSTRAINT IF EXISTS menu_item_source_valid;
ALTER TABLE public.menu_item ADD CONSTRAINT menu_item_source_valid
  CHECK (source = ANY (ARRAY['manual','ai_suggested','import','auto','hubrise','otter']::text[]));
