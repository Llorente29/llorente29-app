-- supabase/migrations/20260620T1400_converge_c2_external_catalog_product.sql
-- ============================================================================
-- CONVERGENCIA DE INGESTA — Capa 2: lastapp_catalog_product → external_catalog_product.
-- ============================================================================
-- Segunda pieza con nombre 'lastapp_*' que se converge al modelo agnóstico. Es el
-- ESPEJO del catálogo del integrador (1.125 filas, todas con matrícula). Verificado:
-- external_catalog_product NO existe (sin choque); unique real =
-- lastapp_catalog_product_account_id_catalog_product_id_key.
--
-- Qué hace:
--   · RENAME lastapp_catalog_product → external_catalog_product (metadata: conserva
--     1.125 filas, FKs, índices, RLS).
--   · RENAME columnas acopladas: lastapp_organization_id→external_org_id,
--     lastapp_catalog_id→external_catalog_id, lastapp_brand_name→external_brand_name,
--     lastapp_channel→external_channel. (catalog_product_id, organization_product_id,
--     product_name, price_cents, product_type, is_enabled, seen_*, needs_review,
--     created_at, updated_at se quedan: ya son neutros.)
--   · ADD source text NOT NULL DEFAULT 'lastapp' (las 1.125 filas = 'lastapp').
--   · Unique (account_id, catalog_product_id) → (account_id, source, catalog_product_id).
--   · VISTA puente lastapp_catalog_product (security_invoker, columnas viejas) para
--     que las funciones que aún la nombran (seed/recast/resolve, sync-catalog) sigan
--     vivas hasta reescribirlas en capas siguientes. Trivial → actualizable.
--
-- Postgres 17.6. Idempotente (to_regclass). Sin BEGIN/COMMIT. Sin SECURITY DEFINER.
-- ============================================================================

-- 1) Renombrar tabla + columnas acopladas (solo si aún no se hizo)
DO $$
BEGIN
  IF to_regclass('public.lastapp_catalog_product') IS NOT NULL
     AND to_regclass('public.external_catalog_product') IS NULL THEN
    ALTER TABLE public.lastapp_catalog_product RENAME TO external_catalog_product;
    ALTER TABLE public.external_catalog_product RENAME COLUMN lastapp_organization_id TO external_org_id;
    ALTER TABLE public.external_catalog_product RENAME COLUMN lastapp_catalog_id      TO external_catalog_id;
    ALTER TABLE public.external_catalog_product RENAME COLUMN lastapp_brand_name      TO external_brand_name;
    ALTER TABLE public.external_catalog_product RENAME COLUMN lastapp_channel         TO external_channel;
  END IF;
END $$;

-- 2) Columna source (idempotente)
ALTER TABLE public.external_catalog_product
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'lastapp';

-- 3) Reconstruir el unique para incluir source
DO $$
BEGIN
  IF to_regclass('public.external_catalog_product') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.external_catalog_product'::regclass
        AND contype = 'u'
        AND conname = 'lastapp_catalog_product_account_id_catalog_product_id_key'
    ) THEN
      ALTER TABLE public.external_catalog_product
        DROP CONSTRAINT lastapp_catalog_product_account_id_catalog_product_id_key;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.external_catalog_product'::regclass
        AND contype = 'u'
        AND conname = 'external_catalog_product_account_source_catprod_key'
    ) THEN
      ALTER TABLE public.external_catalog_product
        ADD CONSTRAINT external_catalog_product_account_source_catprod_key
        UNIQUE (account_id, source, catalog_product_id);
    END IF;
  END IF;
END $$;

-- 4) Vista puente con el nombre/columnas viejos (seed/recast/resolve/sync-catalog
--    siguen vivos hasta reescribirlos en capas siguientes).
DROP VIEW IF EXISTS public.lastapp_catalog_product;
CREATE VIEW public.lastapp_catalog_product
WITH (security_invoker = true) AS
  SELECT
    id, account_id,
    external_org_id     AS lastapp_organization_id,
    catalog_product_id, organization_product_id,
    external_catalog_id AS lastapp_catalog_id,
    external_brand_name AS lastapp_brand_name,
    product_name, price_cents, product_type, is_enabled,
    seen_in_catalog_at, seen_in_sale_at, needs_review,
    created_at, updated_at,
    external_channel    AS lastapp_channel,
    source
  FROM public.external_catalog_product;
