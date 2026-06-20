-- supabase/migrations/20260620T1740_converge_d_jubilar_residuo.sql
-- ============================================================================
-- CONVERGENCIA DE INGESTA — Bloque D: jubilar funciones residuo del modelo viejo.
-- ============================================================================
-- Jubila tres funciones del modelo viejo (por canal / lastapp_product_map), una
-- vez que NADIE las llama:
--   · seed_lastapp_catalog      → sustituida por seed_catalog_canonical
--     (lastappIntegrationService.seedAndRecast ya llama a la canónica).
--   · seed_catalog_from_lastapp → variante vieja sin llamadas (ni código ni RPC).
--   · resolve_lastapp_line      → la usaban SOLO el edge lastapp-backfill-sales y
--     scripts/backfill-sales.mjs; ambos reescritos al modelo canónico
--     (escriben venta cruda + reprocess_sale), ya no la llaman.
--
-- ⚠️ ORDEN: aplicar esta migración DESPUÉS de:
--   1) desplegar el cambio de lastappIntegrationService.ts (seed_catalog_canonical),
--   2) desplegar el edge lastapp-backfill-sales canónico,
--   3) (si se sigue usando) el script backfill-sales.mjs canónico.
-- Verificar 0 referencias antes (grep en repo + pg_depend si procede).
--
-- DROP robusto por nombre (no por firma): borra TODAS las sobrecargas que existan,
-- evitando depender de la firma exacta (estas funciones no están versionadas en el
-- repo). Idempotente. Sin BEGIN/COMMIT.
-- ============================================================================

DO $$
DECLARE
  v_sig text;
BEGIN
  FOR v_sig IN
    SELECT format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid))
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('seed_lastapp_catalog',
                        'seed_catalog_from_lastapp',
                        'resolve_lastapp_line')
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || v_sig;
    RAISE NOTICE 'Jubilada: %', v_sig;
  END LOOP;
END $$;

-- NOTA: el fichero suelto supabase/migrations/seed_catalog_from_lastapp.sql
-- (definición vieja sin timestamp) queda OBSOLETO tras este DROP. Borrarlo del
-- repo en el commit de cierre (no se aplica solo; es un artefacto histórico).
