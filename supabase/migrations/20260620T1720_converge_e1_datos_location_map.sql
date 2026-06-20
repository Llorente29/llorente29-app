-- supabase/migrations/20260620T1720_converge_e1_datos_location_map.sql
-- ============================================================================
-- CONVERGENCIA DE INGESTA — Bloque E.1: migrar datos lastapp_location_map →
-- external_location_map (source='lastapp').
-- ============================================================================
-- POR QUÉ: external_location_map (tabla agnóstica creada en 20260617T2350) NO es
-- un rename de lastapp_location_map; es un linaje aparte y NO contiene los
-- vínculos de tienda Last (medido 20/06: lastapp_location_map = 6 filas;
-- external_location_map = 1 fila). Antes de reescribir migrate_brands_and_map para
-- que lea external_location_map (Bloque A.2), hay que trasladar esos 6 vínculos;
-- si no, _src_map saldría vacío y la función no encontraría las tiendas.
--
-- Mapeo de columnas (esquemas reales):
--   lastapp_location_map(account_id, lastapp_location_id, lastapp_location_name,
--                        location_id, needs_review, ...)
--   external_location_map(source, external_location_id, account_id, location_id,
--                         is_active, ...)  UNIQUE (source, external_location_id)
--   · external_location_id   ← lastapp_location_id    (ambos text)
--   · external_location_name ← lastapp_location_name  (requiere E.0)
--   · needs_review           ← needs_review            (requiere E.0)
--   · source = 'lastapp'; is_active = true
--
-- ⚠️ Requiere haber aplicado E.0 (20260620T1715) que añade external_location_name
-- y needs_review. Idempotente: ON CONFLICT (source, external_location_id) DO
-- NOTHING. NO borra la tabla vieja (eso es E.2, tras converger las referencias).
-- Sin SECURITY DEFINER (DML directo, sesión admin / RLS current_user_account_ids).
-- Sin BEGIN/COMMIT.
-- ============================================================================

INSERT INTO public.external_location_map
  (source, external_location_id, account_id, location_id, external_location_name, needs_review, is_active)
SELECT
  'lastapp'                       AS source,
  llm.lastapp_location_id         AS external_location_id,
  llm.account_id                  AS account_id,
  llm.location_id                 AS location_id,
  llm.lastapp_location_name       AS external_location_name,
  coalesce(llm.needs_review, false) AS needs_review,
  true                            AS is_active
FROM public.lastapp_location_map llm
WHERE llm.lastapp_location_id IS NOT NULL
ON CONFLICT (source, external_location_id) DO NOTHING;

-- Verificación (Julio): las 6 deben quedar reflejadas con source='lastapp'.
--   SELECT count(*) FILTER (WHERE source='lastapp') AS lastapp_en_external,
--          (SELECT count(*) FROM public.lastapp_location_map) AS en_vieja
--   FROM public.external_location_map;
