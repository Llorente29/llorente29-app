-- supabase/migrations/20260620T1300_converge_c1_external_integration.sql
-- ============================================================================
-- CONVERGENCIA DE INGESTA — Capa 1: lastapp_integration → external_integration.
-- ============================================================================
-- Parte del frente "una sola frontera canónica multi-fuente". El casado vivo ya
-- es agnóstico (reprocess_sale despacha por sale.source; la marca por
-- external_brand_map; el producto por menu_item.external_source+external_id).
-- Faltan por converger las dos piezas con nombre 'lastapp_*': la INTEGRACIÓN
-- (esta capa) y el CATÁLOGO (capa 2). Verificado: external_integration NO existe
-- (sin choque de nombres), lastapp_integration tiene 1 unique.
--
-- Qué hace:
--   · RENAME lastapp_integration → external_integration (metadata: conserva datos,
--     FKs, índices, RLS, y la columna push_status_enabled).
--   · RENAME columna lastapp_organization_id → external_org_id.
--   · ADD source text NOT NULL DEFAULT 'lastapp' (las 4 filas actuales = 'lastapp',
--     correcto; HubRise/Otter usarán su source).
--   · Unique (account_id, lastapp_organization_id) → (account_id, source, external_org_id).
--   · VISTA puente lastapp_integration (security_invoker) con el nombre y columnas
--     viejos, para que las funciones/servicios que aún la nombran sigan vivos hasta
--     reescribirlos (capas siguientes). La vista es trivial → actualizable.
--
-- Postgres 17.6 (security_invoker OK). Idempotente (to_regclass). Sin BEGIN/COMMIT.
-- No ejecuta funciones SECURITY DEFINER (regla SQL del proyecto).
-- ============================================================================

-- 1) Renombrar tabla + columna (solo si aún no se hizo)
DO $$
BEGIN
  IF to_regclass('public.lastapp_integration') IS NOT NULL
     AND to_regclass('public.external_integration') IS NULL THEN
    ALTER TABLE public.lastapp_integration RENAME TO external_integration;
    ALTER TABLE public.external_integration RENAME COLUMN lastapp_organization_id TO external_org_id;
  END IF;
END $$;

-- 2) Columna source (idempotente)
ALTER TABLE public.external_integration
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'lastapp';

-- 3) Reconstruir el unique para incluir source
DO $$
BEGIN
  IF to_regclass('public.external_integration') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.external_integration'::regclass
        AND contype = 'u'
        AND conname = 'lastapp_integration_account_id_lastapp_organization_id_key'
    ) THEN
      ALTER TABLE public.external_integration
        DROP CONSTRAINT lastapp_integration_account_id_lastapp_organization_id_key;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.external_integration'::regclass
        AND contype = 'u'
        AND conname = 'external_integration_account_source_org_key'
    ) THEN
      ALTER TABLE public.external_integration
        ADD CONSTRAINT external_integration_account_source_org_key
        UNIQUE (account_id, source, external_org_id);
    END IF;
  END IF;
END $$;

-- 4) Vista puente con el nombre/columnas viejos (las piezas que aún nombran
--    lastapp_integration siguen vivas hasta reescribirlas en capas siguientes).
DROP VIEW IF EXISTS public.lastapp_integration;
CREATE VIEW public.lastapp_integration
WITH (security_invoker = true) AS
  SELECT
    id, account_id,
    external_org_id AS lastapp_organization_id,
    organization_name, token_secret_name, ownership_type,
    is_active, created_at, updated_at, push_status_enabled,
    source
  FROM public.external_integration;
