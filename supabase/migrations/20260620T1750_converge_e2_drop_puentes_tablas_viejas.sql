-- supabase/migrations/20260620T1750_converge_e2_drop_puentes_tablas_viejas.sql
-- ============================================================================
-- CONVERGENCIA DE INGESTA — Bloque E.2: retirar vistas puente + tablas viejas.
-- ============================================================================
-- ÚLTIMO paso de la convergencia. Deja el esquema SIN objetos lastapp_* (salvo
-- lastapp_webhook_log, deuda declarada explícita: log de frontera Last; su gemelo
-- agnóstico external_webhook_log ya existe — convergerlo = otro frente).
--
-- ⚠️ ORDEN — aplicar SOLO cuando TODO lo anterior esté aplicado y desplegado:
--   · B (1700), A.1 (1710), E.0 (1715), E.1 (1720), D (1740) aplicadas.
--   · A.2 (migrate_brands_and_map reescrita a external_location_map) aplicada
--     — si no, su EXISTS sobre lastapp_location_map rompería al dropear la tabla.
--   · Código desplegado (todos convergidos a external_*):
--       lastapp-webhook, order-advance, lastapp-catalog-import, lastapp-sync-catalog,
--       lastappIntegrationService.ts, edge+script de backfill.
--
-- VERIFICAR ANTES (la BBDD es la verdad — no borrar con datos sin comprobar uso):
--   -- ¿alguna función viva aún nombra estas tablas en su cuerpo?
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE n.nspname='public' AND (
--     pg_get_functiondef(p.oid) ILIKE '%lastapp_location_map%' OR
--     pg_get_functiondef(p.oid) ILIKE '%lastapp_product_map%' OR
--     pg_get_functiondef(p.oid) ILIKE '%lastapp_catalog_product%' OR
--     pg_get_functiondef(p.oid) ILIKE '%lastapp_integration%');
--   -- debe devolver 0 filas (salvo, si acaso, la propia migrate_brands ya reescrita).
--   -- Datos: las 6 filas de location ya en external_location_map (E.1);
--   -- lastapp_product_map (112 filas) NO lo usa el casado vivo (medido 20/06).
--
-- Idempotente (IF EXISTS). Sin BEGIN/COMMIT.
-- ============================================================================

-- 1) Vistas puente (creadas en T1300/T1400) — ya sin lectores tras converger código.
DROP VIEW IF EXISTS public.lastapp_integration;
DROP VIEW IF EXISTS public.lastapp_catalog_product;

-- 2) Tablas viejas residuales.
--    lastapp_location_map: datos ya en external_location_map (E.1); lectores
--      convergidos (webhook/servicio/edges) + migrate_brands reescrita (A.2).
--    lastapp_product_map: residuo del modelo viejo; 0 usos en el casado vivo.
--      Sus únicos lectores restantes son scripts one-shot históricos
--      (import-platos, import-escandallos, diagnose-needs-review, tspoon-*), que
--      quedan obsoletos (rehacer canónicos si se vuelven a necesitar).
DROP TABLE IF EXISTS public.lastapp_location_map;
DROP TABLE IF EXISTS public.lastapp_product_map;

-- NOTA: lastapp_webhook_log se CONSERVA (deuda declarada): es el log crudo de la
-- frontera Last. Convergerlo a external_webhook_log es un frente aparte.
